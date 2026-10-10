import { experimental_evaluate } from 'ai';
import type { Providers } from '../../providers/providers.server';
import { choice, evidenceBatches, type Judge, type JudgeAnswers } from '../../providers/judgeProvider.server';
import { COVERAGE_LEVELS, type CoverageLevel, type InterviewEvaluation, type InterviewObjectiveReading } from '../../shared/snapshot';
import { dialogueState, findEvidence, TRANSCRIPT_LIMIT, transcriptCharacters, type Passage } from '../../shared/transcript';
import { interviewerToken, interviewQuestions, judgedObjectives, type JudgedSpec } from './topicCoverage.prompt';
import { isBackchannel } from '../reasoning/turnTaking';

export type EvaluationInput = {
  spec: JudgedSpec;
  passages: Passage[];
  revision: number;
  signal?: AbortSignal;
};
/** The calibrated judge, optionally with provider telemetry. */
export type EvaluationJudge = Pick<Providers, 'judge' | 'telemetry'> | Judge;

const validProbability = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;

function evidence(answers: JudgeAnswers, key: string, participant: Passage[]) {
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

function coverage(answers: JudgeAnswers, objectiveId: string, participant: Passage[], exploredThreshold: number): InterviewObjectiveReading {
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

/** Turns the judge's answers into topic coverage. Only a participant passage can be evidence. */
export function readTopicCoverage(spec: JudgedSpec, passages: Passage[], answers: JudgeAnswers, exploredThreshold = .85): Pick<InterviewEvaluation, 'objectives'> {
  const participant = passages.filter(passage => passage.speaker === 'participant');
  return { objectives: judgedObjectives(spec).map(objective => {
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

/** The final grade: the injected judge reads the whole transcript for every objective. */
export async function judgeTopicCoverage(input: EvaluationInput, supplied: EvaluationJudge) {
  validate(input.passages);
  const started = performance.now();
  const { passages } = input;
  const { judge, telemetry } = 'judge' in supplied ? supplied : { judge: supplied, telemetry: undefined };
  const result = await experimental_evaluate({
    model: judge.model, state: dialogueState(passages, interviewerToken(input.spec)), questions: interviewQuestions(input.spec, passages),
    abortSignal: input.signal, maxRetries: 0, ...(telemetry ? { telemetry } : {}),
  });
  return {
    ...readTopicCoverage(input.spec, passages, result.answers, judge.thresholds.coverageExplored),
    revision: input.revision, model: result.response.modelId,
    durationMs: Math.round(performance.now() - started), usage: result.usage, answers: result.answers,
  };
}
