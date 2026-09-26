import { describe, expect, test } from 'bun:test';
import { characters } from './characters';
import {
  combineReadings, acceptReading, emptyStreak, recentEvidence, fullEvidence, judgingEvidence, upsertSegment,
  type WordSegment,
} from './performance';
import comparison from '../ai/evals/comparison.json';

const segment = (id: string, start: number, end: number, text = 'We should discuss the concrete next step', final = true): WordSegment => ({ id, start, end, text, final });

describe('consecutive score streak', () => {
  test('requires ten distinct qualifying results, including the raw threshold', () => {
    expect(acceptReading(emptyStreak(), .799, 1).count).toBe(0);
    let streak = emptyStreak();
    for (let id = 1; id <= 10; id++) {
      streak = acceptReading(streak, .8, id);
      expect(streak.count).toBe(id);
      expect(streak.won).toBe(id === 10);
    }
  });

  test('a below-zone score resets consecutive progress; separate bursts cannot accumulate', () => {
    let streak = emptyStreak();
    for (let id = 1; id <= 6; id++) streak = acceptReading(streak, .95, id);
    streak = acceptReading(streak, .799, 7);
    expect(streak.count).toBe(0);
    for (let id = 8; id <= 16; id++) streak = acceptReading(streak, .95, id);
    expect(streak.count).toBe(9);
    expect(streak.won).toBe(false);
    expect(acceptReading(streak, .95, 17).won).toBe(true);
  });

  test('duplicate and older responses cannot advance or reset a streak', () => {
    const streak = acceptReading(acceptReading(emptyStreak(), .86, 1), .9, 4);
    for (const id of [0, 1, 3, 4]) {
      expect(acceptReading(streak, .99, id)).toEqual(streak);
      expect(acceptReading(streak, .1, id)).toEqual(streak);
    }
    expect(acceptReading(streak, .9, 20).count).toBe(3);
  });

  test('a completed streak cannot be undone by a later score', () => {
    let streak = emptyStreak();
    for (let id = 1; id <= 10; id++) streak = acceptReading(streak, .9, id);
    expect(acceptReading(streak, .01, 11)).toEqual(streak);
  });

  test('invalid values are rejected, not counted as judgments', () => {
    for (const score of [NaN, Infinity, -.1, 1.01]) expect(() => acceptReading(emptyStreak(), score, 1)).toThrow();
    for (const id of [NaN, Infinity, -1, .5]) expect(() => acceptReading(emptyStreak(), .9, id)).toThrow();
  });
});

describe('recent finalized evidence', () => {
  test('expires segments at the twenty-second boundary and excludes partials and future audio', () => {
    const evidence = recentEvidence([
      segment('expired', 0, 0, 'old evidence must disappear entirely'),
      segment('current', 17, 18),
      segment('partial', 18, 19, 'partial words must stay out', false),
      segment('future', 21, 22, 'future words must stay out'),
    ], 20);
    expect(evidence.text).toBe('We should discuss the concrete next step');
    expect(evidence.speechThrough).toBe(18);
    expect(evidence.enough).toBe(true);
  });

  test('six recognized words and recent actual speech are both required', () => {
    expect(recentEvidence([segment('short', 0, 1, 'one two three four five')], 1).enough).toBe(false);
    expect(recentEvidence([segment('enough', 0, 1, 'one two three four five six')], 1).enough).toBe(true);
    expect(recentEvidence([segment('stale', 0, 1, 'one two three four five six')], 4.001).enough).toBe(false);
  });

  test('corrected final text replaces earlier text and invalidates its fingerprint', () => {
    const original = segment('utterance', 0, 1, 'We should build a giant service bus');
    const before = recentEvidence([original], 1);
    const update = upsertSegment([original], { ...original, text: 'We should avoid a giant service bus' }, 1);
    expect(update.corrected).toBe(true);
    expect(update.segments).toHaveLength(1);
    const after = recentEvidence(update.segments, 1);
    expect(after.text).toBe('We should avoid a giant service bus');
    expect(after.fingerprint).not.toBe(before.fingerprint);
  });

  test('timestamp refinement changes metadata without withdrawing unchanged judged content', () => {
    const original = segment('utterance', 0, 3);
    const update = upsertSegment([original], { ...original, end: 1 }, 3);
    expect(update.corrected).toBe(false);
    expect(update.revised).toBe(false);
    expect(recentEvidence(update.segments, 3).fingerprint).not.toBe(recentEvidence([original], 3).fingerprint);
    const words = [{ text: 'We', start: 0, end: 1 }, { text: 'should', start: 1, end: 2 }];
    const withWords = { ...original, words };
    const changedWord = { ...withWords, words: [words[0]!, { ...words[1]!, end: 2.5 }] };
    const wordUpdate = upsertSegment([withWords], changedWord, 3);
    expect(wordUpdate.corrected).toBe(false);
    expect(wordUpdate.revised).toBe(false);
    expect(recentEvidence(wordUpdate.segments, 3).fingerprint).not.toBe(recentEvidence([withWords], 3).fingerprint);
  });

  test('partial finalization replaces the segment without duplicating its words', () => {
    const partial = segment('utterance', 0, 1, 'one two three', false);
    const final = segment('utterance', 0, 2, 'one two three four five six');
    const update = upsertSegment([partial], final, 2);
    expect(update.corrected).toBe(false);
    expect(update.segments).toEqual([final]);
    expect(recentEvidence(update.segments, 2).text).toBe(final.text);
  });

  test('a later partial cannot overwrite finalized evidence with the same ID', () => {
    const final = segment('utterance', 0, 2);
    const partial = { ...final, text: 'We should', final: false };
    const update = upsertSegment([final], partial, 2);
    expect(update.segments).toEqual([final]);
    expect(update.corrected).toBe(false);
  });
});

