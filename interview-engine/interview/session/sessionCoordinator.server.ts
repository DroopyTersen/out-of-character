import type { EngineEvent } from '../../providers/diagnostics.server';
import { modelName, type Providers } from '../../providers/providers.server';
import type { VoiceEvent } from '../../providers/voice.server';
import { activitySchema, CAPABILITY, readySchema, resumeSchema, startSchema, submitTextSchema, type Activity, type SubmitTextInput, type SubmitTextReply } from '../../shared/protocol';
import type { InterviewSnapshot, SessionPause, SessionWarning } from '../../shared/snapshot';
import type { InterviewLimits } from '../../shared/spec';
import { resolveInterview, type InterviewDefinition, type ResolvedInterview } from '../definition.server';
import {
  SESSION_IDLE_TIMEOUT_MS, SESSION_IDLE_WARNING_MS, SESSION_LIMIT_SECONDS, SESSION_MAX_RESUMES, SESSION_PAUSE_HOLD_MS, SESSION_WALL_LIMIT_MS, within, type PauseSpan,
} from '../../shared/timing';
import { TRANSCRIPT_LIMIT, transcriptCharacters, type Passage } from '../../shared/transcript';
import { TopicGrading, type Evaluate } from '../judging/topicGrading.server';
import { judgeTopicCoverage } from '../judging/judgeTopicCoverage.server';
import { generateMap, settledPrefix } from '../reasoning/conversationMap.server';
import { InterviewProducer } from '../reasoning/interviewProducer.server';
import { evaluateTurn } from '../judging/judgeConversationTurn.server';
import { lookupInterviewBackground } from '../reasoning/backgroundResearch.server';
import { INTERVIEW_RUBRIC_VERSION } from '../judging/topicCoverage.prompt';
import { FencedError, type Archive, type Background, type InterviewArchiveRow, type NarrativeProvenance, type SessionStore } from '../seams.server';
import { interviewerBrief, interviewOpening } from '../voice/interviewerBrief.server';
import type { Checkpoint, ConnectionLog, Lease, NarrativeStatus, PauseRecord, SessionSnapshot } from './sessionCheckpoint';
import { appendTranscript, settledTranscript } from './sessionTranscript';
import { conversationSoFar, isTypedItem, NO_EXTERNAL_TASK, resumeInstruction, typedAnswerCue, typedItemId } from '../voice/voice.prompt';
import { judgeConversationSilence } from '../judging/judgeConversationSilence.server';
import { VoiceInterviewer, type VoiceOutput } from '../voice/voiceInterviewer.server';
import { UNRESPONSIVE } from '../voice/voiceRecovery.server';
import type { VoiceSegment } from '../voice/voiceSession';

/** The paid calls, replaceable for tests: Sol, Jev's turn reads, Luna, and Jev's coverage grade. */
export type SessionServices = {
  generateMap: typeof generateMap;
  evaluateTurn: typeof evaluateTurn;
  lookupInterviewBackground: typeof lookupInterviewBackground;
  evaluate: Evaluate;
  judgeConversationSilence: typeof judgeConversationSilence;
};

export type SessionOptions = InterviewDefinition & {
  /** Every paid client, credentials bound: nothing else in the options can reach a provider. */
  providers: Providers;
  store: SessionStore;
  background: Background;
  archive: Archive;
  now?: () => number;
  /** Receives the attempt's diagnostics; without it nothing is logged. */
  log?: (event: EngineEvent) => void;
  services?: Partial<SessionServices>;
  /**
   * For a host without timers: each command first runs any wake that has come due. A host with durable timers leaves
   * it off and calls `wake()` when the time it was given arrives.
   */
  lazyWake?: boolean;
};

/** One browser command. `body` is the request's JSON text, when it had one. */
export type Command = { action: string; capability: string; body?: string };
/**
 * The answer to a command. `terminal`: the attempt has ended, and the host adds its report state to the body.
 * `report`: the browser asked for the report, which the host serves once `closing` settles.
 */
export type Reply = { status: number; body: unknown; terminal?: true; report?: true };

const FENCED = 'Another owner has taken over this attempt.';
const INVALID = 'Invalid interview request.';
const CANCELLED = 'The attempt was cancelled.';
/** How long after the lease's deadline a provider session's closure is still retried. */
const CLOSURE_GRACE_MS = 60 * 60_000;
/** The attempt was ended before its provider session was opened; nothing paid happened. */
class Cancelled extends Error { constructor() { super(CANCELLED); this.name = 'Cancelled'; } }
const interviewerSpoke = (transcript: Passage[]) => transcript.some(entry => entry.speaker === 'interviewer' && entry.text.trim());
const reply = (body: unknown, status = 200): Reply => ({ status, body });
const parse = (body: string | undefined): unknown => { try { return JSON.parse(body ?? ''); } catch { return undefined; } };
const defaultLimits: InterviewLimits = {
  durationSeconds: SESSION_LIMIT_SECONDS, idleWarningMs: SESSION_IDLE_WARNING_MS, idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
  pauseHoldMs: SESSION_PAUSE_HOLD_MS, maxResumes: SESSION_MAX_RESUMES,
};
const digest = async (text: string) => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 12);
};

/** Coverage from the host's injected decision model. */
function judgeWith(spec: ResolvedInterview, providers: Providers): Evaluate {
  return ({ transcript, revision, signal }) => judgeTopicCoverage({ spec, passages: transcript, revision, signal }, providers);
}

/**
 * Owns one attempt for as long as this owner holds it. The closure lease always survives a lost owner; once the
 * conversation has gone live, a checkpoint lets a replacement hold it for the browser to resume, or finish it with
 * what was captured. A save the store refuses means another owner has taken over: this one stops and writes nothing.
 */
