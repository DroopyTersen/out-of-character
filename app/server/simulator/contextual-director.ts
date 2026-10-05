import { DirectorOutputError, generateDirector, recheckDirector, type DirectorInput } from '../../../ai/simulator/director.server';
import type { FoundryConfig } from '../../../ai/foundry.server';
import { JEV_MODEL } from '../../../ai/judging';
import { CONCERN_TEXT, DirectorGate, DIRECTOR_LIMITS, DIRECTOR_VERSION, isConcern, publicHint, type DirectorAudience, type DirectorIssue, type DirectorSignal, type DirectorRecord, type ObservationRecord, type InterventionRecord, type DirectorSummary } from '../../../core/simulator/director';
import type { LiveHint, ObjectiveReading, TranscriptEntry } from '../../../core/simulator/types';

export const directorServices = { generateDirector, recheckDirector };
type Observation = { audience: DirectorAudience; transcript: TranscriptEntry[]; revision: number; capturedAt: number };
type ObservationResult = { signals: DirectorSignal[]; model?: string; failure?: 'evaluation_error' | 'evaluation_timeout' };
type RecordedObservation = Observation & { record: ObservationRecord };
/** lastConcern is the pre-v4 single shown concern; shownConcerns supersedes it. Open concerns keep their identity across a restart. */
export type DirectorCheckpoint = { records: InterventionRecord[]; usage: DirectorGate['usage']; lastConcern?: string; shownConcerns?: string[]; concerns?: DirectorIssue[] };
type Options = {
  scenarioId: string; clientId: string; objectives: () => ObjectiveReading[];
  foundry: FoundryConfig; typesafeKey: string; services: typeof directorServices;
  settled: () => TranscriptEntry[]; isFresh: (transcript: TranscriptEntry[]) => boolean; send: (event: Record<string, unknown>) => boolean;
};

/** Owns optional simulator interventions, never audio, grades or the session snapshot. The interview uses InterviewProducer. */
export class ContextualDirector {
  private gate = new DirectorGate();
  readonly records: InterventionRecord[] = [];
  private abort = new AbortController();
  private closed = false;
  private shownConcerns = new Set<string>();
  private hint: LiveHint | null = null;

  constructor(private options: Options) {}

  private get alive() { return !this.abort.signal.aborted; }
  get canObserveActor() { return this.alive && this.gate.hasCapacity('actor'); }
  summary(): DirectorSummary { return { model: this.options.foundry.agentModel, effort: 'low', version: DIRECTOR_VERSION, ...this.gate.usage }; }

  coaching(now = Date.now()): LiveHint | null {
    const hint = this.hint;
    if (!hint) return null;
    const resolved = hint.objectiveId
      ? this.options.objectives().some(item => item.id === hint.objectiveId && item.achieved)
      : !this.gate.current('trainee', hint.id);
    if (hint.expiresAt <= now || resolved) this.hint = null;
    return this.hint;
  }

  beginObservation(input: Observation): RecordedObservation | undefined {
    if (!this.alive) return;
    const record: ObservationRecord = {
      source: 'observation', id: `observation-${crypto.randomUUID()}`, audience: input.audience, revision: input.revision,
      snapshotAt: input.capturedAt, model: JEV_MODEL, signals: [], inputCount: input.transcript.length,
      lastInputId: input.transcript.at(-1)?.id ?? null, outcome: 'pending',
    };
    this.records.push(record);
    return { ...input, record };
  }

