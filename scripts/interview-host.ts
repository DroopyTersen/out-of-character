/**
 * The reference host: the interview engine outside Cloudflare, in one Bun process.
 *
 *   bun --env-file=.dev.vars scripts/interview-host.ts    # PORT (default 8788), HOST (default 127.0.0.1)
 *
 * It serves the same `/api/interview/...` routes and replies as the Worker, over the engine's in-memory seams: attempts
 * live in this process, wakes are timers, background work runs inline, and archive rows are kept in memory (and written
 * to INTERVIEW_ARCHIVE_DIR as JSON when it is set). It reads the Worker's Foundry and Typesafe variables.
 */
import { foundryConfig, foundryConfigured } from '../ai/foundry.server';
import { summarizeInterview } from '../ai/interview/summary.server';
import { HostedSession } from '../app/server/interview/hosted';
import { routeInterview } from '../app/server/interview/routes';
import { inlineBackground, memoryArchive, memoryRecord, memoryStore } from '../interview-engine/interview/adapters/memory.server';
import { SessionActor, type Archive } from '../interview-engine/interview/interview.server';
import { foundryProviders } from '../interview-engine/providers/providers.server';
import { spec } from '../interviews/project-closeout/spec';

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
const providers = foundryProviders({ ...foundry, typesafeKey }, { fetch: upgradingFetch, socket: response => upgraded.get(response) ?? null });

const rows = memoryArchive();
const archive: Archive = {
  async write(row) {
    await rows.write(row);
    if (env.INTERVIEW_ARCHIVE_DIR) await Bun.write(`${env.INTERVIEW_ARCHIVE_DIR}/${row.id}.json`, JSON.stringify(rows.rows.get(row.id), null, 2));
  },
};

/** One hosted session per attempt id, restored on first use and dropped once its store has been cleared. */
const attempts = new Map<string, Promise<HostedSession>>();
function attempt(id: string) {
  let hosted = attempts.get(id);
  if (!hosted) attempts.set(id, hosted = open(id));
  return hosted;
}
async function open(id: string) {
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
    spec, providers, foundry, typesafeKey, store, background: inlineBackground(), archive,
    log: event => { if (event.type === 'session') console.warn('Interview session', event); },
  }).then(actor => new HostedSession(actor, { summarize: (input, finish) => summarizeInterview({ ...input, foundry }, finish), model: foundry.agentModel }));
  return hosted;
}

/** The Worker's limiter allows three starts a minute per key; this one keeps the same rule in memory. */
const starts = new Map<string, number[]>();
const limit = async (key: string) => {
  const now = Date.now();
  const recent = (starts.get(key) ?? []).filter(at => now - at < 60_000);
  if (recent.length >= 3) return false;
  starts.set(key, [...recent, now]);
  return true;
};

const server = Bun.serve({
  hostname: env.HOST || '127.0.0.1',
  port: Number(env.PORT || 8788),
  async fetch(request) {
    const response = await routeInterview(request, {
      available: () => true, limit,
      session: async (id, command) => (await attempt(id)).fetch(command),
    });
    return response ?? Response.json({ error: 'Not found.' }, { status: 404 });
  },
});
console.log(`Interview host on ${server.url} (spec ${spec.id} ${spec.version})`);