export class SessionCoordinator {
  private readonly spec: ResolvedInterview;
  private readonly limits: InterviewLimits;
  private readonly providers: Providers;
  private readonly store: SessionStore;
  private readonly background: Background;
  private readonly archive: Archive;
  private readonly now: () => number;
  private readonly report: (event: EngineEvent) => void;
  private readonly paid: SessionServices;
  private readonly lazyWake: boolean;
  private lease: Lease | undefined;
  private state: SessionSnapshot | undefined;
  private readonly grading: TopicGrading;
  private narrativeStatus: NarrativeStatus | null = null;
  private readonly voice: VoiceInterviewer;
  private timer: ReturnType<typeof setInterval> | undefined;
  private finishing: Promise<void> | undefined;
  /** Original end intent while closing is pending, including after a failed store write. */
  private endingInterrupted: boolean | undefined;
  private orphaning: Promise<void> | undefined;
  private connecting: Promise<{ sdp: string }> | undefined;
  private pausing: Promise<void> | undefined;
  private lastSeen: number;
  private lastActivity: number;
  private connectingSince: number | undefined;
  private capacityDeadline: number | null = null;
  private passageUpdatedAt = new Map<string, number>();
  private frozenPassages = new Set<string>();
  private reachedLive = false;
  private pauses: PauseRecord[] = [];
  private resumes = 0;
  /** Restored from a checkpoint too close to its limit to resume; finished on first contact. */
  private recovered = false;
  private producer: InterviewProducer | undefined;
  private activitySequence = -1;
  private seenEvents = new Set<string>();
  /** When the attempt ended, while the archive has not acknowledged its final row. Its terminal checkpoint is kept until then. */
  private unarchived: number | null = null;
  private narrativeArchive = Promise.resolve();
  private narrative: NarrativeProvenance | undefined;
  private digests: Promise<[string, string]> | undefined;
  private wakeAt: number | null = null;
  private fenced = false;
  /** The browser holds a typed draft: silence nudges wait. Reported by sequenced activity; never stored. */
  private composing = false;
  /** Typed answers whose required checkpoint is still being written, by passage id; a retry shares the operation. */
  private typedPending = new Map<string, Promise<Reply>>();
  /** Typed turns the current provider session has not heard; a resume rebuilds them from the transcript instead. */
  private typedUnforwarded = new Set<string>();
  /** Every checkpoint write and deletion, in issue order. Each link builds its checkpoint when it runs. */
  private storage: Promise<void> = Promise.resolve();

  private constructor(options: SessionOptions) {
    this.spec = resolveInterview(options.plan, options.config, options.context);
    this.limits = this.spec.limits ?? defaultLimits;
    this.providers = options.providers;
    this.store = options.store;
    this.background = options.background;
    this.archive = options.archive;
    this.now = options.now ?? Date.now;
    this.report = options.log ?? (() => {});
    this.paid = { generateMap, evaluateTurn, lookupInterviewBackground, evaluate: judgeWith(this.spec, options.providers), judgeConversationSilence, ...options.services };
    this.grading = new TopicGrading({
      evaluate: this.paid.evaluate, now: this.now,
      current: () => ({ transcript: settledTranscript(this.state!.transcript, this.passageUpdatedAt, this.now()), revision: this.state!.revision }),
      freeze: passages => { for (const passage of passages) this.frozenPassages.add(passage.id); },
    });
    this.voice = new VoiceInterviewer({
      spec: this.spec, provider: this.providers.voice, now: this.now,
      conversation: () => this.fenced || !this.state || this.ended() ? null : {
        status: this.state.status, transcript: this.state.transcript, revision: this.state.revision, composing: this.composing,
      },
      judgeSilence: input => this.paid.judgeConversationSilence({ ...input, judge: this.providers.judge.model }),
      silenceContinue: this.providers.judge.thresholds.silenceContinue,
      admit: () => {
        if (this.fenced) throw new FencedError();
        if (this.finishing || this.state?.status === 'ending') throw new Cancelled();
      },
      persist: () => this.persistLease(), output: message => this.voiceOutput(message),
    });
    this.lazyWake = options.lazyWake ?? false;
    this.lastSeen = this.lastActivity = this.now();
  }

  /**
   * Loads the attempt this store is bound to. A started conversation whose owner was lost is held for its browser to
   * resume; a finished one whose final row was never acknowledged is archived again.
   */
  static async restore(options: SessionOptions): Promise<SessionCoordinator> {
    const stored = await options.store.load();
    const accepted = stored.checkpoint?.definition;
    const coordinator = new SessionCoordinator(accepted ? { ...options, ...accepted, context: accepted.context } : options);
    coordinator.lease = stored.lease;
    if (coordinator.lease && stored.checkpoint) await coordinator.restoreCheckpoint(stored.checkpoint);
    return coordinator;
  }

  /** A copy of the accepted input, including the report format and context used after resume. */
  get definition(): InterviewDefinition {
    return structuredClone({ plan: this.spec.plan, config: this.spec.config, ...(this.spec.context ? { context: this.spec.context } : {}) });
  }

  /** Finishes through the first final archive write, resuming a failed close before the host starts its report. */
  get closing(): Promise<void> | undefined { return this.endingInterrupted !== undefined ? this.end() : this.finishing; }

  private get segment(): Readonly<VoiceSegment> | undefined { return this.voice.current; }

  async handle(command: Command): Promise<Reply> {
    if (this.fenced) return reply({ error: FENCED }, 409);
    try {
      if (this.lazyWake && this.wakeAt != null && this.now() >= this.wakeAt) await this.wake();
      return await this.dispatch(command);
    } catch (error) {
      if (error instanceof FencedError || this.fenced) return reply({ error: FENCED }, 409);
      throw error;
    }
  }

  private async dispatch({ action, capability, body }: Command): Promise<Reply> {
    if (!CAPABILITY.test(capability)) return reply({ error: 'Session capability is required.' }, 401);
    if (this.lease && capability !== this.lease.capability) return reply({ error: 'Session ownership did not match.' }, 403);
    if (action === 'start') return this.start(body, capability);
    if (!this.lease) {
      // A cancelled browser may send end before its creation request arrives.
      if (action === 'end') {
        this.lease = { capability, providerIds: [], deadline: this.now(), closed: true };
        await this.save({ lease: this.lease });
        await this.setWake(this.now() + 60_000);
        return reply({ ended: true });
      }
      return reply({ error: 'This interview session was not found.' }, 404);
    }
    this.recoverCheckpoint();
    if (!this.state) {
      if (!this.lease.closed) this.background.track(this.closeOrphan());
      return reply({ error: 'This interview session was interrupted. Start a new attempt.' }, 410);
    }
    if (action === 'report') return { status: 200, body: null, report: true };
    if (action === 'end' && this.endingInterrupted !== undefined) await this.end();
    // A terminal snapshot is not an acceptance receipt.
    // A retry of a turn already in the transcript is still acknowledged after the end; a new one is not.
    if (action === 'submitText' && this.ended()) return this.submitText(body);
    // Terminal reads must not refresh a lease, heartbeat, or live state.
    if (this.ended()) return { status: 200, body: this.publicSnapshot(), terminal: true };
    this.lastSeen = this.now();
    if (action === 'submitText') return this.submitText(body);
    if (action === 'poll' && body) {
      const parsed = activitySchema.safeParse(parse(body));
      if (!parsed.success) return reply({ error: INVALID }, 400);
      this.applyActivity(parsed.data, this.now());
    }
    // The browser's current activity rides on ready, so a draft opened while reconnecting protects the resumed session.
    if (action === 'ready' && body) {
      const parsed = readySchema.safeParse(parse(body));
      if (!parsed.success) return reply({ error: INVALID }, 400);
      if (parsed.data) this.applyActivity(parsed.data, this.now());
    }
    // A best-effort report from a browser that lost its media; the server never depends on it.
    if (action === 'pause') this.background.track(this.pause('browser'));
    if (action === 'resume') return this.resume(body);
    if (action === 'ready' && this.state.status === 'connecting') {
      if (this.checkLifetime()) return reply(this.publicSnapshot());
      if (this.reachedLive) this.resumed();
      else {
        // The lease makes start single-use, so this transition and its greeting happen once.
        this.state.status = 'live';
        this.reachedLive = true;
        this.lastActivity = this.now();
        this.voice.greet('opening', interviewOpening(this.spec, this.state.voiceId));
      }
    }
    if (action === 'end') await this.end();
    this.checkLifetime();
    if (action === 'poll' && this.state.status === 'live') {
      const recovery = this.voice.checkSilence(this.now());
      if (recovery) this.background.track(recovery);
    }
    return reply(this.publicSnapshot());
  }

