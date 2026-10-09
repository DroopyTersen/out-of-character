import { experimental_evaluate, type Experimental_EvaluationAnswer, type Experimental_EvaluationQuestion } from 'ai';
import type { Providers } from '../../providers/providers.server';
import { evidenceBatches, type Judge } from '../../providers/judge.server';
import { COVERAGE_LEVELS, type CoverageLevel, type InterviewEvaluation, type InterviewObjectiveReading } from '../../shared/snapshot';
import { findEvidence, TRANSCRIPT_LIMIT, transcriptCharacters, type Passage, type Speaker } from '../../shared/transcript';
import { emptyReadings } from './coverage';
import { interviewerToken, interviewQuestions, judgedObjectives, type JudgedSpec } from './rubric.prompt';
import { isBackchannel } from './turns';

type Answer = Experimental_EvaluationAnswer<Experimental_EvaluationQuestion>;
export type InterviewAnswers = Record<string, Answer>;
export type EvaluationInput = {
  spec: JudgedSpec;
  passages: Passage[];
  revision: number;
  signal?: AbortSignal;
};
/** The calibrated judge, optionally with provider telemetry. */
export type EvaluationJudge = Pick<Providers, 'judge' | 'telemetry'> | Judge;

const validProbability = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;

// The judge's answers, checked against the question asked. A missing or malformed answer fails the whole reading.
export function booleanProbability(answers: InterviewAnswers, id: string): number {
  const answer = answers[id];
  if (answer?.type !== 'boolean' || !validProbability(answer.probability)) throw new Error(`Invalid interview judgment: ${id}`);
  return answer.probability;
}

export function score(answers: InterviewAnswers, id: string) {
  const answer = answers[id];
  if (answer?.type !== 'score' || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > 4) throw new Error(`Invalid interview score: ${id}`);
  return answer;
}

export function choice<T extends string>(answers: InterviewAnswers, id: string, options: readonly T[]) {
  const answer = answers[id];
  if (answer?.type !== 'choice' || !options.includes(answer.choice as T)) throw new Error(`Invalid interview selection: ${id}`);
  return answer as typeof answer & { choice: T };
}

function evidence(answers: InterviewAnswers, key: string, participant: Passage[]) {
  let selected: { id: string; probability: number } | null = null;
  evidenceBatches(participant).forEach((batch, index) => {
    const answer = choice(answers, index ? `${key}:${index}` : key, ['none', ...batch.map(passage => passage.id)]);
    if (answer.choice === 'none') return;
    const probability = answer.probabilities?.[answer.choice] ?? 0;
    if (!selected || probability > selected.probability) selected = { id: answer.choice, probability };
  });
  // The chosen ID must still resolve to a real participant passage. The judge never supplies quotation text.
  if (!selected) return null;
  const passage = findEvidence(participant, (selected as { id: string }).id);
  return passage && !isBackchannel(passage.text) ? passage : null;
}

function coverage(answers: InterviewAnswers, objectiveId: string, participant: Passage[], exploredThreshold: number): InterviewObjectiveReading {
  const answer = choice(answers, `objective:${objectiveId}`, [...COVERAGE_LEVELS]);
  const levels = answer.probabilities
    ? Object.fromEntries(COVERAGE_LEVELS.map(level => [level, validProbability(answer.probabilities![level] ?? NaN) ? answer.probabilities![level]! : 0])) as Record<CoverageLevel, number>
    : null;
  const passage = evidence(answers, `objective:${objectiveId}:evidence`, participant);
  let level = answer.choice as CoverageLevel;
  // Credit uses the judge's calibrated confidence. A supported boundary still wins at even odds.
  if (level !== 'not-yet' && !passage) level = 'not-yet';
  if (level === 'explored' && (levels?.explored ?? 0) < exploredThreshold) level = 'touched';
  if (level === 'set-aside' && (levels?.['set-aside'] ?? 0) < .5) level = 'touched';
  return { id: objectiveId, level, levels, probability: levels?.explored ?? null, achieved: level === 'explored', evidence: level === 'not-yet' ? null : passage };
}

/** Turns the judge's answers into readings and coverage. Only a participant passage can be evidence. */
export function readInterviewAnswers<const S extends JudgedSpec>(spec: S, passages: Passage[], answers: InterviewAnswers, exploredThreshold = .85): Pick<InterviewEvaluation<S['readings'][number]['id']>, 'readings' | 'objectives'> {
  const participant = passages.filter(passage => passage.speaker === 'participant');
  const readings = emptyReadings<S['readings'], Speaker>(spec.readings);
  for (const reading of spec.readings) {
    const observed = booleanProbability(answers, `reading:${reading.id}:observable`) >= .8;
    const value = score(answers, `reading:${reading.id}`);
    const passage = evidence(answers, `reading:${reading.id}:evidence`, participant);
    if (observed && passage) readings[reading.id as S['readings'][number]['id']] = { value: value.score, distribution: value.probabilities ?? null, evidence: passage };
  }
  return { readings, objectives: judgedObjectives(spec).map(objective => {
    const reading = coverage(answers, objective.id, participant, exploredThreshold);
    if (!objective.appliesWhen) return reading;
    const key = `objective:${objective.id}:applicability`;
    const answer = choice(answers, key, ['applicable', 'not-applicable', 'unknown']);
    const support = evidence(answers, `objective:${objective.id}:applicability-evidence`, participant);
    const applicability = support && (answer.probabilities?.[answer.choice] ?? 0) >= .8
      ? answer.choice as 'applicable' | 'not-applicable' | 'unknown' : 'unknown';
    return { ...reading, applicability, applicabilityEvidence: applicability === 'unknown' ? null : support,
      ...(applicability !== 'applicable' ? { level: 'not-yet' as const, achieved: false, evidence: null } : {}),
    };
  }) };
}

function validate(passages: Passage[]) {
  if (!passages.length || passages.length > TRANSCRIPT_LIMIT.entries || transcriptCharacters(passages) > TRANSCRIPT_LIMIT.characters) throw new Error('Transcript is outside the interview limit.');
  if (new Set(passages.map(passage => passage.id)).size !== passages.length) throw new Error('Transcript passage IDs must be unique.');
}

/** The dialogue as every Jev interview call sees it, rendered the same way each time, with the interviewer's speaker token. */
export function dialogueState(passages: Pick<Passage, 'id' | 'speaker' | 'text'>[], interviewer = 'interviewer') {
  return { dialogueColumns: ['id', 'speaker', 'text'], dialogue: passages.map(({ id, speaker, text }) => [id, speaker === 'participant' ? 'participant' : interviewer, text]) };
}

/** The final grade: the injected judge reads the whole transcript for every reading and objective. */
export async function evaluateInterview<const S extends JudgedSpec>(input: EvaluationInput & { spec: S }, supplied: EvaluationJudge) {
  validate(input.passages);
  const started = performance.now();
  const { passages } = input;
  const { judge, telemetry } = 'judge' in supplied ? supplied : { judge: supplied, telemetry: undefined };
  const result = await experimental_evaluate({
    model: judge.model, state: dialogueState(passages, interviewerToken(input.spec)), questions: interviewQuestions(input.spec, passages),
    abortSignal: input.signal, maxRetries: 0, ...(telemetry ? { telemetry } : {}),
  });
  return {
    ...readInterviewAnswers(input.spec, passages, result.answers, judge.thresholds.coverageExplored),
    revision: input.revision, model: result.response.modelId,
    durationMs: Math.round(performance.now() - started), usage: result.usage, answers: result.answers,
  };
}
