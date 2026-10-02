import { DurableObject } from 'cloudflare:workers';
import { evaluateInterview } from '../../../ai/interview/evaluate.server';
import { settledPrefix } from '../../../ai/interview/map.server';
import { summarizeInterview, SUMMARY_VERSION } from '../../../ai/interview/summary.server';
import { callFailure } from '../../../ai/interview/diagnostics.server';
import { INTERVIEW_SCENARIO_ID, mergeCoverage, type InterviewSummaryContent } from '../../../core/interview';
import { evaluateClient, evaluateTrainee } from '../../../ai/simulator/evaluate.server';
import { conversationSoFar, getClient, getScenario, openingInstruction, resumeInstruction } from '../../../ai/simulator/scenarios.server';
import { appendTranscript, reconcileObjectives, settledTranscript, TRANSCRIPT_LIMIT, transcriptCharacters, type PauseSpan } from '../../../core/simulator/state';
import {
  SESSION_IDLE_TIMEOUT_MS, SESSION_IDLE_WARNING_MS, SESSION_LIMIT_SECONDS, SESSION_MAX_RESUMES, SESSION_PAUSE_HOLD_MS, SESSION_WALL_LIMIT_MS,
  type SessionPause, type SessionSnapshot, type SessionWarning,
} from '../../../core/simulator/types';
import { attachLive, createLive, LiveSessionGone, NO_EXTERNAL_TASK, transcriptEvent } from './live.server';
import { activitySchema, resumeSchema, simulatorJson, startSchema } from './api';
import { archiveProvenance, writeArchive, writeReport, type ArchiveProvenance, type ConnectionLog } from './archive.server';
import { writeInterviewArchive } from '../interview/archive.server';
import { ContextualDirector, directorServices, type DirectorCheckpoint } from './contextual-director';
import { InterviewProducer, producerServices, type ProducerCheckpoint } from './interview-producer';
import { gradeObjectives, type GradeRecord } from '../../../core/interview-producer';
import { generateReport, REPORT_PROVENANCE } from '../../../ai/simulator/report.server';
import { idleReport, type CoachingReport, type ReportState } from '../../../core/simulator/report';
import { SessionReport, within, type ReportArchive } from './report';
import { foundryConfig } from '../../../ai/foundry.server';

/** `providerId` is the newest provider session not yet confirmed closed; `unconfirmed` holds any older ones. */
type Lease = { capability: string; providerId?: string; unconfirmed?: string[]; deadline: number; closed: boolean };
/** One provider session. A resume opens a new one; its timestamps restart at 0, so `offsetMs` keeps the transcript clock monotonic. */
type Segment = {
  epoch: number; providerId: string; offsetMs: number; startedAt: number; endedAt: number | null;
  closeReason: string | null; finalization: SessionSnapshot['finalization']; usageSeconds: number | null;
};
type PauseRecord = { epoch: number; reason: SessionPause['reason']; pausedAt: number; resumedAt: number | null; endedAt: number | null };
/** What a lost instance needs to finish the attempt. In-flight paid work is not kept. */
type Checkpoint = {
  savedAt: number; snapshot: SessionSnapshot; reachedLive: boolean; epoch: number; resumes: number;
  segments: Segment[]; pauses: PauseRecord[]; grades: GradeRecord[]; gradeCalls: number;
  producer?: ProducerCheckpoint; contextual?: DirectorCheckpoint;
};
const services = { createLive, attachLive, evaluateTrainee, evaluateClient, evaluateInterview, summarizeInterview, generateReport, ...directorServices, ...producerServices };
const GRADE_INTERVAL_MS = 5000;
const MAX_LIVE_GRADES = 719; // Assessment rounds; long transcripts use several requests per round. Final grade is extra.

/**
 * Owns one attempt. The closure lease always survives a worker restart; once the conversation has gone live, a
 * checkpoint lets a replacement owner hold it for the browser to resume, or finish it with what was captured.
 */
export class SimulatorSession extends DurableObject<Env> {
  private lease: Lease | undefined;
  private snapshot: SessionSnapshot | undefined;
  private socket: WebSocket | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private closing: Promise<void> | undefined;
  private orphaning: Promise<void> | undefined;
  private connecting: Promise<{ sdp: string }> | undefined;
  private pausing: Promise<void> | undefined;
  private closeReceived: (() => void) | undefined;
  private lastSeen = Date.now();
  private lastActivity = Date.now();
  private lastAudio = Date.now();
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
  private directing: Promise<void> | undefined;
  private lastDirected = 0;
  private reachedLive = false;
  private epoch = 0;
  private segments: Segment[] = [];
  private pauses: PauseRecord[] = [];
  private resumes = 0;
  /** Restored from a checkpoint too close to its limit to resume; finished on first contact. */
  private recovered = false;
  private contextual: ContextualDirector | undefined;
  private producer: InterviewProducer | undefined;
  private activitySequence = -1;
  // Already bounded by MAX_LIVE_GRADES plus the final grade; retain probability-only changes too.
  private readonly grades: GradeRecord[] = [];
  private seenEvents = new Set<string>();
  private readonly paid: typeof services;
  private report: SessionReport<CoachingReport> | SessionReport<InterviewSummaryContent> | undefined;
  private finalArchive: Promise<void> | undefined;
  private reportArchive = Promise.resolve();
  private summaryArchive: ArchiveProvenance['interviewSummary'];

  constructor(ctx: DurableObjectState, env: Env, paid: Partial<typeof services> = {}) {
    super(ctx, env);
    this.paid = { ...services, ...paid };
    ctx.blockConcurrencyWhile(async () => {
      this.lease = await ctx.storage.get<Lease>('lease');
      const checkpoint = this.lease && !this.lease.closed ? await ctx.storage.get<Checkpoint>('checkpoint') : undefined;
      if (checkpoint) await this.restore(checkpoint);
    });
  }

