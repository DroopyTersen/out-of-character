import { expect, test } from 'bun:test';
import { askedIn, classify, measure, named, unusable } from './interview-delivery-measures.mjs';

const spoken = 'Near the end there was a launch approval step we had to plan around. We waited three weeks for VPN access.';
const note = 'Thread note. Supersedes earlier thread notes.\nAsk next: “So who actually made the final call to launch, and what did they need to see first?”';

test('a turn asks about the one thread its questions name', () => {
  expect(classify('Three weeks for VPN, ouch. Who gave the green light?')).toMatchObject({ asked: 'target', unclear: false });
  expect(classify('So after access cleared, you handed the pipeline to Priya. What made that handoff work?')).toMatchObject({ asked: 'priya', unclear: false });
  expect(classify('A three-week VPN wait is brutal. When it came time to actually launch, who had to say, “Yep, we’re going live”?').asked).toBe('target');
  expect(classify('Who approved launch? Anyway, that pipeline handoff sounds smooth.').asked).toBe('target');
  expect(classify('I’m guessing that three-week stall rippled through everything?').asked).toBe('vpn');
  expect(classify('So... who signed off?').asked).toBe('target');
});

test('a question naming no thread, or several, is unclear; a turn with no question asks nothing', () => {
  expect(classify('The launch approval sounds settled. What happened next?')).toMatchObject({ asked: null, unclear: true });
  expect(classify('Oh. Three weeks for VPN access. What did that break for you early on?')).toMatchObject({ asked: null, unclear: true });
  expect(classify('Did the VPN wait push the launch?')).toMatchObject({ asked: null, threads: ['target', 'vpn'], unclear: true });
  expect(classify('Three weeks for VPN? Who made the final call to launch?')).toMatchObject({ asked: null, unclear: true });
  expect(classify('Sure. Thanks for talking it through.')).toMatchObject({ question: null, asked: null, unclear: false });
  expect(named('Who approved it, after the VPN wait?')).toEqual(['vpn', 'target']);
});

test('a hand label overrides the classified thread', () => {
  expect(askedIn({ text: 'What happened next?' })).toBeNull();
  expect(askedIn({ text: 'What happened next?', label: 'target' })).toBe('target');
  expect(askedIn({ text: 'Who approved launch?', label: 'other' })).toBe('other');
  expect(askedIn(undefined)).toBeNull();
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

test('a run is unusable unless it finished cleanly, both measured replies exist and the participant was heard', () => {
  const heard = [
    { speaker: 'trainee', text: 'Near the end there was a launch approval step. We waited three weeks for V.P.N. access. Priya took over the pipeline.' },
    { speaker: 'trainee', text: 'Honestly, that part was pretty routine.' },
  ];
  const report = { finalized: true, errors: [], deadAir: [], segments: [{ text: 'Who signed off?' }, { text: 'Fair enough. What about Priya?' }], transcript: heard };
  expect(unusable(report)).toBeNull();
  expect(unusable({ ...report, finalized: false })).toBe('not finalized');
  expect(unusable({ ...report, errors: ['Run deadline exceeded.'] })).toBe('errors');
  expect(unusable({ ...report, deadAir: [{ afterLine: 0 }] })).toBe('dead air');
  expect(unusable({ ...report, segments: [{ text: 'Who signed off?' }, { text: '' }] })).toBe('a measured reply is missing');
  expect(unusable({ ...report, transcript: heard.slice(0, 1) })).toBe('the participant was not heard');
});
