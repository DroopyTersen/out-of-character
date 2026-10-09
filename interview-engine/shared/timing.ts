// The interview's clock and limits, shared by the session runtime and the browser connection.

export const SESSION_LIMIT_SECONDS = 3600;
export const SESSION_IDLE_WARNING_MS = 3 * 60_000;
export const SESSION_IDLE_TIMEOUT_MS = 5 * 60_000;
/** How long a dropped attempt is held for resume before it ends with what was captured. */
export const SESSION_PAUSE_HOLD_MS = 15 * 60_000;
/** Each resume creates a paid voice session; bound a flapping network. */
export const SESSION_MAX_RESUMES = 5;
/** Paused time extends the live limit, up to this much wall clock. */
export const SESSION_WALL_LIMIT_MS = 90 * 60_000;
/**
 * Sam's playback below the speech level this long has stopped: the browser reports the change at once, and the server
 * counts Sam as still speaking until a report says otherwise.
 */
export const SPEECH_QUIET_MS = 300;

/** Rejects when `promise` has not settled within `ms`. */
export async function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Operation timed out.')), ms); })]);
  } finally { clearTimeout(timer!); }
}

export type PauseSpan = { from: number; to: number | null };
/** Wall time since start minus paused spans: the conversation's own clock. An open span runs to `time`. */
export function activeElapsed(startedAt: number, time: number, pauses: readonly PauseSpan[] = []): number {
  let paused = 0;
  for (const pause of pauses) paused += Math.max(0, Math.min(time, pause.to ?? time) - Math.max(startedAt, pause.from));
  return Math.max(0, time - startedAt - paused);
}