  /** A poll's or ready's activity report. Stale reports are dropped; activity changes composing only when sequenced. */
  private applyActivity(activity: Activity, now: number) {
    if (activity.sequence != null && activity.sequence <= this.activitySequence) return;
    if (activity.sequence != null) this.activitySequence = activity.sequence;
    if (activity.active || activity.audio) this.lastActivity = now;
    if (activity.audio) this.voice.playback(now);
    if (activity.network) this.voice.network({ at: now, ...activity.network });
    if (activity.sequence != null && activity.composing !== undefined) this.setComposing(activity.composing, now);
  }

  /** Opening a draft cancels a pending silence judgment; closing it starts a fresh four-second interval. */
  private setComposing(value: boolean, now: number) {
    if (value === this.composing) return;
    this.composing = value;
    this.voice.composing(value, now);
    if (!value) this.producer?.flushNotes(now);
  }

  /**
   * One typed participant answer. Validation, deduplication and the append happen before the first await; the reply
   * waits for a checkpoint holding the turn, and the answer is then forwarded once to the same provider session.
   */
  private submitText(body: string | undefined): Promise<Reply> | Reply {
    const parsed = submitTextSchema.safeParse(parse(body));
    if (!parsed.success) return reply({ error: INVALID }, 400);
    const input = parsed.data;
    const snapshot = this.state!;
    const id = typedItemId(input.id);
    const existing = snapshot.transcript.find(entry => entry.id === id);
    if (existing) {
      if (existing.text !== input.text) return reply({ error: 'This answer was already sent with different text.' }, 409);
      // A retry never trusts memory: the required save runs again unless it is still in flight.
      const pending = this.typedPending.get(id);
      if (pending) return pending;
      if (this.fenced) return reply({ error: 'The interview is not live.' }, 409);
      // After the end the turn is in the transcript, the final archive and the grade record; there is no checkpoint to save.
      if (snapshot.status === 'ending' || this.ended()) return reply({ acceptedId: input.id, snapshot: this.publicSnapshot() } satisfies SubmitTextReply);
      return this.acceptTyped(input);
    }
    if (this.fenced || snapshot.status !== 'live') return reply({ error: 'The interview is not live.' }, 409);
    if (snapshot.transcript.length + 1 > TRANSCRIPT_LIMIT.entries || transcriptCharacters(snapshot.transcript) + input.text.length > TRANSCRIPT_LIMIT.characters) {
      return reply({ error: 'The transcript is full.' }, 409);
    }
    const now = this.now();
    const segment = this.segment!;
    // A point on the speech timeline, never before anything already said.
    const at = Math.max(snapshot.transcript.reduce((max, entry) => Math.max(max, entry.endMs), 0), segment.offsetMs + (now - segment.startedAt));
    const passage: Passage = { id, speaker: 'participant', text: input.text, startMs: at, endMs: at };
    const next = [...snapshot.transcript, passage];
    // Frozen: later speech starts a new passage instead of extending the typed one.
    this.frozenPassages.add(id);
    this.typedUnforwarded.add(id);
    this.committed(next, passage, now);
    const pending = this.acceptTyped(input).finally(() => this.typedPending.delete(id));
    this.typedPending.set(id, pending);
    return pending;
  }

  /** Acknowledges a typed answer once a checkpoint holding it is saved, forwarding it to the live provider session once. */
  private async acceptTyped(input: SubmitTextInput): Promise<Reply> {
    try { await this.requiredCheckpoint(); }
    catch (error) {
      if (error instanceof FencedError) throw error;
      return reply({ error: 'Your answer could not be saved. Try again.' }, 503);
    }
    // A session that is not live learns the answer from the resume context instead. A failed send is rebuilt the same way.
    const id = typedItemId(input.id);
    if (this.typedUnforwarded.has(id) && this.state?.status === 'live' && this.segment && !this.fenced) {
      this.typedUnforwarded.delete(id);
      // Context first, so Sam answers the typed turn knowing what the producer learned meanwhile.
      this.setComposing(false, this.now());
      this.voice.send({ kind: 'context', id, content: typedAnswerCue(input.text) });
    }
    return reply({ acceptedId: input.id, snapshot: this.publicSnapshot() } satisfies SubmitTextReply);
  }

  /** What the browser sees, or null before the attempt has started here. */
  snapshot(): InterviewSnapshot | null {
    return this.state ? this.publicSnapshot() : null;
  }

  /** The transcript so far, in the engine's speaker names. */
  transcript(): Passage[] {
    return this.state?.transcript ?? [];
  }

  /**
   * `hold`: the browser's link closed or this process is stopping; the attempt is held for the browser to resume.
   * `fenced`: another owner has taken over; this one stops without writing.
   */
  async close(reason: 'hold' | 'fenced'): Promise<void> {
    if (reason === 'fenced') { this.fence(); return; }
    if (this.fenced) return;
    await this.pause('browser').catch(error => { if (!(error instanceof FencedError)) throw error; });
  }

