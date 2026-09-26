import { expect, test } from 'bun:test';
import { emptyTurn, observeTurn, settledTranscript, type FluxTurnInfo } from './transcript';
import { acceptReading, emptyStreak, fullEvidence, judgingEvidence, recentEvidence, upsertSegment, type WordSegment } from '../../core/performance';
import recorded from './fixtures/flux-turns.json';

const sentence = 'We should build a giant service bus';
function event(text = sentence, start = 0, final = false, turn = 0): FluxTurnInfo {
  return { type: 'TurnInfo', event: final ? 'EndOfTurn' : 'Update', turn_index: turn, transcript: text, words: text.split(/\s+/).filter(Boolean).map((word, index) => ({ word, start: start + index * .1, end: start + (index + 1) * .1 })) };
}
const initial = () => observeTurn(emptyTurn('turn-0'), event(), 1);

test('interim evidence waits400ms and leaves the last word pending; provider final releases it', () => {
  const state = initial();
  expect(recentEvidence([settledTranscript(state, 1.399)], 1.399).enough).toBe(false);
  const settled = settledTranscript(state, 1.401);
  expect(recentEvidence([settled], 1.401).text).toBe('We should build a giant service');
  expect(recentEvidence([settled], 1.401).enough).toBe(true);
  const final = observeTurn(state, event(sentence, 0, true), 2);
  expect(settledTranscript(final, 2).words).toHaveLength(7);
  expect(upsertSegment([settled], settledTranscript(final, 2), 2).corrected).toBe(false);
});

test('actual audio timestamps—not update arrival, window duration, or silence—define freshness', () => {
  const state = initial();
  const repeated = observeTurn(state, event(), 3);
  expect(repeated.words).toEqual(state.words);
  const finalized = observeTurn(repeated, event(sentence, 0, true), 10);
  const evidence = judgingEvidence([settledTranscript(finalized, 10)], 10);
  expect(evidence.speechThrough).toBe(.7);
  expect(evidence.enough).toBe(false);
  expect(evidence.fullTranscript).toBe(sentence);
});

test('millisecond normalization removes float jitter and clamps tiny negative zero without resetting settled support', () => {
  const first = event();
  first.words[0]!.start = -1.07e-8;
  const state = observeTurn(emptyTurn('turn'), first, 1);
  const jitter = event();
  jitter.words.forEach(word => { word.start += 8e-8; word.end += 8e-8; });
  const next = observeTurn(state, jitter, 2);
  expect(next.words).toEqual(state.words);
  expect(next.words[0]!.start).toBe(0);
  expect(upsertSegment([settledTranscript(state, 1.5)], settledTranscript(next, 2), 2).revised).toBe(false);
});

test('genuine eligible lexical corrections invalidate both contexts; harmless retiming retains settled support', () => {
  const state = initial();
  const before = settledTranscript(state, 1.5);
  const changed = event('We should avoid a giant service bus');
  const revised = observeTurn(state, changed, 2);
  const update = upsertSegment([before], settledTranscript(revised, 2), 2);
  expect(update.corrected).toBe(true);
  expect(update.revised).toBe(true);
  expect(recentEvidence([settledTranscript(revised, 2)], 2).text).toBe('We should');
  expect(revised.words.slice(3)).toEqual(state.words.slice(3));
  const retimed = event(sentence, 0, true);
  retimed.words[2]!.end = .25;
  const final = settledTranscript(observeTurn(state, retimed, 2), 2);
  expect(final.words![2]!.end).toBe(.25);
  expect(upsertSegment([before], final, 2).corrected).toBe(false);
  expect(upsertSegment([before], final, 2).revised).toBe(false);
});

test('punctuation, case, and punctuation-only words do not manufacture corrections or fresh speech', () => {
  const state = initial();
  const punctuation = event('WE should build a giant service bus.', 0, true);
  punctuation.words.push({ word: '--', start: 5, end: 5 });
  const next = settledTranscript(observeTurn(state, punctuation, 2), 2);
  expect(next.fullWords).toHaveLength(7);
  expect(next.fullWords!.map(word => word.text).join(' ')).toBe(sentence);
  expect(judgingEvidence([next], 2).speechThrough).toBe(.7);
  expect(upsertSegment([settledTranscript(state, 1.5)], next, 2).corrected).toBe(false);
});

test('append-only words settle without resetting an existing eligible prefix', () => {
  const state = initial();
  const before = settledTranscript(state, 1.5);
  const appended = observeTurn(state, event(`${sentence} with fourteen services`), 2);
  expect(upsertSegment([before], settledTranscript(appended, 2), 2).corrected).toBe(false);
  expect(upsertSegment([before], settledTranscript(appended, 2.5), 2.5).revised).toBe(false);
  expect(recentEvidence([settledTranscript(appended, 2.5)], 2.5).text).toBe(`${sentence} with fourteen`);
});

