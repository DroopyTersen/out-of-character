// The closeout evaluator binds the host's plan and injected decision model.
import * as engine from '../../interview-engine/interview/grading/judgeTopicCoverage.server';
import { createDecisionJudge } from '../../interview-engine/providers/decisionJudge.server';
import { dialogueState as renderDialogue, type Passage } from '../../interview-engine/shared/transcript';
import type { JudgeAnswers } from '../../interview-engine/providers/judgeProvider.server';
import { spec } from '../../interviews/project-closeout/spec';

export type { JudgeAnswers } from '../../interview-engine/providers/judgeProvider.server';
type Input = {
  planId: string;
  voiceId: string;
  transcript: Passage[];
  revision: number;
  apiKey: string;
  signal?: AbortSignal;
};

export const readTopicCoverage = (transcript: Passage[], answers: JudgeAnswers) =>
  engine.readTopicCoverage(spec, transcript, answers);
export const dialogueState = (entries: Passage[]) => renderDialogue(entries);

export async function judgeTopicCoverage(input: Input) {
  if (input.planId !== spec.id || !spec.interviewer.voices.some(item => item.id === input.voiceId)) throw new Error('Unknown interview setup.');
  if (!input.apiKey.trim()) throw new Error('Interview judging is not configured.');
  return engine.judgeTopicCoverage({ spec, passages: input.transcript, revision: input.revision, signal: input.signal }, createDecisionJudge({ apiKey: input.apiKey }));
}
