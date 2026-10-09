import type { InterviewDefinition } from '../definition.server';
import type { NetworkRecord } from '../../shared/network';
import type { InterviewEvaluation, InterviewSnapshot, SessionPause } from '../../shared/snapshot';
import type { ProducerCheckpoint } from '../conversation/producer.server';
import type { GradeRecord, ProducerSummary } from '../conversation/records';
import type { SilenceRecord } from './silence.server';

/** Whether the host has written the narrative. Kept in storage and archives, outside the live snapshot. */
export type NarrativeStatus = { status: 'pending' | 'ready' | 'unavailable'; text: string | null };
export type InterviewState = { evaluation: InterviewEvaluation | null; summary: NarrativeStatus | null };

/** The actor's lifecycle and transcript, before current readings and public references are composed into it. */
export type SessionSnapshot = Omit<InterviewSnapshot, 'evaluation' | 'background' | 'pause'> & { pause?: SessionPause | null };

/** The closure lease: `providerId` is the newest provider session not yet confirmed closed; `unconfirmed` holds any older ones. */
export type Lease = { capability: string; providerId?: string; unconfirmed?: string[]; deadline: number; closed: boolean };
/** When a provider session was asked to speak, acknowledged it, was asked again, first spoke, and was given up on. */
export type GreetingLog = { sentAt: number; acknowledgedAt: number | null; retriedAt: number | null; repliedAt: number | null; abandonedAt: number | null };
/** One provider session. A resume opens a new one; its timestamps restart at 0, so `offsetMs` keeps the transcript clock monotonic. */
export type Segment = {
  epoch: number; providerId: string; offsetMs: number; startedAt: number; endedAt: number | null;
  closeReason: string | null; finalization: SessionSnapshot['finalization']; usageSeconds: number | null;
  /** Absent before the session went live, and on checkpoints saved before it was recorded. */
  greeting?: GreetingLog;
  /** The browser's periodic media-quality reports for this connection, for diagnostics. */
  network?: NetworkRecord[];
  /** Bounded silence judgments and any continuation reminders, never exposed in the public snapshot. */
  silence?: SilenceRecord[];
  /** Typed answers the provider rejected on this connection; each one paused the attempt for a reconnect. */
  typedErrors?: { id: string; at: number }[];
};
export type PauseRecord = { epoch: number; reason: SessionPause['reason']; pausedAt: number; resumedAt: number | null; endedAt: number | null };
/** What a lost owner needs to finish the attempt. In-flight paid work is not kept. */
export type Checkpoint = {
  definition?: InterviewDefinition;
  /** The interview state rides inside the stored snapshot, so older checkpoints restore unchanged. */
  savedAt: number; snapshot: SessionSnapshot & { interview?: InterviewState }; reachedLive: boolean; epoch: number; resumes: number;
  segments: Segment[]; pauses: PauseRecord[]; grades: GradeRecord[]; gradeCalls: number;
  producer?: ProducerCheckpoint;
};

/** One entry per provider session, and each connection pause. Provider ids are never archived. */
export type ConnectionLog = {
  segments: Omit<Segment, 'providerId'>[];
  pauses: { reason: SessionPause['reason']; pausedAt: number; resumedAt: number | null; durationMs: number }[];
};
export type { ProducerSummary };