test('transient prefix withdrawal preserves support and timestamps; sustained or final deletion is a correction', () => {
  const state = initial();
  const before = settledTranscript(state, 1.5);
  const withdrawn = observeTurn(state, event('We should build'), 2);
  const waiting = settledTranscript(withdrawn, 2.2);
  expect(fullEvidence([waiting])).toEqual(fullEvidence([before]));
  expect(upsertSegment([before], waiting, 2.2).corrected).toBe(false);
  const returned = observeTurn(withdrawn, event(), 2.215);
  expect(returned.words).toEqual(state.words);
  expect(upsertSegment([before], settledTranscript(returned, 2.215), 2.215).revised).toBe(false);
  expect(upsertSegment([before], settledTranscript(withdrawn, 2.401), 2.401).corrected).toBe(true);
  const final = observeTurn(state, event('We should build', 0, true), 2);
  expect(upsertSegment([before], settledTranscript(final, 2), 2).corrected).toBe(true);
});

test('separate turns retain full speech, use a rolling20s horizon, and do not duplicate finalized words', () => {
  const old = settledTranscript(observeTurn(emptyTurn('turn-0'), event('The opening makes the diagram beautiful', 0, true), 1), 1);
  const next = settledTranscript(observeTurn(emptyTurn('turn-1'), event('We should draw six service boundaries pending', 20, false, 1), 21), 21.5);
  const update = upsertSegment([old], next, 21.5);
  const evidence = judgingEvidence(update.segments, 21.5);
  expect(evidence.text).toBe('We should draw six service boundaries');
  expect(evidence.fullTranscript).toBe('The opening makes the diagram beautiful We should draw six service boundaries');
  expect(update.revised).toBe(false);
  expect(upsertSegment(update.segments, next, 21.5).segments).toHaveLength(2);
  expect(recentEvidence(update.segments, 40.6).text).toBe('');
});

test('a pending old correction cannot hide unchanged fresh words or renew its horizon', () => {
  const first = event('diagram service bus We should ship the useful checkout button');
  first.words.forEach((word, index) => { if (index >= 3) { word.start += 28; word.end += 28; } });
  const state = observeTurn(emptyTurn('turn'), first, 29);
  const before = settledTranscript(state, 29.5);
  const revisedEvent = { ...first, words: first.words.map(word => ({ ...word })) };
  revisedEvent.transcript = first.transcript.replace('diagram', 'diagrams');
  revisedEvent.words[0]!.word = 'diagrams';
  const revised = observeTurn(state, revisedEvent, 30);
  const immediate = settledTranscript(revised, 30);
  expect(judgingEvidence([immediate], 30).text).toBe('We should ship the useful checkout');
  expect(upsertSegment([before], immediate, 30).revised).toBe(true);
  expect(upsertSegment([before], immediate, 30).corrected).toBe(false);
  expect(settledTranscript(revised, 30.5).fullWords![0]!.end).toBe(.1);
});

test('finalized turns ignore later interim downgrade and unchanged finalization preserves timestamps', () => {
  const state = observeTurn(emptyTurn('turn'), event(sentence, 0, true), 1);
  const late = observeTurn(state, event('We should'), 2);
  expect(late).toEqual(state);
  const repeated = observeTurn(state, event(sentence, 0, true), 3);
  expect(repeated.words).toEqual(state.words);
});

test('actual recorded hosted Flux events replay with normalized word timing, final words, and silence expiry', () => {
  const turns = new Map<number, ReturnType<typeof emptyTurn>>();
  let segments: WordSegment[] = [];
  let nonempty = 0;
  for (const recordedEvent of recorded.events) {
    const value = recordedEvent as FluxTurnInfo & { receivedAtSeconds: number };
    const state = observeTurn(turns.get(value.turn_index) ?? emptyTurn(`turn-${value.turn_index}`), value, value.receivedAtSeconds);
    turns.set(value.turn_index, state);
    segments = upsertSegment(segments, settledTranscript(state, value.receivedAtSeconds), value.receivedAtSeconds).segments;
    const evidence = judgingEvidence(segments, value.receivedAtSeconds);
    if (evidence.enough) nonempty++;
    expect(evidence.fullTranscript.length).toBeLessThan(80000);
    expect(state.words.every(word => word.start >= 0 && word.end >= word.start)).toBe(true);
  }
  expect(nonempty).toBeGreaterThan(20);
  expect(turns.size).toBe(2);
  expect(turns.get(0)!.final).toBe(true);
  expect(fullEvidence(segments).text.toLowerCase().replace(/[^\w\s]/g, '')).toBe('a checkout button first we need a bounded context diagram i propose separate cart pricing checkout then checkout orchestration services communicate');
  expect(turns.get(0)!.words.at(-1)!.end).toBe(10);
  expect(judgingEvidence(segments, 13.001).enough).toBe(false);
});

