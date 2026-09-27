import { DIRECTOR_MODEL, DirectorOutputError, generateDirector, recheckDirector, type DirectorInput } from '../../../ai/simulator/director.server';
import { JEV_MODEL } from '../../../ai/judging';
import { DirectorGate, DIRECTOR_LIMITS, DIRECTOR_VERSION, MATERIAL_CONCERN, publicHint, type DirectorAudience, type DirectorIssue, type DirectorSignal, type DirectorRecord, type InterventionRecord, type DirectorSummary } from '../../../core/simulator/director';
import type { LiveHint, ObjectiveReading, TranscriptEntry } from '../../../core/simulator/types';

export const directorServices = { generateDirector, recheckDirector };
type Observation = { audience: DirectorAudience; signals: DirectorSignal[]; transcript: TranscriptEntry[]; revision: number; capturedAt: number };
type Options = {
  scenarioId: string; clientId: string; objectives: () => ObjectiveReading[];
  openaiKey: string; typesafeKey: string; services: typeof directorServices;
  settled: () => TranscriptEntry[]; isFresh: (transcript: TranscriptEntry[]) => boolean; send: (event: Record<string, unknown>) => boolean;
};

/** Owns optional interventions, never audio, grades or the session snapshot. */
export class ContextualDirector {
  private gate = new DirectorGate();
  readonly records: InterventionRecord[] = [];
  private counts = { observations: 0, staleGates: 0, skipped: 0 };
  private abort = new AbortController();
  private lastConcern: string | undefined;
  private hint: LiveHint | null = null;

  constructor(private options: Options) {}

  private get alive() { return !this.abort.signal.aborted; }
  get canObserveActor() { return this.alive && this.gate.hasCapacity('actor'); }
  summary(): DirectorSummary { return { model: DIRECTOR_MODEL, effort: 'none', version: DIRECTOR_VERSION, ...this.counts, ...this.gate.usage }; }

  coaching(now = Date.now()): LiveHint | null {
    const hint = this.hint;
    if (!hint) return null;
    const resolved = hint.objectiveId
      ? this.options.objectives().some(item => item.id === hint.objectiveId && item.achieved)
      : !this.gate.current('trainee', hint.id);
    if (hint.expiresAt <= now || resolved) this.hint = null;
    return this.hint;
  }

  observe(observation: Observation): Promise<void> | undefined {
    if (!this.alive) return;
    this.counts.observations++;
    if (!this.options.isFresh(observation.transcript)) { this.counts.staleGates++; return; }
    const now = Date.now();
    this.gate.observe(observation.audience, observation.signals);
    if (observation.audience === 'trainee') this.showConcern(observation, now);
    if (now >= observation.capturedAt + DIRECTOR_LIMITS.age - DIRECTOR_LIMITS.recheck) { this.counts.skipped++; return; }
    const speaker = observation.audience === 'trainee' ? 'trainee' : 'client';
    const work = this.gate.review(observation.audience, now, observation.transcript.filter(entry => entry.speaker === speaker).length, observation.revision, issue => this.run(observation, issue));
    if (!work) this.counts.skipped++;
    return work;
  }

  private recordBase(observation: Observation, issue: DirectorIssue, now: number) {
    return {
      id: `intervention-${crypto.randomUUID()}`, issueId: issue.id, audience: observation.audience, signal: issue.signal,
      revision: observation.revision, inputIds: observation.transcript.map(entry => entry.id), snapshotAt: observation.capturedAt, gateAt: now,
    };
  }

  private showConcern(observation: Observation, now: number) {
    const issue = this.gate.concern();
    if (!issue || this.lastConcern === issue.id) return;
    this.lastConcern = issue.id;
    // The episode keeps its ID when generation replaces this fixed alert.
    this.records.push({ ...this.recordBase(observation, issue, now), source: 'detector', model: JEV_MODEL,
      result: { action: 'intervene', text: MATERIAL_CONCERN, evidenceIds: [] }, readyAt: now, deliveredAt: now, outcome: 'published' });
    this.hint = publicHint(issue, MATERIAL_CONCERN, [], now);
  }

  private async run(observation: Observation, issue: DirectorIssue) {
    const { services } = this.options;
    const record: DirectorRecord = { ...this.recordBase(observation, issue, Date.now()), source: 'director', model: DIRECTOR_MODEL, effort: 'none', outcome: 'pending' };
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
        record.recheck = { probability: null, durationMs: null };
        const checked = await recheck;
        if (!this.alive) return;
        record.recheck = { probability: checked.probability, durationMs: Date.now() - started, usage: checked.usage };
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
        record.delivery = { eventId, status: 'unknown' };
        const sent = this.gate.sendNote(() => this.options.send({ type: 'session.thinking.append', event_id: eventId, delegation_id: null, content: result.text }));
        record.outcome = sent ? 'sent' : 'error';
        if (sent) record.deliveredAt = Date.now();
      }
    } catch (error) {
      if (!this.alive) return;
      record.outcome = error instanceof DirectorOutputError ? 'invalid' : error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout' : 'error';
    }
  }

  providerEvent(id: string, accepted: boolean) {
    if (!this.alive) return;
    const record = this.records.find(item => item.source === 'director' && item.delivery?.eventId === id);
    if (record?.source === 'director' && record.delivery) record.delivery.status = accepted ? 'accepted' : 'rejected';
  }

  close() {
    this.abort.abort();
    this.hint = null;
    for (const record of this.records) if (record.outcome === 'pending') record.outcome = 'aborted';
  }
}
