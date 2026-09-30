import { DurableObject } from 'cloudflare:workers';
import { evaluateInterview, evaluateInterviewer } from '../../../ai/interview/evaluate.server';
import { summarizeInterview } from '../../../ai/interview/summary.server';
import { coverageEvidenceIds, INTERVIEW_SCENARIO_ID, mergeCoverage, type InterviewSummaryContent } from '../../../core/interview';
import { evaluateClient, evaluateTrainee } from '../../../ai/simulator/evaluate.server';
import { getClient, getScenario, openingInstruction } from '../../../ai/simulator/scenarios.server';
import { appendTranscript, reconcileObjectives, settledTranscript, TRANSCRIPT_LIMIT, transcriptCharacters } from '../../../core/simulator/state';
import { SESSION_IDLE_TIMEOUT_MS, SESSION_IDLE_WARNING_MS, SESSION_LIMIT_SECONDS, type SessionSnapshot, type SessionWarning } from '../../../core/simulator/types';
import { attachLive, createLive, LiveSessionGone, NO_EXTERNAL_TASK, transcriptEvent } from './live.server';
import { activitySchema, simulatorJson, startSchema } from './api';
import { archiveProvenance, writeArchive, writeReport } from './archive.server';
import { writeInterviewArchive } from '../interview/archive.server';
import { ContextualDirector, directorServices } from './contextual-director';
import { InterviewProducer, producerServices } from './interview-producer';
import { gradeObjectives, type GradeRecord } from '../../../core/interview-producer';
import { generateReport, REPORT_PROVENANCE } from '../../../ai/simulator/report.server';
import { idleReport, type CoachingReport, type ReportState } from '../../../core/simulator/report';
import { SessionReport, within, type ReportArchive } from './report';
import { foundryConfig } from '../../../ai/foundry.server';

type Lease = { capability: string; providerId?: string; deadline: number; closed: boolean };
const services = { createLive, attachLive, evaluateTrainee, evaluateClient, evaluateInterview, evaluateInterviewer, summarizeInterview, generateReport, ...directorServices, ...producerServices };
const GRADE_INTERVAL_MS = 5000;
const MAX_LIVE_GRADES = 719; // Assessment rounds; long transcripts use several requests per round. Final grade is extra.