  observe(observation: RecordedObservation | undefined, result: ObservationResult): Promise<void> | undefined {
    if (!this.alive || !observation || observation.record.outcome !== 'pending') return;
    const now = Date.now();
    const record = observation.record;
    record.completedAt = now;
    record.signals = result.signals;
    record.model = result.model ?? JEV_MODEL;
    if (result.failure) { record.outcome = result.failure; return; }
    if (!this.options.isFresh(observation.transcript)) { record.outcome = 'stale'; return; }
    this.gate.observe(observation.audience, result.signals);
    if (observation.audience === 'trainee') this.showConcern(observation, now);
    if (now >= observation.capturedAt + DIRECTOR_LIMITS.age - DIRECTOR_LIMITS.recheck) { record.outcome = 'expired'; return; }
    const review = this.gate.review(observation.audience, now, observation.revision, issue => this.run(observation, issue));
    record.outcome = review.decision;
    record.issueId = review.issueId;
    return review.work;
  }

  private recordBase(observation: RecordedObservation, issue: DirectorIssue, now: number) {
    return {
      id: `intervention-${crypto.randomUUID()}`, observationId: observation.record.id, issueId: issue.id, audience: observation.audience, signal: issue.signal,
      revision: observation.revision, snapshotAt: observation.capturedAt, gateAt: now,
    };
  }

  private showConcern(observation: RecordedObservation, now: number) {
    const issue = this.gate.concerns().find(item => !this.shownConcerns.has(item.id));
    if (!issue || !isConcern(issue.signal.condition)) return;
    this.shownConcerns.add(issue.id);
    const text = CONCERN_TEXT[issue.signal.condition];
    // The episode keeps its ID when generation replaces this fixed alert.
    this.records.push({ ...this.recordBase(observation, issue, now), source: 'detector', model: JEV_MODEL,
      result: { action: 'intervene', text, evidenceIds: [] }, readyAt: now, deliveredAt: now, outcome: 'published' });
    this.hint = publicHint(issue, text, [], now);
  }

  private async run(observation: RecordedObservation, issue: DirectorIssue) {
    const { services } = this.options;
    const record: DirectorRecord = { ...this.recordBase(observation, issue, Date.now()), source: 'director', inputCount: observation.transcript.length, lastInputId: observation.transcript.at(-1)?.id ?? null, model: this.options.foundry.agentModel, effort: 'low', outcome: 'pending' };
    this.records.push(record);
    const expiry = observation.capturedAt + DIRECTOR_LIMITS.age;
    const deadline = Math.min(Date.now() + DIRECTOR_LIMITS.generation, expiry - DIRECTOR_LIMITS.recheck);
    const scope = this.abort.signal;
    const signal = AbortSignal.any([scope, AbortSignal.timeout(Math.max(1, deadline - Date.now()))]);
    const input: DirectorInput = {
      audience: observation.audience, reason: issue.signal,
      scenarioId: this.options.scenarioId, clientId: this.options.clientId, transcript: observation.transcript,
      objectives: this.options.objectives(), history: this.records, foundry: this.options.foundry, signal,
    };
    try {
      const { model, usage, ...result } = await services.generateDirector(input);
      if (scope.aborted) return;
      record.result = result;
      record.usage = usage;
      record.model = model;
      if (signal.aborted || Date.now() >= expiry) { record.outcome = 'timeout'; return; }
      if (result.action === 'none') { record.outcome = 'none'; record.readyAt = Date.now(); return; }
      // Public hints must still fit now. The actor interprets private direction in the live conversation.
      if (observation.audience === 'trainee' && !this.options.isFresh(observation.transcript)) {
        if (expiry - Date.now() < DIRECTOR_LIMITS.recheck) { record.outcome = 'stale'; return; }
        const transcript = [...this.options.settled()];
        const started = Date.now();
        const recheck = this.gate.recheck(() => services.recheckDirector({ ...input, audience: 'trainee', transcript, objectives: this.options.objectives(), apiKey: this.options.typesafeKey, intervention: result, signal: AbortSignal.any([scope, AbortSignal.timeout(DIRECTOR_LIMITS.recheck)]) }));
        if (!recheck) { record.outcome = 'stale'; return; }
        record.recheck = { inputCount: transcript.length, lastInputId: transcript.at(-1)?.id ?? null, startedAt: started, probability: null, durationMs: null };
        const checked = await recheck;
        if (scope.aborted) return;
        record.recheck = { ...record.recheck, probability: checked.probability, durationMs: Date.now() - started, usage: checked.usage };
        if (checked.probability < .9 || !this.options.isFresh(transcript)) { record.outcome = 'stale'; return; }
      }
      // Resolve public hints from current evidence; let the actor handle an outdated private direction.
      const resolved = observation.audience === 'trainee' && ('selected' in issue.signal
        ? this.options.objectives().some(item => `objective:${item.id}` === issue.signal.condition && item.achieved)
        : !this.gate.current('trainee', issue.id));
      if (Date.now() >= expiry || resolved) { record.outcome = 'stale'; return; }
      if (observation.audience === 'trainee' && !isConcern(issue.signal.condition) && this.gate.urgentConcerns().length) { record.outcome = 'stale'; return; }
      record.readyAt = Date.now();
      if (observation.audience === 'trainee') {
        this.hint = publicHint(issue, result.text, result.evidenceIds, Date.now());
        record.outcome = 'published';
        record.deliveredAt = Date.now();
      } else {
        // Set unknown before send: an immediate acknowledgment may arrive.
        const eventId = `cue-${crypto.randomUUID()}`;
        record.delivery = { eventId, afterPassageId: this.options.settled().at(-1)?.id ?? null, status: 'unknown' };
        const sent = this.gate.sendNote(() => this.options.send({ type: 'session.instructions.append', event_id: eventId, delegation_id: null, content: result.text }));
        record.outcome = sent ? 'sent' : 'error';
        if (sent) record.deliveredAt = Date.now();
      }
    } catch (error) {
      if (scope.aborted) return;
      record.outcome = error instanceof DirectorOutputError ? 'invalid' : error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout' : 'error';
    } finally {
      if (!scope.aborted) record.completedAt = Date.now();
    }
  }