describe('saved-provider score sequences', () => {
  test('recorded Noul negatives never produce a streak for any assigned character', () => {
    const negatives = comparison.rows.filter(row => !('expected' in row) && row.mode === 'noul');
    expect(negatives).toHaveLength(6);
    for (const row of negatives) for (const character of characters) {
      let streak = emptyStreak();
      for (let id = 1; id <= 12; id++) streak = acceptReading(streak, (row.readings as Record<string, number>)[character.id]!, id);
      expect(streak.count).toBe(0);
      expect(streak.won).toBe(false);
    }
  });
});

describe('dual-context judging evidence', () => {
  test('full performance carries 70% and recent speech 30%, preserving endpoints and the win boundary', () => {
    expect(combineReadings(1, 0)).toBe(.7);
    expect(combineReadings(0, 1)).toBe(.3);
    expect(combineReadings(0, 0)).toBe(0);
    expect(combineReadings(1, 1)).toBe(1);
    expect(combineReadings(.8, .8)).toBe(.8);
    expect(combineReadings(.84, .76)).toBeCloseTo(.816, 12);
    expect(acceptReading(emptyStreak(), combineReadings(.8, .8), 1).count).toBe(1);
    expect(acceptReading(emptyStreak(), combineReadings(.8, .799), 1).count).toBe(0);
  });

  test('recent context uses the exact twenty-second boundary while full context retains the beginning', () => {
    const words = [
      { text: 'opening', start: 0, end: 0 },
      { text: 'boundary', start: 0, end: 0 },
      { text: 'retained', start: .001, end: .001 },
      ...'We should draw six service boundaries'.split(' ').map(text => ({ text, start: 18, end: 18 })),
    ];
    const rolling = { ...segment('rolling', 0, 18), words, fullWords: words };
    const evidence = judgingEvidence([rolling], 20);
    expect(evidence.text).toBe('retained We should draw six service boundaries');
    expect(evidence.fullTranscript).toBe('opening boundary retained We should draw six service boundaries');
    expect(evidence.speechThrough).toBe(18);
    expect(evidence.enough).toBe(true);
  });

  test('full history survives old segment expiry and exceeds the old caption limit without truncation', () => {
    const opening = segment('opening', 0, 1, 'original ' + 'history '.repeat(1200));
    const next = segment('current', 90, 91);
    const update = upsertSegment([opening], next, 91);
    const evidence = judgingEvidence(update.segments, 91);
    expect(update.segments).toHaveLength(2);
    expect(evidence.text).toBe(next.text);
    expect(evidence.fullTranscript).toBe(`${opening.text.trim()} ${next.text}`);
    expect(evidence.fullTranscript.length).toBeGreaterThan(8000);
    expect(() => fullEvidence([segment('oversize', 0, 1, 'x'.repeat(80001))])).toThrow(/full transcript limit/);
  });

  test('an explicit empty settled word list never substitutes the raw caption or invents fresh speech', () => {
    const rolling = { ...segment('rolling', 0, 20, 'raw pending words cannot become settled evidence', false), stable: true, words: [], fullWords: [{ text: 'old', start: 0, end: 0 }] };
    expect(judgingEvidence([rolling], 20).text).toBe('');
    expect(judgingEvidence([rolling], 20).speechThrough).toBe(-Infinity);
    expect(judgingEvidence([rolling], 20).enough).toBe(false);
    expect(fullEvidence([rolling]).text).toBe('old');
  });

  test('old full-history revisions invalidate requests without changing recent speech freshness', () => {
    const old = { text: 'opening', start: 0, end: 0 };
    const fresh = 'We should draw six service boundaries'.split(' ').map(text => ({ text, start: 18, end: 18 }));
    const before = { ...segment('rolling', 0, 18), words: fresh, fullWords: [old, ...fresh] };
    const next = { ...before, fullWords: [{ ...old, text: 'revised' }, ...fresh] };
    const update = upsertSegment([before], next, 20);
    expect(update.revised).toBe(true);
    expect(update.corrected).toBe(false);
    expect(judgingEvidence([before], 20).fingerprint).not.toBe(judgingEvidence(update.segments, 20).fingerprint);
    expect(judgingEvidence(update.segments, 20).speechThrough).toBe(18);
    const appended = { ...next, words: [...fresh, { text: 'now', start: 20, end: 20 }], fullWords: [...next.fullWords, { text: 'now', start: 20, end: 20 }] };
    expect(upsertSegment([next], appended, 20).revised).toBe(false);
    expect(upsertSegment([next], appended, 20).corrected).toBe(false);
  });

  test('a weighted composite below threshold resets even when one context is high', () => {
    const streak = acceptReading(emptyStreak(), combineReadings(.86, .66), 1);
    expect(streak.count).toBe(1);
    expect(acceptReading(streak, combineReadings(.70, .99), 2).count).toBe(0);
  });
});
