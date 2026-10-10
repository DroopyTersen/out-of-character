import type { Experimental_EvaluationModel } from 'ai';

/** The host binds the model and its calibrated action thresholds as one judge. */
export type Judge = {
  model: Experimental_EvaluationModel;
  thresholds: { silenceContinue: number; coverageExplored: number; novelInformation?: number; interviewFeedback?: number };
};

/** The judge a provider set carries when the host configured none: narrative-only callers never reach it. */
export function unconfiguredJudge(): Judge {
  const fail = () => { throw new Error('Interview judging is not configured.'); };
  return { thresholds: { silenceContinue: 1, coverageExplored: 1 }, model: {
    specificationVersion: 'v4', provider: 'none', modelId: 'unconfigured', supportedQuestionTypes: ['boolean', 'choice', 'score'],
    doEvaluate: async () => fail(),
  } };
}

/** Splits passages into the batches one evaluation question can offer as choices. An empty transcript is one empty batch. */
export function evidenceBatches<T>(entries: T[]): T[][] {
  if (!entries.length) return [[]];
  const batches: T[][] = [];
  for (let start = 0; start < entries.length; start += 254) batches.push(entries.slice(start, start + 254));
  return batches;
}
