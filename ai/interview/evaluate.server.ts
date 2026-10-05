import { createTypeSafeAi } from '@ai-sdk/typesafe-ai';
import { experimental_evaluate, type Experimental_EvaluationAnswer, type Experimental_EvaluationQuestion } from 'ai';
import { JEV_MODEL } from '../judging';
import { COVERAGE_LEVELS, emptyInterviewReadings, interviewReadings, isBackchannel, type CoverageLevel, type InterviewEvaluation, type InterviewObjectiveReading } from '../../core/interview';
import { findEvidence, TRANSCRIPT_LIMIT, transcriptCharacters } from '../../core/simulator/state';
import type { TranscriptEntry } from '../../core/simulator/types';
import { evidenceBatches } from '../simulator/rubric';
import { interviewScenario, interviewers } from './scenario.server';
import { interviewQuestions } from './rubric';

type Answer = Experimental_EvaluationAnswer<Experimental_EvaluationQuestion>;
export type InterviewAnswers = Record<string, Answer>;
type Input = {
  scenarioId: string;
  clientId: string;
  transcript: TranscriptEntry[];
  revision: number;
  apiKey: string;
  signal?: AbortSignal;
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
  return passage && !isBackchannel(passage.text) ? passage : null;
}

function coverage(answers: InterviewAnswers, objectiveId: string, participant: TranscriptEntry[]): InterviewObjectiveReading {
  const answer = choice(answers, `objective:${objectiveId}`, [...COVERAGE_LEVELS]);
  const levels = answer.probabilities
    ? Object.fromEntries(COVERAGE_LEVELS.map(level => [level, validProbability(answer.probabilities![level] ?? NaN) ? answer.probabilities![level]! : 0])) as Record<CoverageLevel, number>
    : null;
  const passage = evidence(answers, `objective:${objectiveId}:evidence`, participant);
  let level = answer.choice as CoverageLevel;
  // Credit needs high confidence. Respect a supported boundary at even odds instead of inviting another probe.
  if (level !== 'not-yet' && !passage) level = 'not-yet';
  if (level === 'explored' && (levels?.explored ?? 0) < .85) level = 'touched';
  if (level === 'set-aside' && (levels?.['set-aside'] ?? 0) < .5) level = 'touched';
  return { id: objectiveId, level, levels, probability: levels?.explored ?? null, achieved: level === 'explored', evidence: level === 'not-yet' ? null : passage };
}

export function readInterviewAnswers(transcript: TranscriptEntry[], answers: InterviewAnswers): Pick<InterviewEvaluation, 'readings' | 'objectives'> {
  const participant = transcript.filter(entry => entry.speaker === 'trainee');
  const readings = emptyInterviewReadings();
  for (const reading of interviewReadings) {
    const observed = booleanProbability(answers, `reading:${reading.id}:observable`) >= .8;
    const value = score(answers, `reading:${reading.id}`);
    const passage = evidence(answers, `reading:${reading.id}:evidence`, participant);
    if (observed && passage) readings[reading.id] = { value: value.score, distribution: value.probabilities ?? null, evidence: passage };
  }
  return { readings, objectives: interviewScenario.objectives.map(objective => coverage(answers, objective.id, participant)) };
}

function validate(input: Input) {
  if (input.scenarioId !== interviewScenario.id || !interviewers.some(item => item.id === input.clientId)) throw new Error('Unknown interview setup.');
  if (!input.apiKey.trim()) throw new Error('Interview judging is not configured.');
  if (!input.transcript.length || input.transcript.length > TRANSCRIPT_LIMIT.entries || transcriptCharacters(input.transcript) > TRANSCRIPT_LIMIT.characters) throw new Error('Transcript is outside the interview limit.');
  if (new Set(input.transcript.map(entry => entry.id)).size !== input.transcript.length) throw new Error('Transcript passage IDs must be unique.');
}

/** The dialogue as every Jev interview call sees it, rendered the same way each time. */
export function dialogueState(entries: TranscriptEntry[]) {
  return { dialogueColumns: ['id', 'speaker', 'text'], dialogue: entries.map(({ id, speaker, text }) => [id, speaker === 'trainee' ? 'participant' : 'sam', text]) };
}

export async function evaluateInterview(input: Input) {
  validate(input);
  const started = performance.now();
  const { transcript } = input;
  const result = await experimental_evaluate({
    model: createTypeSafeAi({ apiKey: input.apiKey }).evaluationModel(JEV_MODEL),
    state: dialogueState(transcript), questions: interviewQuestions(transcript),
    abortSignal: input.signal, maxRetries: 0,
  });
  return {
    ...readInterviewAnswers(transcript, result.answers),
    revision: input.revision, model: result.response.modelId,
    durationMs: Math.round(performance.now() - started), usage: result.usage, answers: result.answers,
  };
}
