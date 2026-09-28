import type { CoverageLevel, InterviewBackground } from './interview';
import type { DirectorSignal, DirectorUsage, INTERVIEW_CONDITIONS } from './simulator/director';

/** Private producer state for the interview: Sol cues, Luna research cards and the rundown share Sam's earpiece. */
export const PRODUCER_VERSION = 'interview-producer-v1';
export const PRODUCER_LIMITS = {
  consultations: 60, cues: 15, cueSpacing: 30_000, research: 4, lookups: 2, researchAge: 90_000, checkIn: 45_000,
  rundowns: 30, rundownSpacing: 15_000, rundownAt: 25 * 60_000, targetMinutes: 30, generation: 15_000, check: 3000, cuePass: .65, cardPass: .5,
};
type InterviewCondition = typeof INTERVIEW_CONDITIONS[number];
/** A new episode of one of these consults the producer promptly and skips cue spacing. */
export const PROTECTION_CONDITIONS = ['boundary-pressure', 'leading', 'source-confusion', 'invented-facts'] as const satisfies readonly InterviewCondition[];
export type ProtectionCondition = typeof PROTECTION_CONDITIONS[number];
/** Non-urgent signals never summon the producer; they are listed as reasons on the next check-in. */
export const CHECK_IN_SIGNALS = { 'missed-thread': .6, 'question-stacking': .6, overprobing: .5, research: .5 } as const;

export type ResearchKind = InterviewBackground['target']['kind'];
export type ResearchRequest = { kind: ResearchKind; name: string; clue: string | null; passageIds: string[] };
export type ProducerTrigger =
  | { kind: 'check-in' }
  | { kind: 'concern'; condition: ProtectionCondition; probability: number }
  | { kind: 'signal'; condition: keyof typeof CHECK_IN_SIGNALS; probability: number }
  | { kind: 'research'; researchId: string; status: 'sent' | 'withheld' | 'unresolved' };
export type NoteDelivery = { eventId: string; afterPassageId: string | null; status: 'unknown' | 'accepted' | 'rejected'; acknowledgedAt?: number };
type Check = { probability: number | null; inputCount: number; lastInputId: string | null; usage?: DirectorUsage };

export type ProducerRecord = {
  source: 'producer'; id: string; triggers: ProducerTrigger[]; queued: boolean; model: string; effort: 'none';
  inputCount: number; lastInputId: string | null;
  triggeredAt: number; startedAt: number; generatedAt?: number; checkedAt?: number; sentAt?: number; nextSamTurnAt?: number; completedAt?: number;
  result?: { cue: string | null; evidenceIds: string[]; research: ResearchRequest | null }; usage?: DirectorUsage; check?: Check;
  outcome: 'pending' | 'none' | 'sent' | 'withheld' | 'budget' | 'spacing' | 'invalid' | 'timeout' | 'error' | 'aborted';
  delivery?: NoteDelivery;
};
export type ResearchRecord = {
  source: 'research'; id: string; consultationId: string; request: ResearchRequest; model: string;
  requestedAt: number; lookupAt?: number; checkedAt?: number; sentAt?: number; nextSamTurnAt?: number; completedAt?: number;
  facts?: InterviewBackground['facts']; retrievedAt?: number; queries?: string[]; reason?: string; check?: Check;
  outcome: 'pending' | 'invalid' | 'duplicate' | 'budget' | 'busy' | 'unresolved' | 'expired' | 'withheld' | 'sent' | 'timeout' | 'error' | 'aborted';
  delivery?: NoteDelivery;
};
export type RundownRecord = {
  source: 'rundown'; id: string; sentAt: number; reason: 'change' | 'time'; elapsedMinutes: number;
  levels: Record<string, CoverageLevel>; outcome: 'sent' | 'error'; delivery?: NoteDelivery;
};
export type AssessmentRecord = {
  source: 'assessment'; id: string; snapshotAt: number; completedAt: number; model: string; inputCount: number; lastInputId: string | null;
  signals: DirectorSignal[]; researchProbability?: number; outcome: 'observed' | 'evaluation_error' | 'evaluation_timeout'; concerns: ProtectionCondition[];
};
export type DelegationRecord = { source: 'delegation'; id: string; createdAt: number; target: string | null; replied: boolean };
export type ProducerLogRecord = ProducerRecord | ResearchRecord | RundownRecord | AssessmentRecord | DelegationRecord;

export type DeliveredInterviewBackground = InterviewBackground & { afterPassageId: string | null; status: 'accepted' | 'unknown' };

/** Only cards actually sent can explain Sam's public claims; rejected or withheld cards cannot. */
export function deliveredBackground(records: ProducerLogRecord[]): DeliveredInterviewBackground[] {
  return records.flatMap(item => {
    if (item.source !== 'research' || item.outcome !== 'sent' || !item.facts?.length || item.retrievedAt == null || !item.delivery || item.delivery.status === 'rejected') return [];
    return [{ id: item.id, target: { kind: item.request.kind, name: item.request.name }, facts: item.facts, retrievedAt: item.retrievedAt,
      afterPassageId: item.delivery.afterPassageId, status: item.delivery.status }];
  });
}

export type LatencyStat = { count: number; p50: number; p90: number } | null;
export type ProducerSummary = {
  model: string; effort: 'none'; version: string;
  consultations: number; cues: number; research: number; rundowns: number; queued: number;
  latency: { sol: LatencyStat; cueCheck: LatencyStat; triggerToCue: LatencyStat; cueToSam: LatencyStat; lookup: LatencyStat; requestToCard: LatencyStat };
};

export function latencyStat(values: number[]): LatencyStat {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (quantile: number) => sorted[Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1)]!;
  return { count: sorted.length, p50: at(.5), p90: at(.9) };
}

export function producerLatency(records: ProducerLogRecord[]): ProducerSummary['latency'] {
  const producers = records.filter((item): item is ProducerRecord => item.source === 'producer');
  const research = records.filter((item): item is ResearchRecord => item.source === 'research');
  const spans = (pairs: [number | undefined, number | undefined][]) => pairs.flatMap(([from, to]) => from != null && to != null ? [to - from] : []);
  return {
    sol: latencyStat(spans(producers.map(item => [item.startedAt, item.generatedAt]))),
    cueCheck: latencyStat(spans(producers.map(item => [item.generatedAt, item.checkedAt]))),
    triggerToCue: latencyStat(spans(producers.map(item => [item.triggeredAt, item.sentAt]))),
    cueToSam: latencyStat(spans(producers.map(item => [item.sentAt, item.nextSamTurnAt]))),
    lookup: latencyStat(spans(research.map(item => [item.requestedAt, item.lookupAt]))),
    requestToCard: latencyStat(spans(research.map(item => [item.requestedAt, item.sentAt]))),
  };
}
