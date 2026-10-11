import type { NetworkRecord } from '../shared/network';
import type { SessionStatus, InterviewSnapshot } from '../shared/snapshot';
import type { Passage } from '../shared/transcript';
import type { SilenceRecord } from '../judging/judgeConversationSilence.server';

/** The coordinator's current conversation, read by voice policy without exposing attempt or storage state. */
export type VoiceConversation = {
  status: SessionStatus;
  transcript: readonly Passage[];
  revision: number;
  composing: boolean;
};

/** Receipt is separate from speech: an accepted instruction can still be met with silence. */
export type GreetingLog = { sentAt: number; acknowledgedAt: number | null; retriedAt: number | null; repliedAt: number | null; abandonedAt: number | null };

/** One provider session. Its offset places provider timestamps on the attempt's transcript clock. */
export type VoiceSegment = {
  epoch: number; providerId: string; offsetMs: number; startedAt: number; endedAt: number | null;
  closeReason: string | null; finalization: InterviewSnapshot['finalization']; usageSeconds: number | null;
  greeting?: GreetingLog;
  network?: NetworkRecord[];
  silence?: SilenceRecord[];
  typedErrors?: { id: string; at: number }[];
};

export type RecoveryOutput =
  | { type: 'replace' }
  | { type: 'unresponsive' }
  | { type: 'responded' };
