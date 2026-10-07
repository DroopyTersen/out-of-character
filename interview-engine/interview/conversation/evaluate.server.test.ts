import { expect, test } from 'bun:test';
import type { Experimental_EvaluationModel, Experimental_EvaluationQuestion } from 'ai';
import type { Passage } from '../../shared/transcript';
import { dialogueState, evaluateInterview, readInterviewAnswers, type InterviewAnswers } from './evaluate.server';
import { interviewQuestions, type JudgedSpec } from './rubric.prompt';

const criteria = ['zero', 'one', 'two', 'three', 'four'] as const;
const spec = {
  readings: [{ id: 'specificity', label: 'Specificity', description: 'Concrete detail.', rubric: { task: 'How concrete?', criteria } }],
  topics: [{ objectives: [
    { id: 'scope', label: 'Scope', criterion: 'Names what was built.' },
    { id: 'role', label: 'Role', criterion: 'Names their own work.', creditRule: 'Only their own work counts.', explored: 'They state their own work.' },
  ] }],
} satisfies JudgedSpec;
const passages: Passage[] = [
  { id: 'p1', speaker: 'interviewer', text: 'What did you build?', startMs: 0, endMs: 1000 },
  { id: 'p2', speaker: 'participant', text: 'A claims portal for the adjusters.', startMs: 1500, endMs: 4000 },
  { id: 'p3', speaker: 'interviewer', text: 'And your part?', startMs: 4500, endMs: 5000 },
  { id: 'p4', speaker: 'participant', text: 'Mm-hmm.', startMs: 5500, endMs: 6000 },
];

function answersFor(questions: Record<string, Experimental_EvaluationQuestion>): InterviewAnswers {
  return Object.fromEntries(Object.entries(questions).map(([id, question]) => {
    if (question.type === 'boolean') return [id, { type: 'boolean', probability: .02 }];
    if (question.type === 'score') return [id, { type: 'score', score: 2 }];
    return [id, { type: 'choice', choice: /^objective:[^:]+$/.test(id) ? 'not-yet' : 'none' }];
  })) as InterviewAnswers;
}

test('the questions come from the spec, and only participant passages are evidence choices', () => {
  const questions = interviewQuestions(spec, passages);
  expect(Object.keys(questions)).toEqual(['reading:specificity:observable', 'reading:specificity', 'reading:specificity:evidence',
    'objective:scope', 'objective:scope:evidence', 'objective:role', 'objective:role:evidence']);
  expect(questions['reading:specificity']).toMatchObject({ type: 'score', instructions: { task: 'How concrete?' }, criteria: [...criteria] });
  expect(questions['objective:scope']).toMatchObject({ instructions: { task: 'How far has the participant covered this closeout topic? Names what was built.' } });
  expect(questions['objective:role']).toMatchObject({ instructions: { task: 'How far has the participant covered this closeout topic? Names their own work. Only their own work counts.' }, criteria: { explored: 'They state their own work.' } });
  const evidence = questions['objective:scope:evidence'];
  if (evidence?.type !== 'choice') throw new Error('Expected a choice.');
  expect(Object.keys(evidence.criteria ?? {})).toEqual(['none', 'p2', 'p4']);
});

test('answers become readings and coverage; a backchannel is never evidence', () => {
  const answers = answersFor(interviewQuestions(spec, passages));
  answers['reading:specificity:observable'] = { type: 'boolean', probability: .9 };
  answers['reading:specificity'] = { type: 'score', score: 3 };
  answers['reading:specificity:evidence'] = { type: 'choice', choice: 'p2' };
  answers['objective:scope'] = { type: 'choice', choice: 'explored', probabilities: { explored: .9 } };
  answers['objective:scope:evidence'] = { type: 'choice', choice: 'p2' };
  answers['objective:role'] = { type: 'choice', choice: 'explored', probabilities: { explored: .99 } };
  answers['objective:role:evidence'] = { type: 'choice', choice: 'p4' };
  const result = readInterviewAnswers(spec, passages, answers);
  expect(result.readings.specificity).toEqual({ value: 3, distribution: null, evidence: { entryId: 'p2', speaker: 'participant', text: passages[1]!.text } });
  expect(result.objectives.map(item => [item.id, item.level, item.evidence?.entryId ?? null])).toEqual([['scope', 'explored', 'p2'], ['role', 'not-yet', null]]);
});

test('Jev sees participant and sam, and the grade runs on the judge it is given', async () => {
  expect(dialogueState(passages).dialogue.map(row => row[1])).toEqual(['sam', 'participant', 'sam', 'participant']);
  const calls: unknown[] = [];
  const judge: Experimental_EvaluationModel = {
    specificationVersion: 'v4', provider: 'test', modelId: 'jev-test', supportedQuestionTypes: ['choice', 'score', 'boolean'],
    async doEvaluate(options) {
      calls.push(options.state);
      return { answers: answersFor(options.questions as Record<string, Experimental_EvaluationQuestion>), warnings: [], response: { modelId: 'jev-test' } };
    },
  };
  const result = await evaluateInterview({ spec, passages, revision: 4 }, { judge });
  expect(calls).toEqual([dialogueState(passages)]);
  expect(result).toMatchObject({ revision: 4, model: 'jev-test', readings: { specificity: { value: null } } });
  expect(result.objectives.every(item => item.level === 'not-yet')).toBe(true);
  await expect(evaluateInterview({ spec, passages: [], revision: 1 }, judge)).rejects.toThrow('Transcript is outside the interview limit.');
  await expect(evaluateInterview({ spec, passages: [passages[1]!, passages[1]!], revision: 1 }, judge)).rejects.toThrow('Transcript passage IDs must be unique.');
});
