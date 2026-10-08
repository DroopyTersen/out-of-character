/** The outcome and metered usage of one attempt to write a narrative. */
export type NarrativeFailure = 'provider' | 'invalid' | 'cancelled' | 'timeout';
export type NarrativeUsage = { inputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null; cachedTokens: number | null };
export type NarrativeAttempt = { startedAt: number; endedAt: number; failure: NarrativeFailure | null; usage: NarrativeUsage | null };
/** Retained with the interview when its narrative settles. */
export type NarrativeProvenance = { model: string; version: string; attempts: NarrativeAttempt[] };
