import { expect, test } from 'bun:test';
import { experimental_evaluate } from 'ai';
import { decisionsModel, decisionPayload, type Model } from './provider';

const questions = {
  visible: { type: 'boolean', instructions: { task: 'Is damage visible?', rule: 'Ignore packaging.' }, criteria: { true: 'The item is broken.', false: 'The item is intact.' } },
  route: { type: 'choice', instructions: 'Route the item.', criteria: { repair: 'Broken.', keep: 'Intact.' } },
  severity: { type: 'score', instructions: 'How severe?', criteria: ['Intact', 'Cosmetic', 'Broken'] },
} as const;
const raw = { model: 'gpt-6-luna', usage: { input_tokens: 100, output_tokens: 0 }, answers: [
  { type: 'score', name: 'severity', score: 1.1, confidence: .55, probabilities: [{ value: 0, label: '0', probability: .1 }, { value: 1, label: '1', probability: .7 }, { value: 2, label: '2', probability: .2 }] },
  { type: 'predicate', name: 'visible', probability: .8 },
  { type: 'choice', name: 'route', choice: 'repair', confidence: .6, probabilities: [{ value: 'repair', probability: .8 }, { value: 'keep', probability: .2 }] },
] };
const call = (body: unknown, selected = questions) => experimental_evaluate({ state: 'case', questions: selected,
  model: decisionsModel({ apiKey: 'test', fetch: async () => Response.json(body) }), maxRetries: 0 });

test('real SDK accepts named out-of-order answers, probability and a nonuniform weighted score', async () => {
  const result = await call(raw);
  expect(result.answers.visible).toEqual({ type: 'boolean', probability: .8 });
  expect(result.answers.route.choice).toBe('repair');
  expect(result.answers.severity.score).toBeCloseTo(1.1);
  expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 0, totalTokens: 100 });
});

test('translation retains structured instructions, both predicate criteria and score order', () => {
  const payload = decisionPayload({ state: { transcript: 'Evidence' }, questions }, 'literal');
  expect(payload.input).toBe('{"transcript":"Evidence"}');
  const predicate = payload.questions.find(q => q.name === 'visible')!;
  expect(predicate.instructions).toContain('Ignore packaging.');
  expect(predicate.instructions).toContain('The item is broken.');
  expect(predicate.instructions).toContain('The item is intact.');
  expect(payload.questions.find(q => q.name === 'severity')).toMatchObject({ levels: [{ label: '0', description: 'Intact' }, { label: '1', description: 'Cosmetic' }, { label: '2', description: 'Broken' }] });
});

test('dialogue rendering preserves every source ID, speaker and quoted text, retaining other state when present', () => {
  const state = { dialogueColumns: ['id', 'speaker', 'text'], dialogue: [['p1', 'participant', 'Yes.\nThen “no”.'], ['p2', 'sam', 'Why?']] };
  const payload = decisionPayload({ state, questions }, 'dialogue');
  expect(payload.input).toBe('["p1"] participant: "Yes.\\nThen “no”."\n["p2"] sam: "Why?"');
  expect(decisionPayload({ state: { ...state, earlierDialogueOmitted: true }, questions }, 'dialogue').input).toContain('"earlierDialogueOmitted":true');
});

test.each(['refusal', 'missing', 'duplicate', 'unknown', 'bad-sum', 'wrong-mean', 'wrong-option', 'duplicate-option'])('rejects %s without fabricating an answer', async failure => {
  const changed = structuredClone(raw) as any;
  if (failure === 'refusal') changed.answers[0] = { type: 'refusal', name: 'severity' };
  if (failure === 'missing') changed.answers.pop();
  if (failure === 'duplicate') changed.answers[2] = changed.answers[1];
  if (failure === 'unknown') changed.answers[1].name = 'other';
  if (failure === 'bad-sum') changed.answers[0].probabilities[0].probability = .6;
  if (failure === 'wrong-mean') changed.answers[0].score = 1.9;
  if (failure === 'wrong-option') changed.answers[2].choice = 'other';
  if (failure === 'duplicate-option') changed.answers[2].probabilities[1].value = 'repair';
  await expect(call(changed)).rejects.toThrow();
});

test('singleton evidence is deterministic while presence is still evaluated; abort prevents dispatch', async () => {
  let requests = 0;
  const model = decisionsModel({ apiKey: 'test', fetch: (async (_, init) => {
    requests++;
    const body = JSON.parse(String(init?.body));
    expect(body.questions.map((x: { name: string }) => x.name)).toEqual(['exists']);
    return Response.json({ model: 'gpt-6-luna', usage: { input_tokens: 30, output_tokens: 0 }, answers: [{ type: 'predicate', name: 'exists', probability: .02 }] });
  }) as typeof fetch });
  const request = { state: 'unrelated', questions: { exists: { type: 'boolean', instructions: 'Evidence exists?' }, where: { type: 'choice', instructions: 'Where?', criteria: { p1: null } } } } as const;
  const result = await experimental_evaluate({ ...request, model, maxRetries: 0 });
  expect(result.answers.exists.probability).toBe(.02);
  expect(result.answers.where.choice).toBe('p1');
  await expect(experimental_evaluate({ ...request, model, maxRetries: 0, abortSignal: AbortSignal.abort() })).rejects.toThrow();
  expect(requests).toBe(1);
});

test('HTTP failure is surfaced and never retried by the adapter', async () => {
  let requests = 0;
  const model: Model = decisionsModel({ apiKey: 'test', fetch: async () => { requests++; return new Response('', { status: 429 }); } });
  await expect(experimental_evaluate({ model, state: 'case', questions, maxRetries: 0 })).rejects.toThrow('429');
  expect(requests).toBe(1);
});
