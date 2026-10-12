import type { Experimental_EvaluationModel, Experimental_EvaluationAnswer, Experimental_EvaluationQuestion } from 'ai';

type EvaluationRequest = Parameters<Exclude<Experimental_EvaluationModel, string>['doEvaluate']>[0];
type JudgePassage = { id: string; speaker: string; text: string };

/** Domain input for a host's calibrated recipe. Other providers keep the ordinary state and questions unchanged. */
export type InterviewJudgeInput =
  | { purpose: 'turn'; scope: { earlierDialogue: JudgePassage[]; latestParticipantTurn: JudgePassage[]; precedingInterviewer: JudgePassage | null; earlierDialogueOmitted: boolean };
      feedback: { id: string; latest: { speaker: string; text: string }[]; savedPreferences: { text: string; passageId: string }[] }; states: string[] }
  | { purpose: 'coverage'; participantText: Record<string, string>; objectives: Record<string, { topic: string; criterion: string }>; coverageEvidenceQuestions: string[] }
  | { purpose: 'silence' };

export function interviewJudgeOptions(input: InterviewJudgeInput): NonNullable<EvaluationRequest['providerOptions']> {
  return { interviewJudge: input };
}

/** Internal SDK boundary: only the typed interview builders populate this provider namespace. */
export function readInterviewJudgeInput(request: EvaluationRequest): InterviewJudgeInput | undefined {
  return request.providerOptions?.interviewJudge as InterviewJudgeInput | undefined;
}

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

/** Checked answers shared by topic and conversation-turn judgments. */
type Answer = Experimental_EvaluationAnswer<Experimental_EvaluationQuestion>;
export type JudgeAnswers = Record<string, Answer>;

export function choice<T extends string>(answers: JudgeAnswers, id: string, options: readonly T[]) {
  const answer = answers[id];
  if (answer?.type !== 'choice' || !options.includes(answer.choice as T)) throw new Error(`Invalid interview selection: ${id}`);
  return answer as typeof answer & { choice: T };
}
