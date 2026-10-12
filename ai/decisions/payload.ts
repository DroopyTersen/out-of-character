import type { Experimental_EvaluationQuestion } from 'ai';
import type { Request } from '../../interview-engine/providers/decisionJudge.server';

export type Format = 'literal' | 'readable' | 'dialogue';

const readable = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(readable).join('\n');
  if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key}: ${readable(item)}`).join('\n');
  return String(value);
};

/** Presentation experiments feed the production adapter, including its response validation. */
export function evaluationRequest(request: Request, format: Format): Request {
  if (format === 'literal') return request;
  if (format === 'dialogue') {
    const state = request.state;
    const dialogue = typeof state === 'object' && state !== null && 'dialogue' in state ? state.dialogue : null;
    if (Array.isArray(dialogue) && Object.keys(state).length === 2
      && dialogue.every(row => Array.isArray(row) && row.length === 3 && row.every(value => typeof value === 'string'))) {
      return { ...request, state: dialogue.map(row => `[${JSON.stringify(row[0])}] ${row[1]}: ${JSON.stringify(row[2])}`).join('\n') };
    }
    return request;
  }
  const questions: Record<string, Experimental_EvaluationQuestion> = {};
  for (const [name, question] of Object.entries(request.questions)) {
    const instructions = readable(question.instructions);
    if (question.type === 'score') questions[name] = { ...question, instructions, criteria: question.criteria.map(item => item == null ? item : readable(item)) };
    else questions[name] = { ...question, instructions, ...(question.criteria ? {
      criteria: Object.fromEntries(Object.entries(question.criteria).map(([key, item]) => [key, item == null ? item : readable(item)])),
    } : {}) };
  }
  return { ...request, questions };
}
