// The closeout evaluator binds the host's plan and injected decision model.
import * as engine from '../../interview-engine/interview/conversation/evaluate.server';
import { createDecisionJudge } from '../../interview-engine/providers/decisionJudge.server';
import type { Passage } from '../../interview-engine/shared/transcript';
import { spec } from '../../interviews/project-closeout/spec';

export type { InterviewAnswers } from '../../interview-engine/interview/conversation/evaluate.server';
type Input = {
  planId: string;
  voiceId: string;
  transcript: Passage[];
  revision: number;
  apiKey: string;
  signal?: AbortSignal;
};

export const readInterviewAnswers = (transcript: Passage[], answers: engine.InterviewAnswers) =>
  engine.readInterviewAnswers(spec, transcript, answers);
export const dialogueState = (entries: Passage[]) => engine.dialogueState(entries);

export async function evaluateInterview(input: Input) {
  if (input.planId !== spec.id || !spec.interviewer.voices.some(item => item.id === input.voiceId)) throw new Error('Unknown interview setup.');
  if (!input.apiKey.trim()) throw new Error('Interview judging is not configured.');
  return engine.evaluateInterview({ spec, passages: input.transcript, revision: input.revision, signal: input.signal }, createDecisionJudge({ apiKey: input.apiKey }));
}
