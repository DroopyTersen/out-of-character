import type { NetworkRecord } from '../../shared/network';
import type { FeedbackStatus, InterviewBackground, InterviewEvaluation, SessionPause, SessionStatus, SessionWarning } from '../../shared/snapshot';
import type { ProducerCheckpoint } from '../conversation/producer.server';
import type { GradeRecord, ProducerSummary } from '../conversation/records';
import type { WireEntry, WireSpeaker } from '../wire';
import type { SilenceRecord } from './silence.server';

// The shapes the running protocol and its stored attempts use today. The snapshot keeps the practice simulator's
// field names (scenarioId, clientId, trainee and client) until the browser moves to InterviewSnapshot.

/** Whether the narrative has been written. The host settles it; the snapshot carries it until the narrative route replaces it. */
export type NarrativeStatus = { status: 'pending' | 'ready' | 'unavailable'; text: string | null };
/** Jev's latest readings and the narrative's status, kept beside the snapshot. */
export type InterviewState = { evaluation: InterviewEvaluation<string, WireSpeaker> | null; summary: NarrativeStatus | null };

/** The session's own snapshot, before the interview state is composed into it. */
export type WireSnapshot = {
  id: string;
  /** The spec's id. */
  scenarioId: string;
  /** The voice's id. */
  clientId: string;
  status: SessionStatus;
  startedAt: number;
  limitSeconds: number;
  warning: SessionWarning | null;
  revision: number;
  transcript: WireEntry[];
  /** Always null for an interview; the readings travel in `interview`. */
  evaluation: null;
  coaching: null;
  feedbackStatus: FeedbackStatus;
  message: string | null;
  finalization: 'pending' | 'confirmed' | 'unconfirmed';
  usageSeconds: number | null;
  /** Present while paused, and while a resume is connecting. */
  pause?: SessionPause | null;
};
/** What the browser receives. */
export type PublicSnapshot = WireSnapshot & { interview: InterviewState & { background: InterviewBackground[] } };

/** The closure lease: `providerId` is the newest provider session not yet confirmed closed; `unconfirmed` holds any older ones. */
export type Lease = { capability: string; providerId?: string; unconfirmed?: string[]; deadline: number; closed: boolean };
/** When a provider session was asked to speak, acknowledged it, was asked again, first spoke, and was given up on. */
export type GreetingLog = { sentAt: number; acknowledgedAt: number | null; retriedAt: number | null; repliedAt: number | null; abandonedAt: number | null };
/** One provider session. A resume opens a new one; its timestamps restart at 0, so `offsetMs` keeps the transcript clock monotonic. */
export type Segment = {
  epoch: number; providerId: string; offsetMs: number; startedAt: number; endedAt: number | null;
  closeReason: string | null; finalization: WireSnapshot['finalization']; usageSeconds: number | null;
  /** Absent before the session went live, and on checkpoints saved before it was recorded. */
  greeting?: GreetingLog;
  /** The browser's periodic media-quality reports for this connection, for diagnostics. */
  network?: NetworkRecord[];
  /** Bounded silence judgments and any continuation reminders, never exposed in the public snapshot. */
  silence?: SilenceRecord[];
};
export type PauseRecord = { epoch: number; reason: SessionPause['reason']; pausedAt: number; resumedAt: number | null; endedAt: number | null };
/** What a lost owner needs to finish the attempt. In-flight paid work is not kept. */
export type Checkpoint = {
  /** The interview state rides inside the stored snapshot, so older checkpoints restore unchanged. */
  savedAt: number; snapshot: WireSnapshot & { interview?: InterviewState }; reachedLive: boolean; epoch: number; resumes: number;
  segments: Segment[]; pauses: PauseRecord[]; grades: GradeRecord[]; gradeCalls: number;
  producer?: ProducerCheckpoint;
};

/** One entry per provider session, and each connection pause. Provider ids are never archived. */
export type ConnectionLog = {
  segments: Omit<Segment, 'providerId'>[];
  pauses: { reason: SessionPause['reason']; pausedAt: number; resumedAt: number | null; durationMs: number }[];
};
export type { ProducerSummary };
