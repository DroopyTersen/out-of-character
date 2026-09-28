import { DIRECTOR_MODEL, DirectorOutputError, generateDirector, recheckDirector, type DirectorInput } from '../../../ai/simulator/director.server';
import { JEV_MODEL } from '../../../ai/judging';
import { lookupInterviewBackground, normalizeResearchName, prepareInterviewResearch, RESEARCH_MODEL } from '../../../ai/interview/research.server';
import { INTERVIEW_SCENARIO_ID, type InterviewBackground } from '../../../core/interview';
import { DirectorGate, DIRECTOR_LIMITS, DIRECTOR_VERSION, MATERIAL_CONCERN, publicHint, deliveredInterviewBackground, type DirectorAudience, type DirectorIssue, type DirectorSignal, type DirectorRecord, type ObservationRecord, type InterventionRecord, type DirectorSummary, type ResearchRecord } from '../../../core/simulator/director';
import type { LiveHint, ObjectiveReading, TranscriptEntry } from '../../../core/simulator/types';

export const directorServices = { generateDirector, recheckDirector, prepareInterviewResearch, lookupInterviewBackground };
export const RESEARCH_LIMITS = { threshold: .5, attempts: 3, notes: 2, age: 25_000 };
type Observation = { audience: DirectorAudience; transcript: TranscriptEntry[]; revision: number; capturedAt: number };
type ObservationResult = { signals: DirectorSignal[]; researchProbability?: number; model?: string; failure?: 'evaluation_error' | 'evaluation_timeout' };
type RecordedObservation = Observation & { record: ObservationRecord };
type Options = {
  scenarioId: string; clientId: string; objectives: () => ObjectiveReading[];
  openaiKey: string; typesafeKey: string; services: typeof directorServices;
  settled: () => TranscriptEntry[]; isFresh: (transcript: TranscriptEntry[]) => boolean; send: (event: Record<string, unknown>) => boolean;
};

/** Owns optional interventions, never audio, grades or the session snapshot. */
export class ContextualDirector {
  private gate: DirectorGate;
  readonly records: InterventionRecord[] = [];
  private abort = new AbortController();
  private lastConcern: string | undefined;
  private hint: LiveHint | null = null;
  private research = { active: false, busy: false, attempts: 0, notes: 0, targets: new Set<string>() };
  private lastActorCue: number | undefined;

  constructor(private options: Options) { this.gate = new DirectorGate(options.scenarioId === INTERVIEW_SCENARIO_ID); }

