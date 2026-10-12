import type { SessionPause, SessionWarning } from '../shared/snapshot';
import type { InterviewLimits } from '../shared/spec';
import { SESSION_WALL_LIMIT_MS } from '../shared/timing';

type LifetimeInput = {
  now: number; status: 'live' | 'connecting' | 'paused'; startedAt: number; reachedLive: boolean;
  lastSeen: number; lastActivity: number; voiceActivityAt: number; deadline: number;
  connectingSince?: number; capacityDeadline: number | null; pause?: SessionPause | null; limits: InterviewLimits;
};
export type LifetimeDecision = {
  action: 'continue' | 'drain' | 'pause' | 'end'; warning?: SessionWarning | null; message?: string; interrupted?: true;
};

/** Browser contact, connection establishment and conversation limits, in their precedence order. */
export function lifetimeDecision(input: LifetimeInput): LifetimeDecision {
  const { now, status, pause, limits } = input;
  if (status === 'paused') {
    if (!pause || now < pause.resumeBy) return { action: 'continue' };
    const capped = pause.resumeBy < pause.pausedAt + limits.pauseHoldMs;
    return { action: 'end', message: `The interview ended because the connection did not return ${capped ? 'in time' : 'within 15 minutes'}.` };
  }
  if (now - input.lastSeen > 35_000) {
    return input.reachedLive ? { action: 'pause' } : { action: 'end', message: 'Interview ended after losing contact with this page.' };
  }
  if (status === 'connecting') {
    if (now - (input.connectingSince ?? input.startedAt) < 60_000) return { action: 'continue' };
    return input.reachedLive
      ? { action: 'pause', message: 'Reconnecting timed out. Try resuming again.' }
      : { action: 'end', interrupted: true, message: 'The voice connection timed out before the interview began.' };
  }
  let warning: SessionWarning | null = null;
  if (now - input.lastActivity >= limits.idleWarningMs) warning = { kind: 'idle', endsAt: input.lastActivity + limits.idleTimeoutMs };
  if (now >= input.deadline - 60_000 && (!warning || input.deadline < warning.endsAt)) warning = { kind: 'limit', endsAt: input.deadline };
  if (input.capacityDeadline && (!warning || input.capacityDeadline < warning.endsAt)) warning = { kind: 'capacity', endsAt: input.capacityDeadline };
  if (!warning || now < warning.endsAt) return { action: 'continue', warning };
  // Automatic limits allow a bounded speech drain; an explicit End bypasses this policy.
  if (warning.kind !== 'idle' && now < warning.endsAt + 20_000 && (now < warning.endsAt + 3000 || now - input.voiceActivityAt < 2500)) return { action: 'drain', warning };
  const message = warning.kind === 'idle' ? 'Interview ended after five minutes without activity.'
    : warning.kind === 'limit' ? 'Interview reached the 60-minute safety limit.' : 'Interview reached its transcript capacity.';
  return { action: 'end', warning, message };
}

/** Paused time extends the live deadline, within the attempt's wall-clock cap. */
export function attemptDeadline(deadline: number, startedAt: number, pausedAt: number | undefined, now: number): number {
  return Math.min(deadline + (pausedAt === undefined ? 0 : now - pausedAt), startedAt + SESSION_WALL_LIMIT_MS);
}

export function pauseDeadline(startedAt: number, pausedAt: number, holdMs: number): number {
  return Math.min(pausedAt + holdMs, startedAt + SESSION_WALL_LIMIT_MS);
}

/** Holding or restoring needs more than a minute; a resume already held permits exactly a minute. */
export function canHold(deadline: number, now: number, capacityDeadline: number | null): boolean {
  return capacityDeadline === null && now < deadline - 60_000;
}

export function resumeRefusal(resumes: number, maxResumes: number, resumeBy: number, deadline: number, now: number): string | null {
  if (resumes >= maxResumes) return 'This attempt has reconnected too many times. End it to keep what was captured.';
  if (now >= resumeBy) return 'The hold on this attempt has expired.';
  if (deadline - now < 60_000) return 'Too little time remains to resume this attempt.';
  return null;
}
