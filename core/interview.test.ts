import { expect, test } from 'bun:test';
import { asksToEnd, finishesTurn, yieldsTurn } from './interview';

test('finishesTurn is false for thinking sounds, hanging clauses and requests for time', () => {
  for (const text of ['Hmm.', 'Um', '[sniff]', 'tongue click', '', 'We moved the rollout and', 'The vendor, which', 'It was kind of',
    'So we had to wait for the board,', 'And then...', 'The schedule slipped because —', 'Let me think about that.', 'Hold on.', 'Give me a second.', 'One sec, I want to get this right.'])
    expect(finishesTurn(text), text).toBe(false);
});

test('finishesTurn is true for complete answers, questions and plain replies', () => {
  for (const text of ['We moved the rollout to March.', 'Yes.', 'No', 'What do you mean by handoff?', 'Priya ran the testing. [laughs]', 'That was it, really.'])
    expect(finishesTurn(text), text).toBe(true);
});

test('asksToEnd recognises requests to finish', () => {
  for (const text of ['Can we be done?', "Let's wrap up.", 'I need to go soon.', "I'm done, honestly.", 'Can we stop here?', 'Let’s call it there.'])
    expect(asksToEnd(text), text).toBe(true);
  for (const text of ['We were done with testing by May.', 'Dana had to stop the vendor work.', 'Keep going.'])
    expect(asksToEnd(text), text).toBe(false);
});

test('yieldsTurn treats short non-questions and go-aheads as handing back the floor', () => {
  expect(yieldsTurn('Mm-hmm.')).toBe(true);
  expect(yieldsTurn('Sorry, go ahead, I cut in there.')).toBe(true);
  expect(yieldsTurn('What happened next?')).toBe(false);
  expect(yieldsTurn('That makes sense, and it sounds like the board approval was the real constraint on the timeline.')).toBe(false);
});
