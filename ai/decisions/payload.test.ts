import { expect, test } from 'bun:test';
import { experimental_evaluate } from 'ai';
import { decisionPayload, decisionsModel } from '../../interview-engine/providers/decisionJudge.server';
import { evaluationRequest } from './payload';

const state = { dialogueColumns: ['id', 'speaker', 'text'], dialogue: [['p1', 'participant', 'Yes.\nThen “no”.'], ['p2', 'sam', 'Why?']] };
const questions = {
  visible: { type: 'boolean', instructions: { task: 'Is damage visible?', rules: ['Ignore packaging.', 'Use the dialogue.'] },
    criteria: { true: { evidence: 'The item is broken.' }, false: 'The item is intact.' } },
  route: { type: 'choice', instructions: 'Route the item.', criteria: { repair: { condition: 'Broken.' }, keep: null } },
  severity: { type: 'score', instructions: 'How severe?', criteria: ['Intact', { condition: 'Cosmetic' }, null] },
} as const;

test('literal comparison retains the canonical production request', () => {
  expect(decisionPayload(evaluationRequest({ state, questions }, 'literal'))).toEqual({
    model: 'gpt-6-luna', input: JSON.stringify(state), questions: [
      { name: 'visible', type: 'predicate', instructions: '{"task":"Is damage visible?","rules":["Ignore packaging.","Use the dialogue."]}\nTrue criteria: {"evidence":"The item is broken."}\nFalse criteria: The item is intact.' },
      { name: 'route', type: 'choice', instructions: 'Route the item.', choices: [{ value: 'repair', description: '{"condition":"Broken."}' }, { value: 'keep' }] },
      { name: 'severity', type: 'score', instructions: 'How severe?', levels: [{ label: '0', description: 'Intact' }, { label: '1', description: '{"condition":"Cosmetic"}' }, { label: '2' }] },
    ],
  });
});

test('readable comparison changes rubric presentation while retaining all evidence and option order', () => {
  expect(decisionPayload(evaluationRequest({ state, questions }, 'readable'))).toEqual({
    model: 'gpt-6-luna', input: JSON.stringify(state), questions: [
      { name: 'visible', type: 'predicate', instructions: 'task: Is damage visible?\nrules: Ignore packaging.\nUse the dialogue.\nTrue criteria: evidence: The item is broken.\nFalse criteria: The item is intact.' },
      { name: 'route', type: 'choice', instructions: 'Route the item.', choices: [{ value: 'repair', description: 'condition: Broken.' }, { value: 'keep' }] },
      { name: 'severity', type: 'score', instructions: 'How severe?', levels: [{ label: '0', description: 'Intact' }, { label: '1', description: 'condition: Cosmetic' }, { label: '2' }] },
    ],
  });
});

test('dialogue comparison preserves source IDs, speakers and quoted text, retaining other state when present', () => {
  const payload = decisionPayload(evaluationRequest({ state, questions }, 'dialogue'));
  expect(payload.input).toBe('["p1"] participant: "Yes.\\nThen “no”."\n["p2"] sam: "Why?"');
  expect(payload.questions).toEqual(decisionPayload({ state, questions }).questions);
  const extra = { ...state, earlierDialogueOmitted: true };
  expect(decisionPayload(evaluationRequest({ state: extra, questions }, 'dialogue')).input).toBe(JSON.stringify(extra));
});

test.each(['literal', 'readable', 'dialogue'] as const)('%s comparison uses the production response contract and singleton evidence behavior', async format => {
  let requests = 0;
  const request = evaluationRequest({ state, questions: {
    exists: { type: 'boolean', instructions: { task: 'Evidence exists?' } },
    where: { type: 'choice', instructions: 'Where?', criteria: { p1: null } },
  } }, format);
  const model = decisionsModel({ apiKey: 'test', fetch: async (_, init) => {
    requests++;
    expect(JSON.parse(String(init?.body)).questions.map((item: { name: string }) => item.name)).toEqual(['exists']);
    return Response.json({ model: 'gpt-6-luna', usage: { input_tokens: 30, output_tokens: 0 },
      answers: requests === 1 ? [{ type: 'predicate', name: 'exists', probability: .02 }] : [] });
  } });
  const result = await experimental_evaluate({ ...request, model, maxRetries: 0 });
  expect(result.answers.exists).toEqual({ type: 'boolean', probability: .02 });
  expect(result.answers.where).toEqual({ type: 'choice', choice: 'p1', probabilities: { p1: 1 } });
  await expect(experimental_evaluate({ ...request, model, maxRetries: 0 })).rejects.toThrow('contract');
});
