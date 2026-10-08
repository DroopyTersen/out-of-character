import { expect, test } from 'bun:test';
import type { Experimental_EvaluationModel } from 'ai';
import { evaluateInterview } from '../../interview-engine/interview/conversation/evaluate.server';
import { mapInstructions, mapSeed } from '../../interview-engine/interview/conversation/map.prompt';
import { interviewQuestions } from '../../interview-engine/interview/conversation/rubric.prompt';
import { interviewerBrief, interviewOpening } from '../../interview-engine/interview/voice/brief.server';
import { NOTE_CHANNELS } from '../../interview-engine/interview/voice/channel';
import type { Passage } from '../../interview-engine/shared/transcript';
import { spec } from './spec';

// The closeout's rendered prompts, frozen. The engine builds them from the spec; moving wording between the two must
// not change a byte. A deliberate prompt change rewrites the fixture and bumps its version constant.

const fixture = (name: string) => Bun.file(new URL(`./fixtures/${name}`, import.meta.url)).text();
const passages: Passage[] = [
  { id: 'p1', speaker: 'interviewer', text: 'What did the project deliver, and who was the client?', startMs: 0, endMs: 4000 },
  { id: 'p2', speaker: 'participant', text: 'A dispatch app for a regional utility. I built the routing service.', startMs: 5000, endMs: 11_000 },
  { id: 'p3', speaker: 'interviewer', text: 'Who decided to start with routing?', startMs: 12_000, endMs: 14_000 },
  { id: 'p4', speaker: 'participant', text: 'Their ops director, after a bad storm season.', startMs: 15_000, endMs: 19_000 },
];

test('the brief and the opening for every voice and note channel are unchanged', async () => {
  for (const voice of spec.interviewer.voices) {
    for (const channel of NOTE_CHANNELS) expect(interviewerBrief(spec, voice.id, channel)).toBe(await fixture(`brief.${voice.id}.${channel}.txt`));
    expect(interviewOpening(spec, voice.id)).toBe(await fixture(`opening.${voice.id}.txt`));
  }
});

test('Sol’s instructions and seed are unchanged', async () => {
  expect(mapInstructions(spec)).toBe(await fixture('map-instructions.txt'));
  expect(mapSeed(spec)).toBe(await fixture('map-seed.txt'));
});

test('Jev’s final-grade questions and dialogue are unchanged', async () => {
  expect(JSON.stringify(interviewQuestions(spec, passages), null, 1)).toBe(await fixture('grade-questions.json'));
  const states: unknown[] = [];
  const judge: Experimental_EvaluationModel = {
    specificationVersion: 'v4', provider: 'test', modelId: 'jev-test', supportedQuestionTypes: ['choice', 'score', 'boolean'],
    async doEvaluate(options) { states.push(options.state); throw new Error('captured'); },
  };
  await expect(evaluateInterview({ spec, passages, revision: 1 }, judge)).rejects.toThrow();
  expect(JSON.stringify(states[0], null, 1)).toBe(await fixture('grade-state.json'));
});
