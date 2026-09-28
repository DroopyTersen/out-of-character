import { checkCard, checkCue, generateProducer } from '../../../ai/interview/producer.server';
import { lookupInterviewBackground, RESEARCH_MODEL, researchKey, validateResearchRequest } from '../../../ai/interview/research.server';
import { DirectorOutputError, SOL_MODEL } from '../../../ai/simulator/sol.server';
import { JEV_MODEL } from '../../../ai/judging';
import { coverageBands, isBackchannel, type CoverageLevel, type InterviewBackground, type InterviewObjectiveReading } from '../../../core/interview';
import {
  CHECK_IN_SIGNALS, deliveredBackground, PRODUCER_LIMITS, producerLatency, PRODUCER_VERSION, PROTECTION_CONDITIONS,
  type AssessmentRecord, type NoteDelivery, type ProducerLogRecord, type ProducerRecord, type ProducerSummary, type ProducerTrigger,
  type ProtectionCondition, type ResearchRecord, type ResearchRequest, type RundownRecord,
} from '../../../core/interview-producer';
import type { DirectorSignal } from '../../../core/simulator/director';
import type { TranscriptEntry } from '../../../core/simulator/types';

export const producerServices = { generateProducer, checkCue, checkCard, lookupInterviewBackground };
type Options = {
  clientId: string; startedAt: number; openaiKey: string; typesafeKey: string; services: typeof producerServices;
  settled: () => TranscriptEntry[]; coverage: () => InterviewObjectiveReading[];
  send: (event: Record<string, unknown>) => boolean; waitUntil?: (work: Promise<void>) => void;
};
export type Assessment = {
  transcript: TranscriptEntry[]; capturedAt: number; signals: DirectorSignal[]; researchProbability?: number; model?: string;
  failure?: 'evaluation_error' | 'evaluation_timeout';
};

const LIMITS = PRODUCER_LIMITS;
const timedOut = (error: unknown) => error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name);
const validProbability = (value: number | undefined): value is number => value != null && Number.isFinite(value) && value >= 0 && value <= 1;
const probabilityOf = (signals: DirectorSignal[], condition: string) => {
  const signal = signals.find(item => item.condition === condition);
  return signal && 'probability' in signal ? signal.probability : undefined;
};
/** Enough to tell whether the settled dialogue moved, without re-serializing it every tick. */
const dialogueKey = (transcript: TranscriptEntry[]) => { const last = transcript.at(-1); return last ? `${transcript.length}:${last.id}:${last.text}` : ''; };
const triggerKey = (trigger: ProducerTrigger) => trigger.kind === 'research' ? `research:${trigger.researchId}` : trigger.kind === 'check-in' ? 'check-in' : `${trigger.kind}:${trigger.condition}`;
const LEVEL_LABELS: [CoverageLevel, string][] = [['explored', 'explored'], ['touched', 'touched'], ['set-aside', 'set aside'], ['not-yet', 'not yet']];
const INITIAL_LEVELS = JSON.stringify(Object.fromEntries(coverageBands([]).flatMap(topic => topic.objectives.map(item => [item.id, item.level]))));

export function rundownText(coverage: Pick<InterviewObjectiveReading, 'id' | 'level'>[], elapsedMs: number): string {
  const minutes = Math.max(0, Math.round(elapsedMs / 60_000));
  const areas = coverageBands(coverage).map(topic => `${topic.label}: ${LEVEL_LABELS.flatMap(([level, label]) => {
    const items = topic.objectives.filter(item => item.level === level).map(item => item.label);
    return items.length ? [`${label}: ${items.join(', ')}`] : [];
  }).join('; ')}.`);
  return [`RUNDOWN (replaces earlier rundowns). About ${minutes} of ${LIMITS.targetMinutes} minutes.`, ...areas].join('\n');
}

export function researchCard(request: Pick<ResearchRequest, 'kind' | 'name'>, facts: InterviewBackground['facts'], retrievedAt: number): string {
  return `PUBLIC BACKGROUND on ${request.name} (${request.kind}), requested earlier; use it only if it still fits. Retrieved ${new Date(retrievedAt).toISOString()}. This is current public information, not evidence about this project. Use it only where it helps a neutral question now or later; do not pivot to it or interrupt a developing story. Do not lecture, infer project events, contradict their account, or read this note aloud.\n${facts.map(fact => `${fact.text} (${fact.url})`).join('\n')}`;
}