  /**
   * The narrative settled: its status rides in the snapshot and its provenance in the archive, which is rewritten once
   * the end-of-attempt row has been written.
   */
  settleNarrative(status: NarrativeStatus, provenance: NarrativeProvenance) {
    if (!this.state) return;
    this.narrative = provenance;
    this.narrativeStatus = status;
    this.narrativeArchive = this.narrativeArchive.then(async () => {
      if (this.finishing) await within(this.finishing, 15_000).catch(() => {});
      await this.archiveFinal();
    });
    this.background.track(this.narrativeArchive);
  }

  private publicSnapshot(): InterviewSnapshot {
    const snapshot = this.state!;
    const { evaluation, feedbackStatus } = this.grading.snapshot();
    return { ...snapshot, pause: snapshot.pause ?? null, evaluation, feedbackStatus, background: this.producer?.publicBackground() ?? [] };
  }

  /** The attempt has ended here, one way or the other. */
  private ended(): boolean {
    return this.state?.status === 'ended' || this.state?.status === 'interrupted';
  }

  /** A store write under this owner's fence: refused once fenced, and fencing this owner when the store refuses it. */
  private async guarded(write: () => Promise<void>) {
    if (this.fenced) throw new FencedError();
    try { await write(); }
    catch (error) {
      if (error instanceof FencedError) this.fence();
      throw error;
    }
  }

  private save(patch: { lease?: Lease; checkpoint?: Checkpoint | null }) {
    return this.guarded(() => this.store.save(patch));
  }

  private setWake(at: number | null) {
    return this.guarded(() => { this.wakeAt = at; return this.store.wake(at); });
  }

  private async clearStore() {
    if (this.fenced) throw new FencedError();
    this.wakeAt = null;
    // Ordered behind any checkpoint write still in flight, so a late write cannot restore what this removes.
    await this.ordered(() => this.guarded(() => this.store.clear()));
  }

  /** Stops the live timer and silence check. Each caller orders grading and voice settlement itself. */
  private stopClock() {
    clearInterval(this.timer);
    this.timer = undefined;
    void this.voice.stopRecovery();
  }

  /** Runs a checkpoint write or deletion after every earlier one. Its failure is the caller's; the chain continues. */
  private ordered(write: () => Promise<void>): Promise<void> {
    const link = this.storage.then(write);
    this.storage = link.catch(() => {});
    return link;
  }

  /** Saves a checkpoint built when its turn in the chain comes, and propagates any failure. */
  private requiredCheckpoint(): Promise<void> {
    return this.ordered(() => this.save({ checkpoint: this.checkpoint() }));
  }

  private checkpoint(savedAt = this.now()): Checkpoint {
    const { evaluation, feedbackStatus, grades, gradeCalls } = this.grading.snapshot();
    return structuredClone({
      definition: this.definition, savedAt, snapshot: { ...this.state!, feedbackStatus, interview: { evaluation, summary: this.narrativeStatus } }, reachedLive: this.reachedLive, epoch: this.voice.epoch, resumes: this.resumes,
      segments: [...this.voice.segments], pauses: this.pauses, grades, gradeCalls,
      ...(this.producer ? { producer: this.producer.checkpoint() } : {}),
    });
  }

  /** A newer owner holds the attempt: drop the voice socket, stop the clock and paid work, and write nothing more. */
  private fence() {
    if (this.fenced) return;
    this.fenced = true;
    this.stopClock();
    void this.grading.stop();
    this.producer?.close();
    // The successor owns the provider IDs retained in the durable lease.
    this.voice.detach();
    this.report({ type: 'session', event: 'fenced', id: this.state?.id ?? '' });
  }

  private async start(body: string | undefined, capability: string): Promise<Reply> {
    const parsed = startSchema.safeParse(parse(body));
    if (!parsed.success || parsed.data.planId !== this.spec.id || !this.spec.interviewer.voices.some(voice => voice.id === parsed.data.voiceId)) return reply({ error: INVALID }, 400);
    const input = parsed.data;
    if (this.lease) return reply({ error: 'This attempt has already been used. Start a new attempt.' }, 409);
    const now = this.now();
    this.lease = { capability, providerIds: [], deadline: now + this.limits.durationSeconds * 1000, closed: false };
    this.state = {
      id: input.id, planId: input.planId, voiceId: input.voiceId,
      status: 'connecting', startedAt: now, limitSeconds: this.limits.durationSeconds, warning: null,
      revision: 0, transcript: [],
      message: null, finalization: 'pending', usageSeconds: null,
    };
    this.createProducer();
    const snapshot = this.state;
    try {
      // The lease is durable before any provider session exists. An end that arrives meanwhile waits for this and
      // then finds no segment to close, because creation is skipped once the attempt is ending.
      this.connecting = this.connect(input);
      const created = await this.connecting;
      if (this.finishing || snapshot.status === 'ending' || this.lease.closed) return reply({ error: CANCELLED }, 409);
      this.lastSeen = this.now();
      this.timer = setInterval(() => this.tick(), 500);
      return reply({ sdp: created.sdp, snapshot: this.publicSnapshot() });
    } catch (error) {
      if (error instanceof FencedError || this.fenced) throw error;
      if (error instanceof Cancelled) return reply({ error: CANCELLED }, 409);
      snapshot.message = 'The voice connection could not be established.';
      await this.end(true);
      return reply({ error: snapshot.message }, 502);
    }
  }

  /** Saves the new lease, then opens the first provider session unless the attempt has been ended meanwhile. */
  private async connect(input: { voiceId: string; sdp: string }) {
    await this.save({ lease: this.lease! });
    await this.setWake(this.now() + 30_000);
    return this.voice.open(input);
  }

  private createProducer() {
    const snapshot = this.state!;
    const settled = () => settledTranscript(this.state!.transcript, this.passageUpdatedAt, this.now());
    // Sol's log is append-only, so the producer reads only up to the first passage still being transcribed.
    const prefix = () => { const ready = new Set(settled()); return settledPrefix(this.state!.transcript, entry => ready.has(entry)); };
    this.producer = new InterviewProducer({
      spec: this.spec, attemptId: snapshot.id, startedAt: snapshot.startedAt,
      models: { agent: modelName(this.providers.language.agent), fast: modelName(this.providers.language.fast) },
      thresholds: this.providers.judge.thresholds,
      services: {
        generateMap: input => this.paid.generateMap({ ...input, structured: this.providers.structured }),
        evaluateTurn: input => this.paid.evaluateTurn({ ...input, judge: this.providers.judge.model }),
        lookupInterviewBackground: input => this.paid.lookupInterviewBackground({ ...input, model: this.providers.language.fast, webSearch: this.providers.webSearch }),
      },
      settled: prefix, coverage: () => this.grading.snapshot().evaluation?.objectives ?? [], send: note => this.voice.send({ kind: 'context', ...note }), notesHeld: () => this.composing, waitUntil: work => this.background.track(work),
      pauses: () => this.pauseSpans(),
    });
  }

