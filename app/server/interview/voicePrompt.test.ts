import { expect, test } from 'bun:test';
import { conversationSoFar, getClient, getScenario, resumeInstruction } from '../../../ai/simulator/scenarios.server';
import { INTERVIEW_SCENARIO_ID, INTERVIEWER_NAME } from '../../../core/interview';
import * as engine from '../../../interview-engine/interview/session/voice.prompt';
import { NO_EXTERNAL_TASK } from '../simulator/live.server';

// The engine's session sends the voice model the same resume and delegation text as the practice simulator's session.
const transcript = [
  { id: 'p1', speaker: 'client' as const, text: 'What did the team deliver?', startMs: 0, endMs: 900 },
  { id: 'p2', speaker: 'trainee' as const, text: 'A claims portal. '.repeat(30), startMs: 1000, endMs: 4000 },
  { id: 'p3', speaker: 'client' as const, text: '  ', startMs: 4100, endMs: 4200 },
  { id: 'p4', speaker: 'trainee' as const, text: 'And the access requests took weeks.', startMs: 4300, endMs: 6000 },
];
const long = Array.from({ length: 400 }, (_, index) => ({ id: `q${index}`, speaker: index % 2 ? 'trainee' as const : 'client' as const, text: `Passage ${index} `.repeat(20), startMs: index * 1000, endMs: index * 1000 + 900 }));
const scenario = getScenario(INTERVIEW_SCENARIO_ID);
const sam = getClient('sam-cedar');

test('the resumed conversation and the resume cue match the practice simulator’s for the interview', () => {
  expect(engine.NO_EXTERNAL_TASK).toBe(NO_EXTERNAL_TASK);
  for (const entries of [transcript, long, transcript.slice(0, 1)]) {
    expect(engine.conversationSoFar(INTERVIEWER_NAME, entries)).toBe(conversationSoFar(scenario, sam, entries));
    for (const pausedMs of [5000, 300_000]) expect(engine.resumeInstruction(INTERVIEWER_NAME, entries, pausedMs)).toBe(resumeInstruction(scenario, sam, entries, pausedMs));
  }
});
