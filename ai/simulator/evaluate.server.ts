import { createTypeSafeAi } from '@ai-sdk/typesafe-ai';
import { experimental_evaluate, type Experimental_EvaluationAnswer, type Experimental_EvaluationQuestion } from 'ai';
import { JEV_MODEL } from '../judging';
import { emptySkills, skills, type TranscriptEntry } from '../../core/simulator/types';
import { findEvidence, TRANSCRIPT_LIMIT, transcriptCharacters } from '../../core/simulator/state';
import { getClient, getScenario, type Scenario } from './scenarios.server';
import { clientQuestions, endingQuestions, evidenceBatches, traineeQuestions } from './rubric';
import { ACTOR_CONDITIONS, CONDUCT_CONCERN, MATERIAL_CONCERN, type BooleanCondition, type DirectorSignal } from '../../core/simulator/director';

type Answer = Experimental_EvaluationAnswer<Experimental_EvaluationQuestion>;
type Answers = Record<string, Answer>;
type Judgment = {
  answers: Answers;
  usage: { inputTokens: number | undefined; outputTokens: number | undefined; totalTokens: number | undefined };
  response: { modelId: string };
};
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
function readSignal(answers: Answers, id: string, condition: BooleanCondition): DirectorSignal[] {
  const answer = answers[id];
  return answer?.type === 'boolean' && probability(answer.probability) ? [{ condition, probability: answer.probability }] : [];
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
  if (answer.probabilities && Object.values(answer.probabilities).some(value => !probability(value))) throw new Error('Invalid simulator choice distribution.');
  return answer;
}

function readEvidence(answers: Answers, key: string, entries: TranscriptEntry[], skill = false) {
  let selected: { id: string; confidence: number } | null = null;
  const batches = evidenceBatches(entries);
  for (const [index, batch] of batches.entries()) {
    const options = [...(skill && batches.length === 1 && batch.length ? [] : ['none']), ...batch.map(entry => entry.id)];
    const answer = choice(answers, index ? `${key}:${index}` : key, options);
    if (answer.choice === 'none') continue;
    const confidence = answer.probabilities?.[answer.choice] ?? -1;
    if (!selected || confidence > selected.confidence) selected = { id: answer.choice, confidence };
  }
  return selected ? findEvidence(entries, selected.id) : null;
}

/** Provider output selects real passages; it never supplies quotation text. */
export function readTraineeAnswers(scenario: Scenario, transcript: TranscriptEntry[], answers: Answers, achievedIds: string[] = []) {
  const readings = emptySkills();
  for (const skill of skills) {
    const available = yes(answers, `skill:${skill.id}:observable`) >= .85;
    const value = score(answers, `skill:${skill.id}`);
    const evidence = readEvidence(answers, `skill:${skill.id}:evidence`, transcript.filter(entry => entry.speaker === 'trainee'), true);
    if (available && evidence?.speaker === 'trainee') readings[skill.id] = { value: value.score, distribution: value.probabilities ?? null, evidence };
  }
  const mistake = yes(answers, 'mistake') >= .85;
  // Optional like stalled: an invalid conduct judgment is dropped rather than discarding the grade.
  const disrespect = readSignal(answers, 'disrespect', 'disrespect');
  const objectives = scenario.objectives.map(objective => {
    const p = yes(answers, `objective:${objective.id}`);
    const evidence = readEvidence(answers, `objective:${objective.id}:evidence`, transcript.filter(entry => entry.speaker === (objective.kind === 'behavior' ? 'trainee' : 'client')));
    const appropriateSpeaker = evidence?.speaker === (objective.kind === 'behavior' ? 'trainee' : 'client');
    const achieved = p >= (objective.kind === 'discovery' ? .75 : .85) && !!evidence && appropriateSpeaker;
    return { id: objective.id, probability: p, achieved, evidence: achieved ? evidence : null };
  });
  const selected = choice(answers, 'hint', ['none', ...scenario.objectives.map(item => item.id)]);
  const candidate = scenario.objectives.find(item => item.id === selected.choice);
  const hintId = candidate && !achievedIds.includes(candidate.id) && !objectives.find(item => item.id === candidate.id)?.achieved ? candidate.id : null;
  const signals: DirectorSignal[] = [
    ...disrespect,
    { condition: 'mistake', probability: yes(answers, 'mistake') },
    ...scenario.objectives.map(item => ({ condition: `objective:${item.id}` as const, selected: hintId === item.id })),
    ...readSignal(answers, 'stalled', 'stalled'),
  ];
  const concern = disrespect.some(signal => 'probability' in signal && signal.probability >= .85) ? CONDUCT_CONCERN : mistake ? MATERIAL_CONCERN : null;
  return { skills: readings, objectives, concern, signals };
}

function validateInput(input: Input) {
  if (!input.apiKey.trim()) throw new Error('Simulator judging is not configured.');
  if (!input.transcript.length || input.transcript.length > TRANSCRIPT_LIMIT.entries || transcriptCharacters(input.transcript) > TRANSCRIPT_LIMIT.characters) throw new Error('Transcript is outside the simulator limit.');
  if (new Set(input.transcript.map(entry => entry.id)).size !== input.transcript.length) throw new Error('Transcript passage IDs must be unique.');
}

export function shouldPartitionTraineeQuestions(transcript: TranscriptEntry[]) {
  return transcript.length > 128 || transcriptCharacters(transcript) > 20_000;
}