/** Owns one transient attempt. Only the closure lease survives a worker restart. */
export class SimulatorSession extends DurableObject<Env> {
  private lease: Lease | undefined;
  private snapshot: SessionSnapshot | undefined;
  private socket: WebSocket | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private closing: Promise<void> | undefined;
  private orphaning: Promise<void> | undefined;
  private connecting: Promise<{ sdp: string }> | undefined;
  private closeReceived: (() => void) | undefined;
  private lastSeen = Date.now();
  private lastActivity = Date.now();
  private lastAudio = Date.now();
  private capacityDeadline: number | null = null;
  private passageUpdatedAt = new Map<string, number>();
  private judgedPassages = new Set<string>();
  private lastGrade = 0;
  private gradedText = '';
  private retriedText = '';
  private gradeCalls = 0;
  private grading: Promise<void> | undefined;
  private gradeAbort = new AbortController();
  private directing = false;
  private lastDirected = 0;
  private reachedLive = false;
  private contextual: ContextualDirector | undefined;
  private producer: InterviewProducer | undefined;
  private quietReport: { outputMs: number | null; at: number } | undefined;
  private activitySequence = -1;
  // Already bounded by MAX_LIVE_GRADES plus the final grade; retain probability-only changes too.
  private readonly grades: GradeRecord[] = [];
  private seenEvents = new Set<string>();
  private readonly paid: typeof services;
  private report: SessionReport<CoachingReport> | SessionReport<InterviewSummaryContent> | undefined;
  private finalArchive: Promise<void> | undefined;
  private reportArchive = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env, paid: Partial<typeof services> = {}) {
    super(ctx, env);
    this.paid = { ...services, ...paid };
    ctx.blockConcurrencyWhile(async () => { this.lease = await ctx.storage.get<Lease>('lease'); });
  }

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
        this.quietReport = { outputMs: activity.outputQuietMs ?? null, at: Date.now() };
      }
    }
    if (action === '/ready' && this.snapshot.status === 'connecting') {
      if (this.checkLifetime()) return simulatorJson(this.publicSnapshot());
      // The lease makes start single-use, so this transition and its greeting happen once.
      this.snapshot.status = 'live';
      this.reachedLive = true;
      this.lastActivity = Date.now();
      this.send({ type: 'session.instructions.append', event_id: 'opening', delegation_id: null, content: openingInstruction(getScenario(this.snapshot.scenarioId), getClient(this.snapshot.clientId)) });
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
    const settled = () => settledTranscript(this.snapshot!.transcript, this.passageUpdatedAt, Date.now());
    if (this.snapshot.interview) {
      this.producer = new InterviewProducer({
        clientId: input.clientId, startedAt: this.snapshot.startedAt,
        foundry: foundryConfig(this.env), typesafeKey: this.env.TYPESAFE_API_KEY!, services: this.paid,
        settled, coverage: () => this.snapshot!.interview?.evaluation?.objectives ?? [], send: event => this.send(event), waitUntil: work => this.ctx.waitUntil(work),
        canDeliverCue: () => this.canDeliverCue(),
      });
    } else if (getScenario(input.scenarioId).objectives.length) this.contextual = new ContextualDirector({
      scenarioId: input.scenarioId, clientId: input.clientId,
      objectives: () => this.snapshot!.evaluation?.objectives ?? [],
      isFresh: transcript => this.isFresh(transcript),
      foundry: foundryConfig(this.env), typesafeKey: this.env.TYPESAFE_API_KEY!, services: this.paid,
      settled, send: event => this.send(event),
    });
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

  private async openLive(input: { scenarioId: string; clientId: string; sdp: string }) {
    const created = await this.paid.createLive(input, foundryConfig(this.env));
    this.lease!.providerId = created.session.id;
    await this.ctx.storage.put('lease', this.lease);
    this.socket = await this.paid.attachLive(created.session.id, foundryConfig(this.env));
    this.listen(this.socket);
    return { sdp: created.transport.sdp };
  }

  private listen(socket: WebSocket) {
    socket.addEventListener('message', event => {
      if (typeof event.data !== 'string') return;
      try { this.onEvent(JSON.parse(event.data)); } catch { /* Ignore malformed protocol messages, never log private payloads. */ }
    });
    socket.addEventListener('close', () => {
      if (!this.closing && this.snapshot?.finalization !== 'confirmed') this.ctx.waitUntil(this.end(true));
    });
    socket.addEventListener('error', () => { if (!this.closing) this.ctx.waitUntil(this.end(true)); });
  }

  private send(event: Record<string, unknown>): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    try {
      this.socket.send(JSON.stringify(event));
      return true;
    } catch { return false; }
  }

  private canDeliverCue() {
    const now = Date.now();
    const lastSam = this.snapshot?.transcript.findLast(entry => entry.speaker === 'client');
    return !!this.quietReport && now - this.quietReport.at <= 1500 && this.quietReport.outputMs != null && this.quietReport.outputMs >= 600
      && (!lastSam || now - (this.passageUpdatedAt.get(lastSam.id) ?? now) >= 600);
  }

  private onEvent(event: Record<string, unknown>) {
    const snapshot = this.snapshot;
    if (!snapshot || snapshot.status === 'ended' || snapshot.status === 'interrupted') return;
    if (event.type === 'session.closed') {
      snapshot.finalization = 'confirmed';
      const usage = event.usage as { seconds?: unknown } | undefined;
      if (typeof usage?.seconds === 'number' && Number.isFinite(usage.seconds)) snapshot.usageSeconds = usage.seconds;
      if (event.reason !== 'close_requested' && !this.closing) snapshot.message = event.reason === 'connection_lost' ? 'The voice connection was interrupted.' : 'The voice session ended.';
      this.closeReceived?.();
      if (!this.closing) this.ctx.waitUntil(this.end(event.reason === 'connection_lost'));
      return;
    }
    const transcript = transcriptEvent.safeParse(event);
    if (transcript.success) {
      const value = transcript.data;
      // The trainee cannot hear a reply generated after they end practice.
      if (snapshot.status === 'ending' && value.type === 'session.output_transcript.delta') return;
      if (value.event_id && this.seenEvents.has(value.event_id)) return;
      if (value.event_id) this.seenEvents.add(value.event_id);
      const next = appendTranscript(snapshot.transcript, {
        speaker: value.type === 'session.input_transcript.delta' ? 'trainee' : 'client', text: value.delta, startMs: value.start_ms, endMs: value.end_ms,
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
    if (snapshot.status === 'ending') return;
    if ((event.type === 'session.thinking.appended' || event.type === 'session.instructions.appended') && typeof event.client_event_id === 'string') {
      if (event.type === 'session.thinking.appended') this.contextual?.providerEvent(event.client_event_id, true);
      this.producer?.providerEvent(event.client_event_id, true, {
        ...(typeof event.start_ms === 'number' && Number.isFinite(event.start_ms) ? { startMs: event.start_ms } : {}),
        ...(typeof event.end_ms === 'number' && Number.isFinite(event.end_ms) ? { endMs: event.end_ms } : {}),
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
      // A declined optional cue need not interrupt otherwise-working practice.
      if (typeof error?.client_event_id === 'string' && /^(cue|research|rundown)-/.test(error.client_event_id)) {
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
    if ((snapshot.interview ? this.producer?.canObserve : this.contextual?.canObserveActor) && !this.directing && now - this.lastDirected >= 8000) {
      this.lastDirected = now;
      this.ctx.waitUntil(this.direct(transcript, snapshot.revision, now));
    }
  }

  /** Shared by polls, the live tick and the durable alarm; browser contact is not conversation activity. */
  private checkLifetime(): boolean {
    const snapshot = this.snapshot;
    if (!snapshot || (snapshot.status !== 'live' && snapshot.status !== 'connecting')) return !!this.closing;
    const now = Date.now();
    if (now - this.lastSeen > 35_000) {
      snapshot.message = 'Practice ended after losing contact with this page.';
      this.ctx.waitUntil(this.end());
      return true;
    }
    if (snapshot.status === 'connecting') {
      if (now - snapshot.startedAt < 60_000) return false;
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
        // Coverage is re-judged each time; its supporting passages stay visible as the interview grows.
        const result = await this.paid.evaluateInterview({ ...input, keepIds: coverageEvidenceIds(snapshot.interview.evaluation?.objectives ?? []) });
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
    this.directing = true;
    const snapshot = this.snapshot!;
    const input = { scenarioId: snapshot.scenarioId, clientId: snapshot.clientId, transcript, revision, apiKey: this.env.TYPESAFE_API_KEY!, signal: AbortSignal.any([this.gradeAbort.signal, AbortSignal.timeout(2500)]) };
    const failure = (error: unknown) => error instanceof Error && error.name === 'TimeoutError' ? 'evaluation_timeout' as const : 'evaluation_error' as const;
    if (snapshot.interview) {
      try {
        const cue = this.producer?.cue();
        const result = await this.paid.evaluateInterviewer({ ...input, cue, deliveredBackground: this.producer?.background() ?? [] });
        this.producer?.observe({ transcript, capturedAt, signals: result.signals, researchProbability: result.researchProbability, followThrough: result.followThrough, model: result.model });
      } catch (error) {
        this.producer?.observe({ transcript, capturedAt, signals: [], failure: failure(error) });
      } finally { this.directing = false; }
      return;
    }
    const observation = this.contextual?.beginObservation({ audience: 'actor', transcript, revision, capturedAt });
    try {
      const result = await this.paid.evaluateClient(input);
      const work = this.contextual?.observe(observation, { signals: result.signals, model: result.model });
      if (work) this.ctx.waitUntil(work);
    } catch (error) {
      this.contextual?.observe(observation, { signals: [], failure: failure(error) });
    }
    finally { this.directing = false; }
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
    try { await this.connecting; } catch { /* Creation failure is surfaced by start. */ }
    await this.grading;
    this.gradeAbort = new AbortController();
    if (snapshot.finalization !== 'confirmed') {
      // The browser sends silence while the final trainee audio/transcript arrives.
      if (drain) await new Promise(resolve => setTimeout(resolve, 1000));
      if ((!this.socket || this.socket.readyState !== WebSocket.OPEN) && this.lease?.providerId) {
        try { this.socket = await this.paid.attachLive(this.lease.providerId, foundryConfig(this.env)); this.listen(this.socket); }
        catch (error) { if (error instanceof LiveSessionGone) snapshot.finalization = 'confirmed'; /* Otherwise the alarm retains closure responsibility. */ }
      }
      if (String(snapshot.finalization) !== 'confirmed') await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, 10_000);
        this.closeReceived = () => { clearTimeout(timer); resolve(); };
        if (!this.send({ type: 'session.close' })) { clearTimeout(timer); resolve(); }
      });
      if (String(snapshot.finalization) !== 'confirmed') snapshot.finalization = 'unconfirmed';
    }
    this.socket?.close();
    if (snapshot.transcript.some(item => item.speaker === 'trainee')) await this.grade(snapshot.transcript, snapshot.revision, true);
    snapshot.status = interrupted ? 'interrupted' : 'ended';
    if (snapshot.finalization !== 'confirmed') snapshot.message = 'Practice ended, but the voice service did not confirm finalization.';
    this.lease!.closed = snapshot.finalization === 'confirmed' || !this.lease!.providerId;
    await this.ctx.storage.put('lease', this.lease);
    await this.ctx.storage.setAlarm(Date.now() + (this.lease!.closed ? 300_000 : 15_000));
    if (this.reachedLive) {
      if (snapshot.interview) {
        snapshot.interview.summary = { status: snapshot.transcript.some(item => item.speaker === 'trainee') ? 'pending' : 'unavailable', text: null };
      }
      this.finalArchive = this.saveArchive('final');
      this.ctx.waitUntil(this.finalArchive);
    }
  }

  private closeOrphan(): Promise<void> {
    if (!this.orphaning) this.orphaning = this.recoverLease().finally(() => { this.orphaning = undefined; });
    return this.orphaning;
  }

  private async recoverLease() {
    if (!this.lease || this.lease.closed) return;
    // No provider id survives a process loss during creation. There is no Live
    // lookup-by-attempt API; do not leave this local lease retrying forever.
    if (!this.lease.providerId) { await this.ctx.storage.deleteAll(); return; }
    let socket: WebSocket | undefined;
    try {
      socket = await this.paid.attachLive(this.lease.providerId, foundryConfig(this.env));
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
    this.lease.closed = true;
    await this.ctx.storage.put('lease', this.lease);
    await this.ctx.storage.setAlarm(Date.now() + 300_000);
  }

  async alarm() {
    if (this.lease?.closed) { await this.ctx.storage.deleteAll(); return; }
    if (!this.snapshot || this.snapshot.status === 'ended' || this.snapshot.status === 'interrupted') {
      await this.closeOrphan();
      return;
    }
    this.checkLifetime();
    if (this.closing) { await this.closing; return; }
    await this.ctx.storage.setAlarm(Date.now() + 30_000);
    if (this.snapshot.status === 'live') this.ctx.waitUntil(this.saveArchive('partial'));
  }

  private async saveArchive(state: 'partial' | 'final') {
    try {
      // Freeze the data and its timestamp before any asynchronous work.
      const snapshot = structuredClone(this.publicSnapshot());
      const interventions = structuredClone(this.contextual?.records ?? []);
      // Grade diagnostics ride with the private producer records; they are never part of the public snapshot.
      const producer = structuredClone([...(this.producer?.records ?? []), ...this.grades]);
      const director = this.producer?.summary() ?? this.contextual?.summary() ?? null;
      const capturedAt = Date.now();
      const provenance = await archiveProvenance(this.env, snapshot, director);
      if (snapshot.interview) await writeInterviewArchive(this.env.SIMULATOR_ARCHIVE, { state, capturedAt, snapshot: { ...snapshot, interview: snapshot.interview }, interventions: producer, provenance });
      else await writeArchive(this.env.SIMULATOR_ARCHIVE, { state, capturedAt, snapshot, provenance, interventions });
    } catch {
      // Best effort: never delay closure or retry a failed transcript save.
      console.warn('Simulator archive save failed', { id: this.snapshot?.id, category: state });
    }
  }
}