  private voiceOutput(message: VoiceOutput) {
    if (this.fenced) return;
    if (message.type === 'event') return this.onEvent(message.event, message.segment);
    if (message.type === 'dropped') return this.dropped(message.segment);
    if (message.type === 'replace') this.background.track(this.pause('provider'));
    if (message.type === 'unresponsive') this.state!.message = UNRESPONSIVE;
    if (message.type === 'responded' && this.state?.message === UNRESPONSIVE) this.state.message = null;
  }

  private dropped(segment: Readonly<VoiceSegment>) {
    const status = this.state?.status;
    if (this.fenced || this.finishing || segment !== this.segment || segment.finalization === 'confirmed' || status === 'paused') return;
    if (this.reachedLive && (status === 'live' || status === 'connecting')) this.background.track(this.pause('provider'));
    else this.background.track(this.end(true));
  }

  private onEvent(event: VoiceEvent, segment: Readonly<VoiceSegment>) {
    const snapshot = this.state;
    if (this.fenced || !snapshot || this.ended()) return;
    if (event.type === 'closed') {
      snapshot.usageSeconds = this.voice.usageSeconds();
      if (segment !== this.segment) return;
      if (this.finishing || snapshot.status === 'paused') return;
      // A lost connection holds a conversation that has started; policy and limit closures still end it.
      if (event.reason === 'connection_lost' && this.reachedLive && (snapshot.status === 'live' || snapshot.status === 'connecting')) {
        this.background.track(this.pause('provider'));
        return;
      }
      if (event.reason !== 'close_requested') snapshot.message = event.reason === 'connection_lost' ? 'The voice connection was interrupted.' : 'The voice session ended.';
      this.background.track(this.end(event.reason === 'connection_lost'));
      return;
    }
    if (event.type === 'transcript') {
      const delta = event;
      // The participant cannot hear a reply generated after they end the interview or lose the connection.
      if ((snapshot.status === 'ending' || snapshot.status === 'paused') && delta.speaker === 'interviewer') return;
      const key = delta.id && `${segment.epoch}:${delta.id}`;
      if (key && this.seenEvents.has(key)) return;
      if (key) this.seenEvents.add(key);
      const next = appendTranscript(snapshot.transcript, {
        speaker: delta.speaker, text: delta.text,
        startMs: delta.startMs + segment.offsetMs, endMs: delta.endMs + segment.offsetMs,
      }, this.frozenPassages);
      // Late deltas may arrive during close. Keep the final grading input valid.
      if (next.length > TRANSCRIPT_LIMIT.entries || transcriptCharacters(next) > TRANSCRIPT_LIMIT.characters) return;
      const changed = next.find(entry => !snapshot.transcript.includes(entry));
      if (!changed) return;
      this.committed(next, changed, this.now());
      return;
    }
    if (event.type === 'acknowledged') {
      this.producer?.providerEvent(event.id, true, {
        ...(event.startMs != null ? { startMs: event.startMs + segment.offsetMs } : {}),
        ...(event.endMs != null ? { endMs: event.endMs + segment.offsetMs } : {}),
      });
    }
    if (event.type === 'delegation') {
      const replied = event.target === 'client' && this.voice.send({ kind: 'context', id: crypto.randomUUID(), delegationId: event.id, content: NO_EXTERNAL_TASK });
      // Research belongs to the producer; Sam's own delegation attempts are logged, never run.
      this.producer?.delegation(event.id, event.target, replied);
    }
    if (event.type === 'error') {
      // A typed answer is already saved; a rejected delivery is recovered by reconnecting with it in the resume context.
      if (typeof event.id === 'string' && isTypedItem(event.id)) {
        snapshot.message = 'Your answer is saved. Reconnect to continue.';
        this.background.track(this.pause('provider'));
        return;
      }
      // A declined optional note need not interrupt an otherwise-working interview.
      if (typeof event.id === 'string' && /^(cue|note)-/.test(event.id)) {
        this.producer?.providerEvent(event.id, false);
        return;
      }
      snapshot.message = 'The voice service reported a problem. You can end this attempt and try again.';
    }
  }

  /** Speech and typed answers alike: the transcript grew by `changed` on the current segment. */
  private committed(next: Passage[], changed: Passage, now: number) {
    const snapshot = this.state!;
    this.passageUpdatedAt.set(changed.id, now);
    this.lastActivity = now;
    this.voice.transcript(changed, now);
    snapshot.transcript = next;
    snapshot.revision++;
    this.producer?.transcriptChanged(changed, next[next.indexOf(changed) - 1]?.id ?? null, now);
    if (snapshot.transcript.length >= TRANSCRIPT_LIMIT.entries * .9 || transcriptCharacters(snapshot.transcript) >= TRANSCRIPT_LIMIT.characters * .9) this.capacityDeadline ??= now + 30_000;
  }

  private tick() {
    const snapshot = this.state;
    if (this.fenced || !snapshot || snapshot.status !== 'live') return;
    const now = this.now();
    if (this.checkLifetime()) return;
    const recovery = this.voice.tick(now);
    if (recovery) this.background.track(recovery);
    this.producer?.tick(now);
    const grading = this.grading.tick();
    if (grading) this.background.track(grading);
  }

