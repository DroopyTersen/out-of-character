import { expect, test } from 'bun:test';
import { skills } from '../../core/simulator/types';
import { evaluateTraineeQuestionGroups, readTraineeAnswers, shouldPartitionTraineeQuestions } from './evaluate.server';
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
    result[`objective:${id}:evidence`] = { type: 'choice', choice: id === 'capability' ? 'p2' : 'p3' };
  }
  return result;
}
test('feedback quotes source text and leaves unavailable or uncited evidence unscored', () => {
  const transcript = simulatorFixtures[0]!.transcript;
  const raw = answers();
  raw['skill:adaptability:observable'] = { type: 'boolean', probability: .1 };
  raw['skill:rapport:observable'] = { type: 'boolean', probability: .1 };
  raw['objective:impact:evidence'] = { type: 'choice', choice: 'none' };
  raw['objective:capability:evidence'] = { type: 'choice', choice: 'none' };
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
  raw['objective:stakeholder:evidence'] = { type: 'choice', choice: 'none' };
  raw['objective:next-step:evidence'] = { type: 'choice', choice: 'none' };
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
  raw['objective:stakeholder:evidence'] = { type: 'choice', choice: 'p2' };
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
test('long conversations cover every eligible passage in bounded evidence batches', () => {
  const transcript = Array.from({ length: 800 }, (_, index) => ({
    id: `p${index + 1}`, speaker: index % 2 ? 'trainee' as const : 'client' as const,
    text: `Passage ${index + 1}`, startMs: index * 1000, endMs: index * 1000 + 500,
  }));
  const questions = traineeQuestions(getScenario('demo'), transcript);
  for (const [id, question] of Object.entries(questions)) {
    if (!/:evidence(?::\d+)?$/.test(id) || question.type !== 'choice') continue;
    expect(Object.keys(question.criteria ?? {}).length).toBeLessThanOrEqual(255);
  }
  const covered = (prefix: string) => Object.entries(questions)
    .filter(([id]) => id === prefix || id.startsWith(`${prefix}:`))
    .flatMap(([, question]) => question.type === 'choice' ? Object.keys(question.criteria ?? {}).filter(id => id !== 'none') : []);
  expect(covered('objective:stakes:evidence')).toEqual(transcript.filter(entry => entry.speaker === 'client').map(entry => entry.id));
  expect(covered('skill:guidance:evidence')).toEqual(transcript.filter(entry => entry.speaker === 'trainee').map(entry => entry.id));
  for (const key of ['skill:guidance:evidence', 'skill:guidance:evidence:1']) {
    const question = questions[key];
    expect(question?.type === 'choice' && Object.keys(question.criteria ?? {})).toContain('none');
  }
});
test('single-batch skill evidence preserves a required quote unless no trainee spoke', () => {
  const short = traineeQuestions(getScenario('sharepoint'), simulatorFixtures[0]!.transcript)['skill:guidance:evidence'];
  const empty = traineeQuestions(getScenario('sharepoint'), [{ id: 'p1', speaker: 'client', text: 'Hello.', startMs: 0, endMs: 500 }])['skill:guidance:evidence'];
  expect(short?.type === 'choice' && Object.keys(short.criteria ?? {})).not.toContain('none');
  expect(empty?.type === 'choice' && Object.keys(empty.criteria ?? {})).toEqual(['none']);
});
test('a final evaluation can cite qualifying middle passages missed by an earlier grade', () => {
  const transcript = Array.from({ length: 720 }, (_, index) => ({
    id: `p${index + 1}`, speaker: 'client' as const,
    text: index === 50 ? 'I thought the prototype used our real inspection records.' : index === 599 ? 'Thursday decides whether to fund work that ends inspectors entering notes twice.' : `Other discussion ${index + 1}.`,
    startMs: index * 1000, endMs: index * 1000 + 500,
  }));
  const questions = traineeQuestions(getScenario('demo'), transcript);
  const raw: Parameters<typeof readTraineeAnswers>[2] = {};
  for (const [id, question] of Object.entries(questions)) {
    raw[id] = question.type === 'boolean' ? { type: 'boolean', probability: .01 }
      : question.type === 'score' ? { type: 'score', score: 2 }
      : { type: 'choice', choice: 'none' };
  }
  raw['objective:assumption'] = { type: 'boolean', probability: .99 };
  raw['objective:stakes'] = { type: 'boolean', probability: .99 };
  raw['objective:assumption:evidence'] = { type: 'choice', choice: 'p51' };
  raw['objective:stakes:evidence:2'] = { type: 'choice', choice: 'p600' };
  const result = readTraineeAnswers(getScenario('demo'), transcript, raw);
  expect(result.objectives.find(item => item.id === 'assumption')?.evidence?.entryId).toBe('p51');
  expect(result.objectives.find(item => item.id === 'stakes')?.evidence?.entryId).toBe('p600');
  expect(result.objectives.find(item => item.id === 'reframe')?.achieved).toBe(false);
  raw['objective:assumption:evidence'] = { type: 'choice', choice: 'p51', probabilities: { p51: .4 } };
  raw['objective:assumption:evidence:2'] = { type: 'choice', choice: 'p600', probabilities: { p600: .8 } };
  expect(readTraineeAnswers(getScenario('demo'), transcript, raw).objectives.find(item => item.id === 'assumption')?.evidence?.entryId).toBe('p600');
  raw['objective:assumption:evidence:2'] = { type: 'choice', choice: 'p600', probabilities: { p600: 2 } };
  expect(() => readTraineeAnswers(getScenario('demo'), transcript, raw)).toThrow();
});
test('one-call grading requires both passage and character limits', () => {
  const transcript = Array.from({ length: 128 }, (_, index) => ({
    id: `p${index + 1}`, speaker: 'trainee' as const, text: 'x'.repeat(index < 32 ? 157 : 156),
    startMs: index * 1000, endMs: index * 1000 + 500,
  }));
  expect(shouldPartitionTraineeQuestions(transcript)).toBe(false);
  expect(shouldPartitionTraineeQuestions([...transcript, { id: 'p129', speaker: 'client', text: 'Hi', startMs: 128_000, endMs: 128_500 }])).toBe(true);
  expect(shouldPartitionTraineeQuestions([{ ...transcript[0]!, text: transcript[0]!.text + 'x' }, ...transcript.slice(1)])).toBe(true);
});
test('long grades cover every question once, merge answers and usage, and propagate a failed part', async () => {
  const transcript = Array.from({ length: 800 }, (_, index) => ({
    id: `p${index + 1}`, speaker: index % 2 ? 'trainee' as const : 'client' as const,
    text: `Passage ${index + 1}`, startMs: index * 1000, endMs: index * 1000 + 500,
  }));
  const questions = traineeQuestions(getScenario('demo'), transcript);
  const calls: string[][] = [];
  const run: Parameters<typeof evaluateTraineeQuestionGroups>[2] = async part => {
    const ids = Object.keys(part);
    calls.push(ids);
    return {
      answers: Object.fromEntries(Object.entries(part).map(([id, question]) => [id,
        question.type === 'boolean' ? { type: 'boolean', probability: .5 }
          : question.type === 'score' ? { type: 'score', score: 2 }
            : { type: 'choice', choice: Object.keys(question.criteria)[0]! },
      ])),
      usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13 }, response: { modelId: 'fixture' },
    };
  };
  const result = await evaluateTraineeQuestionGroups(questions, true, run);
  expect(calls.length).toBeGreaterThan(1);
  expect(calls.every(ids => ids.length <= 12)).toBe(true);
  expect(calls.flat()).toEqual(Object.keys(questions));
  expect(Object.keys(result.answers)).toEqual(Object.keys(questions));
  expect(result.usage).toEqual({ inputTokens: calls.length * 10, outputTokens: calls.length * 3, totalTokens: calls.length * 13 });
  const shortCalls: string[][] = [];
  await evaluateTraineeQuestionGroups(questions, false, async part => { shortCalls.push(Object.keys(part)); return run(part); });
  expect(shortCalls).toEqual([Object.keys(questions)]);
  await expect(evaluateTraineeQuestionGroups(questions, true, async part => {
    if (Object.keys(part).includes(calls[1]![0]!)) throw new Error('Provider part failed');
    return run(part);
  })).rejects.toThrow('Provider part failed');
  const siblingSignals: AbortSignal[] = [];
  await expect(evaluateTraineeQuestionGroups(questions, true, async (part, signal) => {
    if (!signal) throw new Error('Missing child signal');
    siblingSignals.push(signal);
    if (Object.keys(part).includes(calls[1]![0]!)) throw new Error('Provider part failed');
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('Sibling cancelled')), { once: true }));
  })).rejects.toThrow('Provider part failed');
  expect(siblingSignals.length).toBe(Math.ceil(Object.keys(questions).length / 12));
  expect(siblingSignals.every(signal => signal.aborted)).toBe(true);
  const parent = new AbortController();
  const pending = evaluateTraineeQuestionGroups(questions, true, async (_part, signal) => new Promise((_, reject) => {
    signal?.addEventListener('abort', () => reject(new Error('Parent cancelled')), { once: true });
  }), parent.signal);
  parent.abort();
  await expect(pending).rejects.toThrow('Parent cancelled');
});
