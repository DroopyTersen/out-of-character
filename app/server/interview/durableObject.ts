import { DurableObject } from 'cloudflare:workers';
import { foundryConfig, foundryConfigured, type FoundryConfig } from '../../../ai/foundry.server';
import { SessionActor, type Background, type Checkpoint, type Lease, type SessionOptions, type SessionStore } from '../../../interview-engine/interview/interview.server';
import { foundryProviders, type Providers } from '../../../interview-engine/providers/providers.server';
import { spec } from '../../../interviews/project-closeout/spec';
import { LIVE_MODEL } from '../simulator/live.server';
import { d1Archive } from './archiveD1.server';
import { HostedSession } from './hosted';
import { narrateWith, type Narrate } from './narrative';

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

/** For tests: the providers, the paid calls and the narrative, in place of the ones built from the environment. */
export type InterviewObjectOverrides = { providers?: Providers; services?: SessionOptions['services']; narrate?: Narrate };

/**
 * One interview attempt. The engine's SessionActor owns everything; this object adapts storage, alarms, background
 * work and D1 to its seams and hands the browser's commands to the hosted session.
 */
export class InterviewObject extends DurableObject<Env> {
  private session!: HostedSession;

  constructor(ctx: DurableObjectState, env: Env, overrides: InterviewObjectOverrides = {}) {
    super(ctx, env);
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

  fetch(request: Request): Promise<Response> {
    return this.session.fetch(request);
  }

  async alarm() {
    await this.session.actor.wake();
  }
}
