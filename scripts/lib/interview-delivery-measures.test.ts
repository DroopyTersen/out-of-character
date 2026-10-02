import { expect, test } from 'bun:test';
import { measure, named } from './interview-delivery-measures.mjs';

const spoken = 'Near the end there was a launch approval step we had to plan around. We waited three weeks for VPN access.';
const note = 'Thread note. Supersedes earlier thread notes.\nAsk next: “So who actually made the final call to launch, and what did they need to see first?”';

test('the thread Sam asks about is the last one the turn names', () => {
  expect(named('Three weeks for VPN, ouch. Who gave the green light?')).toEqual(['target', 'vpn']);
  expect(named('Oh. Three weeks for VPN access. That’s a lot. What did that break for you early on?')).toEqual(['vpn']);
  expect(named('So after access cleared, you handed the pipeline to Priya. What made that handoff work?')).toEqual(['priya', 'vpn']);
  expect(named('A three-week VPN wait is brutal. When it came time to actually launch, who had to say, “Yep, we’re going live”?')).toEqual(['target', 'vpn']);
  expect(measure('Sure. Thanks for talking it through.', note, spoken).asked).toBeNull();
});

test('parroting counts only note wording nobody said aloud', () => {
  const echo = measure('So who actually made the final call to launch?', note, spoken);
  expect(echo).toMatchObject({ asked: 'target', parroted: ['so who actually', 'who actually made', 'actually made the', 'made the final', 'the final call', 'final call to', 'call to launch'], parrotShare: 1 });
  // The header is not note content, and the participant's own words are not the note's.
  expect(measure('Thread note supersedes nothing. We waited three weeks, huh?', 'Thread note supersedes nothing.\nWe waited three weeks for VPN access.', spoken).parroted).toEqual([]);
  expect(measure('Who signed off on launch in the end?', note, spoken)).toMatchObject({ asked: 'target', parroted: [], leak: null });
});

test('a leak is a mention of the notes or the templates’ own wording', () => {
  expect(measure('My notes say to ask about launch.', note, spoken).leak).toBe('My notes');
  expect(measure('Worth pulling next: who approved launch?', note, spoken).leak).toBe('Worth pulling');
  expect(measure('What else is still unknown here?', note, spoken).leak).toBe('still unknown');
  expect(measure('Who made the call, notably?', note, spoken).leak).toBeNull();
});
