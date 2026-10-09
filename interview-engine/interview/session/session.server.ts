import type { EngineEvent } from '../../providers/diagnostics.server';
import { callFailure } from '../../providers/diagnostics.server';
import { LiveSessionGone, transcriptEvent } from '../../providers/gptLive.server';
import type { Providers, WebSocketLike } from '../../providers/providers.server';
import { activitySchema, CAPABILITY, resumeSchema, startSchema } from '../../shared/protocol';
import { NETWORK_SAMPLES } from '../../shared/network';
import type { InterviewEvaluation, SessionPause, SessionWarning } from '../../shared/snapshot';
import type { InterviewLimits, InterviewSpec } from '../../shared/spec';
import {
  SESSION_IDLE_TIMEOUT_MS, SESSION_IDLE_WARNING_MS, SESSION_LIMIT_SECONDS, SESSION_MAX_RESUMES, SESSION_PAUSE_HOLD_MS, SESSION_WALL_LIMIT_MS, type PauseSpan,
} from '../../shared/timing';
import { TRANSCRIPT_LIMIT, transcriptCharacters, type Passage } from '../../shared/transcript';
import { mergeCoverage } from '../conversation/coverage';
import { evaluateInterview } from '../conversation/evaluate.server';
import { settledPrefix, type MappedSpec } from '../conversation/map.server';
import { InterviewProducer, producerServices } from '../conversation/producer.server';
import { gradeObjectives, type GradeRecord } from '../conversation/records';
import { upToParticipant } from '../conversation/ranking.server';
import { INTERVIEW_RUBRIC_VERSION, type JudgedSpec } from '../conversation/rubric.prompt';
import { FencedError, type Archive, type Background, type InterviewArchiveRow, type NarrativeProvenance, type SessionStore } from '../seams.server';
import { interviewerBrief, interviewOpening, type BriefedSpec } from '../voice/brief.server';
import { toPassage, toWireSpeaker, type WireEntry, type WireSpeaker } from '../wire';
import type { Checkpoint, ConnectionLog, InterviewState, Lease, NarrativeStatus, PauseRecord, PublicSnapshot, Segment, WireSnapshot } from './checkpoint';
import { appendTranscript, settledTranscript } from './transcript';
import { conversationSoFar, NO_EXTERNAL_TASK, resumeInstruction } from './voice.prompt';
import { CONTINUE_INTERVIEW, evaluateSilence, MAX_SILENCE_CHECKS, SILENCE_MS, SILENCE_VERSION, type SilenceRecord } from './silence.server';

/** The parts of a spec the session reads: the interviewer's brief, Jev's rubric, Sol's topics and the limits. */
export type SessionSpec = Pick<InterviewSpec, 'id' | 'version' | 'limits'> & BriefedSpec & JudgedSpec & MappedSpec;
/** Jev's readings with the wire's speaker names. */
export type SessionEvaluation = InterviewEvaluation<string, WireSpeaker>;
type Evaluate = (input: { transcript: WireEntry[]; revision: number; signal: AbortSignal }) => Promise<SessionEvaluation>;
/** The paid calls, replaceable for tests: Sol, Jev's turn reads, Luna, and Jev's coverage grade. */
export type SessionServices = typeof producerServices & { evaluate: Evaluate; evaluateSilence: typeof evaluateSilence };

export type SessionOptions = {
  spec: SessionSpec;
  /** Every paid client, credentials bound: nothing else in the options can reach a provider. */
  providers: Providers;
  store: SessionStore;
  background: Background;
  archive: Archive;
  now?: () => number;
  /** Defaults to the providers' log. */
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

const GRADE_INTERVAL_MS = 5000;
const MAX_LIVE_GRADES = 719; // Assessment rounds; long transcripts use several requests per round. Final grade is extra.
/** Keep answered questions and corrections; a trailing interviewer turn adds no participant evidence. */
function gradingText(transcript: WireEntry[]): string {
  const answered = upToParticipant(transcript);
  return answered.length ? JSON.stringify(answered.map(({ id, speaker, text }) => [id, speaker, text])) : '';
}
// The provider has no command that guarantees speech, and it can accept the greeting and stay silent.
const GREETING_RETRY_MS = 10_000;
const GREETING_REPLACE_MS = 25_000;
const UNRESPONSIVE = 'The voice service is not responding. You can end this attempt and try again.';
const FENCED = 'Another owner has taken over this attempt.';
const INVALID = 'Invalid simulator request.';
const CANCELLED = 'The attempt was cancelled.';
/** How long after the lease's deadline a provider session's closure is still retried. */
const CLOSURE_GRACE_MS = 60 * 60_000;
/** The attempt was ended before its provider session was opened; nothing paid happened. */
class Cancelled extends Error { constructor() { super(CANCELLED); this.name = 'Cancelled'; } }
const clientSpoke = (transcript: WireEntry[]) => transcript.some(entry => entry.speaker === 'client' && entry.text.trim());
const reply = (body: unknown, status = 200): Reply => ({ status, body });
const within = <T>(work: Promise<T>, ms: number) => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Timed out.')), ms);
  work.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
});
const parse = (body: string | undefined): unknown => { try { return JSON.parse(body ?? ''); } catch { return undefined; } };
const defaultLimits: InterviewLimits = {
  durationSeconds: SESSION_LIMIT_SECONDS, idleWarningMs: SESSION_IDLE_WARNING_MS, idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
  pauseHoldMs: SESSION_PAUSE_HOLD_MS, maxResumes: SESSION_MAX_RESUMES,
};
const digest = async (text: string) => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 12);
};

