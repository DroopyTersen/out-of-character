import { createTypeSafeAi } from '@ai-sdk/typesafe-ai';
import { experimental_evaluate, type Experimental_EvaluationAnswer, type Experimental_EvaluationQuestion } from 'ai';
import { JEV_MODEL } from '../judging';
import { emptySkills, skills, type TranscriptEntry } from '../../core/simulator/types';
import { findEvidence } from '../../core/simulator/state';
import { getClient, getScenario, type Scenario } from './scenarios.server';
import { clientQuestions, traineeQuestions } from './rubric';

type Answer = Experimental_EvaluationAnswer<Experimental_EvaluationQuestion>;
type Answers = Record<string, Answer>;
type Input = {
  scenarioId: string;
  clientId: string;
  transcript: TranscriptEntry[];
  revision: number;
  apiKey: string;
  signal?: AbortSignal;
  achievedIds?: string[];
};
const probability = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;

function yes(answers: Answers, id: string): number {
  const answer = answers[id];
  if (answer?.type !== 'boolean' || !probability(answer.probability)) throw new Error('Invalid simulator condition judgment.');
  return answer.probability;
}
function score(answers: Answers, id: string) {
  const answer = answers[id];
  if (answer?.type !== 'score' || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > 4) throw new Error('Invalid simulator score.');
  if (answer.probabilities && Object.values(answer.probabilities).some(value => !probability(value))) throw new Error('Invalid simulator score distribution.');
  return answer;
}
function choice(answers: Answers, id: string, options: string[]) {
  const answer = answers[id];
  if (answer?.type !== 'choice' || !options.includes(answer.choice)) throw new Error('Invalid simulator selection.');
  return answer;
}

/** Provider output selects real passages; it never supplies quotation text. */
export function readTraineeAnswers(scenario: Scenario, transcript: TranscriptEntry[], answers: Answers, achievedIds: string[] = []) {
  const evidenceIds = ['none', ...transcript.map(entry => entry.id)];
  const readings = emptySkills();
  for (const skill of skills) {
    const available = yes(answers, `skill:${skill.id}:observable`) >= .85;
    const value = score(answers, `skill:${skill.id}`);
    const selected = choice(answers, `skill:${skill.id}:evidence`, evidenceIds);
    const evidence = findEvidence(transcript, selected.choice);
    if (available && evidence?.speaker === 'trainee') readings[skill.id] = { value: value.score, distribution: value.probabilities ?? null, evidence };
  }
  const mistake = yes(answers, 'mistake') >= .85;
  const objectives = scenario.objectives.map(objective => {
    const p = yes(answers, `objective:${objective.id}`);
    const selected = choice(answers, `objective:${objective.id}:evidence`, evidenceIds);
    const evidence = findEvidence(transcript, selected.choice);
    const appropriateSpeaker = evidence?.speaker === (objective.kind === 'behavior' ? 'trainee' : 'client');
    const achieved = p >= (objective.kind === 'discovery' ? .75 : .85) && !!evidence && appropriateSpeaker && !(objective.kind === 'outcome' && mistake);
    return { id: objective.id, probability: p, achieved, evidence: achieved ? evidence : null };
  });
  const selected = choice(answers, 'hint', ['none', ...scenario.objectives.map(item => item.id)]);
  const candidate = scenario.objectives.find(item => item.id === selected.choice);
  const hintId = candidate && !achievedIds.includes(candidate.id) && !objectives.find(item => item.id === candidate.id)?.achieved ? candidate.id : null;
  return { skills: readings, objectives, hintId, hint: hintId ? candidate!.hint : null, concern: mistake ? 'A commitment or claim may go beyond what has been established. Review it before proceeding.' : null };
}

function validateInput(input: Input) {
  if (!input.apiKey.trim()) throw new Error('Simulator judging is not configured.');
  if (!input.transcript.length || input.transcript.length > 240 || input.transcript.reduce((sum, entry) => sum + entry.text.length, 0) > 80000) throw new Error('Transcript is outside the simulator limit.');
  if (new Set(input.transcript.map(entry => entry.id)).size !== input.transcript.length) throw new Error('Transcript passage IDs must be unique.');
}

export async function evaluateTrainee(input: Input) {
  validateInput(input);
  const scenario = getScenario(input.scenarioId);
  const client = getClient(input.clientId);
  const started = performance.now();
  const result = await experimental_evaluate({
    model: createTypeSafeAi({ apiKey: input.apiKey }).evaluationModel(JEV_MODEL),
    state: {
      dialogue: input.transcript,
      referenceNotSpoken: { lead: scenario.lead, services: scenario.services, constraints: scenario.constraints, clientStyle: client.behavior },
    },
    questions: traineeQuestions(scenario, input.transcript, input.achievedIds),
    abortSignal: input.signal,
    maxRetries: 0,
  });
  return {
    ...readTraineeAnswers(scenario, input.transcript, result.answers, input.achievedIds), revision: input.revision,
    model: result.response.modelId, durationMs: Math.round(performance.now() - started), usage: result.usage, answers: result.answers,
  };
}

export type ClientEvaluation = {
  revision: number;
  fidelity: number;
  interests: number[];
  cueId: string;
  cueProbability: number;
  model: string;
  durationMs: number;
  usage: { inputTokens: number | undefined; outputTokens: number | undefined; totalTokens: number | undefined };
  answers: Answers;
};

export async function evaluateClient(input: Input): Promise<ClientEvaluation> {
  validateInput(input);
  const scenario = getScenario(input.scenarioId);
  const client = getClient(input.clientId);
  const started = performance.now();
  const result = await experimental_evaluate({
    model: createTypeSafeAi({ apiKey: input.apiKey }).evaluationModel(JEV_MODEL),
    state: {
      dialogue: input.transcript,
      client: { name: client.name, stats: client.stats, behavior: client.behavior },
      scenario: { interests: scenario.interests, facts: scenario.facts, constraints: scenario.constraints },
    },
    questions: clientQuestions(scenario), abortSignal: input.signal, maxRetries: 0,
  });
  const cue = choice(result.answers, 'cue', ['no_hint', ...scenario.cues.map(item => item.id)]);
  const p = cue.probabilities?.[cue.choice];
  if (p == null || !probability(p)) throw new Error('Client cue probability is unavailable.');
  return {
    revision: input.revision, fidelity: score(result.answers, 'fidelity').score,
    interests: scenario.interests.map((_, index) => score(result.answers, `interest:${index}`).score),
    cueId: cue.choice, cueProbability: p, model: result.response.modelId,
    durationMs: Math.round(performance.now() - started), usage: result.usage, answers: result.answers,
  };
}
