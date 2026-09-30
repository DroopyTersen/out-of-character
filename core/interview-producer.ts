import type { CoverageLevel, InterviewBackground, InterviewObjectiveReading } from './interview';
import type { DirectorSignal, DirectorUsage, INTERVIEW_CONDITIONS } from './simulator/director';

/** Private producer state for the interview: Sol cues, Luna research cards and the rundown share Sam's earpiece. */
export const PRODUCER_VERSION = 'interview-producer-v9';
export const PRODUCER_LIMITS = {
  consultations: 60, cues: 15, cueSpacing: 30_000, research: 4, lookups: 2, researchAge: 90_000, checkIn: 45_000,
  rundowns: 30, rundownSpacing: 15_000, rundownAt: 25 * 60_000, targetMinutes: 30, generation: 15_000, check: 3000, cardPass: .5,
  followThroughPass: .8,
  cueWait: 15_000,
};
type InterviewCondition = typeof INTERVIEW_CONDITIONS[number];
/** A new episode of one of these consults the producer promptly and skips cue spacing. */
export const PROTECTION_CONDITIONS = ['boundary-pressure', 'leading', 'source-confusion', 'invented-facts'] as const satisfies readonly InterviewCondition[];
export type ProtectionCondition = typeof PROTECTION_CONDITIONS[number];
/** Non-urgent signals never summon the producer; they are listed as reasons on the next check-in. */
export const CHECK_IN_SIGNALS = { 'missed-thread': .6, 'question-stacking': .6, overprobing: .5, research: .5 } as const;

export type ResearchKind = InterviewBackground['target']['kind'];
export type ResearchRequest = { kind: ResearchKind; name: string; clue: string | null; passageIds: string[] };
export const CUE_OUTCOMES = ['followed', 'deferred', 'missed', 'retired', 'not-yet-assessable'] as const;
/** Used by the live session and voice rehearsals so they exercise the same instruction. */
export function producerDirection(cue: string): string {
  return `Producer direction for your next suitable turn: ${cue}\nContinue listening if the participant has the floor. A useful new answer takes priority. Use this only while it remains unanswered and relevant.`;
}
export type CueOutcome = typeof CUE_OUTCOMES[number];
/** A pinned instruction and its context receipt, separate from what Sam subsequently does. */
export type InterviewCue = { id: string; text: string; evidenceIds: string[]; afterPassageId: string | null; endMs: number };
export type CueFollowThrough = {
  cueId: string; outcome: CueOutcome; probabilities: Record<CueOutcome, number>;
  /** Settled passages eligible to demonstrate a response after estimated context delivery. */
  responseIds: string[];
};
export type ProducerTrigger =
  | { kind: 'check-in' }
  | { kind: 'cue-recovery'; cueId: string; probability: number }
  | { kind: 'concern'; condition: ProtectionCondition; probability: number }
  | { kind: 'signal'; condition: keyof typeof CHECK_IN_SIGNALS; probability: number }
  | { kind: 'research'; researchId: string; status: 'sent' | 'withheld' | 'unresolved' };
export type NoteDelivery = { eventId: string; afterPassageId: string | null; status: 'unknown' | 'accepted' | 'rejected'; acknowledgedAt?: number; startMs?: number; endMs?: number };
type Check = { probability: number | null; inputCount: number; lastInputId: string | null; usage?: DirectorUsage };

/** nextSamTurnAfterId precedes the first observed Sam passage after a sent note; it does not prove cue uptake. */
export type ProducerRecord = {
  source: 'producer'; id: string; triggers: ProducerTrigger[]; queued: boolean; model: string; effort: 'none' | 'low';
  inputCount: number; lastInputId: string | null;
  triggeredAt: number; startedAt: number; generatedAt?: number; checkedAt?: number; deferredAt?: number; sentAt?: number; nextSamTurnAt?: number; nextSamTurnAfterId?: string | null; completedAt?: number;
  result?: { cue: string | null; evidenceIds: string[]; research: ResearchRequest | null }; usage?: DirectorUsage;
  /** Historical delivery checks, retained for reading older archives. New cues go straight to Sam. */
  check?: Check;
  outcome: 'pending' | 'deferred' | 'none' | 'sent' | 'withheld' | 'budget' | 'spacing' | 'invalid' | 'timeout' | 'error' | 'aborted';
  /** An obsolete recovery, or a historical delivery-check rejection. */
  reason?: 'check' | 'dialogue_changed' | 'superseded' | 'no_quiet_opening';
  delivery?: NoteDelivery;
  followThrough?: CueFollowThrough & { lastInputId: string | null };
  /** Also inherited by a replacement, preventing an automatic recovery chain. */
  recoveryUsed?: boolean;
};
export type ResearchRecord = {
  source: 'research'; id: string; consultationId: string; request: ResearchRequest; model: string;
  requestedAt: number; lookupAt?: number; checkedAt?: number; sentAt?: number; nextSamTurnAt?: number; nextSamTurnAfterId?: string | null; completedAt?: number;
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
  followThrough?: CueFollowThrough;
};
export type DelegationRecord = { source: 'delegation'; id: string; createdAt: number; target: string | null; replied: boolean };
/** Compact, named tuples keep every grade inside D1's row limit without losing either judgment's evidence. */
export type GradeObjective = {
  id: string;
  shown: [level: CoverageLevel, evidenceId: string | null];
  graded: [level: CoverageLevel, evidenceId: string | null];
  levels: [notYet: number, touched: number, explored: number, setAside: number] | null;
};
export type GradeRecord = {
  source: 'grade'; id: string; final: boolean; revision: number; capturedAt: number; completedAt: number; inputCount: number; lastInputId: string | null;
  outcome: 'graded' | 'stale' | 'aborted' | 'evaluation_timeout' | 'evaluation_error'; durationMs?: number; objectives?: GradeObjective[];
};
export type ProducerLogRecord = ProducerRecord | ResearchRecord | RundownRecord | AssessmentRecord | DelegationRecord | GradeRecord | ContinuityRecord;

/** Retired rescue records remain readable in older preview archives. New sessions never produce these. */
export type ContinuityRecord = {
  source: 'continuity'; id: string; participantId: string; afterPassageId: string; sentAt: number; quietMs: number;
  outcome: 'sent' | 'resumed' | 'unanswered' | 'error'; delivery: NoteDelivery;
  responseObservedAt?: number; participantResumedAt?: number;
};

const round = (value: number) => Math.round(value * 100) / 100;
export function gradeObjectives(graded: InterviewObjectiveReading[], shown: InterviewObjectiveReading[]): GradeObjective[] {
  return graded.map(own => {
    const reading = shown.find(item => item.id === own.id);
    const levels = own.levels;
    return { id: own.id, shown: [reading?.level ?? 'not-yet', reading?.evidence?.entryId ?? null],
      graded: [own.level, own.evidence?.entryId ?? null],
      levels: levels ? [round(levels['not-yet']), round(levels.touched), round(levels.explored), round(levels['set-aside'])] : null };
  });
}

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
  model: string; effort: 'none' | 'low'; version: string;
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