/**
 * The interview's producer. One Sol consultation runs at a time; triggers that arrive meanwhile merge
 * into one follow-up on the latest dialogue. Research lookups run beside it and may finish in any order.
 * Owns Sam's private notes only, never audio, grades or the session snapshot.
 */
export class InterviewProducer {
  readonly records: ProducerLogRecord[] = [];
  private abort = new AbortController();
  private busy = false;
  private queue: { triggers: ProducerTrigger[]; triggeredAt: number } | null = null;
  private lastConsultation: number;
  private consultedDialogue = '';
  private signals: DirectorSignal[] = [];
  private researchProbability: number | undefined;
  private episodes = new Set<ProtectionCondition>();
  private lastCueAt: number | null = null;
  private lookups = 0;
  private researched = new Set<string>();
  private samTurns = new Set<string>();
  private lastRundown: { key: string; at: number } | null = null;
  private timeRundownSent = false;
  private work = new Set<Promise<void>>();
  private counts = { consultations: 0, cues: 0, research: 0, rundowns: 0 };

  constructor(private options: Options) { this.lastConsultation = options.startedAt; }

  private get alive() { return !this.abort.signal.aborted; }
  get canObserve() { return this.alive && this.counts.consultations < LIMITS.consultations; }
  background() { return deliveredBackground(this.records); }
  publicBackground(): InterviewBackground[] {
    return this.background().filter(item => item.status === 'accepted').map(({ id, target, facts, retrievedAt }) => ({ id, target, facts, retrievedAt }));
  }

  /** Waits for all in-flight consultations and lookups, including follow-ups they start. */
  async settle() { while (this.work.size) await Promise.all([...this.work]); }

  private track(work: Promise<void>) {
    this.work.add(work);
    work.then(() => this.work.delete(work), () => this.work.delete(work));
    this.options.waitUntil?.(work);
  }

  /** An interviewer assessment. New protection episodes consult promptly; other signals wait for the next check-in. */
  observe(input: Assessment) {
    if (!this.alive) return;
    const record: AssessmentRecord = {
      source: 'assessment', id: `assessment-${crypto.randomUUID()}`, snapshotAt: input.capturedAt, completedAt: Date.now(), model: input.model ?? JEV_MODEL,
      inputCount: input.transcript.length, lastInputId: input.transcript.at(-1)?.id ?? null, signals: input.signals,
      ...(input.researchProbability != null ? { researchProbability: input.researchProbability } : {}), outcome: input.failure ?? 'observed', concerns: [],
    };
    this.records.push(record);
    if (input.failure) return;
    // A late assessment still describes recent dialogue; Sol and the cue check see the latest.
    this.signals = input.signals;
    this.researchProbability = input.researchProbability;
    const concerns: ProducerTrigger[] = [];
    for (const condition of PROTECTION_CONDITIONS) {
      const probability = probabilityOf(input.signals, condition);
      if (!validProbability(probability)) continue;
      if (probability < .5) this.episodes.delete(condition);
      else if (probability >= .6 && !this.episodes.has(condition)) {
        this.episodes.add(condition);
        concerns.push({ kind: 'concern', condition, probability });
        record.concerns.push(condition);
      }
    }
    if (concerns.length) this.trigger(concerns, Date.now());
  }

  private checkInSignals(): ProducerTrigger[] {
    return Object.entries(CHECK_IN_SIGNALS).flatMap(([condition, threshold]) => {
      const probability = condition === 'research' ? this.researchProbability : probabilityOf(this.signals, condition);
      return validProbability(probability) && probability >= threshold ? [{ kind: 'signal', condition: condition as keyof typeof CHECK_IN_SIGNALS, probability }] : [];
    });
  }

  /** Scheduled check-in after a Sam turn, and the rundown. Called on the session tick. */
  tick(now = Date.now()) {
    if (!this.alive) return;
    this.rundown(now);
    if (this.busy || this.queue || this.counts.consultations >= LIMITS.consultations || now - this.lastConsultation < LIMITS.checkIn) return;
    const transcript = this.options.settled();
    const last = transcript.at(-1);
    if (!last || last.speaker === 'trainee' || isBackchannel(last.text) || !transcript.some(entry => entry.speaker === 'trainee')) return;
    if (dialogueKey(transcript) === this.consultedDialogue) return;
    this.trigger([{ kind: 'check-in' }, ...this.checkInSignals()], now);
  }

