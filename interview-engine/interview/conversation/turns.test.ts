import { expect, test } from 'bun:test';
import { yieldsTurn } from './turns';

test('yieldsTurn treats short non-questions and go-aheads as handing back the floor', () => {
  expect(yieldsTurn('Mm-hmm.')).toBe(true);
  expect(yieldsTurn('Sorry, go ahead, I cut in there.')).toBe(true);
  expect(yieldsTurn('What happened next?')).toBe(false);
  expect(yieldsTurn('That makes sense, and it sounds like the board approval was the real constraint on the timeline.')).toBe(false);
});
