import { expect, test } from 'bun:test';
import type { Experimental_EvaluationModel } from 'ai';
import { evaluateInterview } from '../../interview-engine/interview/conversation/evaluate.server';
import type { Passage } from '../../interview-engine/shared/transcript';
import { spec } from './spec';

const passages: Passage[] = [
  { id: 'p1', speaker: 'interviewer', text: 'What did the project deliver, and who was the client?', startMs: 0, endMs: 4000 },
  { id: 'p2', speaker: 'participant', text: 'A dispatch app for a regional utility. I built the routing service.', startMs: 5000, endMs: 11_000 },
  { id: 'p3', speaker: 'interviewer', text: 'Who decided to start with routing?', startMs: 12_000, endMs: 14_000 },
  { id: 'p4', speaker: 'participant', text: 'Their ops director, after a bad storm season.', startMs: 15_000, endMs: 19_000 },
];

test('the judge receives only canonical spoken dialogue, with source identities intact', async () => {
  const states: unknown[] = [];
  const judge: Experimental_EvaluationModel = {
    specificationVersion: 'v4', provider: 'test', modelId: 'judge-test', supportedQuestionTypes: ['choice', 'score', 'boolean'],
    async doEvaluate(options) { states.push(options.state); throw new Error('captured paid boundary'); },
  };
  await expect(evaluateInterview({ spec, passages, revision: 1 }, { model: judge, thresholds: { silenceContinue: .85, coverageExplored: .85 } })).rejects.toThrow();
  expect(states).toEqual([{ dialogueColumns: ['id', 'speaker', 'text'], dialogue: [
    ['p1', 'sam', 'What did the project deliver, and who was the client?'],
    ['p2', 'participant', 'A dispatch app for a regional utility. I built the routing service.'],
    ['p3', 'sam', 'Who decided to start with routing?'],
    ['p4', 'participant', 'Their ops director, after a bad storm season.'],
  ] }]);
});