test('malformed times, events, and oversized transcripts fail clearly', () => {
  for (const value of [NaN, Infinity, -.01]) {
    const bad = event(); bad.words[0]!.start = value;
    expect(() => observeTurn(emptyTurn('turn'), bad, 1)).toThrow(/timestamp/);
  }
  const backwards = event(); backwards.words[0]!.end = -.01;
  expect(() => observeTurn(emptyTurn('turn'), backwards, 1)).toThrow(/timestamp/);
  expect(() => observeTurn(emptyTurn('turn'), event(), NaN)).toThrow(/time/);
  expect(() => observeTurn(emptyTurn('turn'), { ...event(), transcript: 'x'.repeat(80001) }, 1)).toThrow(/limit/);
  expect(() => observeTurn(emptyTurn('turn'), { ...event(), turn_index: -1 }, 1)).toThrow(/transcript/);
});


test('an unchanged settled word stays eligible across real interim timing refinement without renewing arrival-time freshness', () => {
  const state = initial();
  const before = settledTranscript(state, 1.5);
  const refined = event();
  refined.words[2]!.start = .18;
  refined.words[2]!.end = .35;
  const next = settledTranscript(observeTurn(state, refined, 2), 2);
  expect(next.words).toHaveLength(6);
  expect(next.words![2]).toEqual({ text: 'build', start: .18, end: .35 });
  expect(upsertSegment([before], next, 2).corrected).toBe(false);
  expect(upsertSegment([before], next, 2).revised).toBe(false);
  expect(judgingEvidence([before], 2).fingerprint).toBe(judgingEvidence([next], 2).fingerprint);
  expect(recentEvidence([next], 3.601).enough).toBe(false);
});

test('real timing refinement that changes recent-window eligibility invalidates the judged content', () => {
  const words = event('old We should draw six service boundaries pending', 0, true).words;
  words.forEach((word, index) => { if (index > 0) { word.start += 28; word.end += 28; } });
  const state = observeTurn(emptyTurn('turn'), { ...event(), event: 'EndOfTurn', words }, 29);
  const before = settledTranscript(state, 30);
  const shifted = words.map(word => ({ ...word }));
  shifted[0]!.start = 10;
  shifted[0]!.end = 10.1;
  const next = settledTranscript(observeTurn(state, { ...event(), event: 'EndOfTurn', words: shifted }, 30), 30);
  expect(recentEvidence([before], 30).text).not.toBe(recentEvidence([next], 30).text);
  expect(upsertSegment([before], next, 30).corrected).toBe(true);
  expect(upsertSegment([before], next, 30).revised).toBe(false);
});


test('continuing positive speech preserves settled content through timing refinements; repeated speech does not create new evidence', () => {
  let info = event(sentence, 0);
  let state = observeTurn(emptyTurn('turn'), info, 1);
  let segment = settledTranscript(state, 1.5);
  let streak = acceptReading(emptyStreak(), .95, 1);
  for (let second = 2; second <= 12; second++) {
    info = { ...info, transcript: `${info.transcript} service${second} boundary${second}`, words: [
      ...info.words.map((word, index) => index === 2 ? { ...word, end: second % 2 ? .30 : .35 } : word),
      { word: `service${second}`, start: second - .2, end: second - .1 },
      { word: `boundary${second}`, start: second - .1, end: second },
    ] };
    state = observeTurn(state, info, second + .2);
    const next = settledTranscript(state, second + .7);
    const update = upsertSegment([segment], next, second + .7);
    expect(update.corrected).toBe(false);
    expect(update.revised).toBe(false);
    segment = next;
    const evidence = recentEvidence([segment], second + .7);
    expect(evidence.enough).toBe(true);
    streak = acceptReading(streak, .95, second);
  }
  expect(streak.won).toBe(true);

  // Replaying identical settled words after audio stops cannot extend a streak.
  let quiet = acceptReading(emptyStreak(), .99, 12);
  for (let second = 13; second <= 25; second++) {
    state = observeTurn(state, info, second);
    const evidence = recentEvidence([settledTranscript(state, second)], second);
    if (evidence.enough) quiet = acceptReading(quiet, .99, 12);
    expect(quiet.won).toBe(false);
  }
  expect(quiet.count).toBe(1);

  const changed = { ...info, words: info.words.map((word, index) => index === info.words.length - 3 ? { ...word, word: 'actually' } : word) };
  const before = settledTranscript(state, 13);
  const correction = settledTranscript(observeTurn(state, changed, 13), 13);
  expect(upsertSegment([before], correction, 13).corrected).toBe(true);
  expect(upsertSegment([before], correction, 13).revised).toBe(true);
});