  private get segment(): Segment | undefined { return this.segments.at(-1); }

  async fetch(request: Request): Promise<Response> {
    const action = new URL(request.url).pathname;
    const capability = request.headers.get('Authorization') ?? '';
    if (!/^Bearer [a-f0-9]{64}$/.test(capability)) return simulatorJson({ error: 'Session capability is required.' }, 401);
    if (this.lease && capability !== this.lease.capability) return simulatorJson({ error: 'Session ownership did not match.' }, 403);
    if (action === '/start') return this.start(request, capability);
    if (!this.lease) {
      // A cancelled browser may send end before its creation request arrives.
      if (action === '/end') {
        this.lease = { capability, deadline: Date.now(), closed: true };
        await this.ctx.storage.put('lease', this.lease);
        await this.ctx.storage.setAlarm(Date.now() + 60_000);
        return simulatorJson({ ended: true });
      }
      return simulatorJson({ error: 'This practice session was not found.' }, 404);
    }
    this.recoverCheckpoint();
    if (!this.snapshot) {
      if (!this.lease.closed) this.ctx.waitUntil(this.closeOrphan());
      return simulatorJson({ error: 'This practice session was interrupted. Start a new attempt.' }, 410);
    }
    if (action === '/report') return this.startReport(request);
    // Terminal reads must not refresh a lease, heartbeat, or live state.
    if (this.snapshot.status === 'ended' || this.snapshot.status === 'interrupted') {
      const report = action === '/poll' && this.report ? await this.report.read() : this.reportState();
      return simulatorJson({ ...this.publicSnapshot(), report });
    }
    this.lastSeen = Date.now();
    if (action === '/poll' && request.body) {
      const activity = activitySchema.parse(await request.json());
      if (activity.sequence == null || activity.sequence > this.activitySequence) {
        if (activity.sequence != null) this.activitySequence = activity.sequence;
        if (activity.active || activity.audio) this.lastActivity = Date.now();
        if (activity.audio) this.lastAudio = Date.now();
      }
    }
    // A best-effort report from a browser that lost its media; the server never depends on it.
    if (action === '/pause') this.ctx.waitUntil(this.pause('browser'));
    if (action === '/resume') return this.resume(request);
    if (action === '/ready' && this.snapshot.status === 'connecting') {
      if (this.checkLifetime()) return simulatorJson(this.publicSnapshot());
      if (this.reachedLive) this.resumed();
      else {
        // The lease makes start single-use, so this transition and its greeting happen once.
        this.snapshot.status = 'live';
        this.reachedLive = true;
        this.lastActivity = Date.now();
        this.send({ type: 'session.instructions.append', event_id: 'opening', delegation_id: null, content: openingInstruction(getScenario(this.snapshot.scenarioId), getClient(this.snapshot.clientId)) });
      }
    }
    if (action === '/end') await this.end();
    this.checkLifetime();
    return simulatorJson(this.publicSnapshot());
  }

  private publicSnapshot(): SessionSnapshot {
    const snapshot = this.snapshot!;
    return { ...snapshot, coaching: this.contextual?.coaching() ?? null,
      ...(snapshot.interview ? { interview: { ...snapshot.interview, background: this.producer?.publicBackground() ?? [] } } : {}) };
  }

  private reportState(): ReportState<CoachingReport | InterviewSummaryContent> {
    if (!this.snapshot || !getScenario(this.snapshot.scenarioId).objectives.length || !this.snapshot.transcript.some(item => item.speaker === 'trainee' && item.text.trim())) {
      return { status: 'ineligible', starts: 0, report: null, failure: null };
    }
    return this.report?.state ?? idleReport();
  }

  private async startReport(request: Request): Promise<Response> {
    if (this.closing) {
      try { await within(this.closing, 40_000); }
      catch { return simulatorJson({ error: 'The conversation is still closing.' }, 409); }
    }
    if (!this.snapshot || !['ended', 'interrupted'].includes(this.snapshot.status)) return simulatorJson({ error: 'End the conversation before requesting its report.' }, 409);
    if (this.reportState().status === 'ineligible') return simulatorJson({ error: 'There is not enough scored conversation to review.' }, 422);
    if (!this.report) {
      const snapshot = structuredClone(this.publicSnapshot());
      if (snapshot.interview) {
        this.report = new SessionReport<InterviewSummaryContent>((signal, finish) => this.paid.summarizeInterview({ transcript: snapshot.transcript, foundry: foundryConfig(this.env), signal }, finish), archive => {
          this.summaryArchive = { model: foundryConfig(this.env).agentModel, version: SUMMARY_VERSION, attempts: archive.attempts };
          this.snapshot!.interview!.summary = archive.report ? { status: 'ready', text: archive.report.text } : { status: 'unavailable', text: null };
          this.reportArchive = this.reportArchive.then(async () => {
            if (this.finalArchive) await within(this.finalArchive, 15_000).catch(() => {});
            await this.saveArchive('final');
          });
          this.ctx.waitUntil(this.reportArchive);
        });
      } else {
        const interventions = structuredClone(this.contextual?.records ?? []);
        this.report = new SessionReport<CoachingReport>((signal, finish) => this.paid.generateReport({ snapshot, interventions, foundry: foundryConfig(this.env), signal }, finish), archive => {
          this.reportArchive = this.reportArchive.then(() => this.saveReport({ ...REPORT_PROVENANCE, model: foundryConfig(this.env).agentModel, ...archive }));
          this.ctx.waitUntil(this.reportArchive);
        });
      }
    }
    return this.report.start(request);
  }

  private async saveReport(archive: ReportArchive) {
    try {
      if (this.finalArchive) await within(this.finalArchive, 15_000).catch(() => {});
      await writeReport(this.env.SIMULATOR_ARCHIVE, this.snapshot!.id, archive);
    } catch {
      console.warn('Simulator report archive save failed', { id: this.snapshot?.id, category: 'report' });
    }
  }

