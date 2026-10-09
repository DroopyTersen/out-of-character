import { resolveInterview, type InterviewDefinition } from '../../../interview-engine/interview/definition.server';
import { DurableObject } from 'cloudflare:workers';
import { foundryConfig, foundryConfigured, type FoundryConfig } from '../../../ai/foundry.server';
import { SessionActor, type Background, type Checkpoint, type Lease, type SessionOptions, type SessionStore } from '../../../interview-engine/interview/interview.server';
import { foundryProviders, type Providers } from '../../../interview-engine/providers/providers.server';
import { createJevJudge } from '../../../interview-engine/providers/judge.server';
import { startSchema } from '../../../interview-engine/shared/protocol';
import { LIVE_MODEL } from '../simulator/live.server';
import { d1Archive } from './archiveD1.server';
import { HostedSession } from './hosted';
import { templates, workerDebriefs, type HostedSpec, type SpecCatalog } from './debriefs';
import { narrateWith, type Narrate } from './narrative';
import { routeInterview, workerGates } from './routes';
import { serveSocket, socketContext, type SocketContext } from './socket';
import type { WebSocketLike } from '../../../interview-engine/providers/voice.server';

/** The SessionStore over Durable Object storage, under the keys the practice simulator's session has always used. */
export function durableStore(storage: DurableObjectStorage): SessionStore {
  return {
    async load() {
      const lease = await storage.get<Lease>('lease');
      const checkpoint = lease && !lease.closed ? await storage.get<Checkpoint>('checkpoint') : undefined;
      return { ...(lease ? { lease } : {}), ...(checkpoint ? { checkpoint } : {}) };
    },
    // One object owns its attempt, so storage writes are never stale here: nothing throws FencedError.
    async save(patch) {
      if (patch.lease) await storage.put('lease', patch.lease);
      if (patch.checkpoint === null) await storage.delete('checkpoint');
      else if (patch.checkpoint) await storage.put('checkpoint', patch.checkpoint);
    },
    async wake(at) {
      if (at == null) await storage.deleteAlarm();
      else await storage.setAlarm(at);
    },
    async clear() { await storage.deleteAll(); },
  };
}

export const durableBackground = (ctx: Pick<DurableObjectState, 'waitUntil'>): Background => ({ track: work => ctx.waitUntil(work) });

/** The Cloudflare upgrade: the socket arrives on the response and must be accepted before use. */
const acceptSocket = (response: Response) => {
  const socket = response.webSocket;
  if (!socket) return null;
  socket.accept();
  return socket;
};

/** Cloudflare's side of a WebSocket upgrade: the accepted server socket, and the 101 that hands the other end over. */
const acceptUpgrade = () => {
  const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
  server.accept();
  return { socket: server as WebSocketLike, response: new Response(null, { status: 101, webSocket: client }) };
};

/** For tests: the providers, the paid calls, the narrative and the socket upgrade, in place of the platform's. */
export type InterviewObjectOverrides = {
  providers?: Providers; services?: SessionOptions['services']; narrate?: Narrate;
  upgrade?: () => { socket: WebSocketLike; response: Response };
  /** The specs this object can run; the Worker's catalog otherwise. */
  catalog?: SpecCatalog;
};

/** The complete accepted definition is pinned before any voice session opens. */
export const SPEC_KEY = 'spec';
type SpecIdentity = Pick<HostedSpec, 'id' | 'version'>;
type PinnedSpec = InterviewDefinition | SpecIdentity;

/**
 * One interview attempt. The engine's SessionActor owns everything; this object adapts storage, alarms, background
 * work and D1 to its seams and hands the browser's commands to the hosted session.
 *
 * The attempt's spec is whichever debrief its start names, resolved through the catalog and recorded in storage, so
 * every later restore (resume, grading, report, archive) runs under the same id and version. Until a start names one,
 * commands run under the first template, which answers them as it always has (an unknown attempt, or an end held
 * for a start that never came).
 */
export class InterviewObject extends DurableObject<Env> {
  private session?: HostedSession;

  /** Whether storage records the spec; once it does, the session never changes. */
  private pinned = false;

  private turn: Promise<unknown> = Promise.resolve();

  private readonly catalog: SpecCatalog;

  private readonly overrides: InterviewObjectOverrides;

  private readonly upgrade: () => { socket: WebSocketLike; response: Response };