  /** Shared by polls, the live tick and the wake; browser contact is not conversation activity. */
  private checkLifetime(): boolean {
    const snapshot = this.state;
    const now = this.now();
    if (snapshot?.status === 'paused' && !this.finishing) {
      if (this.pausing) return true;
      const hold = snapshot.pause;
      if (!hold || now < hold.resumeBy) return false;
      const capped = hold.resumeBy < hold.pausedAt + this.limits.pauseHoldMs;
      snapshot.message = `The interview ended because the connection did not return ${capped ? 'in time' : 'within 15 minutes'}.`;
      this.background.track(this.end());
      return true;
    }
    if (!snapshot || (snapshot.status !== 'live' && snapshot.status !== 'connecting')) return !!this.finishing;
    if (now - this.lastSeen > 35_000) {
      // A page that went quiet mid-conversation most likely lost its network; hold the attempt for it.
      if (this.reachedLive) {
        this.background.track(this.pause('browser'));
        return true;
      }
      snapshot.message = 'Interview ended after losing contact with this page.';
      this.background.track(this.end());
      return true;
    }
    if (snapshot.status === 'connecting') {
      if (now - (this.connectingSince ?? snapshot.startedAt) < 60_000) return false;
      if (this.reachedLive) {
        snapshot.message = 'Reconnecting timed out. Try resuming again.';
        this.background.track(this.pause('browser'));
        return true;
      }
      snapshot.message = 'The voice connection timed out before the interview began.';
      this.background.track(this.end(true));
      return true;
    }
    let warning: SessionWarning | null = null;
    if (now - this.lastActivity >= this.limits.idleWarningMs) warning = { kind: 'idle', endsAt: this.lastActivity + this.limits.idleTimeoutMs };
    const deadline = this.lease!.deadline;
    if (now >= deadline - 60_000 && (!warning || deadline < warning.endsAt)) warning = { kind: 'limit', endsAt: deadline };
    if (this.capacityDeadline && (!warning || this.capacityDeadline < warning.endsAt)) warning = { kind: 'capacity', endsAt: this.capacityDeadline };
    snapshot.warning = warning;
    if (!warning || now < warning.endsAt) return false;
    // Automatic limits give current speech a short bounded drain. Explicit End remains immediate.
    if (warning.kind !== 'idle' && now < warning.endsAt + 20_000 && (now < warning.endsAt + 3000 || now - this.voice.lastActivityAt < 2500)) return true;
    snapshot.message = warning.kind === 'idle' ? 'Interview ended after five minutes without activity.' : warning.kind === 'limit' ? 'Interview reached the 60-minute safety limit.' : 'Interview reached its transcript capacity.';
    this.background.track(this.end());
    return true;
  }

  private openPause(): PauseRecord | undefined {
    const last = this.pauses.at(-1);
    return last && last.resumedAt === null && last.endedAt === null ? last : undefined;
  }

  private pauseSpans(): PauseSpan[] {
    return this.pauses.map(pause => ({ from: pause.pausedAt, to: pause.resumedAt ?? pause.endedAt }));
  }

  /** The live limit, extended by paused time, within the wall-clock cap. */
  private limitAt(now: number) {
    const open = this.openPause();
    return Math.min(this.lease!.deadline + (open ? now - open.pausedAt : 0), this.state!.startedAt + SESSION_WALL_LIMIT_MS);
  }

  /** Holds a started conversation after a lost connection. Idempotent; a conversation near a hard limit ends instead. */
  private pause(reason: SessionPause['reason']): Promise<void> {
    if (this.pausing) return this.pausing;
    const snapshot = this.state;
    if (this.fenced || !snapshot || this.finishing || !this.reachedLive || (snapshot.status !== 'live' && snapshot.status !== 'connecting')) return Promise.resolve();
    const now = this.now();
    if (this.capacityDeadline || now >= this.limitAt(now) - 60_000) {
      snapshot.message = 'The interview ended because the connection was lost close to its limit.';
      return this.end();
    }
    this.pausing = this.suspend(reason).finally(() => { this.pausing = undefined; });
    return this.pausing;
  }

  /** Marks the attempt paused and starts its hold. */
  private hold(reason: SessionPause['reason'], now: number) {
    const snapshot = this.state!;
    snapshot.status = 'paused';
    snapshot.warning = null;
    // A failed resume continues the pause it was resuming.
    let record = this.openPause();
    if (!record) {
      record = { epoch: this.voice.epoch, reason, pausedAt: now, resumedAt: null, endedAt: null };
      this.pauses.push(record);
    }
    snapshot.pause ??= { reason: record.reason, pausedAt: record.pausedAt, resumeBy: Math.min(record.pausedAt + this.limits.pauseHoldMs, snapshot.startedAt + SESSION_WALL_LIMIT_MS), resumes: this.resumes, maxResumes: this.limits.maxResumes };
  }

  private async suspend(reason: SessionPause['reason']) {
    this.hold(reason, this.now());
    this.stopClock();
    const grading = this.grading.stop();
    this.producer?.pause();
    try { await this.connecting; } catch { /* A failed resume is reported by resume. */ }
    await this.voice.closeCurrent();
    await grading;
    await this.voice.stopRecovery();
    if (this.finishing) return;
    await this.saveCheckpoint();
    await this.setWake(this.now() + 30_000);
    this.background.track(this.saveArchive('partial'));
  }

  /** A new provider session, seeded with the conversation so far, continues the paused attempt. */
  private async resume(body: string | undefined): Promise<Reply> {
    const parsed = resumeSchema.safeParse(parse(body));
    if (!parsed.success) return reply({ error: INVALID }, 400);
    const input = parsed.data;
    const snapshot = this.state!;
    // An outage shorter than the server's contact grace was never noticed here, and an abandoned
    // reconnect may still be connecting; either is paused before the new attempt.
    if (snapshot.status === 'live' || (snapshot.status === 'connecting' && this.reachedLive)) await this.pause('browser');
    await this.pausing;
    const hold = snapshot.pause;
    if (this.finishing || snapshot.status !== 'paused' || !hold) return reply({ error: 'This attempt is not paused.', snapshot: this.publicSnapshot() }, 409);
    const now = this.now();
    const refusal = this.resumes >= this.limits.maxResumes ? 'This attempt has reconnected too many times. End it to keep what was captured.'
      : now >= hold.resumeBy ? 'The hold on this attempt has expired.'
      : this.limitAt(now) - now < 60_000 ? 'Too little time remains to resume this attempt.' : null;
    if (refusal) return reply({ error: refusal, snapshot: this.publicSnapshot() }, 409);
    this.resumes++;
    hold.resumes = this.resumes;
    // Nothing said before the drop may be extended by the new session.
    for (const entry of snapshot.transcript) this.frozenPassages.add(entry.id);
    const offsetMs = Math.max(0, ...snapshot.transcript.map(entry => entry.endMs)) + (now - hold.pausedAt);
    snapshot.status = 'connecting';
    snapshot.message = null;
    this.connectingSince = now;
    const epoch = this.voice.epoch;
    try {
      // Until the interviewer has spoken there is no conversation to rebuild; the new session opens it instead.
      this.connecting = this.voice.open({ voiceId: snapshot.voiceId, sdp: input.sdp, offsetMs,
        context: interviewerSpoke(snapshot.transcript) ? conversationSoFar(this.spec.interviewer.name, snapshot.transcript) : undefined });
      const created = await this.connecting;
      if (this.finishing || snapshot.status !== 'connecting') return reply({ error: 'The attempt changed while reconnecting.', snapshot: this.publicSnapshot() }, 409);
      this.lastSeen = this.now();
      clearInterval(this.timer);
      this.timer = setInterval(() => this.tick(), 500);
      return reply({ sdp: created.sdp, snapshot: this.publicSnapshot() });
    } catch (error) {
      if (error instanceof FencedError || this.fenced) throw error;
      if (this.finishing || String(snapshot.status) !== 'connecting') return reply({ error: 'The attempt changed while reconnecting.', snapshot: this.publicSnapshot() }, 409);
      snapshot.status = 'paused';
      snapshot.message = 'The voice connection could not be re-established. Try again.';
      // Creation may have succeeded before attachment failed.
      if (this.voice.epoch !== epoch) await this.voice.closeCurrent();
      await this.saveCheckpoint();
      return reply({ error: snapshot.message, snapshot: this.publicSnapshot() }, 502);
    }
  }