/** Long grades share one full dialogue while keeping each provider request bounded. */
export async function evaluateTraineeQuestionGroups(
  questions: Record<string, Experimental_EvaluationQuestion>,
  partition: boolean,
  run: (part: Record<string, Experimental_EvaluationQuestion>, signal?: AbortSignal) => Promise<Judgment>,
  signal?: AbortSignal,
): Promise<Judgment> {
  if (!partition) return run(questions, signal);
  const entries = Object.entries(questions);
  const parts = [];
  for (let start = 0; start < entries.length; start += 12) parts.push(Object.fromEntries(entries.slice(start, start + 12)));
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  let results: Judgment[];
  try {
    results = await Promise.all(parts.map(part => run(part, controller.signal)));
  } catch (error) {
    abort();
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
  const total = (key: keyof Judgment['usage']) => results.every(result => result.usage[key] != null)
    ? results.reduce((sum, result) => sum + result.usage[key]!, 0) : undefined;
  return {
    answers: Object.assign({}, ...results.map(result => result.answers)),
    usage: { inputTokens: total('inputTokens'), outputTokens: total('outputTokens'), totalTokens: total('totalTokens') },
    response: results[0]!.response,
  };
}

export async function evaluateTrainee(input: Input) {
  validateInput(input);
  const scenario = getScenario(input.scenarioId);
  const client = getClient(input.clientId);
  const started = performance.now();
  const model = createTypeSafeAi({ apiKey: input.apiKey }).evaluationModel(JEV_MODEL);
  const state = {
    dialogueColumns: ['id', 'speaker', 'text'],
    dialogue: input.transcript.map(({ id, speaker, text }) => [id, speaker, text]),
    referenceNotSpoken: { lead: scenario.lead, briefing: scenario.briefing ?? [], services: scenario.services, constraints: scenario.constraints, clientStyle: client.behavior },
  };
  const result = await evaluateTraineeQuestionGroups(
    traineeQuestions(scenario, input.transcript, input.achievedIds), shouldPartitionTraineeQuestions(input.transcript),
    (questions, signal) => experimental_evaluate({ model, state, questions, abortSignal: signal, maxRetries: 0 }), input.signal,
  );
  const reading = readTraineeAnswers(scenario, input.transcript, result.answers, input.achievedIds);
  return {
    ...reading, revision: input.revision,
    model: result.response.modelId, durationMs: Math.round(performance.now() - started), usage: result.usage, answers: result.answers,
  };
}

export type ClientEvaluation = {
  revision: number;
  model: string;
  durationMs: number;
  usage: { inputTokens: number | undefined; outputTokens: number | undefined; totalTokens: number | undefined };
  answers: Answers;
  signals: DirectorSignal[];
};

export function readClientAnswers(answers: Answers) {
  return {
    signals: ACTOR_CONDITIONS.flatMap(condition => readSignal(answers, `director:${condition}`, condition)),
  };
}

export async function evaluateClient(input: Input): Promise<ClientEvaluation> {
  validateInput(input);
  const scenario = getScenario(input.scenarioId);
  const client = getClient(input.clientId);
  const started = performance.now();
  const result = await experimental_evaluate({
    model: createTypeSafeAi({ apiKey: input.apiKey }).evaluationModel(JEV_MODEL),
    state: {
      dialogueColumns: ['id', 'speaker', 'text'],
      dialogue: input.transcript.map(({ id, speaker, text }) => [id, speaker, text]),
      client: { name: client.name, role: scenario.clientRole, stats: client.stats, behavior: client.behavior },
      scenario: { meetingPremise: scenario.opening, interests: scenario.interests, clientFacts: scenario.facts, worldLimitsNotNecessarilyKnownToClient: scenario.constraints },
    },
    questions: clientQuestions(), abortSignal: input.signal, maxRetries: 0,
  });
  return {
    ...readClientAnswers(result.answers), revision: input.revision,
    model: result.response.modelId,
    durationMs: Math.round(performance.now() - started), usage: result.usage, answers: result.answers,
  };
}

export type EndingEvaluation = {
  model: string;
  durationMs: number;
  usage: { inputTokens: number | undefined; outputTokens: number | undefined; totalTokens: number | undefined };
  answers: Answers;
  probability: number;
  passageId: string | null;
};
/** The walk-out judgment reads only recent dialogue; the ending, and any reopening, are always recent. */
export const ENDING_WINDOW = 16;
const endingCandidates = (transcript: TranscriptEntry[]) => transcript.slice(-ENDING_WINDOW).filter(entry => entry.speaker === 'client');

/** An ending must cite a real recent client passage; otherwise the meeting stays open. */
export function readEndingAnswers(answers: Answers, transcript: TranscriptEntry[]) {
  const ended = yes(answers, 'ended');
  const evidence = choice(answers, 'ended:evidence', ['none', ...endingCandidates(transcript).map(entry => entry.id)]);
  const passageId = evidence.choice === 'none' ? null : evidence.choice;
  return { probability: passageId ? ended : Math.min(ended, .49), passageId };
}

export async function evaluateEnding(input: Input): Promise<EndingEvaluation> {
  validateInput(input);
  const scenario = getScenario(input.scenarioId);
  const client = getClient(input.clientId);
  const started = performance.now();
  const recent = input.transcript.slice(-ENDING_WINDOW);
  const result = await experimental_evaluate({
    model: createTypeSafeAi({ apiKey: input.apiKey }).evaluationModel(JEV_MODEL),
    state: {
      dialogueColumns: ['id', 'speaker', 'text'],
      recentDialogue: recent.map(({ id, speaker, text }) => [id, speaker, text]),
      client: { name: client.name, role: scenario.clientRole },
    },
    questions: endingQuestions(endingCandidates(input.transcript)), abortSignal: input.signal, maxRetries: 0,
  });
  return {
    ...readEndingAnswers(result.answers, input.transcript),
    model: result.response.modelId, durationMs: Math.round(performance.now() - started), usage: result.usage, answers: result.answers,
  };
}