  private async start(request: Request, capability: string): Promise<Response> {
    const input = startSchema.parse(await request.json());
    // Claim after the asynchronous body read so concurrent starts cannot both
    // observe an empty lease and create two paid sessions for the same attempt.
    if (this.lease) return simulatorJson({ error: 'This attempt has already been used. Start a new attempt.' }, 409);
    this.lease = { capability, deadline: Date.now() + SESSION_LIMIT_SECONDS * 1000, closed: false };
    this.snapshot = {
      id: input.id, scenarioId: input.scenarioId, clientId: input.clientId,
      status: 'connecting', startedAt: Date.now(), limitSeconds: SESSION_LIMIT_SECONDS, warning: null,
      revision: 0, transcript: [], evaluation: null, coaching: null, feedbackStatus: 'waiting',
      message: null, finalization: 'pending', usageSeconds: null,
      ...(input.scenarioId === INTERVIEW_SCENARIO_ID ? { interview: { evaluation: null, summary: null } } : {}),
    };
    this.createDirectors();
    await this.ctx.storage.put('lease', this.lease);
    await this.ctx.storage.setAlarm(Date.now() + 30_000);
    try {
      this.connecting = this.openLive(input);
      const created = await this.connecting;
      if (this.snapshot.status === 'ending' || this.lease.closed) {
        return simulatorJson({ error: 'The attempt was cancelled.' }, 409);
      }
      this.lastSeen = Date.now();
      this.timer = setInterval(() => this.tick(), 500);
      return simulatorJson({ sdp: created.sdp, snapshot: this.publicSnapshot() });
    } catch {
      this.snapshot.message = 'The voice connection could not be established.';
      await this.end(true);
      return simulatorJson({ error: this.snapshot.message }, 502);
    }
  }

  private createDirectors() {
    const snapshot = this.snapshot!;
    const settled = () => settledTranscript(this.snapshot!.transcript, this.passageUpdatedAt, Date.now());
    if (snapshot.interview) {
      // Sol's log is append-only, so the producer reads only up to the first passage still being transcribed.
      const prefix = () => { const ready = new Set(settled()); return settledPrefix(this.snapshot!.transcript, entry => ready.has(entry)); };
      this.producer = new InterviewProducer({
        attemptId: snapshot.id, startedAt: snapshot.startedAt,
        foundry: foundryConfig(this.env), typesafeKey: this.env.TYPESAFE_API_KEY!, services: this.paid,
        settled: prefix, coverage: () => this.snapshot!.interview?.evaluation?.objectives ?? [], send: event => this.send(event), waitUntil: work => this.ctx.waitUntil(work),
        pauses: () => this.pauseSpans(),
      });
    } else if (getScenario(snapshot.scenarioId).objectives.length) this.contextual = new ContextualDirector({
      scenarioId: snapshot.scenarioId, clientId: snapshot.clientId,
      objectives: () => this.snapshot!.evaluation?.objectives ?? [],
      isFresh: transcript => this.isFresh(transcript),
      foundry: foundryConfig(this.env), typesafeKey: this.env.TYPESAFE_API_KEY!, services: this.paid,
      settled, send: event => this.send(event),
    });
  }

  private async openLive(input: { scenarioId: string; clientId: string; sdp: string }, offsetMs = 0, context?: string) {
    const created = await this.paid.createLive({ ...input, ...(context ? { context } : {}) }, foundryConfig(this.env));
    const segment: Segment = { epoch: ++this.epoch, providerId: created.session.id, offsetMs, startedAt: Date.now(), endedAt: null, closeReason: null, finalization: 'pending', usageSeconds: null };
    this.segments.push(segment);
    await this.persistLease();
    this.socket = await this.paid.attachLive(created.session.id, foundryConfig(this.env));
    this.listen(this.socket, segment);
    return { sdp: created.transport.sdp };
  }

  /** Events and closures are bound to their segment, so a superseded provider session cannot pause or end its successor. */
  private listen(socket: WebSocket, segment: Segment) {
    socket.addEventListener('message', event => {
      if (typeof event.data !== 'string') return;
      try { this.onEvent(JSON.parse(event.data), segment); } catch { /* Ignore malformed protocol messages, never log private payloads. */ }
    });
    socket.addEventListener('close', () => this.dropped(segment));
    socket.addEventListener('error', () => this.dropped(segment));
  }

  private dropped(segment: Segment) {
    const status = this.snapshot?.status;
    if (this.closing || segment !== this.segment || segment.finalization === 'confirmed' || status === 'paused') return;
    if (this.reachedLive && (status === 'live' || status === 'connecting')) this.ctx.waitUntil(this.pause('provider'));
    else this.ctx.waitUntil(this.end(true));
  }

