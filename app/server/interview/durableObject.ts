import { DurableObject } from 'cloudflare:workers';
import { foundryConfig, foundryConfigured, type FoundryConfig } from '../../../ai/foundry.server';
import { SessionActor, type Background, type Checkpoint, type Lease, type SessionOptions, type SessionStore } from '../../../interview-engine/interview/interview.server';
import { foundryProviders, type Providers } from '../../../interview-engine/providers/providers.server';
import { spec } from '../../../interviews/project-closeout/spec';
import { LIVE_MODEL } from '../simulator/live.server';
import { d1Archive } from './archiveD1.server';
import { HostedSession } from './hosted';
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
};

/**
 * One interview attempt. The engine's SessionActor owns everything; this object adapts storage, alarms, background
 * work and D1 to its seams and hands the browser's commands to the hosted session.
 */
export class InterviewObject extends DurableObject<Env> {
  private session!: HostedSession;

  private readonly upgrade: () => { socket: WebSocketLike; response: Response };

  constructor(ctx: DurableObjectState, env: Env, overrides: InterviewObjectOverrides = {}) {
    super(ctx, env);
    this.upgrade = overrides.upgrade ?? acceptUpgrade;
    ctx.blockConcurrencyWhile(async () => {
      // Unconfigured, the paid calls fail, but owned attempts can still be read and closed.
      const foundry: FoundryConfig = foundryConfigured(env) ? foundryConfig(env) : { resourceName: '', apiKey: '', agentModel: '', fastModel: '', liveModel: env.AZURE_OPENAI_LIVE_MODEL || LIVE_MODEL };
      const providers = overrides.providers ?? foundryProviders({ ...foundry, typesafeKey: env.TYPESAFE_API_KEY }, { socket: acceptSocket });
      const background = durableBackground(ctx);
      const actor = await SessionActor.restore({
        spec, foundry, typesafeKey: env.TYPESAFE_API_KEY ?? '',
        providers, store: durableStore(ctx.storage), background,
        archive: d1Archive(env.SIMULATOR_ARCHIVE, { model: env.AZURE_OPENAI_LIVE_MODEL || LIVE_MODEL, workerId: env.CF_VERSION_METADATA?.id ?? null, workerTag: env.CF_VERSION_METADATA?.tag ?? null }),
        log: event => { if (event.type === 'session') console.warn('Interview session', event); },
        ...(overrides.services ? { services: overrides.services } : {}),
      });
      this.session = new HostedSession(actor, { narrate: overrides.narrate ?? narrateWith(providers), template: spec.narrative, model: foundry.agentModel, track: background.track });
    });
  }

  async fetch(request: Request): Promise<Response> {
    const context = socketContext(request);
    return context ? this.acceptSocket(context) : this.session.fetch(request);
  }

  /**
   * The socket transport, which the Worker forwards here only when it is enabled. Each command goes through the
   * Worker's HTTP routes with this attempt's session, so its gates and replies are the HTTP transport's.
   */
  private acceptSocket(context: SocketContext): Response {
    const { socket, response } = this.upgrade();
    const gates = { ...workerGates(this.env), session: (_id: string, command: Request) => this.session.fetch(command) };
    serveSocket(socket, context, request => routeInterview(request, gates));
    return response;
  }

  async alarm() {
    await this.session.actor.wake();
  }
}
