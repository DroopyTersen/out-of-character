import { expect, test } from 'bun:test';
import { highlightedPassages, transcriptPassages, validateHighlightReview } from './highlights';

test('passages preserve the entire original transcript, Unicode, punctuation, and turn breaks', () => {
  const transcript = '  Thanks for making time for this meeting. We need fourteen services before we build one button.\n\nI won’t skip architecture — even for a working prototype!  ';
  const spans = transcriptPassages(transcript);
  expect(spans.map(span => transcript.slice(span.start, span.end)).join('')).toBe(transcript);
  expect(spans.map(span => transcript.slice(span.start, span.end).trim())).toEqual([
    'Thanks for making time for this meeting.',
    'We need fourteen services before we build one button.',
    'I won’t skip architecture — even for a working prototype!',
  ]);
});

test('short phrases and unpunctuated speech are not cut into arbitrary word blocks', () => {
  const transcript = 'No. I refuse to rebuild the working checkout for no reason.\n\n' + 'we should keep the working system and fix the actual bug '.repeat(100);
  const spans = transcriptPassages(transcript);
  expect(spans).toHaveLength(2);
  expect(transcript.slice(spans[0]!.start, spans[0]!.end)).toStartWith('No. I refuse');
  expect(spans.map(span => transcript.slice(span.start, span.end)).join('')).toBe(transcript);
});

test('long performances stay bounded without losing sentences or source text', () => {
  const transcript = Array.from({ length: 150 }, (_, index) => `We need another architecture review for service number ${index}.`).join('\n');
  const spans = transcriptPassages(transcript);
  expect(spans.length).toBeLessThanOrEqual(64);
  expect(spans.map(span => transcript.slice(span.start, span.end)).join('')).toBe(transcript);
  expect(spans.every(span => transcript.slice(span.start, span.end).trimEnd().endsWith('.'))).toBe(true);
});

test('a relative winner alone cannot highlight a transcript without character evidence', () => {
  const review = { exists: .2, passages: [{ id: 'P0', start: 0, end: 10, relevance: .99 }] };
  expect(highlightedPassages(review).size).toBe(0);
  expect([...highlightedPassages({ ...review, exists: .9 })]).toEqual(['P0']);
});

test('highlights select strongest passages, omit weak evidence, and cap visual emphasis', () => {
  const passages = [.05, .4, .2, .18, .17].map((relevance, index) => ({ id: `P${index}`, start: index * 10, end: index * 10 + 10, relevance }));
  expect([...highlightedPassages({ exists: .99, passages })]).toEqual(['P1', 'P2', 'P3']);
});

test('invalid provider offsets, missing passages, and invalid probabilities cannot render highlights', () => {
  const transcript = 'I need fourteen services before we write any code.';
  const valid = { exists: .9, passages: transcriptPassages(transcript).map(span => ({ ...span, relevance: 1 })) };
  expect(() => validateHighlightReview(valid, transcript)).not.toThrow();
  for (const invalid of [
    { ...valid, exists: NaN }, { ...valid, passages: [] },
    { ...valid, passages: [{ ...valid.passages[0]!, start: 1 }] },
    { ...valid, passages: [{ ...valid.passages[0]!, relevance: 2 }] },
  ]) expect(() => validateHighlightReview(invalid, transcript)).toThrow();
});
