/**
 * The reference host: the interview engine outside Cloudflare, in one Bun process.
 *
 *   bun --env-file=.dev.vars scripts/interview-host.ts    # PORT (default 8788), HOST (default 127.0.0.1)
 *
 * It serves the same `/api/interview/...` routes and replies as the Worker, including imported narratives, over the engine's in-memory seams: attempts
 * live in this process, wakes are timers, background work runs inline, and archive rows are kept in memory (and written
 * to INTERVIEW_ARCHIVE_DIR as JSON when it is set). It reads the Worker's Foundry and Typesafe variables, and accepts
 * the socket transport when INTERVIEW_SOCKET_ENABLED is "true".
 */
import { foundryConfig, foundryConfigured } from '../ai/foundry.server';
import { memoryDebriefStore, specCatalog, templates, type DebriefGates, type HostedSpec } from '../app/server/interview/debriefs';
import { HostedSession } from '../app/server/interview/hosted';
import { importedNarrative, narrateWith } from '../app/server/interview/narrative';
import { routeInterview, type InterviewGates } from '../app/server/interview/routes';
import { answerSocket, socketContext, type SocketContext } from '../app/server/interview/socket';
import { inlineBackground, memoryArchive, memoryRecord, memoryStore } from '../interview-engine/interview/adapters/memory.server';
import { SessionActor, type Archive } from '../interview-engine/interview/interview.server';
import { foundryProviders } from '../interview-engine/providers/providers.server';
import { createJevJudge } from '../interview-engine/providers/judge.server';
import { draftDebrief } from '../interview-engine/setup/draft.server';
import { startSchema } from '../interview-engine/shared/protocol';

const env = process.env;
if (!foundryConfigured(env) || !env.TYPESAFE_API_KEY) {
  console.error('Set AZURE_OPENAI_API_INSTANCE_NAME, AZURE_OPENAI_API_KEY, AZURE_OPENAI_AGENT_MODEL, AZURE_OPENAI_FAST_MODEL and TYPESAFE_API_KEY (for example in .env).');
  process.exit(1);
}
const foundry = foundryConfig(env);
const typesafeKey = env.TYPESAFE_API_KEY;

// GPT-Live's control channel is a WebSocket upgrade. Bun's fetch does not upgrade, so the upgrade request opens a
// WebSocket instead and the socket opener collects it from the response that stands in for the 101.
const upgraded = new WeakMap<Response, WebSocket>();
const upgradingFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  if (headers.get('Upgrade')?.toLowerCase() !== 'websocket') return fetch(input, init);
  headers.delete('Upgrade');
  const url = new URL(input instanceof Request ? input.url : input);
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
  const socket = new WebSocket(url, { headers: Object.fromEntries(headers) } as unknown as string[]);
  const opened = await new Promise<boolean>(resolve => {
    socket.addEventListener('open', () => resolve(true), { once: true });
    socket.addEventListener('error', () => resolve(false), { once: true });
    socket.addEventListener('close', () => resolve(false), { once: true });
    init?.signal?.addEventListener('abort', () => { socket.close(); resolve(false); }, { once: true });
  });
  if (!opened) return new Response(null, { status: 502 });
  const response = new Response(null, { status: 200 });
  upgraded.set(response, socket);
  return response;
}) as typeof fetch;
const providers = foundryProviders({ ...foundry, judge: createJevJudge({ apiKey: typesafeKey, fetch: upgradingFetch }) },
  { fetch: upgradingFetch, socket: response => upgraded.get(response) ?? null });

const rows = memoryArchive();
const archive: Archive = {
  async write(row) {
    await rows.write(row);
    if (env.INTERVIEW_ARCHIVE_DIR) await Bun.write(`${env.INTERVIEW_ARCHIVE_DIR}/${row.id}.json`, JSON.stringify(rows.rows.get(row.id), null, 2));
  },
};

