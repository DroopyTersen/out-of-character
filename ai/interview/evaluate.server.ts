import { createTypeSafeAi } from '@ai-sdk/typesafe-ai';
import { experimental_evaluate, type Experimental_EvaluationAnswer, type Experimental_EvaluationQuestion } from 'ai';
import { JEV_MODEL } from '../judging';
import { COVERAGE_LEVELS, emptyInterviewReadings, interviewReadings, isBackchannel, type CoverageLevel, type InterviewEvaluation, type InterviewObjectiveReading } from '../../core/interview';
import { findEvidence, TRANSCRIPT_LIMIT, transcriptCharacters } from '../../core/simulator/state';
import type { TranscriptEntry } from '../../core/simulator/types';
import { INTERVIEW_CONDITIONS, type DirectorSignal } from '../../core/simulator/director';
import { PRODUCER_LIMITS, type DeliveredInterviewBackground } from '../../core/interview-producer';
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
  /** Passage IDs that support saved coverage; they stay visible to Jev after leaving the recent window. */
  keepIds?: string[];
  deliveredBackground?: DeliveredInterviewBackground[];
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

/** Preserve recent passage IDs while keeping a Jev request bounded as an interview grows. */
export function recentTranscript(entries: TranscriptEntry[], characterLimit: number): TranscriptEntry[] {
  let length = 0;
  let start = entries.length;
  while (start > 0 && length + entries[start - 1]!.text.length <= characterLimit) {
    start--;
    length += entries[start]!.text.length;
  }
  return entries.slice(start);
}

/**
 * The recent window plus each kept passage and the Sam turn before it, in transcript order,
 * so coverage heard early in a long interview can still be re-judged against its evidence.
 */
export function coverageWindow(entries: TranscriptEntry[], keepIds: string[] = [], characterLimit = 16_000) {
  const recent = recentTranscript(entries, characterLimit);
  const included = new Set(recent.map(entry => entry.id));
  // At most one saved passage per topic, within the session's transcript limit.
  // Never drop its evidence just because several other topics were explored later.
  const kept = new Set(keepIds);
  for (let index = 0; index < entries.length; index++) {
    if (!kept.has(entries[index]!.id)) continue;
    included.add(entries[index]!.id);
    let question = index - 1;
    while (question >= 0 && entries[question]!.speaker === 'trainee') question--;
    if (question >= 0) included.add(entries[question]!.id);
  }
  const transcript = entries.filter(entry => included.has(entry.id));
  return { transcript, earlierDialogueOmitted: transcript.length < entries.length };
}

function state(entries: TranscriptEntry[]) {
  return { dialogueColumns: ['id', 'speaker', 'text'], dialogue: entries.map(({ id, speaker, text }) => [id, speaker === 'trainee' ? 'participant' : 'sam', text]) };
}

export async function evaluateInterview(input: Input) {
  validate(input);
  const started = performance.now();
  const { transcript, earlierDialogueOmitted } = coverageWindow(input.transcript, input.keepIds);
  const result = await experimental_evaluate({
    model: createTypeSafeAi({ apiKey: input.apiKey }).evaluationModel(JEV_MODEL),
    state: { ...state(transcript), earlierDialogueOmitted }, questions: interviewQuestions(transcript),
    abortSignal: input.signal, maxRetries: 0,
  });
  return {
    ...readInterviewAnswers(transcript, result.answers),
    revision: input.revision, model: result.response.modelId,
    durationMs: Math.round(performance.now() - started), usage: result.usage, answers: result.answers,
  };
}

export function readInterviewerSignals(answers: InterviewAnswers): DirectorSignal[] {
  return INTERVIEW_CONDITIONS.map(condition => ({ condition, probability: booleanProbability(answers, `director:${condition}`) }));
}

export function readResearchProbability(answers: InterviewAnswers): number | undefined {
  const answer = answers['research:useful'];
  // An optional research failure must not suppress a valid corrective concern.
  return answer?.type === 'boolean' && validProbability(answer.probability) ? answer.probability : undefined;
}

/** Outside facts are visible only to Sam's interviewer assessment, never participant scoring. */
export function interviewerState(transcript: TranscriptEntry[], deliveredBackground: DeliveredInterviewBackground[] = []) {
  const recent = recentTranscript(transcript, 12_000);
  return {
    ...state(recent),
    earlierDialogueOmitted: recent.length < transcript.length,
    deliveredBackground: deliveredBackground.slice(-PRODUCER_LIMITS.research).map(({ target, facts, retrievedAt, afterPassageId, status }) => ({
      target, facts, retrievedAt, afterPassageId, status,
    })),
  };
}

export async function evaluateInterviewer(input: Input) {
  validate(input);
  const started = performance.now();
  const result = await experimental_evaluate({
    model: createTypeSafeAi({ apiKey: input.apiKey }).evaluationModel(JEV_MODEL),
    state: interviewerState(input.transcript, input.deliveredBackground), questions: interviewerQuestions(),
    abortSignal: input.signal, maxRetries: 0,
  });
  return { signals: readInterviewerSignals(result.answers), researchProbability: readResearchProbability(result.answers), revision: input.revision, model: result.response.modelId,
    durationMs: Math.round(performance.now() - started), usage: result.usage, answers: result.answers };
}
