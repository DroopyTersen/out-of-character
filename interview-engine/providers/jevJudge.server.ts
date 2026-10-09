import { createTypeSafeAi } from '@ai-sdk/typesafe-ai';
import type { Judge } from './judge.server';

/** The one Jev version: the practice simulator and the evaluation arms judge with it. */
export const JEV_MODEL = 'jev-1.13.0';

/** Jev on TypeSafe. The key is read when a call is made, so a host without one can build providers it never judges with. */
export const judgeModel = (options: { apiKey?: string; fetch?: typeof fetch }) =>
  createTypeSafeAi({ apiKey: options.apiKey, fetch: options.fetch }).evaluationModel(JEV_MODEL);

export function createJevJudge(options: Parameters<typeof judgeModel>[0]): Judge {
  return { model: judgeModel(options), thresholds: { silenceContinue: .85, coverageExplored: .85 } };
}
