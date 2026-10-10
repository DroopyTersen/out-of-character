import { expect, test } from 'bun:test';
import { calibrate, interpret, scoreChecks, type EvalCase } from './cases';
import type { Result } from '../../interview-engine/providers/decisionJudge.server';
import { emptyMap } from '../../interview-engine/interview/conversation/map';

test('frozen legacy participant turns still produce a wake decision without changing the saved input', () => {
  const transcript = [
    { id: 'p1', speaker: 'client', text: 'What changed?', startMs: 0, endMs: 1000 },
    { id: 'p2', speaker: 'trainee', text: 'The release moved to Friday.', startMs: 1000, endMs: 2000 },
  ];
  const item: EvalCase = { id: 'legacy-turn', lane: 'turn', split: 'development', source: 'synthetic',
    state: 'Frozen API state', questions: {}, deadlineMs: 3000, checks: [], map: emptyMap(), atMs: 2000,
    transcript: transcript as unknown as EvalCase['transcript'] };
  const output = interpret(item, { new: { type: 'boolean', probability: .92 }, feedback: { type: 'boolean', probability: .1 } });
  expect(output).toMatchObject({ passageId: 'p2', focus: null, new: true, feedbackNew: false, wakeCandidate: true });
  expect(item.transcript[1]?.speaker as string).toBe('trainee');
  expect(item.state).toBe('Frozen API state');
});

test('calibration credits a selected supported answer, retaining missing evidence and boundaries', () => {
  const answers: Result['answers'] = {
    'objective:purpose': { type: 'choice', choice: 'explored', probabilities: { explored: .7, touched: .3 } },
    'objective:access': { type: 'choice', choice: 'explored', probabilities: { explored: .9, touched: .1 } },
    'objective:boundary': { type: 'choice', choice: 'set-aside', probabilities: { 'set-aside': .8, explored: .2 } },
  };
  const output = { objectives: {
    purpose: { level: 'touched', achieved: false, evidence: { entryId: 'p4', speaker: 'participant' } },
    access: { level: 'not-yet', achieved: false, evidence: null },
    boundary: { level: 'set-aside', achieved: false, evidence: { entryId: 'p6', speaker: 'participant' } },
  } };
  const result = calibrate({ lane: 'grade' }, answers, output, { silence: .7, explored: .5 });
  expect(result.objectives).toEqual({ ...output.objectives, purpose: { ...output.objectives.purpose, level: 'explored', achieved: true } });
  expect(output.objectives.purpose.achieved).toBe(false);
  expect(answers['objective:purpose']).toMatchObject({ probabilities: { explored: .7, touched: .3 } });
});

test('missing evidence never passes a numeric reading check through null coercion', () => {
  const checks = scoreChecks([{ name: 'observed low specificity', path: ['value'], op: 'lt', expected: 2 }], { value: null });
  expect(checks[0]?.pass).toBe(false);
});

test('turn calibration preserves states and composes independent project and interview signals', () => {
  const raw = { novel: .75, feedback: .2, new: false, feedbackNew: false, wakeCandidate: false, states: { delivery: 'open' } };
  const calibrated = calibrate({ lane: 'turn' }, {}, raw, { silence: .9, explored: .5, novel: .7 });
  expect(calibrated).toMatchObject({ new: true, feedbackNew: false, wakeCandidate: true, states: { delivery: 'open' }, novel: .75, feedback: .2 });
  expect(raw.wakeCandidate).toBe(false);
  const interview = calibrate({ lane: 'turn' }, {}, { ...raw, novel: .1, feedback: .85 }, { silence: .9, explored: .5, novel: .7 });
  expect(interview).toMatchObject({ new: false, feedbackNew: true, wakeCandidate: true });
});

test('independent criterion satisfaction can credit supported touched coverage but cannot erase a boundary or invent support', () => {
  const answers: Result['answers'] = Object.fromEntries(['touched', 'missing', 'declined'].map(id => [`objective:${id}:satisfied`, { type: 'boolean' as const, probability: .95 }]));
  const output = { objectives: {
    touched: { level: 'touched', achieved: false, evidence: { entryId: 'p2' } },
    missing: { level: 'not-yet', achieved: false, evidence: null },
    declined: { level: 'set-aside', achieved: false, evidence: { entryId: 'p4' } },
  } };
  const result = calibrate({ lane: 'grade' }, answers, output, { silence: .9, explored: .5, satisfied: .9 });
  expect(result.objectives).toEqual({ ...output.objectives, touched: { ...output.objectives.touched, level: 'explored', achieved: true } });
  expect(output.objectives.touched.achieved).toBe(false);
});