  private send(event: Record<string, unknown>): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    try {
      this.socket.send(JSON.stringify(event));
      return true;
    } catch { return false; }
  }

  private onEvent(event: Record<string, unknown>, segment: Segment) {
    const snapshot = this.snapshot;
    if (!snapshot || snapshot.status === 'ended' || snapshot.status === 'interrupted') return;
    if (event.type === 'session.closed') {
      segment.finalization = 'confirmed';
      segment.endedAt ??= Date.now();
      segment.closeReason = typeof event.reason === 'string' ? event.reason : null;
      const usage = event.usage as { seconds?: unknown } | undefined;
      if (typeof usage?.seconds === 'number' && Number.isFinite(usage.seconds)) segment.usageSeconds = usage.seconds;
      snapshot.usageSeconds = this.usageSeconds();
      if (segment !== this.segment) return;
      this.closeReceived?.();
      if (this.closing || snapshot.status === 'paused') return;
      // A lost connection holds a conversation that has started; policy and limit closures still end it.
      if (event.reason === 'connection_lost' && this.reachedLive && (snapshot.status === 'live' || snapshot.status === 'connecting')) {
        this.ctx.waitUntil(this.pause('provider'));
        return;
      }
      if (event.reason !== 'close_requested') snapshot.message = event.reason === 'connection_lost' ? 'The voice connection was interrupted.' : 'The voice session ended.';
      this.ctx.waitUntil(this.end(event.reason === 'connection_lost'));
      return;
    }
    if (segment !== this.segment) return;
    const transcript = transcriptEvent.safeParse(event);
    if (transcript.success) {
      const value = transcript.data;
      // The trainee cannot hear a reply generated after they end practice or lose the connection.
      if ((snapshot.status === 'ending' || snapshot.status === 'paused') && value.type === 'session.output_transcript.delta') return;
      const key = value.event_id && `${segment.epoch}:${value.event_id}`;
      if (key && this.seenEvents.has(key)) return;
      if (key) this.seenEvents.add(key);
      const next = appendTranscript(snapshot.transcript, {
        speaker: value.type === 'session.input_transcript.delta' ? 'trainee' : 'client', text: value.delta,
        startMs: value.start_ms + segment.offsetMs, endMs: value.end_ms + segment.offsetMs,
      }, this.judgedPassages);
      // Late deltas may arrive during close. Keep the final grading input valid.
      if (next.length > TRANSCRIPT_LIMIT.entries || transcriptCharacters(next) > TRANSCRIPT_LIMIT.characters) return;
      const changed = next.find(entry => !snapshot.transcript.includes(entry));
      if (!changed) return;
      this.passageUpdatedAt.set(changed.id, Date.now());
      this.lastActivity = Date.now();
      snapshot.transcript = next;
      snapshot.revision++;
      this.producer?.transcriptChanged(changed, next[next.indexOf(changed) - 1]?.id ?? null);
      if (snapshot.transcript.length >= TRANSCRIPT_LIMIT.entries * .9 || transcriptCharacters(snapshot.transcript) >= TRANSCRIPT_LIMIT.characters * .9) this.capacityDeadline ??= Date.now() + 30_000;
      return;
    }
    if (snapshot.status === 'ending' || snapshot.status === 'paused') return;
    if ((event.type === 'session.thinking.appended' || event.type === 'session.instructions.appended') && typeof event.client_event_id === 'string') {
      if (event.type === 'session.instructions.appended') this.contextual?.providerEvent(event.client_event_id, true);
      this.producer?.providerEvent(event.client_event_id, true, {
        ...(typeof event.start_ms === 'number' && Number.isFinite(event.start_ms) ? { startMs: event.start_ms + segment.offsetMs } : {}),
        ...(typeof event.end_ms === 'number' && Number.isFinite(event.end_ms) ? { endMs: event.end_ms + segment.offsetMs } : {}),
      });
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
      // A declined optional cue or note need not interrupt otherwise-working practice.
      if (typeof error?.client_event_id === 'string' && /^(cue|note)-/.test(error.client_event_id)) {
        this.contextual?.providerEvent(error.client_event_id, false);
        this.producer?.providerEvent(error.client_event_id, false);
        return;
      }
      snapshot.message = 'The voice service reported a problem. You can end this attempt and try again.';
    }
  }

  private tick() {
    const snapshot = this.snapshot;
    if (!snapshot || snapshot.status !== 'live') return;
    const now = Date.now();
    if (this.checkLifetime()) return;
    if (!getScenario(snapshot.scenarioId).objectives.length) return;
    this.producer?.tick(now);
    const transcript = settledTranscript(snapshot.transcript, this.passageUpdatedAt, now);
    const text = JSON.stringify(transcript);
    if ((snapshot.evaluation || snapshot.interview?.evaluation) && text !== this.gradedText) snapshot.feedbackStatus = 'delayed';
    if (!transcript.some(item => item.speaker === 'trainee') || this.grading || text === this.gradedText || now - this.lastGrade < GRADE_INTERVAL_MS || this.gradeCalls >= MAX_LIVE_GRADES) return;
    this.lastGrade = now;
    this.gradedText = text;
    // A quoted source must stay exact, even if more speech arrives during grading.
    for (const entry of transcript) this.judgedPassages.add(entry.id);
    this.grading = this.grade(transcript, snapshot.revision, false, now).finally(() => { this.grading = undefined; });
    this.ctx.waitUntil(this.grading);
    if (!snapshot.interview && this.contextual?.canObserveActor && !this.directing && now - this.lastDirected >= 8000) {
      this.lastDirected = now;
      this.directing = this.direct(transcript, snapshot.revision, now).finally(() => { this.directing = undefined; });
      this.ctx.waitUntil(this.directing);
    }
  }

  /** Shared by polls, the live tick and the durable alarm; browser contact is not conversation activity. */
  private checkLifetime(): boolean {
    const snapshot = this.snapshot;
    const now = Date.now();
    if (snapshot?.status === 'paused' && !this.closing) {
      if (this.pausing) return true;
      const hold = snapshot.pause;
      if (!hold || now < hold.resumeBy) return false;
      const capped = hold.resumeBy < hold.pausedAt + SESSION_PAUSE_HOLD_MS;
      snapshot.message = `${snapshot.interview ? 'The interview' : 'Practice'} ended because the connection did not return ${capped ? 'in time' : 'within 15 minutes'}.`;
      this.ctx.waitUntil(this.end());
      return true;
    }
    if (!snapshot || (snapshot.status !== 'live' && snapshot.status !== 'connecting')) return !!this.closing;
    if (now - this.lastSeen > 35_000) {
      // A page that went quiet mid-conversation most likely lost its network; hold the attempt for it.
      if (this.reachedLive) {
        this.ctx.waitUntil(this.pause('browser'));
        return true;
      }
      snapshot.message = 'Practice ended after losing contact with this page.';
      this.ctx.waitUntil(this.end());
      return true;
    }
    if (snapshot.status === 'connecting') {
      if (now - (this.connectingSince ?? snapshot.startedAt) < 60_000) return false;
      if (this.reachedLive) {
        snapshot.message = 'Reconnecting timed out. Try resuming again.';
        this.ctx.waitUntil(this.pause('browser'));
        return true;
      }
      snapshot.message = 'The voice connection timed out before practice began.';
      this.ctx.waitUntil(this.end(true));
      return true;
    }
    let warning: SessionWarning | null = null;
    if (now - this.lastActivity >= SESSION_IDLE_WARNING_MS) warning = { kind: 'idle', endsAt: this.lastActivity + SESSION_IDLE_TIMEOUT_MS };
    const deadline = this.lease!.deadline;
    if (now >= deadline - 60_000 && (!warning || deadline < warning.endsAt)) warning = { kind: 'limit', endsAt: deadline };
    if (this.capacityDeadline && (!warning || this.capacityDeadline < warning.endsAt)) warning = { kind: 'capacity', endsAt: this.capacityDeadline };
    snapshot.warning = warning;
    if (!warning || now < warning.endsAt) return false;
    // Automatic limits give current speech a short bounded drain. Explicit End remains immediate.
    if (warning.kind !== 'idle' && now < warning.endsAt + 20_000 && (now < warning.endsAt + 3000 || now - this.lastAudio < 2500)) return true;
    snapshot.message = warning.kind === 'idle' ? 'Practice ended after five minutes without activity.' : warning.kind === 'limit' ? 'Practice reached the 60-minute safety limit.' : 'Practice reached its transcript capacity.';
    this.ctx.waitUntil(this.end());
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
    return Math.min(this.lease!.deadline + (open ? now - open.pausedAt : 0), this.snapshot!.startedAt + SESSION_WALL_LIMIT_MS);
  }

  /** Holds a started conversation after a lost connection. Idempotent; a conversation near a hard limit ends instead. */
  private pause(reason: SessionPause['reason']): Promise<void> {
    if (this.pausing) return this.pausing;
    const snapshot = this.snapshot;
    if (!snapshot || this.closing || !this.reachedLive || (snapshot.status !== 'live' && snapshot.status !== 'connecting')) return Promise.resolve();
    const now = Date.now();
    if (this.capacityDeadline || now >= this.limitAt(now) - 60_000) {
      snapshot.message = `${snapshot.interview ? 'The interview' : 'Practice'} ended because the connection was lost close to its limit.`;
      return this.end();
    }
    this.pausing = this.suspend(reason).finally(() => { this.pausing = undefined; });
    return this.pausing;
  }

  /** Marks the attempt paused and starts its hold. */
  private hold(reason: SessionPause['reason'], now: number) {
    const snapshot = this.snapshot!;
    snapshot.status = 'paused';
    snapshot.warning = null;
    // A failed resume continues the pause it was resuming.
    let record = this.openPause();
    if (!record) {
      record = { epoch: this.epoch, reason, pausedAt: now, resumedAt: null, endedAt: null };
      this.pauses.push(record);
    }
    snapshot.pause ??= { reason: record.reason, pausedAt: record.pausedAt, resumeBy: Math.min(record.pausedAt + SESSION_PAUSE_HOLD_MS, snapshot.startedAt + SESSION_WALL_LIMIT_MS), resumes: this.resumes, maxResumes: SESSION_MAX_RESUMES };
  }

  private async suspend(reason: SessionPause['reason']) {
    this.hold(reason, Date.now());
    clearInterval(this.timer);
    this.timer = undefined;
    this.gradeAbort.abort();
    this.producer?.pause();
    this.contextual?.pause();
    try { await this.connecting; } catch { /* A failed resume is reported by resume. */ }
    await this.closeSegment();
    await this.grading;
    await this.directing;
    this.gradeAbort = new AbortController();
    if (this.closing) return;
    await this.saveCheckpoint();
    await this.ctx.storage.setAlarm(Date.now() + 30_000);
    this.ctx.waitUntil(this.saveArchive('partial'));
  }

  /** A new provider session, seeded with the conversation so far, continues the paused attempt. */
  private async resume(request: Request): Promise<Response> {
    const input = resumeSchema.parse(await request.json());
    const snapshot = this.snapshot!;
    // An outage shorter than the server's contact grace was never noticed here, and an abandoned
    // reconnect may still be connecting; either is paused before the new attempt.
    if (snapshot.status === 'live' || (snapshot.status === 'connecting' && this.reachedLive)) await this.pause('browser');
    await this.pausing;
    const hold = snapshot.pause;
    if (this.closing || snapshot.status !== 'paused' || !hold) return simulatorJson({ error: 'This attempt is not paused.', snapshot: this.publicSnapshot() }, 409);
    const now = Date.now();
    const refusal = this.resumes >= SESSION_MAX_RESUMES ? 'This attempt has reconnected too many times. End it to keep what was captured.'
      : now >= hold.resumeBy ? 'The hold on this attempt has expired.'
      : this.limitAt(now) - now < 60_000 ? 'Too little time remains to resume this attempt.' : null;
    if (refusal) return simulatorJson({ error: refusal, snapshot: this.publicSnapshot() }, 409);
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
      this.connecting = this.openLive({ scenarioId: snapshot.scenarioId, clientId: snapshot.clientId, sdp: input.sdp }, offsetMs,
        conversationSoFar(getScenario(snapshot.scenarioId), getClient(snapshot.clientId), snapshot.transcript));
      const created = await this.connecting;
      if (this.closing || snapshot.status !== 'connecting') return simulatorJson({ error: 'The attempt changed while reconnecting.', snapshot: this.publicSnapshot() }, 409);
      this.lastSeen = Date.now();
      clearInterval(this.timer);
      this.timer = setInterval(() => this.tick(), 500);
      return simulatorJson({ sdp: created.sdp, snapshot: this.publicSnapshot() });
    } catch {
      if (this.closing || String(snapshot.status) !== 'connecting') return simulatorJson({ error: 'The attempt changed while reconnecting.', snapshot: this.publicSnapshot() }, 409);
      snapshot.status = 'paused';
      snapshot.message = 'The voice connection could not be re-established. Try again.';
      // Creation may have succeeded before attachment failed.
      if (this.epoch !== epoch) await this.closeSegment();
      await this.saveCheckpoint();
      return simulatorJson({ error: snapshot.message, snapshot: this.publicSnapshot() }, 502);
    }
  }

  /** The resumed media is connected: restate the producer's notes, then let the actor pick the conversation back up. */
  private resumed() {
    const snapshot = this.snapshot!;
    const lease = this.lease!;
    const now = Date.now();
    const open = this.openPause();
    const pausedMs = open ? now - open.pausedAt : 0;
    lease.deadline = this.limitAt(now);
    if (open) open.resumedAt = now;
    this.ctx.waitUntil(this.ctx.storage.put('lease', lease));
    snapshot.status = 'live';
    snapshot.pause = null;
    snapshot.warning = null;
    snapshot.message = null;
    this.connectingSince = undefined;
    this.lastActivity = this.lastAudio = now;
    this.contextual?.resume();
    this.producer?.resume(now);
    this.send({ type: 'session.instructions.append', event_id: `resume-${this.epoch}`, delegation_id: null,
      content: resumeInstruction(getScenario(snapshot.scenarioId), getClient(snapshot.clientId), snapshot.transcript, pausedMs) });
  }

  /** Closes the current provider session, reattaching if its control socket is gone. */
  private async closeSegment() {
    const segment = this.segment;
    if (!segment) return;
    const pending = () => segment.finalization === 'pending';
    if (pending()) {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        try { this.socket = await this.paid.attachLive(segment.providerId, foundryConfig(this.env)); this.listen(this.socket, segment); }
        catch (error) { if (error instanceof LiveSessionGone) segment.finalization = 'confirmed'; /* Otherwise the alarm retains closure responsibility. */ }
      }
      if (pending()) await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, 10_000);
        this.closeReceived = () => { clearTimeout(timer); resolve(); };
        if (!this.send({ type: 'session.close' })) { clearTimeout(timer); resolve(); }
      });
      if (pending()) segment.finalization = 'unconfirmed';
    }
    segment.endedAt ??= Date.now();
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
    await this.ctx.storage.put('lease', lease);
  }

  private usageSeconds(): number | null {
    const known = this.segments.filter(segment => segment.usageSeconds != null);
    return known.length ? known.reduce((total, segment) => total + segment.usageSeconds!, 0) : null;
  }

  private async grade(transcript: SessionSnapshot['transcript'], revision: number, final: boolean, capturedAt = Date.now()) {
    const snapshot = this.snapshot!;
    const scenario = getScenario(snapshot.scenarioId);
    if (!scenario.objectives.length) return;
    this.gradeCalls++;
    const diagnostic = { source: 'grade' as const, id: `grade-${this.gradeCalls}`, final, revision, capturedAt,
      inputCount: transcript.length, lastInputId: transcript.at(-1)?.id ?? null };
    const observation = final || snapshot.interview ? undefined : this.contextual?.beginObservation({ audience: 'trainee', transcript, revision, capturedAt });
    try {
      const input = { scenarioId: snapshot.scenarioId, clientId: snapshot.clientId, transcript, revision, apiKey: this.env.TYPESAFE_API_KEY!, signal: AbortSignal.any([this.gradeAbort.signal, AbortSignal.timeout(final ? 8000 : 3000)]) };
      if (snapshot.interview) {
        // Coverage is re-judged each time against the whole settled transcript.
        const result = await this.paid.evaluateInterview(input);
        const log = { ...diagnostic, completedAt: Date.now(), durationMs: result.durationMs };
        if ((!final && this.closing) || revision < (snapshot.interview.evaluation?.revision ?? 0)) {
          this.grades.push({ ...log, outcome: 'stale', objectives: gradeObjectives(result.objectives, snapshot.interview.evaluation?.objectives ?? []) });
          return;
        }
        // Live bands resist flicker; the final re-grade replaces them, so an unsupported checkmark is withdrawn.
        const objectives = final ? result.objectives : mergeCoverage(snapshot.interview.evaluation?.objectives ?? [], result.objectives);
        this.grades.push({ ...log, outcome: 'graded', objectives: gradeObjectives(result.objectives, objectives) });
        snapshot.interview.evaluation = { revision: result.revision, readings: result.readings, model: result.model, durationMs: result.durationMs, objectives };
        snapshot.feedbackStatus = final || this.isFresh(transcript) ? 'current' : 'delayed';
        return;
      }
      const achievedIds = final ? [] : snapshot.evaluation?.objectives.filter(item => item.achieved && scenario.objectives.find(objective => objective.id === item.id)?.kind !== 'outcome').map(item => item.id) ?? [];
      const result = await this.paid.evaluateTrainee({ ...input, achievedIds });
      if (!final && this.closing) return;
      if (snapshot.evaluation && revision < snapshot.evaluation.revision) return;
      // Explicit public projection: raw client diagnostics and grader questions stay private.
      snapshot.evaluation = { revision: result.revision, skills: result.skills, concern: result.concern, model: result.model, durationMs: result.durationMs, objectives: final ? result.objectives : reconcileObjectives(scenario, snapshot.evaluation?.objectives ?? [], result.objectives) };
      snapshot.feedbackStatus = final || this.isFresh(transcript) ? 'current' : 'delayed';
      if (!final) {
        const work = this.contextual?.observe(observation, { signals: result.signals, model: result.model });
        if (work) this.ctx.waitUntil(work);
      }
    } catch (error) {
      if (snapshot.interview) this.grades.push({ ...diagnostic, completedAt: Date.now(),
        failure: callFailure(error),
        outcome: this.gradeAbort.signal.aborted && !final ? 'aborted' : error instanceof Error && error.name === 'TimeoutError' ? 'evaluation_timeout' : 'evaluation_error' });
      if (this.gradeAbort.signal.aborted && !final) return;
      if (!final) this.contextual?.observe(observation, { signals: [], failure: error instanceof Error && error.name === 'TimeoutError' ? 'evaluation_timeout' : 'evaluation_error' });
      snapshot.feedbackStatus = (snapshot.evaluation || snapshot.interview?.evaluation) ? 'delayed' : 'unavailable';
      // One cadence-limited retry per input, still inside the overall paid-call cap.
      if (!final && this.retriedText !== this.gradedText) {
        this.retriedText = this.gradedText;
        this.gradedText = '';
      }
      if (final && snapshot.evaluation) {
        const outcomes = getScenario(snapshot.scenarioId).objectives.filter(item => item.kind === 'outcome').map(item => item.id);
        snapshot.evaluation.objectives = snapshot.evaluation.objectives.map(item => outcomes.includes(item.id) ? { ...item, achieved: false, probability: null, evidence: null } : item);
      }
    }
  }

  private isFresh(transcript: SessionSnapshot['transcript']): boolean {
    return JSON.stringify(transcript) === JSON.stringify(settledTranscript(this.snapshot!.transcript, this.passageUpdatedAt, Date.now()));
  }

  private async direct(transcript: SessionSnapshot['transcript'], revision: number, capturedAt: number) {
    const snapshot = this.snapshot!;
    const input = { scenarioId: snapshot.scenarioId, clientId: snapshot.clientId, transcript, revision, apiKey: this.env.TYPESAFE_API_KEY!, signal: AbortSignal.any([this.gradeAbort.signal, AbortSignal.timeout(2500)]) };
    const failure = (error: unknown) => error instanceof Error && error.name === 'TimeoutError' ? 'evaluation_timeout' as const : 'evaluation_error' as const;
    const observation = this.contextual?.beginObservation({ audience: 'actor', transcript, revision, capturedAt });
    try {
      const result = await this.paid.evaluateClient(input);
      const work = this.contextual?.observe(observation, { signals: result.signals, model: result.model });
      if (work) this.ctx.waitUntil(work);
    } catch (error) {
      this.contextual?.observe(observation, { signals: [], failure: failure(error) });
    }
  }

  private end(interrupted = false): Promise<void> {
    return this.closing ??= this.finish(interrupted);
  }

  private async finish(interrupted: boolean) {
    const snapshot = this.snapshot!;
    const drain = snapshot.status === 'live' && !interrupted;
    snapshot.status = 'ending';
    this.contextual?.close();
    this.producer?.close();
    clearInterval(this.timer);
    this.gradeAbort.abort();
    try { await this.connecting; } catch { /* Creation failure is surfaced by start or resume. */ }
    await this.pausing;
    await this.grading;
    this.gradeAbort = new AbortController();
    const current = this.segment;
    // Only the newest session can still be open; any other unclosed one is left to the closure lease.
    for (const segment of this.segments) if (segment !== current && segment.finalization === 'pending') segment.finalization = 'unconfirmed';
    if (current?.finalization === 'pending') {
      // The browser sends silence while the final trainee audio/transcript arrives.
      if (drain) await new Promise(resolve => setTimeout(resolve, 1000));
      await this.closeSegment();
    } else {
      this.socket?.close();
      this.socket = undefined;
    }
    if (snapshot.transcript.some(item => item.speaker === 'trainee')) await this.grade(snapshot.transcript, snapshot.revision, true);
    snapshot.status = interrupted ? 'interrupted' : 'ended';
    const now = Date.now();
    for (const pause of this.pauses) if (pause.resumedAt === null) pause.endedAt ??= now;
    snapshot.pause = null;
    snapshot.usageSeconds = this.usageSeconds();
    const outstanding = this.outstanding();
    snapshot.finalization = this.segments.length && !outstanding.length ? 'confirmed' : 'unconfirmed';
    if (outstanding.length) snapshot.message = 'Practice ended, but the voice service did not confirm finalization.';
    this.lease!.closed = !outstanding.length;
    await this.persistLease(outstanding);
    await this.ctx.storage.delete('checkpoint');
    await this.ctx.storage.setAlarm(Date.now() + (this.lease!.closed ? 300_000 : 15_000));
    if (this.reachedLive) {
      if (snapshot.interview) {
        snapshot.interview.summary = { status: snapshot.transcript.some(item => item.speaker === 'trainee') ? 'pending' : 'unavailable', text: null };
      }
      this.finalArchive = this.saveArchive('final');
      this.ctx.waitUntil(this.finalArchive);
    }
  }

  private async saveCheckpoint() {
    const snapshot = this.snapshot;
    if (!snapshot || !this.reachedLive || this.closing) return;
    const checkpoint: Checkpoint = structuredClone({
      savedAt: Date.now(), snapshot, reachedLive: this.reachedLive, epoch: this.epoch, resumes: this.resumes,
      segments: this.segments, pauses: this.pauses, grades: this.grades, gradeCalls: this.gradeCalls,
      ...(this.producer ? { producer: this.producer.checkpoint() } : {}),
      ...(this.contextual ? { contextual: this.contextual.checkpoint() } : {}),
    });
    try { await this.ctx.storage.put('checkpoint', checkpoint); }
    catch { console.warn('Simulator checkpoint save failed', { id: snapshot.id }); }
  }

  /** The previous owner was lost. A started conversation is held for its browser to resume, as after a lost connection. */
  private async restore(checkpoint: Checkpoint) {
    this.snapshot = checkpoint.snapshot;
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
    for (const entry of this.snapshot.transcript) {
      this.passageUpdatedAt.set(entry.id, checkpoint.savedAt);
      this.judgedPassages.add(entry.id);
    }
    this.createDirectors();
    if (checkpoint.producer) this.producer?.restore(checkpoint.producer);
    if (checkpoint.contextual) this.contextual?.restore(checkpoint.contextual);
    const snapshot = this.snapshot;
    const now = Date.now();
    if (!['live', 'connecting', 'paused'].includes(snapshot.status) || now >= this.limitAt(now) - 60_000) {
      this.recovered = true;
      return;
    }
    // Their control sockets were lost with the previous owner; the alarm closes them.
    for (const segment of this.segments) if (segment.finalization === 'pending') {
      segment.finalization = 'unconfirmed';
      segment.endedAt ??= now;
    }
    this.hold('restart', now);
    snapshot.message = null;
    await this.saveCheckpoint();
    // The orphaned sessions are still billing; close them soon rather than at the next scheduled check.
    await this.ctx.storage.setAlarm(now + 1000);
  }

  /** Too little time remained to resume. Finish from the checkpoint so the captured conversation is graded and archived. */
  private recoverCheckpoint() {
    if (!this.recovered) return;
    this.recovered = false;
    const snapshot = this.snapshot!;
    snapshot.message = `${snapshot.interview ? 'The interview' : 'Practice'} was interrupted by a service restart. Your transcript was saved.`;
    this.ctx.waitUntil(this.end(true));
  }

  private closeOrphan(): Promise<void> {
    if (!this.orphaning) this.orphaning = this.recoverLease().finally(() => { this.orphaning = undefined; });
    return this.orphaning;
  }

  private async recoverLease() {
    const lease = this.lease;
    if (!lease || lease.closed) return;
    // No provider id survives a process loss during creation. There is no Live
    // lookup-by-attempt API; do not leave this local lease retrying forever.
    const ids = [...new Set([...(lease.unconfirmed ?? []), ...(lease.providerId ? [lease.providerId] : [])])];
    if (!ids.length) { await this.ctx.storage.deleteAll(); return; }
    const failed: string[] = [];
    for (const id of ids) {
      try { await this.closeProvider(id); } catch { failed.push(id); }
    }
    if (failed.length) {
      await this.persistLease(failed);
      throw new Error('Closure not confirmed.');
    }
    lease.closed = true;
    await this.persistLease([]);
    await this.ctx.storage.setAlarm(Date.now() + 300_000);
  }

  /** Closes one provider session over a dedicated control socket. A session that no longer exists is closed. */
  private async closeProvider(id: string) {
    let socket: WebSocket | undefined;
    try {
      socket = await this.paid.attachLive(id, foundryConfig(this.env));
      const control = socket;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Closure not confirmed.')), 10_000);
        control.addEventListener('message', event => {
          if (typeof event.data !== 'string') return;
          try {
            if (JSON.parse(event.data).type === 'session.closed') { clearTimeout(timeout); resolve(); }
          } catch { /* Ignore unrelated protocol data. */ }
        });
        control.send(JSON.stringify({ type: 'session.close' }));
      });
    } catch (error) { if (!(error instanceof LiveSessionGone)) throw error; }
    finally { socket?.close(); }
  }

  /** Keeps retrying superseded provider sessions whose closure was not confirmed. */
  private async retryClosures() {
    const open = this.segments.filter(segment => segment.finalization === 'unconfirmed');
    if (!open.length) return;
    for (const segment of open) {
      try { await this.closeProvider(segment.providerId); segment.finalization = 'confirmed'; } catch { /* The next alarm retries. */ }
    }
    await this.persistLease();
  }

  async alarm() {
    if (this.lease?.closed) { await this.ctx.storage.deleteAll(); return; }
    if (this.recovered) {
      this.recoverCheckpoint();
      await this.closing;
      return;
    }
    if (!this.snapshot || this.snapshot.status === 'ended' || this.snapshot.status === 'interrupted') {
      await this.closeOrphan();
      return;
    }
    this.checkLifetime();
    if (this.closing) { await this.closing; return; }
    await this.ctx.storage.setAlarm(Date.now() + 30_000);
    if (this.snapshot.status === 'live') {
      await this.saveCheckpoint();
      this.ctx.waitUntil(this.saveArchive('partial'));
    }
    // Includes sessions orphaned by a restart, which a resumed conversation leaves behind.
    if (!this.pausing) await this.retryClosures();
  }

  private connectionLog(): ConnectionLog {
    const now = Date.now();
    return {
      segments: this.segments.map(({ providerId: _private, ...segment }) => segment),
      pauses: this.pauses.map(pause => ({ reason: pause.reason, pausedAt: pause.pausedAt, resumedAt: pause.resumedAt, durationMs: (pause.resumedAt ?? pause.endedAt ?? now) - pause.pausedAt })),
    };
  }

  private async saveArchive(state: 'partial' | 'final') {
    try {
      // Freeze the data and its timestamp before any asynchronous work.
      const snapshot = structuredClone(this.publicSnapshot());
      const interventions = structuredClone(this.contextual?.records ?? []);
      // Grade diagnostics ride with the private producer records; they are never part of the public snapshot.
      const producer = structuredClone([...(this.producer?.records ?? []), ...this.grades]);
      const director = this.producer?.summary() ?? this.contextual?.summary() ?? null;
      const connection = this.connectionLog();
      const capturedAt = Date.now();
      const summaryArchive = structuredClone(this.summaryArchive);
      const provenance: ArchiveProvenance = { ...await archiveProvenance(this.env, snapshot, director), connection };
      if (summaryArchive) provenance.interviewSummary = summaryArchive;
      if (snapshot.interview) await writeInterviewArchive(this.env.SIMULATOR_ARCHIVE, { state, capturedAt, snapshot: { ...snapshot, interview: snapshot.interview }, interventions: producer, provenance });
      else await writeArchive(this.env.SIMULATOR_ARCHIVE, { state, capturedAt, snapshot, provenance, interventions });
    } catch {
      // Best effort: never delay closure or retry a failed transcript save.
      console.warn('Simulator archive save failed', { id: this.snapshot?.id, category: state });
    }
  }
}