  /** The resumed media is connected: restate the producer's notes, then let the interviewer pick the conversation back up, or open it if they never spoke. */
  private resumed() {
    const snapshot = this.state!;
    const lease = this.lease!;
    const now = this.now();
    const open = this.openPause();
    const pausedMs = open ? now - open.pausedAt : 0;
    lease.deadline = this.limitAt(now);
    if (open) open.resumedAt = now;
    this.background.track(this.save({ lease }));
    snapshot.status = 'live';
    snapshot.pause = null;
    snapshot.warning = null;
    // The rebuilt conversation already holds every typed turn.
    this.typedUnforwarded.clear();
    snapshot.message = null;
    this.connectingSince = undefined;
    this.lastActivity = now;
    this.voice.playback(now);
    this.producer?.resume(now);
    if (interviewerSpoke(snapshot.transcript)) this.voice.greet(`resume-${this.voice.epoch}`, resumeInstruction(this.spec.interviewer.name, snapshot.transcript, pausedMs));
    else this.voice.greet(`opening-${this.voice.epoch}`, interviewOpening(this.spec, snapshot.voiceId));
  }

  private async persistLease(ids = this.voice.outstanding(), checkpoint?: Checkpoint | null) {
    const lease = this.lease!;
    lease.providerIds = ids;
    await this.save({ lease, ...(checkpoint !== undefined ? { checkpoint } : {}) });
  }

  private end(interrupted = false): Promise<void> {
    if (this.fenced) return Promise.resolve();
    if (this.finishing) return this.finishing;
    this.endingInterrupted ??= interrupted;
    return this.finishing = this.finish(this.endingInterrupted).catch(async error => {
      // A transient store failure must leave closing retryable, including for hosts without platform retries.
      if (!this.fenced) await this.setWake(this.now() + 15_000).catch(() => {});
      this.finishing = undefined;
      throw error;
    });
  }

  private async finish(interrupted: boolean) {
    const snapshot = this.state!;
    if (!this.ended()) {
      const drain = snapshot.status === 'live' && !interrupted;
      snapshot.status = 'ending';
      this.producer?.close();
      this.stopClock();
      const grading = this.grading.stop();
      try { await this.connecting; } catch { /* Creation failure is surfaced by start or resume. */ }
      await this.pausing?.catch(() => {});
      await grading;
      await this.voice.stopRecovery();
      const current = this.segment;
      // The browser sends silence while the final participant audio and transcript arrive.
      if (current?.finalization === 'pending' && drain) await new Promise(resolve => setTimeout(resolve, 1000));
      // Even a confirmed segment must persist its lease before final grading, including on a closing retry.
      await this.voice.closeCurrent();
      if (this.fenced) throw new FencedError();
      await this.grading.final({ transcript: snapshot.transcript, revision: snapshot.revision });
      snapshot.status = interrupted ? 'interrupted' : 'ended';
      const now = this.now();
      for (const pause of this.pauses) if (pause.resumedAt === null) pause.endedAt ??= now;
      snapshot.pause = null;
      snapshot.usageSeconds = this.voice.usageSeconds();
      const outstanding = this.voice.outstanding();
      snapshot.finalization = this.voice.segments.length && !outstanding.length ? 'confirmed' : 'unconfirmed';
      if (outstanding.length) snapshot.message = 'Interview ended, but the voice service did not confirm finalization.';
      this.lease!.closed = !outstanding.length;
      if (this.reachedLive) {
        this.narrativeStatus = { status: snapshot.transcript.some(item => item.speaker === 'participant') ? 'pending' : 'unavailable', text: null };
        this.unarchived = now;
      }
    }
    // One write with the lease, behind any typed answer's whether or not it succeeded. A conversation keeps a terminal
    // checkpoint until its final row is acknowledged, so a later owner can archive it again without any paid work.
    await this.ordered(() => this.persistLease(this.voice.outstanding(), this.unarchived != null ? this.checkpoint(this.unarchived) : null));
    if (this.reachedLive) await this.archiveFinal();
    await this.holdFinished();
    this.endingInterrupted = undefined;
  }

  /** A settled attempt is held for five minutes before it is forgotten; an unacknowledged row or open session is retried sooner. */
  private holdFinished() {
    return this.setWake(this.now() + (this.lease!.closed && this.unarchived == null ? 300_000 : 15_000));
  }

  /** Writes the final row. Until the archive acknowledges one, the terminal checkpoint stays and every wake retries it. */
  private async archiveFinal() {
    const endedAt = this.unarchived;
    if (!(await this.saveArchive('final', endedAt ?? this.now())) || endedAt == null) return;
    await this.ordered(() => this.save({ checkpoint: null }));
    this.unarchived = null;
  }

  private async saveCheckpoint() {
    const snapshot = this.state;
    if (!snapshot || !this.reachedLive || this.finishing) return;
    try { await this.requiredCheckpoint(); }
    catch (error) {
      if (error instanceof FencedError) throw error;
      this.report({ type: 'session', event: 'checkpoint.failed', id: snapshot.id });
    }
  }

