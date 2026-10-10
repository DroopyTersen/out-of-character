import { expect, test } from 'bun:test';
import type { Experimental_EvaluationModel, Experimental_EvaluationQuestion } from 'ai';
import { createJevJudge } from '../../providers/jevJudge.server';
import { createDecisionJudge, type Fetch } from '../../providers/decisionJudge.server';
import { foundryProviders } from '../../providers/providers.server';
import { testFoundry } from '../../providers/testFoundry.server';
import type { Passage } from '../../shared/transcript';
import { dialogueState, evaluateInterview, readInterviewAnswers, type InterviewAnswers } from './evaluate.server';
import { interviewQuestions, type JudgedSpec } from './rubric.prompt';
import { testFraming } from './testSpec';

const spec = {
  interviewer: { name: 'Riley' },
  framing: testFraming,
  topics: [{ objectives: [
    { id: 'scope', label: 'Scope', criterion: 'Names what was built.' },
    { id: 'role', label: 'Role', criterion: 'Names their own work. Only their own work counts.' },
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
    return [id, { type: 'choice', choice: /^objective:[^:]+$/.test(id) ? 'not-yet' : 'none' }];
  })) as InterviewAnswers;
}

test('the questions come from the spec, and only participant passages are evidence choices', () => {
  const questions = interviewQuestions(spec, passages);
  expect(Object.keys(questions)).toEqual(['objective:scope', 'objective:scope:evidence', 'objective:role', 'objective:role:evidence']);
  expect(questions['objective:scope']).toMatchObject({ instructions: { task: 'How far has the participant covered this test topic? Names what was built.' } });
  expect(questions['objective:role']).toMatchObject({ instructions: { task: 'How far has the participant covered this test topic? Names their own work. Only their own work counts.' } });
  const evidence = questions['objective:scope:evidence'];
  if (evidence?.type !== 'choice') throw new Error('Expected a choice.');
  expect(Object.keys(evidence.criteria ?? {})).toEqual(['none', 'p2', 'p4']);
  expect(questions['objective:scope']).toMatchObject({ instructions: { party: 'TEST PARTY' } });
  expect(JSON.stringify(evidence.instructions)).toContain('Speakers are participant and riley (the interviewer); client means the test customer.');
  expect(JSON.stringify(evidence.instructions)).toContain('Do not select Riley’s wording');
});

test('answers become coverage; a backchannel is never evidence', () => {
  const answers = answersFor(interviewQuestions(spec, passages));
  answers['objective:scope'] = { type: 'choice', choice: 'explored', probabilities: { explored: .9 } };
  answers['objective:scope:evidence'] = { type: 'choice', choice: 'p2' };
  answers['objective:role'] = { type: 'choice', choice: 'explored', probabilities: { explored: .99 } };
  answers['objective:role:evidence'] = { type: 'choice', choice: 'p4' };
  expect(() => readInterviewAnswers(spec, passages, { ...answers, 'objective:scope:evidence': { type: 'choice', choice: 'p9' } })).toThrow('Invalid interview selection: objective:scope:evidence');
  const result = readInterviewAnswers(spec, passages, answers);
  expect(result.objectives.map(item => [item.id, item.level, item.evidence?.entryId ?? null])).toEqual([['scope', 'explored', 'p2'], ['role', 'not-yet', null]]);
});

test('Jev sees participant and the spec’s interviewer, and the grade runs on the judge it is given', async () => {
  expect(dialogueState(passages).dialogue.map(row => row[1])).toEqual(['interviewer', 'participant', 'interviewer', 'participant']);
  expect(dialogueState(passages, 'sam').dialogue.map(row => row[1])).toEqual(['sam', 'participant', 'sam', 'participant']);
  const calls: unknown[] = [];
  const model: Experimental_EvaluationModel = {
    specificationVersion: 'v4', provider: 'test', modelId: 'jev-test', supportedQuestionTypes: ['choice', 'score', 'boolean'],
    async doEvaluate(options) {
      calls.push(options.state);
      return { answers: answersFor(options.questions as Record<string, Experimental_EvaluationQuestion>), warnings: [], response: { modelId: 'jev-test' } };
    },
  };
  const judge = { model, thresholds: { silenceContinue: .85, coverageExplored: .85 } };
  const result = await evaluateInterview({ spec, passages, revision: 4 }, { judge });
  expect(calls).toEqual([dialogueState(passages, 'riley')]);
  expect(result).toMatchObject({ revision: 4, model: 'jev-test' });
  expect(result.objectives.every(item => item.level === 'not-yet')).toBe(true);
  await expect(evaluateInterview({ spec, passages: [], revision: 1 }, judge)).rejects.toThrow('Transcript is outside the interview limit.');
  await expect(evaluateInterview({ spec, passages: [passages[1]!, passages[1]!], revision: 1 }, judge)).rejects.toThrow('Transcript passage IDs must be unique.');
});

