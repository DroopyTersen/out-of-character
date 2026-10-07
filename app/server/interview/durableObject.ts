import { DurableObject } from 'cloudflare:workers';
import { foundryConfig } from '../../../ai/foundry.server';
import { summarizeInterview, SUMMARY_VERSION } from '../../../ai/interview/summary.server';
import type { InterviewSummaryContent } from '../../../core/interview';
import { idleReport, type ReportState } from '../../../core/simulator/report';
import { SessionActor, type Background, type Checkpoint, type Lease, type SessionOptions, type SessionStore } from '../../../interview-engine/interview/interview.server';
import { foundryProviders, type Providers } from '../../../interview-engine/providers/providers.server';
import { spec } from '../../../interviews/project-closeout/spec';
import { simulatorJson } from '../simulator/api';
import { LIVE_MODEL } from '../simulator/live.server';
import { SessionReport, within } from '../simulator/report';
import { d1Archive } from './archiveD1.server';

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

type Summarize = (input: { transcript: NonNullable<ReturnType<SessionActor['snapshot']>>['transcript']; signal: AbortSignal }, finish: Parameters<typeof summarizeInterview>[1]) => ReadableStream<string>;
/** For tests: the providers, the paid calls and the narrative, in place of the ones built from the environment. */
export type InterviewObjectOverrides = { providers?: Providers; services?: SessionOptions['services']; summarize?: Summarize };

/**
 * One interview attempt. The engine's SessionActor owns everything; this object adapts storage, alarms, background
 * work and D1 to its seams, forwards the browser's commands, and serves the narrative as the attempt's report.
 */
export class InterviewObject extends DurableObject<Env> {
  private actor!: SessionActor;
  private report: SessionReport<InterviewSummaryContent> | undefined;
  private readonly summarize: Summarize;

  constructor(ctx: DurableObjectState, env: Env, overrides: InterviewObjectOverrides = {}) {
    super(ctx, env);
    this.summarize = overrides.summarize ?? ((input, finish) => summarizeInterview({ ...input, foundry: foundryConfig(env) }, finish));
    ctx.blockConcurrencyWhile(async () => {
      const foundry = foundryConfig(env);
      this.actor = await SessionActor.restore({
        spec, foundry, typesafeKey: env.TYPESAFE_API_KEY ?? '',
        providers: overrides.providers ?? foundryProviders({ ...foundry, typesafeKey: env.TYPESAFE_API_KEY }, { socket: acceptSocket }),
        store: durableStore(ctx.storage), background: durableBackground(ctx),
        archive: d1Archive(env.SIMULATOR_ARCHIVE, { model: env.AZURE_OPENAI_LIVE_MODEL || LIVE_MODEL, workerId: env.CF_VERSION_METADATA?.id ?? null, workerTag: env.CF_VERSION_METADATA?.tag ?? null }),
        log: event => { if (event.type === 'session') console.warn('Interview session', event); },
        ...(overrides.services ? { services: overrides.services } : {}),
      });
    });
  }

  async fetch(request: Request): Promise<Response> {
    const action = new URL(request.url).pathname.slice(1);
    const body = request.body ? await request.text() : undefined;
    const reply = await this.actor.handle({ action, capability: request.headers.get('Authorization') ?? '', ...(body != null ? { body } : {}) });
    if (reply.report) return this.startReport(request);
    if (reply.terminal) {
      const report = action === 'poll' && this.report ? await this.report.read() : this.reportState();
      return simulatorJson({ ...reply.body as object, report });
    }
    return simulatorJson(reply.body, reply.status);
  }

  async alarm() {
    await this.actor.wake();
  }

  private reportState(): ReportState<InterviewSummaryContent> {
    const snapshot = this.actor.snapshot();
    if (!snapshot?.transcript.some(item => item.speaker === 'trainee' && item.text.trim())) return { status: 'ineligible', starts: 0, report: null, failure: null };
    return this.report?.state ?? idleReport();
  }

  private async startReport(request: Request): Promise<Response> {
    const closing = this.actor.closing;
    if (closing) {
      try { await within(closing, 40_000); }
      catch { return simulatorJson({ error: 'The conversation is still closing.' }, 409); }
    }
    const snapshot = this.actor.snapshot();
    if (!snapshot || !['ended', 'interrupted'].includes(snapshot.status)) return simulatorJson({ error: 'End the conversation before requesting its report.' }, 409);
    if (this.reportState().status === 'ineligible') return simulatorJson({ error: 'There is not enough scored conversation to review.' }, 422);
    if (!this.report) {
      const transcript = structuredClone(snapshot.transcript);
      this.report = new SessionReport<InterviewSummaryContent>((signal, finish) => this.summarize({ transcript, signal }, finish), archive => {
        this.actor.settleNarrative(archive.report ? { status: 'ready', text: archive.report.text } : { status: 'unavailable', text: null },
          { model: foundryConfig(this.env).agentModel, version: SUMMARY_VERSION, attempts: archive.attempts });
      });
    }
    return this.report.start(request);
  }
}