  private trigger(triggers: ProducerTrigger[], now: number) {
    if (!this.alive || this.counts.consultations >= LIMITS.consultations) return;
    if (!this.busy) { this.start(triggers, now, false); return; }
    const merged = new Map((this.queue?.triggers ?? []).map(item => [triggerKey(item), item]));
    for (const item of triggers) merged.set(triggerKey(item), item);
    this.queue = { triggers: [...merged.values()], triggeredAt: this.queue?.triggeredAt ?? now };
  }

  private start(triggers: ProducerTrigger[], triggeredAt: number, queued: boolean) {
    const transcript = [...this.options.settled()];
    if (!transcript.length) return;
    const now = Date.now();
    this.busy = true;
    this.counts.consultations++;
    this.lastConsultation = now;
    this.consultedDialogue = dialogueKey(transcript);
    const record: ProducerRecord = {
      source: 'producer', id: `producer-${crypto.randomUUID()}`, triggers, queued, model: SOL_MODEL, effort: 'none',
      inputCount: transcript.length, lastInputId: transcript.at(-1)?.id ?? null, triggeredAt, startedAt: now, outcome: 'pending',
    };
    this.records.push(record);
    this.track(this.consult(record, transcript).finally(() => {
      this.busy = false;
      const next = this.queue;
      this.queue = null;
      if (next && this.alive && this.counts.consultations < LIMITS.consultations) this.start(next.triggers, next.triggeredAt, true);
    }));
  }

  private budget() {
    return { cuesLeft: LIMITS.cues - this.counts.cues, researchLeft: LIMITS.research - this.counts.research, lookupsInFlight: this.lookups };
  }

  // Set delivery before sending: an acknowledgment may arrive immediately.
  private sendNote(record: { delivery?: NoteDelivery }, eventId: string, content: string) {
    record.delivery = { eventId, afterPassageId: this.options.settled().at(-1)?.id ?? null, status: 'unknown' };
    return this.options.send({ type: 'session.thinking.append', event_id: eventId, delegation_id: null, content });
  }