  private get alive() { return !this.abort.signal.aborted; }
  get canObserveActor() { return this.alive && this.gate.hasCapacity('actor'); }
  summary(): DirectorSummary { return { model: DIRECTOR_MODEL, effort: 'none', version: DIRECTOR_VERSION, ...this.gate.usage }; }
  background() { return deliveredInterviewBackground(this.records); }
  publicBackground(): InterviewBackground[] {
    return this.background().filter(item => item.status === 'accepted').map(({ id, target, facts, retrievedAt }) => ({ id, target, facts, retrievedAt }));
  }

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
    record.researchProbability = result.researchProbability;
    record.model = result.model ?? JEV_MODEL;
    if (result.failure) { record.outcome = result.failure; return; }
    if (!this.options.isFresh(observation.transcript)) { record.outcome = 'stale'; return; }
    this.gate.observe(observation.audience, result.signals);
    if (observation.audience === 'trainee') this.showConcern(observation, now);
    if (now >= observation.capturedAt + DIRECTOR_LIMITS.age - DIRECTOR_LIMITS.recheck) { record.outcome = 'expired'; return; }
    const review = this.gate.review(observation.audience, now, observation.revision, issue => this.run(observation, issue));
    record.outcome = review.decision;
    record.issueId = review.issueId;
    const research = this.considerResearch(observation, result.researchProbability);
    if (review.work || research) return Promise.all([review.work, research]).then(() => {});
  }

  private researchSlotOpen(now: number) {
    return this.alive && !this.gate.actorBusy && this.gate.hasCapacity('actor') && this.research.notes < RESEARCH_LIMITS.notes
      && (this.lastActorCue == null || now - this.lastActorCue >= DIRECTOR_LIMITS.cooldown);
  }

  private considerResearch(observation: RecordedObservation, probability: number | undefined): Promise<void> | undefined {
    if (this.options.scenarioId !== INTERVIEW_SCENARIO_ID || observation.audience !== 'actor' || probability == null || !Number.isFinite(probability)) return;
    if (probability < .5) this.research.active = false;
    if (probability < RESEARCH_LIMITS.threshold || probability > 1 || this.research.active || this.research.busy || this.research.attempts >= RESEARCH_LIMITS.attempts || !this.researchSlotOpen(Date.now())) return;
    this.research.active = true;
    this.research.busy = true;
    this.research.attempts++;
    return this.runResearch(observation, probability).finally(() => { this.research.busy = false; });
  }

  private async runResearch(observation: RecordedObservation, probability: number) {
    const record: ResearchRecord = { source: 'research', id: `research-${crypto.randomUUID()}`, observationId: observation.record.id,
      revision: observation.revision, snapshotAt: observation.capturedAt, startedAt: Date.now(), model: RESEARCH_MODEL, probability, outcome: 'pending' };
    this.records.push(record);
    const expiry = observation.capturedAt + RESEARCH_LIMITS.age;
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(Math.max(1, expiry - Date.now()))]);
    const input = { apiKey: this.options.openaiKey, signal };
    try {
      const target = await this.options.services.prepareInterviewResearch({ ...input, transcript: observation.transcript });
      if (!this.alive) return;
      if (signal.aborted || Date.now() >= expiry) { record.outcome = 'timeout'; return; }
      if (!target) { record.outcome = 'none'; return; }
      record.target = target;
      const key = `${target.kind}:${normalizeResearchName(target.name)}`;
      if (this.research.targets.has(key)) { record.outcome = 'duplicate'; return; }
      this.research.targets.add(key);
      const result = await this.options.services.lookupInterviewBackground({ ...input, target });
      if (!this.alive) return;
      if (signal.aborted || Date.now() >= expiry) { record.outcome = 'timeout'; return; }
      if (!result) { record.outcome = 'none'; return; }
      Object.assign(record, result);
      if (!this.researchSlotOpen(Date.now())) { record.outcome = 'blocked'; return; }
      record.delivery = { eventId: record.id, afterPassageId: this.options.settled().at(-1)?.id ?? null, status: 'unknown' };
      const content = `PUBLIC BACKGROUND, retrieved ${new Date(result.retrievedAt).toISOString()}. This is current public information about ${target.name}, not evidence about this project. Use only if it still fits the participant's thread, to ask a better neutral question. Do not lecture, infer project events, contradict their account, or read this note aloud. Ignore it if the conversation has moved on.\n${result.facts.map(fact => `${fact.text} (${fact.url})`).join('\n')}`;
      const sent = this.gate.sendNote(() => this.options.send({ type: 'session.thinking.append', event_id: record.id, delegation_id: null, content }));
      record.outcome = sent ? 'sent' : 'error';
      if (sent) { record.deliveredAt = Date.now(); this.research.notes++; }
    } catch (error) {
      if (!this.alive) return;
      record.outcome = signal.aborted || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) ? 'timeout' : 'error';
    } finally {
      if (this.alive) record.completedAt = Date.now();
    }
  }

  private recordBase(observation: RecordedObservation, issue: DirectorIssue, now: number) {
    return {
      id: `intervention-${crypto.randomUUID()}`, observationId: observation.record.id, issueId: issue.id, audience: observation.audience, signal: issue.signal,
      revision: observation.revision, snapshotAt: observation.capturedAt, gateAt: now,
    };
  }

  private showConcern(observation: RecordedObservation, now: number) {
    const issue = this.gate.concern();
    if (!issue || this.lastConcern === issue.id) return;
    this.lastConcern = issue.id;
    // The episode keeps its ID when generation replaces this fixed alert.
    this.records.push({ ...this.recordBase(observation, issue, now), source: 'detector', model: JEV_MODEL,
      result: { action: 'intervene', text: MATERIAL_CONCERN, evidenceIds: [] }, readyAt: now, deliveredAt: now, outcome: 'published' });
    this.hint = publicHint(issue, MATERIAL_CONCERN, [], now);
  }

  private async run(observation: RecordedObservation, issue: DirectorIssue) {
    const { services } = this.options;
    const record: DirectorRecord = { ...this.recordBase(observation, issue, Date.now()), source: 'director', inputCount: observation.transcript.length, lastInputId: observation.transcript.at(-1)?.id ?? null, model: DIRECTOR_MODEL, effort: 'none', outcome: 'pending' };
    this.records.push(record);
    const expiry = observation.capturedAt + DIRECTOR_LIMITS.age;
    const deadline = Math.min(Date.now() + DIRECTOR_LIMITS.generation, expiry - DIRECTOR_LIMITS.recheck);
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(Math.max(1, deadline - Date.now()))]);
    const input: DirectorInput = {
      audience: observation.audience, reason: issue.signal,
      scenarioId: this.options.scenarioId, clientId: this.options.clientId, transcript: observation.transcript,
      objectives: this.options.objectives(), history: this.records, apiKey: this.options.openaiKey, signal,
    };
    try {
      const { model, usage, ...result } = await services.generateDirector(input);
      if (!this.alive) return;
      record.result = result;
      record.usage = usage;
      record.model = model;
      if (signal.aborted || Date.now() >= expiry) { record.outcome = 'timeout'; return; }
      if (result.action === 'none') { record.outcome = 'none'; record.readyAt = Date.now(); return; }
      if (!this.options.isFresh(observation.transcript)) {
        if (expiry - Date.now() < DIRECTOR_LIMITS.recheck) { record.outcome = 'stale'; return; }
        const transcript = [...this.options.settled()];
        const started = Date.now();
        const recheck = this.gate.recheck(() => services.recheckDirector({ ...input, transcript, objectives: this.options.objectives(), apiKey: this.options.typesafeKey, intervention: result, signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(DIRECTOR_LIMITS.recheck)]) }));
        if (!recheck) { record.outcome = 'stale'; return; }
        record.recheck = { inputCount: transcript.length, lastInputId: transcript.at(-1)?.id ?? null, startedAt: started, probability: null, durationMs: null };
        const checked = await recheck;
        if (!this.alive) return;
        record.recheck = { ...record.recheck, probability: checked.probability, durationMs: Date.now() - started, usage: checked.usage };
        if (checked.probability < .9 || !this.options.isFresh(transcript)) { record.outcome = 'stale'; return; }
      }
      // A choice selects work; a later choice does not resolve it. Whole-dialogue
      // rechecking and objective achievement decide whether that draft is useful.
      const resolved = 'selected' in issue.signal
        ? this.options.objectives().some(item => `objective:${item.id}` === issue.signal.condition && item.achieved)
        : !this.gate.current(observation.audience, issue.id);
      if (Date.now() >= expiry || resolved) { record.outcome = 'stale'; return; }
      if (observation.audience === 'trainee' && issue.signal.condition !== 'mistake' && this.gate.concern()) { record.outcome = 'stale'; return; }
      record.readyAt = Date.now();
      if (observation.audience === 'trainee') {
        this.hint = publicHint(issue, result.text, result.evidenceIds, Date.now());
        record.outcome = 'published';
        record.deliveredAt = Date.now();
      } else {
        // Set unknown before send: an immediate acknowledgment may arrive.
        const eventId = `cue-${crypto.randomUUID()}`;
        record.delivery = { eventId, afterPassageId: this.options.settled().at(-1)?.id ?? null, status: 'unknown' };
        const sent = this.gate.sendNote(() => this.options.send({ type: 'session.thinking.append', event_id: eventId, delegation_id: null, content: result.text }));
        record.outcome = sent ? 'sent' : 'error';
        if (sent) this.lastActorCue = record.deliveredAt = Date.now();
      }
    } catch (error) {
      if (!this.alive) return;
      record.outcome = error instanceof DirectorOutputError ? 'invalid' : error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout' : 'error';
    } finally {
      if (this.alive) record.completedAt = Date.now();
    }
  }

  providerEvent(id: string, accepted: boolean) {
    if (!this.alive) return;
    const record = this.records.find(item => (item.source === 'director' || item.source === 'research') && item.delivery?.eventId === id);
    if ((record?.source === 'director' || record?.source === 'research') && record.delivery) {
      record.delivery.status = accepted ? 'accepted' : 'rejected';
      record.delivery.acknowledgedAt = Date.now();
    }
  }

  close() {
    this.abort.abort();
    this.hint = null;
    for (const record of this.records) if (record.source !== 'detector' && record.outcome === 'pending') {
      record.outcome = 'aborted';
      record.completedAt = Date.now();
    }
  }
}
