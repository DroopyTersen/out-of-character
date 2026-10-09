import { expect, test } from 'bun:test';
import { INTERVIEWER_NAME } from '../../../core/interview';
import * as engine from '../../../interview-engine/interview/session/voice.prompt';
import { NO_EXTERNAL_TASK } from '../simulator/live.server';

// The engine's session sends the voice model the same resume and delegation text the practice simulator's session sent
// for the interview. Those texts are frozen as digests from the practice simulator before its interview dispatch was removed (Phase 5).
const transcript = [
  { id: 'p1', speaker: 'interviewer' as const, text: 'What did the team deliver?', startMs: 0, endMs: 900 },
  { id: 'p2', speaker: 'participant' as const, text: 'A claims portal. '.repeat(30), startMs: 1000, endMs: 4000 },
  { id: 'p3', speaker: 'interviewer' as const, text: '  ', startMs: 4100, endMs: 4200 },
  { id: 'p4', speaker: 'participant' as const, text: 'And the access requests took weeks.', startMs: 4300, endMs: 6000 },
];
const long = Array.from({ length: 400 }, (_, index) => ({ id: `q${index}`, speaker: index % 2 ? 'participant' as const : 'interviewer' as const, text: `Passage ${index} `.repeat(20), startMs: index * 1000, endMs: index * 1000 + 900 }));
const frozen: Record<string, string> = {
  'conversation short': '74d1627e919bb010aab59aad6468de39558c3580f7b3fd76274450f528a93729',
  'resume short 5000': 'e793701ef36c871974f671d91f39292f40ca09e58c1d22373c59a17d65189b0b',
  'resume short 300000': 'bf1b2f76e2e54bf1e67eb54385970d41add4efe4f0cad968d5f62d5722ba1eff',
  'conversation long': '941c509284de4c077396897c97e885b2526ffe58988d2362d1875fe4bb390328',
  'resume long 5000': 'a99b954db94db0073b6c89118cf56f3630da94f86ac0e21578dae4546d8827e4',
  'resume long 300000': '641ebee5723d6850a2d6150d5fce70eaca564bb6bffe8e90d815e31c86d596d4',
  'conversation first': 'dccb455ebbcf287cbdadf5d7b61f2844717983a0f4c327411103f8db19d390e5',
  'resume first 5000': '9dabaf5ab8bb4577b8bacf719671ef98eb945dc1c299f2e3a5f79fb0014a8985',
  'resume first 300000': 'c641b840b2846bca672305204d587844de8843da250b9528a6953fa7c48ab317',
};
const digest = (text: string) => new Bun.CryptoHasher('sha256').update(text).digest('hex');

test('the resumed conversation and the resume cue match the practice simulator’s for the interview', () => {
  expect(engine.NO_EXTERNAL_TASK).toBe(NO_EXTERNAL_TASK);
  expect(engine.conversationSoFar(INTERVIEWER_NAME, transcript)).toContain('the participant');
  for (const [name, entries] of [['short', transcript], ['long', long], ['first', transcript.slice(0, 1)]] as const) {
    expect(digest(engine.conversationSoFar(INTERVIEWER_NAME, entries))).toBe(frozen[`conversation ${name}`]!);
    for (const pausedMs of [5000, 300_000]) expect(digest(engine.resumeInstruction(INTERVIEWER_NAME, entries, pausedMs))).toBe(frozen[`resume ${name} ${pausedMs}`]!);
  }
});
