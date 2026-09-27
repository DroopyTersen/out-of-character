import { createTypeSafeAi } from '@ai-sdk/typesafe-ai';
import { experimental_evaluate, type Experimental_EvaluationAnswer, type Experimental_EvaluationQuestion } from 'ai';
import { JEV_MODEL } from '../judging';
import { emptyInterviewReadings, interviewReadings, type InterviewEvaluation } from '../../core/interview';
import { findEvidence, TRANSCRIPT_LIMIT, transcriptCharacters } from '../../core/simulator/state';
import type { TranscriptEntry } from '../../core/simulator/types';
import { INTERVIEW_CONDITIONS, type DirectorSignal } from '../../core/simulator/director';
import { evidenceBatches } from '../simulator/rubric';
import { interviewScenario, interviewers } from './scenario.server';
import { interviewQuestions, interviewerQuestions } from './rubric';

type Answer = Experimental_EvaluationAnswer<Experimental_EvaluationQuestion>;
export type InterviewAnswers = Record<string, Answer>;
type Input = {
  scenarioId: string;
  clientId: string;
  transcript: TranscriptEntry[];
  revision: number;
  apiKey: string;
  signal?: AbortSignal;
  achievedIds?: string[];
};

const validProbability = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;

function booleanProbability(answers: InterviewAnswers, id: string): number {
  const answer = answers[id];
  if (answer?.type !== 'boolean' || !validProbability(answer.probability)) throw new Error('Invalid interview boolean judgment.');
  return answer.probability;
}

function score(answers: InterviewAnswers, id: string) {
  const answer = answers[id];
  if (answer?.type !== 'score' || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > 4) throw new Error('Invalid interview score judgment.');
  return answer;
}

function choice(answers: InterviewAnswers, id: string, options: string[]) {
  const answer = answers[id];
  if (answer?.type !== 'choice' || !options.includes(answer.choice)) throw new Error('Invalid interview selection.');
  return answer;
}

function evidence(answers: InterviewAnswers, key: string, participant: TranscriptEntry[]) {
  let selected: { id: string; probability: number } | null = null;
  evidenceBatches(participant).forEach((batch, index) => {
    const answer = choice(answers, index ? `${key}:${index}` : key, ['none', ...batch.map(entry => entry.id)]);
    if (answer.choice === 'none') return;
    const probability = answer.probabilities?.[answer.choice] ?? 0;
    if (!selected || probability > selected.probability) selected = { id: answer.choice, probability };
  });
  // The chosen ID must still resolve to a real participant passage. Jev never supplies quotation text.
  if (!selected) return null;
  const passage = findEvidence(participant, (selected as { id: string }).id);
  return passage && !/^(?:mm+|hmm+|uh[- ]?huh|yeah|yep|yes|no|right|okay|ok|sure)[.!?]*$/i.test(passage.text.trim()) ? passage : null;
}

export function readInterviewAnswers(transcript: TranscriptEntry[], answers: InterviewAnswers, achievedIds: string[] = []): Pick<InterviewEvaluation, 'readings' | 'objectives'> {
  const participant = transcript.filter(entry => entry.speaker === 'trainee');
  const readings = emptyInterviewReadings();
  for (const reading of interviewReadings) {
    const observed = booleanProbability(answers, `reading:${reading.id}:observable`) >= .8;
    const value = score(answers, `reading:${reading.id}`);
    const passage = evidence(answers, `reading:${reading.id}:evidence`, participant);
    if (observed && passage) readings[reading.id] = { value: value.score, distribution: value.probabilities ?? null, evidence: passage };
  }
  const objectives = interviewScenario.objectives.map(objective => {
    if (achievedIds.includes(objective.id)) return { id: objective.id, probability: null, achieved: true, evidence: null };
    const probability = booleanProbability(answers, `objective:${objective.id}`);
    const passage = evidence(answers, `objective:${objective.id}:evidence`, participant);
    const achieved = probability >= .85 && passage != null;
    return { id: objective.id, probability, achieved, evidence: achieved ? passage : null };
  });
  return { readings, objectives };
}

function validate(input: Input) {
  if (input.scenarioId !== interviewScenario.id || !interviewers.some(item => item.id === input.clientId)) throw new Error('Unknown interview setup.');
  if (!input.apiKey.trim()) throw new Error('Interview judging is not configured.');
  if (!input.transcript.length || input.transcript.length > TRANSCRIPT_LIMIT.entries || transcriptCharacters(input.transcript) > TRANSCRIPT_LIMIT.characters) throw new Error('Transcript is outside the interview limit.');
  if (new Set(input.transcript.map(entry => entry.id)).size !== input.transcript.length) throw new Error('Transcript passage IDs must be unique.');
}

/** Preserve recent passage IDs while keeping a Jev request bounded as an interview grows. */
function recentTranscript(entries: TranscriptEntry[], characterLimit: number): TranscriptEntry[] {
  let length = 0;
  let start = entries.length;
  while (start > 0 && length + entries[start - 1]!.text.length <= characterLimit) {
    start--;
    length += entries[start]!.text.length;
  }
  return entries.slice(start);
}

function state(entries: TranscriptEntry[]) {
  return { dialogueColumns: ['id', 'speaker', 'text'], dialogue: entries.map(({ id, speaker, text }) => [id, speaker === 'trainee' ? 'participant' : 'sam', text]) };
}

export async function evaluateInterview(input: Input) {
  validate(input);
  const started = performance.now();
  const transcript = recentTranscript(input.transcript, 16_000);
  const result = await experimental_evaluate({
    model: createTypeSafeAi({ apiKey: input.apiKey }).evaluationModel(JEV_MODEL),
    state: state(transcript), questions: interviewQuestions(transcript, input.achievedIds),
    abortSignal: input.signal, maxRetries: 0,
  });
  return {
    ...readInterviewAnswers(transcript, result.answers, input.achievedIds),
    revision: input.revision, model: result.response.modelId,
    durationMs: Math.round(performance.now() - started), usage: result.usage, answers: result.answers,
  };
}

export function readInterviewerSignals(answers: InterviewAnswers): DirectorSignal[] {
  return INTERVIEW_CONDITIONS.map(condition => ({ condition, probability: booleanProbability(answers, `director:${condition}`) }));
}

export async function evaluateInterviewer(input: Input) {
  validate(input);
  const started = performance.now();
  const result = await experimental_evaluate({
    model: createTypeSafeAi({ apiKey: input.apiKey }).evaluationModel(JEV_MODEL),
    state: state(recentTranscript(input.transcript, 12_000)), questions: interviewerQuestions(),
    abortSignal: input.signal, maxRetries: 0,
  });
  return { signals: readInterviewerSignals(result.answers), revision: input.revision, model: result.response.modelId,
    durationMs: Math.round(performance.now() - started), usage: result.usage, answers: result.answers };
}