test('host-selected judges apply their coverage calibration without changing raw probabilities or evidence rules', async () => {
  // Only paid HTTP is replaced; both provider adapters, the SDK and the grade reader run normally.
  const answers = answersFor(interviewQuestions(spec, passages));
  answers['objective:scope'] = { type: 'choice', choice: 'explored', probabilities: { 'not-yet': 0, touched: .25, explored: .75, 'set-aside': 0 } };
  answers['objective:scope:evidence'] = { type: 'choice', choice: 'p2', probabilities: { none: 0, p2: 1, p4: 0 } };
  answers['objective:role'] = { type: 'choice', choice: 'explored', probabilities: { 'not-yet': 0, touched: .1, explored: .9, 'set-aside': 0 } };
  answers['objective:role:evidence'] = { type: 'choice', choice: 'p4', probabilities: { none: 0, p2: 0, p4: 1 } };
  const request: Fetch = async url => {
    if (String(url).includes('typesafe.ai')) return Response.json({ model: 'jev-1.13.0', answers });
    return Response.json({ model: 'gpt-6-luna', usage: { input_tokens: 100, output_tokens: 0 }, answers: [
      ...Object.entries(answers).filter(([, answer]) => answer.type === 'choice').map(([name, answer]) => {
        if (answer.type !== 'choice') throw new Error('Expected choice');
        const options = name.endsWith(':evidence') ? ['none', 'p2', 'p4'] : ['not-yet', 'touched', 'explored', 'set-aside'];
        return { name, type: 'choice', choice: answer.choice, confidence: 1,
          probabilities: options.map(value => ({ value, probability: answer.probabilities?.[value] ?? (answer.choice === value ? 1 : 0) })) };
      }),
    ] });
  };
  const jev = createJevJudge({ apiKey: 'fixture', fetch: request as typeof fetch });
  const decisions = createDecisionJudge({ apiKey: 'fixture', fetch: request });
  for (const [judge, expected] of [[jev, 'touched'], [decisions, 'explored']] as const) {
    const providers = foundryProviders({ ...testFoundry, judge });
    const result = await evaluateInterview({ spec, passages, revision: 1 }, providers);
    expect(result.objectives.map(item => [item.id, item.level, item.evidence?.entryId ?? null])).toEqual([
      ['scope', expected, 'p2'], ['role', 'not-yet', null],
    ]);
    expect(result.answers['objective:scope']).toMatchObject({ probabilities: { explored: .75 } });
  }
});

test('conditional relevance needs participant evidence and is distinct from coverage depth', () => {
  const conditional: JudgedSpec = { ...spec, topics: [{ objectives: [{ id: 'handoff', label: 'Handoff', criterion: 'Describe the access handoff.', appliesWhen: 'The participant handled access.' }] }] };
  const answers: InterviewAnswers = {
    'objective:handoff': { type: 'choice', choice: 'explored', probabilities: { explored: .99 } },
    'objective:handoff:evidence': { type: 'choice', choice: 'p2', probabilities: { p2: .99 } },
    'objective:handoff:applicability': { type: 'choice', choice: 'applicable', probabilities: { applicable: .95 } },
    'objective:handoff:applicability-evidence': { type: 'choice', choice: 'p2', probabilities: { p2: .99 } },
  };
  const read = () => readInterviewAnswers(conditional, passages, answers).objectives[0]!;
  expect(read()).toMatchObject({ applicability: 'applicable', level: 'explored', achieved: true, applicabilityEvidence: { entryId: 'p2', speaker: 'participant' } });
  answers['objective:handoff:applicability'] = { type: 'choice', choice: 'not-applicable', probabilities: { 'not-applicable': .95 } };
  expect(read()).toMatchObject({ applicability: 'not-applicable', level: 'not-yet', achieved: false, evidence: null, applicabilityEvidence: { entryId: 'p2' } });
  answers['objective:handoff:applicability-evidence'] = { type: 'choice', choice: 'none' };
  expect(read()).toMatchObject({ applicability: 'unknown', achieved: false, applicabilityEvidence: null });
  answers['objective:handoff:applicability-evidence'] = { type: 'choice', choice: 'p4' }; // A bare acknowledgment does not establish relevance.
  expect(read()).toMatchObject({ applicability: 'unknown', achieved: false, applicabilityEvidence: null });
});
