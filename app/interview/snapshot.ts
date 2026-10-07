import type { InterviewSession } from '../../core/interview';
import type { SessionSnapshot } from '../../core/simulator/types';
import type { InterviewSnapshot } from './screens';

/**
 * The session still carries the interview inside the practice simulator's snapshot; the screens render the engine's
 * flat shape. The interview has no client walk-out, so that warning never reaches them.
 */
export function toInterviewSnapshot(snapshot: SessionSnapshot & { interview?: InterviewSession }): InterviewSnapshot {
  const { kind, endsAt } = snapshot.warning ?? {};
  const warning = kind && kind !== 'client' && endsAt != null ? { kind, endsAt } : null;
  return {
    id: snapshot.id,
    specId: snapshot.scenarioId,
    voiceId: snapshot.clientId,
    status: snapshot.status,
    startedAt: snapshot.startedAt,
    limitSeconds: snapshot.limitSeconds,
    usageSeconds: snapshot.usageSeconds,
    warning,
    pause: snapshot.pause ?? null,
    transcript: snapshot.transcript,
    evaluation: snapshot.interview?.evaluation ?? null,
    feedbackStatus: snapshot.feedbackStatus,
    background: snapshot.interview?.background ?? [],
    message: snapshot.message,
    revision: snapshot.revision,
    finalization: snapshot.finalization,
  };
}