  /**
   * The previous owner was lost. A started conversation is held for its browser to resume, as after a lost connection.
   * A finished one only needs its final row: the voice session was closed and the dialogue graded before it was saved.
   */
  private async restoreCheckpoint(checkpoint: Checkpoint) {
    const { interview, feedbackStatus, ...stored } = checkpoint.snapshot;
    this.state = stored;
    this.narrativeStatus = interview?.summary ?? null;
    this.grading.restore({ evaluation: interview?.evaluation ?? null, feedbackStatus, grades: checkpoint.grades, gradeCalls: checkpoint.gradeCalls });
    this.reachedLive = checkpoint.reachedLive;
    this.resumes = checkpoint.resumes;
    this.pauses = checkpoint.pauses;
    this.voice.restore({ segments: checkpoint.segments, epoch: checkpoint.epoch, providerIds: this.lease!.providerIds, savedAt: checkpoint.savedAt });
    for (const entry of this.state.transcript) {
      this.passageUpdatedAt.set(entry.id, checkpoint.savedAt);
      this.frozenPassages.add(entry.id);
    }
    this.createProducer();
    if (checkpoint.producer) this.producer?.restore(checkpoint.producer);
    const snapshot = this.state;
    const now = this.now();
    if (this.ended()) {
      this.unarchived = checkpoint.savedAt;
      await this.setWake(now);
      return;
    }
    if (!['live', 'connecting', 'paused'].includes(snapshot.status) || now >= this.limitAt(now) - 60_000) {
      this.recovered = true;
      return;
    }
    // Their control sockets were lost with the previous owner; the wake closes them.
    this.voice.disconnected(now);
    this.hold('restart', now);
    snapshot.message = null;
    await this.saveCheckpoint();
    // The orphaned sessions are still billing; close them soon rather than at the next scheduled check.
    await this.setWake(now + 1000);
  }

  /** Too little time remained to resume. Finish from the checkpoint so the captured conversation is graded and archived. */
  private recoverCheckpoint() {
    if (!this.recovered) return;
    this.recovered = false;
    this.state!.message = 'The interview was interrupted by a service restart. Your transcript was saved.';
    this.background.track(this.end(true));
  }

  private closeOrphan(): Promise<void> {
    if (!this.orphaning) this.orphaning = this.recoverLease().finally(() => { this.orphaning = undefined; });
    return this.orphaning;
  }

  private async recoverLease() {
    const lease = this.lease;
    if (!lease || lease.closed) return;
    // No provider id survives a process loss during creation. There is no lookup by attempt; do not leave this
    // lease retrying forever.
    const ids = lease.providerIds;
    if (!ids.length) { await this.clearStore(); return; }
    const failed: string[] = [];
    for (const id of ids) {
      try { await this.voice.closeOrphan(id); } catch { failed.push(id); }
    }
    if (failed.length) {
      await this.persistLease(failed);
      // A host without platform retries needs the next attempt scheduled here. Closure is given up once the sessions
      // have long outlived the attempt: the provider ends them itself, and this lease must not retry forever.
      if (this.now() < lease.deadline + CLOSURE_GRACE_MS) {
        await this.setWake(this.now() + 15_000);
        throw new Error('Closure not confirmed.');
      }
      this.report({ type: 'session', event: 'closure.abandoned', id: this.state?.id ?? '' });
    }
    lease.closed = true;
    await this.persistLease([]);
    await this.setWake(this.now() + 300_000);
  }

  /** The time given to the store's `wake` has come. A refused write means another owner holds the attempt; this one stops. */
  async wake(): Promise<void> {
    try { await this.alarm(); }
    catch (error) { if (!(error instanceof FencedError)) throw error; }
  }

  private async alarm() {
    if (this.fenced) return;
    this.wakeAt = null;
    if (this.recovered) {
      this.recoverCheckpoint();
      await this.finishing;
      return;
    }
    if (this.endingInterrupted !== undefined) {
      await this.end();
      return;
    }
    if (!this.state || this.ended()) {
      // The final row, then any provider session not confirmed closed. The attempt is forgotten only after both.
      const archiving = this.unarchived != null;
      if (archiving) await this.archiveFinal();
      if (!this.lease?.closed) await this.closeOrphan();
      else if (!archiving) await this.clearStore();
      if (archiving) await this.holdFinished();
      return;
    }
    this.checkLifetime();
    if (this.finishing) { await this.finishing; return; }
    await this.setWake(this.now() + 30_000);
    if (this.state.status === 'live') {
      await this.saveCheckpoint();
      this.background.track(this.saveArchive('partial'));
    }
    // Includes sessions orphaned by a restart, which a resumed conversation leaves behind.
    if (!this.pausing) await this.voice.retryClosures();
  }

  private connectionLog(): ConnectionLog {
    const now = this.now();
    return {
      segments: this.voice.segments.map(({ providerId: _private, ...segment }) => segment),
      pauses: this.pauses.map(pause => ({ reason: pause.reason, pausedAt: pause.pausedAt, resumedAt: pause.resumedAt, durationMs: (pause.resumedAt ?? pause.endedAt ?? now) - pause.pausedAt })),
    };
  }

  /** Whether the archive acknowledged the row. */
  private async saveArchive(state: 'partial' | 'final', capturedAt = this.now()): Promise<boolean> {
    if (this.fenced) return false;
    const id = this.state?.id ?? '';
    try {
      // Freeze the data and its timestamp before any asynchronous work.
      const snapshot = structuredClone(this.publicSnapshot());
      // Grade diagnostics ride with the private producer records; they are never part of the public snapshot.
      const producerLog = structuredClone([...(this.producer?.records ?? []), ...this.grading.snapshot().grades]);
      const producer = this.producer?.summary() ?? null;
      const connection = this.connectionLog();
      const narrative = structuredClone(this.narrative);
      this.digests ??= Promise.all([digest(interviewerBrief(this.spec, snapshot.voiceId)), digest(interviewOpening(this.spec, snapshot.voiceId))]);
      const [actorDigest, openingDigest] = await this.digests;
      const row: InterviewArchiveRow = {
        id: snapshot.id, specId: this.spec.id, specVersion: this.spec.version, voiceId: snapshot.voiceId, state, capturedAt, snapshot,
        transcript: snapshot.transcript, producerLog, narrative: structuredClone(this.narrativeStatus),
        provenance: { voice: this.voice.voiceName(snapshot.voiceId), rubricVersion: INTERVIEW_RUBRIC_VERSION, actorDigest, openingDigest, producer, connection, ...(narrative ? { narrative } : {}) },
      };
      if (this.fenced) return false;
      await this.archive.write(row);
      return true;
    } catch {
      // A partial row is best effort. A final row is retried from the terminal checkpoint.
      this.report({ type: 'session', event: 'archive.failed', id, category: state });
      return false;
    }
  }
}
