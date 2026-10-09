import { expect, test } from 'bun:test';
import { calibrate, scoreChecks } from './cases';
import type { Result } from './provider';

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