  providerEvent(id: string, accepted: boolean) {
    if (!this.alive) return;
    const record = this.records.find(item => item.source === 'director' && item.delivery?.eventId === id);
    if (record?.source === 'director' && record.delivery) {
      record.delivery.status = accepted ? 'accepted' : 'rejected';
      record.delivery.acknowledgedAt = Date.now();
    }
  }

  /** The connection dropped: in-flight observations and directions are abandoned, and the hint no longer fits. */
  pause() {
    this.abort.abort();
    this.hint = null;
    for (const record of this.records) if (record.source !== 'detector' && record.outcome === 'pending') {
      record.outcome = 'aborted';
      record.completedAt = Date.now();
    }
  }

  resume() {
    if (!this.closed && !this.alive) this.abort = new AbortController();
  }

  checkpoint(): DirectorCheckpoint {
    const concerns = this.gate.concerns();
    return { records: this.records, usage: this.gate.usage, ...(this.shownConcerns.size ? { shownConcerns: [...this.shownConcerns] } : {}), ...(concerns.length ? { concerns } : {}) };
  }

  /** Restores a paused director. Work in flight when the checkpoint was written was lost with the isolate. */
  restore(checkpoint: DirectorCheckpoint) {
    this.records.splice(0, this.records.length, ...checkpoint.records);
    this.shownConcerns = new Set([...(checkpoint.shownConcerns ?? []), ...(checkpoint.lastConcern ? [checkpoint.lastConcern] : [])]);
    const ids = [...this.shownConcerns, ...(checkpoint.concerns ?? []).map(issue => issue.id), ...checkpoint.records.flatMap(record => 'issueId' in record && record.issueId ? [record.issueId] : [])];
    const episode = Math.max(0, ...ids.map(id => Number(id.split(':').at(-1))).filter(Number.isInteger));
    this.gate.restoreUsage(checkpoint.usage, episode, checkpoint.concerns);
    this.pause();
  }

  close() {
    this.closed = true;
    this.pause();
  }
}