/** Jev's coverage grade over the providers' judge, with the wire's speaker names. */
function judgeWith(spec: SessionSpec, providers: Providers): Evaluate {
  return async ({ transcript, revision, signal }) => {
    const result = await evaluateInterview({ spec, passages: transcript.map(toPassage), revision, signal }, providers);
    const evidence = <E extends { speaker: Passage['speaker'] }>(item: E | null) => item && { ...item, speaker: toWireSpeaker(item.speaker) };
    return {
      revision: result.revision, model: result.model, durationMs: result.durationMs,
      readings: Object.fromEntries(Object.entries(result.readings).map(([id, reading]) => [id, { ...reading, evidence: evidence(reading.evidence) }])),
      objectives: result.objectives.map(reading => ({ ...reading, evidence: evidence(reading.evidence) })),
    };
  };
}

/**
 * Owns one attempt for as long as this owner holds it. The closure lease always survives a lost owner; once the
 * conversation has gone live, a checkpoint lets a replacement hold it for the browser to resume, or finish it with
 * what was captured. A save the store refuses means another owner has taken over: this one stops and writes nothing.
 */
export class SessionActor {
  private readonly spec: SessionSpec;
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
  private state: WireSnapshot | undefined;
  /** Jev's latest readings and the narrative's status, kept beside the snapshot. */
  private interview: InterviewState | undefined;
  private socket: WebSocketLike | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private finishing: Promise<void> | undefined;
  private orphaning: Promise<void> | undefined;
  private connecting: Promise<{ sdp: string }> | undefined;
  private pausing: Promise<void> | undefined;
  private closeReceived: (() => void) | undefined;
  private lastSeen: number;
  private lastActivity: number;
  /** When the browser last heard Sam's playback; the participant's speech is known only from their transcript. */
  private lastAudio: number;
  private connectingSince: number | undefined;
  private capacityDeadline: number | null = null;
  private passageUpdatedAt = new Map<string, number>();
  private judgedPassages = new Set<string>();
  private lastGrade = 0;
  private gradedText = '';
  private retriedText = '';
  private gradeCalls = 0;
  private grading: Promise<void> | undefined;
  private gradeAbort = new AbortController();
  private reachedLive = false;
  private epoch = 0;
  private segments: Segment[] = [];
  private pauses: PauseRecord[] = [];
  private resumes = 0;
  /** Restored from a checkpoint too close to its limit to resume; finished on first contact. */
  private recovered = false;
  private producer: InterviewProducer | undefined;
  private activitySequence = -1;
  // Already bounded by MAX_LIVE_GRADES plus the final grade; retain probability-only changes too.
  private readonly grades: GradeRecord[] = [];
  private seenEvents = new Set<string>();
  /** The current provider session's instruction to speak, kept to ask once more if it is met with silence. */
  private greeting: { eventId: string; content: string } | undefined;
  /** When either side's transcript last grew. */
  private lastSpeech = 0;
  private silenceCheckedRevision = -1;
  private silenceCheck: Promise<void> | undefined;
  private silenceAbort: AbortController | undefined;
  private replacedSilent = false;
  private finalArchive: Promise<void> | undefined;
  private narrativeArchive = Promise.resolve();
  private narrative: NarrativeProvenance | undefined;
  private digests: Promise<[string, string]> | undefined;
  private wakeAt: number | null = null;
  private fenced = false;

  private constructor(options: SessionOptions) {
    this.spec = options.spec;
    this.limits = options.spec.limits ?? defaultLimits;
    this.providers = options.providers;
    this.store = options.store;
    this.background = options.background;
    this.archive = options.archive;
    this.now = options.now ?? Date.now;
    this.report = options.log ?? options.providers.log ?? (() => {});
    this.paid = { ...producerServices, evaluate: judgeWith(options.spec, options.providers), evaluateSilence, ...options.services };
    this.lazyWake = options.lazyWake ?? false;
    this.lastSeen = this.lastActivity = this.lastAudio = this.now();
  }

  /** Loads the attempt this store is bound to. A started conversation whose owner was lost is held for its browser to resume. */
  static async restore(options: SessionOptions): Promise<SessionActor> {
    const actor = new SessionActor(options);
    const stored = await options.store.load();
    actor.lease = stored.lease;
    if (actor.lease && !actor.lease.closed && stored.checkpoint) await actor.restoreCheckpoint(stored.checkpoint);
    return actor;
  }

  /** The end of the attempt while it is being finished: a host serving the report waits for it. */
  get closing(): Promise<void> | undefined { return this.finishing; }

