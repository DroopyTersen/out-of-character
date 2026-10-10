import type { Experimental_EvaluationModel, Experimental_EvaluationQuestion } from 'ai';
import { z } from 'zod';
import type { Judge } from './judge.server';

export type Model = Exclude<Experimental_EvaluationModel, string>;
export type Request = Parameters<Model['doEvaluate']>[0];
export type Result = Awaited<ReturnType<Model['doEvaluate']>>;
export type Fetch = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;
const DECISIONS_MODEL = 'gpt-6-luna';

export function createDecisionJudge(options: { apiKey?: string; fetch?: Fetch }): Judge {
  return { model: decisionsModel(options), thresholds: { silenceContinue: .7, coverageExplored: .5 } };
}

const probability = z.number().min(0).max(1);
const answerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('predicate'), name: z.string(), probability }),
  z.object({ type: z.literal('choice'), name: z.string(), choice: z.string(), confidence: probability,
    probabilities: z.array(z.object({ value: z.string(), probability })) }),
  z.object({ type: z.literal('score'), name: z.string(), score: z.number().finite(), confidence: probability,
    probabilities: z.array(z.object({ value: z.number().int().nonnegative(), label: z.string(), probability })) }),
  z.object({ type: z.literal('refusal'), name: z.string() }),
]);
const responseSchema = z.object({ model: z.string(), answers: z.array(answerSchema),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }) });

export class DecisionFailure extends Error {
  constructor(readonly category: 'http' | 'refusal' | 'contract', readonly status?: number) {
    super(`Decisions ${category}${status == null ? '' : ` (${status})`}`);
    this.name = 'DecisionFailure';
  }
}

const render = (value: unknown): string => typeof value === 'string' ? value : JSON.stringify(value);

export function decisionPayload(request: Request) {
  type Question = { name: string; type: string; instructions: string; choices?: { value: string; description?: string }[]; levels?: { label: string; description?: string }[] };
  const questions = Object.entries(request.questions).flatMap<Question>(([name, question]) => {
    const instructions = render(question.instructions);
    if (question.type === 'boolean') return [{ name, type: 'predicate', instructions: question.criteria
      ? `${instructions}\nTrue criteria: ${render(question.criteria.true ?? '')}\nFalse criteria: ${render(question.criteria.false ?? '')}` : instructions }];
    if (question.type === 'choice') {
      return [{ name, type: 'choice', instructions, choices: Object.entries(question.criteria).map(([value, description]) => ({ value,
        ...(description == null ? {} : { description: render(description) }) })) }];
    }
    return [{ name, type: 'score', instructions, levels: question.criteria.map((description, index) => ({ label: String(index),
      ...(description == null ? {} : { description: render(description) }) })) }];
  });
  return { model: DECISIONS_MODEL, input: render(request.state), questions };
}

function normalizeResponse(raw: unknown, questions: Request['questions']): Result {
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) throw new DecisionFailure('contract');
  const data = parsed.data;
  const expected = Object.keys(questions);
  if (data.answers.length !== expected.length || new Set(data.answers.map(item => item.name)).size !== expected.length) throw new DecisionFailure('contract');
  const answers: Result['answers'] = {};
  for (const answer of data.answers) {
    if (!Object.hasOwn(questions, answer.name)) throw new DecisionFailure('contract');
    if (answer.type === 'refusal') throw new DecisionFailure('refusal');
    if (answer.type === 'predicate') answers[answer.name] = { type: 'boolean', probability: answer.probability };
    else {
      const keys = answer.probabilities.map(item => String(item.value));
      if (new Set(keys).size !== keys.length) throw new DecisionFailure('contract');
      const probabilities = Object.fromEntries(answer.probabilities.map(item => [String(item.value), item.probability]));
      answers[answer.name] = answer.type === 'choice'
        ? { type: 'choice', choice: answer.choice, probabilities }
        : { type: 'score', score: answer.score, probabilities };
    }
  }
  // The installed AI SDK validates type, exact option coverage, sums and weighted scores without renormalizing.
  return { answers, warnings: [], usage: { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens },
    response: { modelId: data.model, body: raw } };
}

/** Resolve a one-option choice identically for both arms; existence/observability remains model-judged. */
export function singletons(model: Model): Model {
  return { specificationVersion: model.specificationVersion, provider: model.provider, modelId: model.modelId,
    supportedQuestionTypes: model.supportedQuestionTypes, async doEvaluate(request) {
    const fixed: Result['answers'] = {};
    const questions: Record<string, Experimental_EvaluationQuestion> = {};
    for (const [id, question] of Object.entries(request.questions)) {
      if (question.type === 'choice' && Object.keys(question.criteria).length === 1) {
        const choice = Object.keys(question.criteria)[0]!;
        fixed[id] = { type: 'choice', choice, probabilities: { [choice]: 1 } };
      } else questions[id] = question;
    }
    request.abortSignal?.throwIfAborted();
    const result = Object.keys(questions).length ? await model.doEvaluate({ ...request, questions })
      : { answers: {}, warnings: [], usage: { inputTokens: 0, outputTokens: 0 }, response: { modelId: model.modelId } } satisfies Result;
    return { ...result, answers: { ...result.answers, ...fixed } };
  } };
}

export function decisionsModel(options: { apiKey?: string; fetch?: Fetch }): Model {
  const request = options.fetch ?? fetch;
  return singletons({
    specificationVersion: 'v4', provider: 'openai.decisions', modelId: DECISIONS_MODEL,
    supportedQuestionTypes: ['boolean', 'choice', 'score'],
    async doEvaluate(input) {
      if (!options.apiKey) throw new Error('Interview judging is not configured.');
      const response = await request('https://api.openai.com/v1/decisions', { method: 'POST',
        headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(decisionPayload(input)), signal: input.abortSignal });
      if (!response.ok) throw new DecisionFailure('http', response.status);
      const result = normalizeResponse(await response.json(), input.questions);
      return { ...result, response: { ...result.response, id: response.headers.get('x-request-id') ?? undefined } };
    },
  });
}
