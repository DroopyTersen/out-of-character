import { createTypeSafeAi } from '@ai-sdk/typesafe-ai';
import type { Experimental_EvaluationModel } from 'ai';

/** The host binds the model and its calibrated action thresholds as one judge. */
export type Judge = {
  model: Experimental_EvaluationModel;
  thresholds: { silenceContinue: number; coverageExplored: number };
};

/** The one Jev version: the interview and the practice simulator both judge with it. */
export const JEV_MODEL = 'jev-1.13.0';

/** Jev on TypeSafe. The key is read when a call is made, so a host without one can build providers it never judges with. */
export const judgeModel = (options: { apiKey?: string; fetch?: typeof fetch }) =>
  createTypeSafeAi({ apiKey: options.apiKey, fetch: options.fetch }).evaluationModel(JEV_MODEL);

export function createJevJudge(options: Parameters<typeof judgeModel>[0]): Judge {
  return { model: judgeModel(options), thresholds: { silenceContinue: .85, coverageExplored: .85 } };
}

/** Splits passages into the batches one evaluation question can offer as choices. An empty transcript is one empty batch. */
export function evidenceBatches<T>(entries: T[]): T[][] {
  if (!entries.length) return [[]];
  const batches: T[][] = [];
  for (let start = 0; start < entries.length; start += 254) batches.push(entries.slice(start, start + 254));
  return batches;
}