  private get segment(): Segment | undefined { return this.segments.at(-1); }

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
        this.lease = { capability, deadline: this.now(), closed: true };
        await this.save({ lease: this.lease });
        await this.setWake(this.now() + 60_000);
        return reply({ ended: true });
      }
      return reply({ error: 'This practice session was not found.' }, 404);
    }
    this.recoverCheckpoint();
    if (!this.state) {
      if (!this.lease.closed) this.background.track(this.closeOrphan());
      return reply({ error: 'This practice session was interrupted. Start a new attempt.' }, 410);
    }
    if (action === 'report') return { status: 200, body: null, report: true };
    // Terminal reads must not refresh a lease, heartbeat, or live state.
    if (this.state.status === 'ended' || this.state.status === 'interrupted') return { status: 200, body: this.publicSnapshot(), terminal: true };
    this.lastSeen = this.now();
    if (action === 'poll' && body) {
      const parsed = activitySchema.safeParse(parse(body));
      if (!parsed.success) return reply({ error: INVALID }, 400);
      const activity = parsed.data;
      if (activity.sequence == null || activity.sequence > this.activitySequence) {
        const now = this.now();
        if (activity.sequence != null) this.activitySequence = activity.sequence;
        if (activity.active || activity.audio) this.lastActivity = now;
        if (activity.audio) this.lastAudio = now;
        const segment = this.segment;
        if (activity.network && segment && (segment.network?.length ?? 0) < NETWORK_SAMPLES) (segment.network ??= []).push({ at: now, ...activity.network });
      }
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
        this.greet('opening', interviewOpening(this.spec, this.state.clientId));
      }
    }
    if (action === 'end') await this.end();
    this.checkLifetime();
    if (action === 'poll' && this.state.status === 'live') this.checkSilence(this.now());
    return reply(this.publicSnapshot());
  }

  /** What the browser sees, or null before the attempt has started here. */
  snapshot(): PublicSnapshot | null {
    return this.state ? this.publicSnapshot() : null;
  }

  /** The transcript so far, in the engine's speaker names. */
  transcript(): Passage[] {
    return this.state?.transcript.map(toPassage) ?? [];
  }

  /** Nothing is running: no attempt here, or it has ended. A host may let an idle actor go. */
  idle(): boolean {
    return !this.state || ((this.state.status === 'ended' || this.state.status === 'interrupted') && !this.orphaning);
  }

  /**
   * `connection` and `drain`: the browser's link closed, or this process is stopping; the attempt is held for the
   * browser to resume. `fenced`: another owner has taken over; this one stops without writing.
   */
  async close(reason: 'connection' | 'drain' | 'fenced'): Promise<void> {
    if (reason === 'fenced') { this.fence(); return; }
    if (this.fenced) return;
    await this.pause('browser').catch(error => { if (!(error instanceof FencedError)) throw error; });
  }

  /**
   * The narrative settled: its status rides in the snapshot and its provenance in the archive, which is rewritten once
   * the end-of-attempt row has been written.
   */
  settleNarrative(status: NarrativeStatus, provenance: NarrativeProvenance) {
    if (!this.interview) return;
    this.narrative = provenance;
    this.interview.summary = status;
    this.narrativeArchive = this.narrativeArchive.then(async () => {
      if (this.finalArchive) await within(this.finalArchive, 15_000).catch(() => {});
      await this.saveArchive('final');
    });
    this.background.track(this.narrativeArchive);
  }

  private publicSnapshot(): PublicSnapshot {
    const snapshot = this.state!;
    const interview = this.interview ?? { evaluation: null, summary: null };
    return { ...snapshot, coaching: null, interview: { ...interview, background: this.producer?.publicBackground() ?? [] } };
  }

  private async save(patch: { lease?: Lease; checkpoint?: Checkpoint | null }) {
    if (this.fenced) throw new FencedError();
    try { await this.store.save(patch); }
    catch (error) {
      if (error instanceof FencedError) this.fence();
      throw error;
    }
  }

  private async setWake(at: number | null) {
    if (this.fenced) throw new FencedError();
    this.wakeAt = at;
    try { await this.store.wake(at); }
    catch (error) {
      if (error instanceof FencedError) this.fence();
      throw error;
    }
  }

  private async clearStore() {
    if (this.fenced) throw new FencedError();
    this.wakeAt = null;
    try { await this.store.clear(); }
    catch (error) {
      if (error instanceof FencedError) this.fence();
      throw error;
    }
  }

  /** A newer owner holds the attempt: drop the voice socket, stop the clock and paid work, and write nothing more. */
  private fence() {
    if (this.fenced) return;
    this.fenced = true;
    clearInterval(this.timer);
    this.timer = undefined;
    this.gradeAbort.abort();
    this.silenceAbort?.abort();
    this.producer?.close();
    this.closeReceived?.();
    // The provider session stays open: the new owner knows it from the lease and closes it.
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
    this.report({ type: 'session', event: 'fenced', id: this.state?.id ?? '' });
  }

  private async start(body: string | undefined, capability: string): Promise<Reply> {
    const parsed = startSchema.safeParse(parse(body));
    if (!parsed.success || parsed.data.scenarioId !== this.spec.id || !this.spec.interviewer.voices.some(voice => voice.id === parsed.data.clientId)) return reply({ error: INVALID }, 400);
    const input = parsed.data;
    if (this.lease) return reply({ error: 'This attempt has already been used. Start a new attempt.' }, 409);
    const now = this.now();
    this.lease = { capability, deadline: now + this.limits.durationSeconds * 1000, closed: false };
    this.state = {
      id: input.id, scenarioId: input.scenarioId, clientId: input.clientId,
      status: 'connecting', startedAt: now, limitSeconds: this.limits.durationSeconds, warning: null,
      revision: 0, transcript: [], evaluation: null, coaching: null, feedbackStatus: 'waiting',
      message: null, finalization: 'pending', usageSeconds: null,
    };
    this.interview = { evaluation: null, summary: null };
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
  private async connect(input: { clientId: string; sdp: string }) {
    await this.save({ lease: this.lease! });
    await this.setWake(this.now() + 30_000);
    return this.openLive(input);
  }

  private createProducer() {
    const snapshot = this.state!;
    const settled = () => settledTranscript(this.state!.transcript, this.passageUpdatedAt, this.now());
    // Sol's log is append-only, so the producer reads only up to the first passage still being transcribed.
    const prefix = () => { const ready = new Set(settled()); return settledPrefix(this.state!.transcript, entry => ready.has(entry)); };
    this.producer = new InterviewProducer({
      spec: this.spec, attemptId: snapshot.id, startedAt: snapshot.startedAt,
      providers: this.providers, services: this.paid,
      settled: prefix, coverage: () => this.interview?.evaluation?.objectives ?? [], send: event => this.send(event), waitUntil: work => this.background.track(work),
      pauses: () => this.pauseSpans(),
    });
  }

  private voiceName(voiceId: string) {
    return this.spec.interviewer.voices.find(voice => voice.id === voiceId)!.voice;
  }

  /** A resumed session appends the rebuilt conversation after the unchanged brief. */
  private async openLive(input: { clientId: string; sdp: string }, offsetMs = 0, context?: string) {
    // Checked last thing before the paid call: an end or a fence that arrived during the writes above must not open a session.
    if (this.fenced) throw new FencedError();
    if (this.finishing || this.state?.status === 'ending') throw new Cancelled();
    const instructions = [interviewerBrief(this.spec, input.clientId), context].filter(Boolean).join('\n\n');
    const created = await this.providers.voice.create({ sdp: input.sdp, voice: this.voiceName(input.clientId), instructions });
    const segment: Segment = { epoch: ++this.epoch, providerId: created.id, offsetMs, startedAt: this.now(), endedAt: null, closeReason: null, finalization: 'pending', usageSeconds: null };
    this.segments.push(segment);
    try { await this.persistLease(); }
    catch (error) {
      // The lease never recorded this session, so no owner will ever close it from the store: close it now, best effort.
      await this.providers.voice.close(created.id).catch(() => {});
      throw error;
    }
    this.socket = await this.providers.voice.attach(created.id);
    this.listen(this.socket, segment);
    return { sdp: created.sdp };
  }

  /** Events and closures are bound to their segment, so a superseded provider session cannot pause or end its successor. */
  private listen(socket: WebSocketLike, segment: Segment) {
    socket.addEventListener('message', event => {
      if (typeof event.data !== 'string') return;
      try { this.onEvent(JSON.parse(event.data), segment); } catch { /* Ignore malformed protocol messages, never log private payloads. */ }
    });
    socket.addEventListener('close', () => this.dropped(segment));
    socket.addEventListener('error', () => this.dropped(segment));
  }

  private dropped(segment: Segment) {
    const status = this.state?.status;
    if (this.fenced || this.finishing || segment !== this.segment || segment.finalization === 'confirmed' || status === 'paused') return;
    if (this.reachedLive && (status === 'live' || status === 'connecting')) this.background.track(this.pause('provider'));
    else this.background.track(this.end(true));
  }

  private send(event: Record<string, unknown>): boolean {
    if (!this.socket || this.socket.readyState !== 1) return false;
    try {
      this.socket.send(JSON.stringify(event));
      return true;
    } catch { return false; }
  }

  private onEvent(event: Record<string, unknown>, segment: Segment) {
    const snapshot = this.state;
    if (this.fenced || !snapshot || snapshot.status === 'ended' || snapshot.status === 'interrupted') return;
    if (event.type === 'session.closed') {
      segment.finalization = 'confirmed';
      segment.endedAt ??= this.now();
      segment.closeReason = typeof event.reason === 'string' ? event.reason : null;
      const usage = event.usage as { seconds?: unknown } | undefined;
      if (typeof usage?.seconds === 'number' && Number.isFinite(usage.seconds)) segment.usageSeconds = usage.seconds;
      snapshot.usageSeconds = this.usageSeconds();
      if (segment !== this.segment) return;
      this.closeReceived?.();
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
    if (segment !== this.segment) return;
    const parsed = transcriptEvent.safeParse(event);
    if (parsed.success) {
      const delta = parsed.data;
      // The participant cannot hear a reply generated after they end the interview or lose the connection.
      if ((snapshot.status === 'ending' || snapshot.status === 'paused') && delta.type === 'session.output_transcript.delta') return;
      const key = delta.event_id && `${segment.epoch}:${delta.event_id}`;
      if (key && this.seenEvents.has(key)) return;
      if (key) this.seenEvents.add(key);
      const next = appendTranscript(snapshot.transcript, {
        speaker: delta.type === 'session.input_transcript.delta' ? 'trainee' : 'client', text: delta.delta,
        startMs: delta.start_ms + segment.offsetMs, endMs: delta.end_ms + segment.offsetMs,
      }, this.judgedPassages);
      // Late deltas may arrive during close. Keep the final grading input valid.
      if (next.length > TRANSCRIPT_LIMIT.entries || transcriptCharacters(next) > TRANSCRIPT_LIMIT.characters) return;
      const changed = next.find(entry => !snapshot.transcript.includes(entry));
      if (!changed) return;
      const now = this.now();
      this.passageUpdatedAt.set(changed.id, now);
      this.lastActivity = this.lastSpeech = now;
      this.silenceAbort?.abort();
      const reminder = segment.silence?.findLast(item => item.outcome === 'sent' && !item.nextSpeech);
      if (reminder) reminder.nextSpeech = { at: now, passageId: changed.id, speaker: changed.speaker };
      if (delta.type !== 'session.input_transcript.delta' && segment.greeting && segment.greeting.repliedAt == null) {
        segment.greeting.repliedAt = now;
        if (snapshot.message === UNRESPONSIVE) snapshot.message = null;
      }
      snapshot.transcript = next;
      snapshot.revision++;
      this.producer?.transcriptChanged(changed, next[next.indexOf(changed) - 1]?.id ?? null, now);
      if (snapshot.transcript.length >= TRANSCRIPT_LIMIT.entries * .9 || transcriptCharacters(snapshot.transcript) >= TRANSCRIPT_LIMIT.characters * .9) this.capacityDeadline ??= now + 30_000;
      return;
    }
    if (snapshot.status === 'ending' || snapshot.status === 'paused') return;
    if ((event.type === 'session.thinking.appended' || event.type === 'session.instructions.appended') && typeof event.client_event_id === 'string') {
      if (segment.greeting && this.greeting && [this.greeting.eventId, `${this.greeting.eventId}-again`].includes(event.client_event_id)) segment.greeting.acknowledgedAt ??= this.now();
      this.producer?.providerEvent(event.client_event_id, true, {
        ...(typeof event.start_ms === 'number' && Number.isFinite(event.start_ms) ? { startMs: event.start_ms + segment.offsetMs } : {}),
        ...(typeof event.end_ms === 'number' && Number.isFinite(event.end_ms) ? { endMs: event.end_ms + segment.offsetMs } : {}),
      });
      const reminder = segment.silence?.find(item => item.id === event.client_event_id && item.outcome === 'sent');
      if (reminder) reminder.acknowledgedAt ??= this.now();
    }
    if (event.type === 'session.delegation.created') {
      const delegation = event.delegation as { id?: unknown; target?: unknown } | undefined;
      if (typeof delegation?.id === 'string') {
        const replied = delegation.target === 'client' && this.send({ type: 'session.thinking.append', event_id: crypto.randomUUID(), delegation_id: delegation.id, content: NO_EXTERNAL_TASK });
        // Research belongs to the producer; Sam's own delegation attempts are logged, never run.
        this.producer?.delegation(delegation.id, typeof delegation.target === 'string' ? delegation.target : null, replied);
      }
    }
    if (event.type === 'error') {
      const error = event.error as { client_event_id?: unknown } | undefined;
      const reminder = segment.silence?.find(item => item.id === error?.client_event_id);
      if (reminder) { reminder.outcome = 'rejected'; return; }
      // A declined optional note need not interrupt an otherwise-working interview.
      if (typeof error?.client_event_id === 'string' && /^(cue|note)-/.test(error.client_event_id)) {
        this.producer?.providerEvent(error.client_event_id, false);
        return;
      }
      snapshot.message = 'The voice service reported a problem. You can end this attempt and try again.';
    }
  }

  private tick() {
    const snapshot = this.state;
    if (this.fenced || !snapshot || snapshot.status !== 'live') return;
    const now = this.now();
    if (this.checkLifetime()) return;
    this.unanswered(now);
    this.checkSilence(now);
    this.producer?.tick(now);
    const transcript = settledTranscript(snapshot.transcript, this.passageUpdatedAt, now);
    const text = gradingText(transcript);
    if (this.interview?.evaluation && text !== this.gradedText) snapshot.feedbackStatus = 'delayed';
    if (!text || this.grading || text === this.gradedText || now - this.lastGrade < GRADE_INTERVAL_MS || this.gradeCalls >= MAX_LIVE_GRADES) return;
    this.lastGrade = now;
    this.gradedText = text;
    // A quoted source must stay exact, even if more speech arrives during grading.
    for (const entry of transcript) this.judgedPassages.add(entry.id);
    this.grading = this.grade(transcript, snapshot.revision, false, now).finally(() => { this.grading = undefined; });
    this.background.track(this.grading);
  }

  /** Transcript inactivity triggers the check; Jev decides whose turn it is. Audio levels are irrelevant. */
  private checkSilence(now: number) {
    const snapshot = this.state!, segment = this.segment;
    if (snapshot.status !== 'live' || this.silenceCheck || segment?.greeting?.repliedAt == null || this.silenceCheckedRevision === snapshot.revision || now - this.lastSpeech < SILENCE_MS) return;
    if (!snapshot.transcript.some(entry => entry.speaker === 'trainee') || this.segments.reduce((n, item) => n + (item.silence?.length ?? 0), 0) >= MAX_SILENCE_CHECKS) return;
    const transcript = snapshot.transcript.slice(-8);
    const record: SilenceRecord = { id: `silence-${crypto.randomUUID()}`, version: SILENCE_VERSION, revision: snapshot.revision,
      passageIds: transcript.map(entry => entry.id), startedAt: now, quietMs: now - this.lastSpeech, outcome: 'pending' };
    (segment.silence ??= []).push(record);
    this.silenceCheckedRevision = snapshot.revision;
    const abort = this.silenceAbort = new AbortController();
    this.silenceCheck = this.judgeSilence(transcript, segment, record, abort).finally(() => { this.silenceCheck = undefined; });
    this.background.track(this.silenceCheck);
  }

  private async judgeSilence(transcript: WireEntry[], segment: Segment, record: SilenceRecord, abort: AbortController) {
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(3000)]);
    try {
      const result = await this.paid.evaluateSilence({ transcript, judge: this.providers.judge.model, signal });
      Object.assign(record, result);
      signal.throwIfAborted();
      if (this.fenced || this.state?.status !== 'live' || this.segment !== segment || this.state.revision !== record.revision) record.outcome = 'stale';
      else if (result.probability < this.providers.judge.thresholds.silenceContinue) record.outcome = 'wait';
      else {
        record.outcome = 'sent';
        if (!this.send({ type: 'session.instructions.append', event_id: record.id, delegation_id: null, content: CONTINUE_INTERVIEW })) record.outcome = 'error';
      }
    } catch (error) {
      record.outcome = abort.signal.aborted ? 'aborted' : error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'error';
      record.failure = callFailure(error);
    } finally { record.completedAt = this.now(); }
  }

  /** Asks the interviewer to speak on the current provider session; the live tick watches for a reply. */
  private greet(eventId: string, content: string) {
    this.greeting = { eventId, content };
    this.segment!.greeting = { sentAt: this.now(), acknowledgedAt: null, retriedAt: null, repliedAt: null, abandonedAt: null };
    this.send({ type: 'session.instructions.append', event_id: eventId, delegation_id: null, content });
  }

  /** A greeting met with silence is sent once more, then the provider session is replaced once per attempt. */
  private unanswered(now: number) {
    const greeting = this.segment?.greeting;
    if (!greeting || !this.greeting || greeting.repliedAt != null || greeting.abandonedAt != null) return;
    // Speech, or Sam audible in the browser, is not silence.
    const quiet = now - Math.max(greeting.sentAt, this.lastSpeech, this.lastAudio);
    if (quiet >= GREETING_REPLACE_MS) {
      greeting.abandonedAt = now;
      if (this.replacedSilent) { this.state!.message = UNRESPONSIVE; return; }
      this.replacedSilent = true;
      // The browser resumes a server pause on its own, which opens a fresh provider session.
      this.background.track(this.pause('provider'));
    } else if (quiet >= GREETING_RETRY_MS && greeting.retriedAt == null) {
      greeting.retriedAt = now;
      this.send({ type: 'session.instructions.append', event_id: `${this.greeting.eventId}-again`, delegation_id: null, content: this.greeting.content });
    }
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
      snapshot.message = 'Practice ended after losing contact with this page.';
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
      snapshot.message = 'The voice connection timed out before practice began.';
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
    if (warning.kind !== 'idle' && now < warning.endsAt + 20_000 && (now < warning.endsAt + 3000 || now - Math.max(this.lastAudio, this.lastSpeech) < 2500)) return true;
    snapshot.message = warning.kind === 'idle' ? 'Practice ended after five minutes without activity.' : warning.kind === 'limit' ? 'Practice reached the 60-minute safety limit.' : 'Practice reached its transcript capacity.';
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
      record = { epoch: this.epoch, reason, pausedAt: now, resumedAt: null, endedAt: null };
      this.pauses.push(record);
    }
    snapshot.pause ??= { reason: record.reason, pausedAt: record.pausedAt, resumeBy: Math.min(record.pausedAt + this.limits.pauseHoldMs, snapshot.startedAt + SESSION_WALL_LIMIT_MS), resumes: this.resumes, maxResumes: this.limits.maxResumes };
  }

  private async suspend(reason: SessionPause['reason']) {
    this.hold(reason, this.now());
    clearInterval(this.timer);
    this.timer = undefined;
    this.gradeAbort.abort();
    this.silenceAbort?.abort();
    this.producer?.pause();
    try { await this.connecting; } catch { /* A failed resume is reported by resume. */ }
    await this.closeSegment();
    await this.grading;
    await this.silenceCheck;
    this.gradeAbort = new AbortController();
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
    for (const entry of snapshot.transcript) this.judgedPassages.add(entry.id);
    const offsetMs = Math.max(0, ...snapshot.transcript.map(entry => entry.endMs)) + (now - hold.pausedAt);
    snapshot.status = 'connecting';
    snapshot.message = null;
    this.connectingSince = now;
    const epoch = this.epoch;
    try {
      // Until the interviewer has spoken there is no conversation to rebuild; the new session opens it instead.
      this.connecting = this.openLive({ clientId: snapshot.clientId, sdp: input.sdp }, offsetMs,
        clientSpoke(snapshot.transcript) ? conversationSoFar(this.spec.interviewer.name, snapshot.transcript) : undefined);
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
      if (this.epoch !== epoch) await this.closeSegment();
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
    snapshot.message = null;
    this.connectingSince = undefined;
    this.lastActivity = this.lastAudio = now;
    this.producer?.resume(now);
    if (clientSpoke(snapshot.transcript)) this.greet(`resume-${this.epoch}`, resumeInstruction(this.spec.interviewer.name, snapshot.transcript, pausedMs));
    else this.greet(`opening-${this.epoch}`, interviewOpening(this.spec, snapshot.clientId));
  }

  /** Closes the current provider session, reattaching if its control socket is gone. */
  private async closeSegment() {
    const segment = this.segment;
    if (!segment) return;
    const pending = () => segment.finalization === 'pending';
    if (pending()) {
      if (!this.socket || this.socket.readyState !== 1) {
        try { this.socket = await this.providers.voice.attach(segment.providerId); this.listen(this.socket, segment); }
        catch (error) { if (error instanceof LiveSessionGone) segment.finalization = 'confirmed'; /* Otherwise the wake retains closure responsibility. */ }
      }
      if (pending()) await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, 10_000);
        this.closeReceived = () => { clearTimeout(timer); resolve(); };
        if (!this.send({ type: 'session.close' })) { clearTimeout(timer); resolve(); }
      });
      if (pending()) segment.finalization = 'unconfirmed';
    }
    segment.endedAt ??= this.now();
    this.closeReceived = undefined;
    this.socket?.close();
    this.socket = undefined;
    await this.persistLease();
  }

  private outstanding(): string[] {
    return this.segments.filter(segment => segment.finalization !== 'confirmed').map(segment => segment.providerId);
  }

  private async persistLease(ids = this.outstanding()) {
    const lease = this.lease!;
    delete lease.providerId;
    delete lease.unconfirmed;
    if (ids.length) lease.providerId = ids.at(-1);
    if (ids.length > 1) lease.unconfirmed = ids.slice(0, -1);
    await this.save({ lease });
  }

  private usageSeconds(): number | null {
    const known = this.segments.filter(segment => segment.usageSeconds != null);
    return known.length ? known.reduce((total, segment) => total + segment.usageSeconds!, 0) : null;
  }

  /** Coverage is re-judged each time against the whole settled transcript. */
  private async grade(transcript: WireEntry[], revision: number, final: boolean, capturedAt = this.now()) {
    const snapshot = this.state!, interview = this.interview!;
    this.gradeCalls++;
    const diagnostic = { source: 'grade' as const, id: `grade-${this.gradeCalls}`, final, revision, capturedAt,
      inputCount: transcript.length, lastInputId: transcript.at(-1)?.id ?? null };
    try {
      const result = await this.paid.evaluate({ transcript, revision, signal: AbortSignal.any([this.gradeAbort.signal, AbortSignal.timeout(final ? 8000 : 3000)]) });
      const log = { ...diagnostic, completedAt: this.now(), durationMs: result.durationMs };
      if ((!final && this.finishing) || revision < (interview.evaluation?.revision ?? 0)) {
        this.grades.push({ ...log, outcome: 'stale', objectives: gradeObjectives(result.objectives, interview.evaluation?.objectives ?? []) });
        return;
      }
      // Live bands resist flicker; the final re-grade replaces them, so an unsupported checkmark is withdrawn.
      const objectives = final ? result.objectives : mergeCoverage(interview.evaluation?.objectives ?? [], result.objectives);
      this.grades.push({ ...log, outcome: 'graded', objectives: gradeObjectives(result.objectives, objectives) });
      interview.evaluation = { revision: result.revision, readings: result.readings, model: result.model, durationMs: result.durationMs, objectives };
      snapshot.feedbackStatus = final || this.isFresh(transcript) ? 'current' : 'delayed';
    } catch (error) {
      this.grades.push({ ...diagnostic, completedAt: this.now(),
        failure: callFailure(error),
        outcome: this.gradeAbort.signal.aborted && !final ? 'aborted' : error instanceof Error && error.name === 'TimeoutError' ? 'evaluation_timeout' : 'evaluation_error' });
      if (this.gradeAbort.signal.aborted && !final) return;
      snapshot.feedbackStatus = interview.evaluation ? 'delayed' : 'unavailable';
      // One cadence-limited retry per input, still inside the overall paid-call cap.
      if (!final && this.retriedText !== this.gradedText) {
        this.retriedText = this.gradedText;
        this.gradedText = '';
      }
    }
  }

  private isFresh(transcript: WireEntry[]): boolean {
    return gradingText(transcript) === gradingText(settledTranscript(this.state!.transcript, this.passageUpdatedAt, this.now()));
  }

  private end(interrupted = false): Promise<void> {
    if (this.fenced) return Promise.resolve();
    return this.finishing ??= this.finish(interrupted);
  }

  private async finish(interrupted: boolean) {
    const snapshot = this.state!;
    const drain = snapshot.status === 'live' && !interrupted;
    snapshot.status = 'ending';
    this.producer?.close();
    clearInterval(this.timer);
    this.gradeAbort.abort();
    this.silenceAbort?.abort();
    try { await this.connecting; } catch { /* Creation failure is surfaced by start or resume. */ }
    await this.pausing?.catch(() => {});
    await this.grading;
    await this.silenceCheck;
    this.gradeAbort = new AbortController();
    const current = this.segment;
    // Only the newest session can still be open; any other unclosed one is left to the closure lease.
    for (const segment of this.segments) if (segment !== current && segment.finalization === 'pending') segment.finalization = 'unconfirmed';
    if (current?.finalization === 'pending') {
      // The browser sends silence while the final participant audio and transcript arrive.
      if (drain) await new Promise(resolve => setTimeout(resolve, 1000));
      await this.closeSegment();
    } else {
      this.socket?.close();
      this.socket = undefined;
    }
    if (snapshot.transcript.some(item => item.speaker === 'trainee')) await this.grade(snapshot.transcript, snapshot.revision, true);
    snapshot.status = interrupted ? 'interrupted' : 'ended';
    const now = this.now();
    for (const pause of this.pauses) if (pause.resumedAt === null) pause.endedAt ??= now;
    snapshot.pause = null;
    snapshot.usageSeconds = this.usageSeconds();
    const outstanding = this.outstanding();
    snapshot.finalization = this.segments.length && !outstanding.length ? 'confirmed' : 'unconfirmed';
    if (outstanding.length) snapshot.message = 'Practice ended, but the voice service did not confirm finalization.';
    this.lease!.closed = !outstanding.length;
    await this.persistLease(outstanding);
    await this.save({ checkpoint: null });
    await this.setWake(this.now() + (this.lease!.closed ? 300_000 : 15_000));
    if (this.reachedLive) {
      this.interview!.summary = { status: snapshot.transcript.some(item => item.speaker === 'trainee') ? 'pending' : 'unavailable', text: null };
      this.finalArchive = this.saveArchive('final');
      this.background.track(this.finalArchive);
    }
  }

  private async saveCheckpoint() {
    const snapshot = this.state;
    if (!snapshot || !this.reachedLive || this.finishing) return;
    const checkpoint: Checkpoint = structuredClone({
      savedAt: this.now(), snapshot: { ...snapshot, interview: this.interview }, reachedLive: this.reachedLive, epoch: this.epoch, resumes: this.resumes,
      segments: this.segments, pauses: this.pauses, grades: this.grades, gradeCalls: this.gradeCalls,
      ...(this.producer ? { producer: this.producer.checkpoint() } : {}),
    });
    try { await this.save({ checkpoint }); }
    catch (error) {
      if (error instanceof FencedError) throw error;
      this.report({ type: 'session', event: 'checkpoint.failed', id: snapshot.id });
    }
  }

  /** The previous owner was lost. A started conversation is held for its browser to resume, as after a lost connection. */
  private async restoreCheckpoint(checkpoint: Checkpoint) {
    const { interview, ...stored } = checkpoint.snapshot;
    this.state = stored;
    this.interview = interview ? { evaluation: interview.evaluation, summary: interview.summary } : { evaluation: null, summary: null };
    this.reachedLive = checkpoint.reachedLive;
    this.epoch = checkpoint.epoch;
    this.resumes = checkpoint.resumes;
    this.segments = checkpoint.segments;
    this.pauses = checkpoint.pauses;
    this.grades.push(...checkpoint.grades);
    this.gradeCalls = checkpoint.gradeCalls;
    // A provider session opened after the checkpoint is known only to the lease; it is the newest.
    const known = new Set(this.segments.map(segment => segment.providerId));
    for (const id of [...(this.lease!.unconfirmed ?? []), ...(this.lease!.providerId ? [this.lease!.providerId] : [])]) if (!known.has(id)) {
      this.segments.push({ epoch: ++this.epoch, providerId: id, offsetMs: 0, startedAt: checkpoint.savedAt, endedAt: null, closeReason: null, finalization: 'pending', usageSeconds: null });
    }
    for (const entry of this.state.transcript) {
      this.passageUpdatedAt.set(entry.id, checkpoint.savedAt);
      this.judgedPassages.add(entry.id);
    }
    this.createProducer();
    if (checkpoint.producer) this.producer?.restore(checkpoint.producer);
    const snapshot = this.state;
    const now = this.now();
    if (!['live', 'connecting', 'paused'].includes(snapshot.status) || now >= this.limitAt(now) - 60_000) {
      this.recovered = true;
      return;
    }
    // Their control sockets were lost with the previous owner; the wake closes them.
    for (const segment of this.segments) if (segment.finalization === 'pending') {
      segment.finalization = 'unconfirmed';
      segment.endedAt ??= now;
    }
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
    const ids = [...new Set([...(lease.unconfirmed ?? []), ...(lease.providerId ? [lease.providerId] : [])])];
    if (!ids.length) { await this.clearStore(); return; }
    const failed: string[] = [];
    for (const id of ids) {
      try { await this.providers.voice.close(id); } catch { failed.push(id); }
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

  /** Keeps retrying superseded provider sessions whose closure was not confirmed. */
  private async retryClosures() {
    const open = this.segments.filter(segment => segment.finalization === 'unconfirmed');
    if (!open.length) return;
    for (const segment of open) {
      try { await this.providers.voice.close(segment.providerId); segment.finalization = 'confirmed'; } catch { /* The next wake retries. */ }
    }
    await this.persistLease();
  }

  /** The time given to the store's `wake` has come. A refused write means another owner holds the attempt; this one stops. */
  async wake(): Promise<void> {
    try { await this.alarm(); }
    catch (error) { if (!(error instanceof FencedError)) throw error; }
  }

  private async alarm() {
    if (this.fenced) return;
    this.wakeAt = null;
    if (this.lease?.closed) { await this.clearStore(); return; }
    if (this.recovered) {
      this.recoverCheckpoint();
      await this.finishing;
      return;
    }
    if (!this.state || this.state.status === 'ended' || this.state.status === 'interrupted') {
      await this.closeOrphan();
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
    if (!this.pausing) await this.retryClosures();
  }

  private connectionLog(): ConnectionLog {
    const now = this.now();
    return {
      segments: this.segments.map(({ providerId: _private, ...segment }) => segment),
      pauses: this.pauses.map(pause => ({ reason: pause.reason, pausedAt: pause.pausedAt, resumedAt: pause.resumedAt, durationMs: (pause.resumedAt ?? pause.endedAt ?? now) - pause.pausedAt })),
    };
  }

  private async saveArchive(state: 'partial' | 'final') {
    if (this.fenced) return;
    const id = this.state?.id ?? '';
    try {
      // Freeze the data and its timestamp before any asynchronous work.
      const snapshot = structuredClone(this.publicSnapshot());
      // Grade diagnostics ride with the private producer records; they are never part of the public snapshot.
      const producerLog = structuredClone([...(this.producer?.records ?? []), ...this.grades]);
      const producer = this.producer?.summary() ?? null;
      const connection = this.connectionLog();
      const capturedAt = this.now();
      const narrative = structuredClone(this.narrative);
      this.digests ??= Promise.all([digest(interviewerBrief(this.spec, snapshot.clientId)), digest(interviewOpening(this.spec, snapshot.clientId))]);
      const [actorDigest, openingDigest] = await this.digests;
      const row: InterviewArchiveRow = {
        id: snapshot.id, specId: this.spec.id, specVersion: this.spec.version, voiceId: snapshot.clientId, state, capturedAt, snapshot,
        transcript: snapshot.transcript.map(toPassage), producerLog,
        provenance: { voice: this.voiceName(snapshot.clientId), rubricVersion: INTERVIEW_RUBRIC_VERSION, actorDigest, openingDigest, producer, connection, ...(narrative ? { narrative } : {}) },
      };
      if (this.fenced) return;
      await this.archive.write(row);
    } catch {
      // Best effort: never delay closure or retry a failed transcript save.
      this.report({ type: 'session', event: 'archive.failed', id, category: state });
    }
  }
}
