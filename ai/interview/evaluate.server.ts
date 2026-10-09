// The app's door to the engine's final grade: the closeout spec, Jev built from the key, and the practice simulator's speaker names.
import * as engine from '../../interview-engine/interview/conversation/evaluate.server';
import { createJevJudge } from '../../interview-engine/providers/judge.server';
import type { Evidence, Passage } from '../../interview-engine/shared/transcript';
import { spec } from '../../interviews/project-closeout/spec';
import type { InterviewEvaluation, InterviewObjectiveReading } from '../../core/interview';
import type { Speaker, TranscriptEntry } from '../../core/simulator/types';

export type { InterviewAnswers } from '../../interview-engine/interview/conversation/evaluate.server';
type Input = {
  scenarioId: string;
  clientId: string;
  transcript: TranscriptEntry[];
  revision: number;
  apiKey: string;
  signal?: AbortSignal;
};

const passages = (transcript: TranscriptEntry[]): Passage[] =>
  transcript.map(({ id, speaker, text, startMs, endMs }) => ({ id, speaker: speaker === 'trainee' ? 'participant' : 'interviewer', text, startMs, endMs }));
const evidence = (item: Evidence | null) => item && { ...item, speaker: (item.speaker === 'participant' ? 'trainee' : 'client') as Speaker };

function entryNames(result: Pick<ReturnType<typeof engine.readInterviewAnswers<typeof spec>>, 'readings' | 'objectives'>): Pick<InterviewEvaluation, 'readings' | 'objectives'> {
  return {
    readings: Object.fromEntries(Object.entries(result.readings).map(([id, reading]) => [id, { ...reading, evidence: evidence(reading.evidence) }])) as InterviewEvaluation['readings'],
    objectives: result.objectives.map((reading): InterviewObjectiveReading => ({ ...reading, evidence: evidence(reading.evidence) })),
  };
}

export const readInterviewAnswers = (transcript: TranscriptEntry[], answers: engine.InterviewAnswers) =>
  entryNames(engine.readInterviewAnswers(spec, passages(transcript), answers));

/** The dialogue as every Jev interview call sees it, rendered the same way each time. */
export const dialogueState = (entries: TranscriptEntry[]) => engine.dialogueState(passages(entries));

export async function evaluateInterview(input: Input) {
  if (input.scenarioId !== spec.id || !spec.interviewer.voices.some(item => item.id === input.clientId)) throw new Error('Unknown interview setup.');
  if (!input.apiKey.trim()) throw new Error('Interview judging is not configured.');
  const result = await engine.evaluateInterview({ spec, passages: passages(input.transcript), revision: input.revision, signal: input.signal }, createJevJudge({ apiKey: input.apiKey }));
  return { ...result, ...entryNames(result) };
}