// Approved debriefs live in this process; the templates are always served.
const debriefs: DebriefGates = {
  store: memoryDebriefStore(), catalog: specCatalog(memoryDebriefStore()),
  draft: (input, signal) => draftDebrief({ description: input.description, interviewer: { name: input.base.interviewer.name }, model: providers.language.agent, signal }),
};
debriefs.catalog = specCatalog(debriefs.store);

/**
 * One hosted session per attempt id, opened on first use under the debrief its start names (the first template for
 * anything else) and dropped once its store has been cleared.
 */
const attempts = new Map<string, Promise<HostedSession>>();
async function attempt(id: string, command: Request) {
  let hosted = attempts.get(id);
  if (!hosted) {
    const parsed = new URL(command.url).pathname === '/start' ? startSchema.safeParse(await command.clone().json().catch(() => null)) : null;
    const named = parsed?.success ? await debriefs.catalog.resolve(parsed.data.scenarioId) : null;
    attempts.set(id, hosted = open(id, named ?? templates[0]!));
  }
  return hosted;
}
async function open(id: string, spec: HostedSpec) {
  const record = memoryRecord();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hosted: Promise<HostedSession> | undefined;
  const wake = async () => {
    const session = await hosted!;
    await session.actor.wake();
    if (record.clears && !record.lease) attempts.delete(id);
  };
  const store = memoryStore(record, { onWake: at => {
    clearTimeout(timer);
    timer = at == null ? undefined : setTimeout(() => void wake().catch(error => console.error('Interview wake failed', id, error)), Math.max(0, at - Date.now()));
  } });
  hosted = SessionActor.restore({
    spec, providers, store, background: inlineBackground(), archive,
    log: event => { if (event.type === 'session') console.warn('Interview session', event); },
  }).then(actor => new HostedSession(actor, { narrate: narrateWith(providers), template: spec.narrative, model: foundry.agentModel }));
  return hosted;
}

/** The Worker's limiters allow three starts and 180 narratives a minute per key; these keep the same rules in memory. */
const recent = new Map<string, number[]>();
const limit = async (key: string, kind: 'session' | 'narrative' = 'session') => {
  const now = Date.now(), slot = `${kind}:${key}`;
  const calls = (recent.get(slot) ?? []).filter(at => now - at < 60_000);
  if (calls.length >= (kind === 'narrative' ? 180 : 3)) return false;
  recent.set(slot, [...calls, now]);
  return true;
};

// The socket transport is opt-in, as on the Worker: INTERVIEW_SOCKET_ENABLED=true.
const sockets = env.INTERVIEW_SOCKET_ENABLED === 'true';
const accepted = new WeakSet<Request>();
const gates: InterviewGates = {
  available: () => true, limit,
  session: async (id, command) => (await attempt(id, command)).fetch(command),
  narrative: (input, signal) => importedNarrative(input, id => debriefs.catalog.resolve(id), narrateWith(providers), signal),
  debriefs,
  ...(sockets ? { socket: (_id: string, upgrade: Request) => {
    const context = socketContext(upgrade);
    if (context && server.upgrade(upgrade, { data: context })) accepted.add(upgrade);
    return accepted.has(upgrade) ? new Response(null) : Response.json({ error: 'Expected a WebSocket upgrade.' }, { status: 426 });
  } } : {}),
};

const server = Bun.serve<SocketContext>({
  hostname: env.HOST || '127.0.0.1',
  port: Number(env.PORT || 8788),
  async fetch(request) {
    const response = await routeInterview(request, gates);
    // Bun answers an accepted upgrade itself.
    if (accepted.has(request)) return undefined;
    return response ?? Response.json({ error: 'Not found.' }, { status: 404 });
  },
  websocket: {
    // Each command goes through the same routes as its HTTP request.
    async message(socket, data) {
      socket.send(await answerSocket(typeof data === 'string' ? data : null, socket.data, request => routeInterview(request, gates)));
    },
  },
});
console.log(`Interview host on ${server.url} (templates ${templates.map(spec => `${spec.id} ${spec.version}`).join(', ')})`);
