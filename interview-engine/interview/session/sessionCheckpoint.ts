import type { InterviewDefinition } from '../definition.server';
import type { FeedbackStatus, InterviewEvaluation, InterviewSnapshot, SessionPause } from '../../shared/snapshot';
import type { ProducerCheckpoint } from '../reasoning/interviewProducer.server';
import type { GradeRecord, ProducerSummary } from '../reasoning/conversationRecords';
import type { VoiceSegment } from '../voice/voiceSession';

export type InterviewState = { evaluation: InterviewEvaluation | null };

/** The coordinator's lifecycle and transcript, before current coverage and public references are composed into it. */
export type SessionSnapshot = Omit<InterviewSnapshot, 'evaluation' | 'feedbackStatus' | 'background' | 'pause'> & { pause?: SessionPause | null };

/** Provider sessions still owed closure, in creation order. */
export type Lease = { capability: string; providerIds: string[]; deadline: number; closed: boolean };
export type PauseRecord = { epoch: number; reason: SessionPause['reason']; pausedAt: number; resumedAt: number | null; endedAt: number | null };
/** What a lost owner needs to finish the attempt. In-flight paid work is not kept. */
export type Checkpoint = {
  definition?: InterviewDefinition;
  /** The interview state rides inside the stored snapshot, so older checkpoints restore unchanged. */
  savedAt: number; snapshot: SessionSnapshot & { feedbackStatus: FeedbackStatus; interview?: InterviewState }; reachedLive: boolean; epoch: number; resumes: number;
  segments: VoiceSegment[]; pauses: PauseRecord[]; grades: GradeRecord[]; gradeCalls: number;
  producer?: ProducerCheckpoint;
};

/** One entry per provider session, and each connection pause. Provider ids are never archived. */
export type ConnectionLog = {
  segments: Omit<VoiceSegment, 'providerId'>[];
  pauses: { reason: SessionPause['reason']; pausedAt: number; resumedAt: number | null; durationMs: number }[];
};
export type { ProducerSummary };
