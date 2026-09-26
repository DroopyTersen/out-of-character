export const WINDOW_SECONDS = 20;
export const FRESH_SECONDS = 3;
export const SCORES_TO_WIN = 10;
export const WIN_THRESHOLD = 0.8;

// Full performance contributes 70%; the recent window contributes 30%.
export const combineReadings = (full: number, recent: number) => (full * 7 + recent * 3) / 10;

export type SpokenWord = { text: string; start: number; end: number };
export type WordSegment = { id: string; text: string; start: number; end: number; final: boolean; stable?: boolean; words?: SpokenWord[]; fullWords?: SpokenWord[] };
export type Streak = { count: number; lastSnapshot: number; won: boolean };
export const emptyStreak = (): Streak => ({ count: 0, lastSnapshot: -1, won: false });

/** Only a new accepted judgment changes the streak. Time and pauses do not. */
export function acceptReading(streak: Streak, probability: number, snapshotId: number): Streak {
  if (!Number.isInteger(snapshotId) || snapshotId < 0 || !Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error('Invalid character reading.');
  if (streak.won || snapshotId <= streak.lastSnapshot) return streak;
  const count = probability >= WIN_THRESHOLD ? streak.count + 1 : 0;
  return { count, lastSnapshot: snapshotId, won: count >= SCORES_TO_WIN };
}

export function recentEvidence(segments: readonly WordSegment[], now: number) {
  const eligible = segments.filter(segment => segment.final || segment.stable).flatMap(segment =>
    segment.words !== undefined
      ? segment.words.map(word => ({ ...word, id: segment.id }))
      : [{ id: segment.id, text: segment.text, start: segment.start, end: segment.end }],
  ).filter(word => word.end > now - WINDOW_SECONDS && word.end <= now + 0.25);
  const text = eligible.map(word => word.text).join(" ").slice(-8000).trim();
  const speechThrough = eligible.reduce((latest, word) => Math.max(latest, word.end), -Infinity);
  const enough = text.split(/\s+/).filter(Boolean).length >= 6 && now - speechThrough <= FRESH_SECONDS;
  return { text, speechThrough, enough, fingerprint: eligible.map(word => `${word.id}:${word.start}:${word.end}:${word.text}`).join("|") };
}

export function fullEvidence(segments: readonly WordSegment[]) {
  const words = segments.filter(segment => segment.final || segment.stable).flatMap(segment =>
    segment.fullWords ?? segment.words ?? [{ text: segment.text, start: segment.start, end: segment.end }],
  );
  const text = words.map(word => word.text.trim()).filter(Boolean).join(" ");
  if (text.length > 80000) throw new Error("Listening reached the full transcript limit. Restart listening to continue.");
  return { text, fingerprint: words.map(word => `${word.start}:${word.end}:${word.text}`).join("|") };
}

export function judgingEvidence(segments: readonly WordSegment[], now: number) {
  const recent = recentEvidence(segments, now);
  const full = fullEvidence(segments);
  return { ...recent, fullTranscript: full.text, fingerprint: `${recent.text}\n${full.text}` };
}

const revisedWords = (previous: readonly SpokenWord[], next: readonly SpokenWord[]) => previous.some((word, index) =>
  word.text !== next[index]?.text,
);

export function upsertSegment(segments: readonly WordSegment[], next: WordSegment, now: number): { segments: WordSegment[]; corrected: boolean; revised: boolean } {
  const previous = segments.find(segment => segment.id === next.id);
  if (previous?.final && !next.final && !next.stable) return { segments: [...segments], corrected: false, revised: false };
  const priorWords = previous?.words?.filter(word => word.end > now - WINDOW_SECONDS);
  const nextWords = next.words?.filter(word => word.end > now - WINDOW_SECONDS);
  const changed = priorWords && nextWords
    ? revisedWords(priorWords, nextWords)
    : previous && (previous.text !== next.text || recentEvidence([previous], now).text !== recentEvidence([next], now).text);
  const corrected = Boolean((previous?.final || previous?.stable) && changed);
  const priorFull = previous?.fullWords ?? previous?.words;
  const nextFull = next.fullWords ?? next.words;
  const revised = Boolean((previous?.final || previous?.stable) && (priorFull && nextFull ? revisedWords(priorFull, nextFull) : changed));
  const updated = [...segments.filter(segment => segment.id !== next.id), next].sort((a, b) => a.start - b.start);
  // Preserve all settled turns for the complete performance context.
  if (updated.length > 300) throw new Error("Listening reached the transcript segment limit. Restart listening to continue.");
  return { segments: updated, corrected, revised };
}

export function formatElapsed(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60).toString().padStart(2, "0")}:${(whole % 60).toString().padStart(2, "0")}`;
}
