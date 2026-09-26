import { expect, test } from 'bun:test';
import { skills } from '../../core/simulator/types';
import { readTraineeAnswers } from './evaluate.server';
import { actorBrief, getClient, getClientCues, getScenario, scenarios } from './scenarios.server';
import { simulatorFixtures } from './fixtures';
import { simulatorChallenges } from './challenge-fixtures';
import { clientQuestions, traineeQuestions } from './rubric';

// Only the paid, probabilistic provider result is substituted. Parsing, public
// evidence projection, and outcome eligibility use the production implementation.
function answers() {
  const result: Parameters<typeof readTraineeAnswers>[2] = { mistake: { type: 'boolean', probability: .01 }, hint: { type: 'choice', choice: 'problem' } };
  for (const skill of skills) {
    result[`skill:${skill.id}:observable`] = { type: 'boolean', probability: .95 };
    result[`skill:${skill.id}`] = { type: 'score', score: 3.1 };
    result[`skill:${skill.id}:evidence`] = { type: 'choice', choice: 'p2' };
  }
  for (const id of ['problem', 'impact', 'stakeholder', 'capability', 'next-step']) {
    result[`objective:${id}`] = { type: 'boolean', probability: .99 };
    result[`objective:${id}:evidence`] = { type: 'choice', choice: 'p3' };
  }
  return result;
}
test('feedback quotes source text and leaves unavailable or wrong-speaker evidence unscored', () => {
  const transcript = simulatorFixtures[0]!.transcript;
  const raw = answers();
  raw['skill:adaptability:observable'] = { type: 'boolean', probability: .1 };
  raw['skill:rapport:evidence'] = { type: 'choice', choice: 'p3' };
  raw['objective:impact:evidence'] = { type: 'choice', choice: 'none' };
  const result = readTraineeAnswers(getScenario('sharepoint'), transcript, raw);
  expect(result.skills.listening.evidence?.text).toBe('Understood. Before we get into solutions, who owns the process that is giving you trouble?');
  expect(result.skills.adaptability.value).toBeNull();
  expect(result.skills.rapport.value).toBeNull();
  expect(result.objectives.find(item => item.id === 'capability')!.achieved).toBe(false);
  expect(result.objectives.find(item => item.id === 'impact')!.achieved).toBe(false);
  expect(result.hint).toBeNull();
});
test('an independent bounded agreement can coexist with a concern about another claim', () => {
  const raw = answers();
  raw.mistake = { type: 'boolean', probability: .99 };
  raw['objective:next-step:evidence'] = { type: 'choice', choice: 'p5' };
  const transcript = simulatorChallenges.find(item => item.id === 'challenge-independent-agreement')!.transcript;
  const result = readTraineeAnswers(getScenario('sharepoint'), transcript, raw);
  expect(result.objectives.find(item => item.id === 'next-step')!.achieved).toBe(true);
  expect(result.objectives.find(item => item.id === 'next-step')!.evidence?.text).toBe(transcript[4]!.text);
  expect(result.concern).not.toBeNull();
  // The agreement still needs its own positive judgment; a concern grants no credit.
  raw['objective:next-step'] = { type: 'boolean', probability: .1 };
  expect(readTraineeAnswers(getScenario('sharepoint'), transcript, raw).objectives.find(item => item.id === 'next-step')!.achieved).toBe(false);
});
test('a trainee proposal cannot supply client agreement or a discovered fact, and latched goals cannot hint again', () => {
  const raw = answers();
  raw['objective:stakeholder:evidence'] = { type: 'choice', choice: 'p2' };
  raw['objective:next-step:evidence'] = { type: 'choice', choice: 'p2' };
  raw['objective:problem'] = { type: 'boolean', probability: .1 };
  const result = readTraineeAnswers(getScenario('sharepoint'), simulatorFixtures[0]!.transcript, raw, ['problem']);
  expect(result.objectives.find(item => item.id === 'stakeholder')!.achieved).toBe(false);
  expect(result.objectives.find(item => item.id === 'next-step')!.achieved).toBe(false);
  expect(result.hint).toBeNull();
});
test('malformed probabilities and invented evidence IDs fail closed', () => {
  const raw = answers();
  raw['objective:stakeholder'] = { type: 'boolean', probability: 2 };
  expect(() => readTraineeAnswers(getScenario('sharepoint'), simulatorFixtures[0]!.transcript, raw)).toThrow();
  raw['objective:stakeholder'] = { type: 'boolean', probability: .9 };
  raw['objective:stakeholder:evidence'] = { type: 'choice', choice: 'invented quote' };
  expect(() => readTraineeAnswers(getScenario('sharepoint'), simulatorFixtures[0]!.transcript, raw)).toThrow();
});
test('the actor receives client context without trainee-only briefing or lead', () => {
  for (const scenario of scenarios) {
    const brief = actorBrief(scenario, getClient('harper'));
    expect(brief).toContain(scenario.opening);
    for (const fact of scenario.facts) expect(brief).toContain(fact);
    for (const limit of scenario.constraints) expect(brief).toContain(limit);
    expect(brief).not.toContain(scenario.lead);
    for (const line of scenario.briefing ?? []) expect(brief).not.toContain(line);
  }
});
test('the shared ownership cue is available to the judge for scored scenes only', () => {
  for (const scenario of scenarios) {
    const cues = getClientCues(scenario);
    const question = clientQuestions(scenario).cue;
    expect(question?.type).toBe('choice');
    if (question?.type === 'choice') expect(Object.keys(question.criteria ?? {})).toEqual(['no_hint', ...cues.map(cue => cue.id)]);
    expect(cues.some(cue => cue.id === 'consultant-ownership')).toBe(scenario.objectives.length > 0);
  }
});
test('long conversations keep evidence choices within provider limits and preserve cited facts', () => {
  const transcript = Array.from({ length: 800 }, (_, index) => ({
    id: `p${index + 1}`, speaker: index % 2 ? 'trainee' as const : 'client' as const,
    text: `Passage ${index + 1}`, startMs: index * 1000, endMs: index * 1000 + 500,
  }));
  const questions = traineeQuestions(getScenario('demo'), transcript, [], ['p51']);
  for (const [id, question] of Object.entries(questions)) {
    if (!id.endsWith(':evidence') || question.type !== 'choice') continue;
    expect(Object.keys(question.criteria ?? {}).length).toBeLessThanOrEqual(255);
  }
  const stakes = questions['objective:stakes:evidence'];
  expect(stakes?.type).toBe('choice');
  if (stakes?.type === 'choice') {
    expect(Object.keys(stakes.criteria ?? {})).toContain('p51');
    expect(Object.keys(stakes.criteria ?? {})).toContain('p799');
  }
});