  constructor(ctx: DurableObjectState, env: Env, overrides: InterviewObjectOverrides = {}) {
    super(ctx, env);
    this.overrides = overrides;
    this.upgrade = overrides.upgrade ?? acceptUpgrade;
    this.catalog = overrides.catalog ?? workerDebriefs(env).catalog;
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<PinnedSpec>(SPEC_KEY);
      if (!stored) return;
      const spec = 'plan' in stored ? resolveInterview(stored.plan, stored.config, stored.context) : await this.catalog.resolve(stored.id, stored.version);
      if (!spec) throw new Error('The attempt’s original debrief is no longer served.');
      this.session = await this.open(spec);
      this.pinned = true;
    });
  }

  /** The hosted session under `spec`, over this object's storage, alarms, background work and D1. */
  private async open(spec: HostedSpec): Promise<HostedSession> {
    const { ctx, env, overrides } = this;
    // Unconfigured, the paid calls fail, but owned attempts can still be read and closed.
    const foundry: FoundryConfig = foundryConfigured(env) ? foundryConfig(env) : { resourceName: '', apiKey: '', agentModel: '', fastModel: '', liveModel: env.AZURE_OPENAI_LIVE_MODEL || LIVE_MODEL };
    const providers = overrides.providers ?? foundryProviders({ ...foundry, judge: createJevJudge({ apiKey: env.TYPESAFE_API_KEY }) }, { socket: acceptSocket });
    const background = durableBackground(ctx);
    const actor = await SessionActor.restore({
      plan: spec.plan, config: spec.config, context: spec.context, providers, store: durableStore(ctx.storage), background,
      archive: d1Archive(env.SIMULATOR_ARCHIVE, { model: env.AZURE_OPENAI_LIVE_MODEL || LIVE_MODEL, workerId: env.CF_VERSION_METADATA?.id ?? null, workerTag: env.CF_VERSION_METADATA?.tag ?? null }),
      log: event => { if (event.type === 'session') console.warn('Interview session', event); },
      ...(overrides.services ? { services: overrides.services } : {}),
    });
    return new HostedSession(actor, { narrate: overrides.narrate ?? narrateWith(providers), model: foundry.agentModel, track: background.track });
  }

  /**
   * The session a command runs under. A start that names a served debrief pins it: storage records the full definition and,
   * if an earlier command opened the default session, that session is fenced and the attempt is restored from the
   * same storage under the named spec, so a held end still counts. Everything else runs under the current session.
   */
  private ensure(command: Request): Promise<HostedSession> {
    const next = this.turn.then(async () => {
      if (this.pinned && this.session) return this.session;
      if (new URL(command.url).pathname === '/start') {
        const parsed = startSchema.safeParse(await command.clone().json().catch(() => null));
        const named = parsed.success ? await this.catalog.resolve(parsed.data.planId) : null;
        if (named) {
          await this.ctx.storage.put(SPEC_KEY, { plan: named.plan, config: named.config, ...(named.context ? { context: named.context } : {}) } satisfies InterviewDefinition);
          if (this.session) { await this.session.actor.close('fenced'); this.session = undefined; }
          this.session ??= await this.open(named);
          this.pinned = true;
          return this.session;
        }
      }
      return this.session ??= await this.open(this.catalog.templates[0] ?? templates[0]!);
    });
    this.turn = next.catch(() => undefined);
    return next;
  }

  async fetch(request: Request): Promise<Response> {
    const context = socketContext(request);
    return context ? this.acceptSocket(context) : (await this.ensure(request)).fetch(request);
  }

  /**
   * The socket transport, which the Worker forwards here only when it is enabled. Each command goes through the
   * Worker's HTTP routes with this attempt's session, so its gates and replies are the HTTP transport's.
   */
  private acceptSocket(context: SocketContext): Response {
    const { socket, response } = this.upgrade();
    const gates = { ...workerGates(this.env), session: async (_id: string, command: Request) => (await this.ensure(command)).fetch(command) };
    serveSocket(socket, context, request => routeInterview(request, gates));
    return response;
  }

  async alarm() {
    // Alarms belong to started attempts, whose spec is pinned; an alarm with nothing stored wakes the default session.
    await (this.session ?? await this.ensure(new Request('https://session/wake'))).actor.wake();
  }
}