  private async consult(record: ProducerRecord, transcript: TranscriptEntry[]) {
    const { services, startedAt } = this.options;
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(LIMITS.generation)]);
    try {
      const { model, usage, ...result } = await services.generateProducer({
        clientId: this.options.clientId, transcript, coverage: this.options.coverage(), startedAt, now: Date.now(),
        triggers: record.triggers, history: this.records, budget: this.budget(), apiKey: this.options.openaiKey, signal,
      });
      if (!this.alive) return;
      signal.throwIfAborted();
      if (Date.now() - record.startedAt >= LIMITS.generation) { record.outcome = 'timeout'; return; }
      Object.assign(record, { generatedAt: Date.now(), result, usage, model });
      if (result.research) this.request(record, result.research, transcript);
      if (!result.cue) { record.outcome = 'none'; return; }
      if (this.counts.cues >= LIMITS.cues) { record.outcome = 'budget'; return; }
      const urgent = record.triggers.some(item => item.kind === 'concern');
      if (!urgent && this.lastCueAt != null && Date.now() - this.lastCueAt < LIMITS.cueSpacing) { record.outcome = 'spacing'; return; }
      const latest = [...this.options.settled()];
      const checkedDialogue = dialogueKey(latest);
      const checkStartedAt = Date.now();
      const checkSignal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(LIMITS.check)]);
      record.check = { probability: null, inputCount: latest.length, lastInputId: latest.at(-1)?.id ?? null };
      const checked = await services.checkCue({
        transcript: latest, coverage: this.options.coverage(), startedAt, now: Date.now(), history: this.records, cue: result.cue,
        apiKey: this.options.typesafeKey, signal: checkSignal,
      });
      if (!this.alive) return;
      checkSignal.throwIfAborted();
      record.checkedAt = Date.now();
      record.check = { ...record.check, probability: checked.probability, usage: checked.usage };
      if (Date.now() - checkStartedAt >= LIMITS.check) { record.outcome = 'timeout'; return; }
      const moved = checkedDialogue !== dialogueKey(this.options.settled());
      if (moved || checked.probability < LIMITS.cuePass) { record.outcome = 'withheld'; record.reason = moved ? 'dialogue_changed' : 'check'; return; }
      const sent = this.sendNote(record, `cue-${crypto.randomUUID()}`, `Producer cue (private): ${result.cue}`);
      record.outcome = sent ? 'sent' : 'error';
      if (sent) { this.counts.cues++; this.lastCueAt = record.sentAt = Date.now(); }
    } catch (error) {
      if (!this.alive) return;
      record.outcome = error instanceof DirectorOutputError ? 'invalid' : signal.aborted || timedOut(error) ? 'timeout' : 'error';
    } finally {
      if (this.alive) record.completedAt = Date.now();
    }
  }

  private request(consultation: ProducerRecord, request: ResearchRequest, transcript: TranscriptEntry[]) {
    const record: ResearchRecord = { source: 'research', id: `research-${crypto.randomUUID()}`, consultationId: consultation.id, request, model: RESEARCH_MODEL, requestedAt: Date.now(), outcome: 'pending' };
    this.records.push(record);
    const refuse = (outcome: ResearchRecord['outcome'], reason: string) => { record.outcome = outcome; record.reason = reason; record.completedAt = Date.now(); };
    const valid = validateResearchRequest(request, transcript);
    if (!valid.ok) return refuse('invalid', valid.reason);
    record.request = valid.request;
    const key = researchKey(valid.request);
    if (this.researched.has(key)) return refuse('duplicate', 'duplicate');
    if (this.counts.research >= LIMITS.research) return refuse('budget', 'budget');
    if (this.lookups >= LIMITS.lookups) return refuse('busy', 'busy');
    this.researched.add(key);
    this.counts.research++;
    this.lookups++;
    this.track(this.research(record, key).finally(() => { this.lookups--; }));
  }

  private async research(record: ResearchRecord, key: string) {
    const { services } = this.options;
    const { kind, name, clue } = record.request;
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(LIMITS.researchAge)]);
    const result = (status: 'sent' | 'withheld' | 'unresolved') => this.trigger([{ kind: 'research', researchId: record.id, status }], Date.now());
    try {
      const lookup = await services.lookupInterviewBackground({ target: { kind, name }, clue, apiKey: this.options.openaiKey, signal });
      if (!this.alive) return;
      signal.throwIfAborted();
      record.lookupAt = Date.now();
      record.queries = lookup.queries;
      if (Date.now() - record.requestedAt >= LIMITS.researchAge) { record.outcome = 'expired'; record.reason = 'expired'; return; }
      if (lookup.status === 'unresolved') { record.outcome = 'unresolved'; record.reason = lookup.reason; result('unresolved'); return; }
      record.facts = lookup.facts;
      record.retrievedAt = lookup.retrievedAt;
      const transcript = [...this.options.settled()];
      const checkedDialogue = dialogueKey(transcript);
      const checkStartedAt = Date.now();
      const checkSignal = AbortSignal.any([signal, AbortSignal.timeout(LIMITS.check)]);
      record.check = { probability: null, inputCount: transcript.length, lastInputId: transcript.at(-1)?.id ?? null };
      const checked = await services.checkCard({
        transcript, request: record.request, facts: lookup.facts, apiKey: this.options.typesafeKey,
        signal: checkSignal,
      });
      if (!this.alive) return;
      checkSignal.throwIfAborted();
      record.checkedAt = Date.now();
      record.check = { ...record.check, probability: checked.probability, usage: checked.usage };
      if (Date.now() - record.requestedAt >= LIMITS.researchAge) { record.outcome = 'expired'; record.reason = 'expired'; return; }
      if (Date.now() - checkStartedAt >= LIMITS.check) { record.outcome = 'timeout'; return; }
      if (checkedDialogue !== dialogueKey(this.options.settled())) { record.outcome = 'withheld'; record.reason = 'dialogue_changed'; result('withheld'); return; }
      if (checked.probability < LIMITS.cardPass) { record.outcome = 'withheld'; record.reason = 'withheld'; result('withheld'); return; }
      const sent = this.sendNote(record, record.id, researchCard(record.request, lookup.facts, lookup.retrievedAt));
      record.outcome = sent ? 'sent' : 'error';
      if (sent) { record.sentAt = Date.now(); result('sent'); }
    } catch (error) {
      if (!this.alive) return;
      record.outcome = signal.aborted || timedOut(error) ? 'timeout' : 'error';
    } finally {
      // Transient failures may be requested again; they still used an attempt.
      if (['error', 'timeout', 'expired'].includes(record.outcome) || record.reason === 'dialogue_changed') this.researched.delete(key);
      if (this.alive) record.completedAt = Date.now();
    }
  }

  /**
   * Sent when a topic's band changes (throttled) and once near the target time. Factual state: no Sol or Jev call.
   * One rundown stays reserved for the time reminder until it is sent, so coverage churn cannot use it up.
   */
  private rundown(now: number) {
    const late = !this.timeRundownSent && now - this.options.startedAt >= LIMITS.rundownAt;
    if (this.counts.rundowns >= LIMITS.rundowns - (late || this.timeRundownSent ? 0 : 1)) return;
    const coverage = this.options.coverage();
    const levels = Object.fromEntries(coverageBands(coverage).flatMap(topic => topic.objectives.map(item => [item.id, item.level])));
    const key = JSON.stringify(levels);
    const changed = key !== (this.lastRundown?.key ?? INITIAL_LEVELS);
    if ((!late && !changed) || (this.lastRundown && now - this.lastRundown.at < LIMITS.rundownSpacing)) return;
    const elapsed = now - this.options.startedAt;
    const record: RundownRecord = { source: 'rundown', id: `rundown-${crypto.randomUUID()}`, sentAt: now, reason: late ? 'time' : 'change',
      elapsedMinutes: Math.round(elapsed / 6000) / 10, levels, outcome: 'sent' };
    this.records.push(record);
    this.counts.rundowns++;
    const sent = this.sendNote(record, record.id, rundownText(coverage, elapsed));
    if (!sent) { record.outcome = 'error'; this.counts.rundowns--; }
    if (late && sent) this.timeRundownSent = true;
    this.lastRundown = { key: sent ? key : this.lastRundown?.key ?? INITIAL_LEVELS, at: now };
  }

  /** Marks the next observed Sam passage after a sent note, not whether Sam acted on it. */
  transcriptChanged(entry: TranscriptEntry, previousId: string | null, now = Date.now()) {
    if (!this.alive || entry.speaker !== 'client' || this.samTurns.has(entry.id)) return;
    this.samTurns.add(entry.id);
    for (const record of this.records) {
      if ((record.source === 'producer' || record.source === 'research') && record.sentAt != null && record.sentAt <= now && record.nextSamTurnAt == null) {
        record.nextSamTurnAt = now;
        record.nextSamTurnAfterId = previousId;
      }
    }
  }

  providerEvent(id: string, accepted: boolean) {
    if (!this.alive) return;
    const record = this.records.find(item => (item.source === 'producer' || item.source === 'research' || item.source === 'rundown') && item.delivery?.eventId === id);
    if (record && 'delivery' in record && record.delivery) {
      record.delivery.status = accepted ? 'accepted' : 'rejected';
      record.delivery.acknowledgedAt = Date.now();
      if (!accepted && record.source === 'research') {
        record.outcome = 'error';
        record.reason = 'delivery_rejected';
        this.researched.delete(researchKey(record.request));
      }
      if (!accepted && record.source === 'rundown' && record.outcome !== 'error') {
        record.outcome = 'error';
        this.counts.rundowns--;
        if (record.reason === 'time') this.timeRundownSent = false;
        if (this.lastRundown?.at === record.sentAt) this.lastRundown = { key: INITIAL_LEVELS, at: Date.now() };
      }
    }
  }

  delegation(id: string, target: string | null, replied: boolean) {
    if (this.alive) this.records.push({ source: 'delegation', id, createdAt: Date.now(), target, replied });
  }

  summary(): ProducerSummary {
    return {
      model: SOL_MODEL, effort: 'none', version: PRODUCER_VERSION, ...this.counts,
      queued: this.records.filter(item => item.source === 'producer' && item.queued).length, latency: producerLatency(this.records),
    };
  }

  close() {
    this.abort.abort();
    this.queue = null;
    for (const record of this.records) if ((record.source === 'producer' || record.source === 'research') && record.outcome === 'pending') {
      record.outcome = 'aborted';
      record.completedAt = Date.now();
    }
  }
}
