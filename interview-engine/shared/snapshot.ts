import type { Evidence, Passage, Speaker } from './transcript';

export type SessionStatus = 'connecting' | 'live' | 'paused' | 'ending' | 'ended' | 'interrupted';
/** A dropped connection holds the attempt instead of ending it; the browser may resume until resumeBy. */
export type SessionPause = { reason: 'browser' | 'provider' | 'restart'; pausedAt: number; resumeBy: number; resumes: number; maxResumes: number };
/** The interview ends at endsAt unless the participant acts (idle) or wraps up (limit, capacity). */
export type SessionWarning = { kind: 'idle' | 'limit' | 'capacity'; endsAt: number };
/** Whether the latest readings reflect the latest words. */
export type FeedbackStatus = 'waiting' | 'current' | 'delayed' | 'unavailable';

/** How far a topic has been covered. Set aside means the participant declined it, cannot speak to it, or says it does not apply. */
export const COVERAGE_LEVELS = ['not-yet', 'touched', 'explored', 'set-aside'] as const;
export type CoverageLevel = typeof COVERAGE_LEVELS[number];

/** One reading of the participant (for example specificity), on Jev's scale. */
export type ReadingValue<S extends string = Speaker> = { value: number | null; distribution: Record<string, number> | null; evidence: Evidence<S> | null };
/** `probability` is P(explored); `achieved` means explored. */
export type InterviewObjectiveReading<S extends string = Speaker> = {
  id: string;
  probability: number | null;
  achieved: boolean;
  evidence: Evidence<S> | null;
  level: CoverageLevel;
  levels: Record<CoverageLevel, number> | null;
};
export type InterviewEvaluation<R extends string = string, S extends string = Speaker> = {
  revision: number;
  readings: Record<R, ReadingValue<S>>;
  objectives: InterviewObjectiveReading<S>[];
  model: string;
  durationMs: number;
};
/** Public references only; preparation and producer directions remain private. */
export type InterviewBackground = {
  id: string;
  target: { kind: 'organization' | 'product' | 'term'; name: string };
  facts: { text: string; url: string; title: string }[];
  retrievedAt: number;
};

/** The transcript entry a snapshot carries: a Passage, or until the runtime is renamed, the practice simulator's entry. */
export type SnapshotEntry = { id: string; speaker: string; text: string; startMs: number; endMs: number };
/** What the browser renders during and after an interview. The narrative is not part of it; the host serves that separately. */
export type InterviewSnapshot<E extends SnapshotEntry = Passage, R extends string = string> = {
  id: string;
  specId: string;
  voiceId: string;
  status: SessionStatus;
  startedAt: number;
  limitSeconds: number;
  usageSeconds: number | null;
  warning: SessionWarning | null;
  /** Present while paused, and while a resume is connecting. */
  pause: SessionPause | null;
  transcript: E[];
  /** Coverage of the spec's objectives and the participant readings, re-judged as the conversation goes. */
  evaluation: InterviewEvaluation<R, E['speaker']> | null;
  feedbackStatus: FeedbackStatus;
  background: InterviewBackground[];
  message: string | null;
  revision: number;
  finalization: 'pending' | 'confirmed' | 'unconfirmed';
};
