export type Passage = { id: string; start: number; end: number };
export type HighlightReview = { exists: number; passages: (Passage & { relevance: number })[] };
export type HighlightState = { status: 'empty' | 'loading' | 'error' } | { status: 'ready'; review: HighlightReview };

const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const sentenceSplitter = new Intl.Segmenter('en', { granularity: 'sentence' });

/** Preserve exact source offsets and whole sentences/turns. Unpunctuated speech
 * stays intact rather than being cut at an arbitrary word count. */
export function transcriptPassages(transcript: string): Passage[] {
  const spans: { start: number; end: number }[] = [];
  for (const paragraph of transcript.matchAll(/[^\n]*(?:\n+|$)/g)) {
    if (!paragraph[0]) continue;
    const turn: { start: number; end: number }[] = [];
    for (const sentence of sentenceSplitter.segment(paragraph[0])) {
      const next = { start: paragraph.index + sentence.index, end: paragraph.index + sentence.index + sentence.segment.length };
      const previous = turn.at(-1);
      if (previous && (wordCount(transcript.slice(previous.start, previous.end)) < 6 || wordCount(sentence.segment) < 4)) previous.end = next.end;
      else turn.push(next);
    }
    spans.push(...turn);
  }
  // Bound one post-game request without truncating longer performances.
  const groupSize = Math.max(1, Math.ceil(spans.length / 64));
  const passages: Passage[] = [];
  for (let index = 0; index < spans.length; index += groupSize) {
    passages.push({ id: `P${passages.length}`, start: spans[index]!.start, end: spans[Math.min(index + groupSize, spans.length) - 1]!.end });
  }
  return passages;
}

export function validateHighlightReview(review: HighlightReview, transcript: string): void {
  const probability = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;
  const expected = transcriptPassages(transcript);
  if (!review || !probability(review.exists) || !Array.isArray(review.passages) || review.passages.length !== expected.length || expected.some((passage, index) => {
    const actual = review.passages[index];
    return !actual || actual.id !== passage.id || actual.start !== passage.start || actual.end !== passage.end || !probability(actual.relevance);
  })) throw new Error('Invalid transcript highlights.');
}

/** Choice is a relative ranking, not an independent match probability. */
export function highlightedPassages(review: HighlightReview): Set<string> {
  if (review.exists < .8) return new Set();
  const ranked = [...review.passages].sort((a, b) => b.relevance - a.relevance || a.start - b.start);
  const strongest = ranked[0]?.relevance ?? 0;
  return new Set(ranked.filter(passage => passage.relevance > 0 && passage.relevance >= strongest * .35).slice(0, 3).map(passage => passage.id));
}
