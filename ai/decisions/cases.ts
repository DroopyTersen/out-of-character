import type { Experimental_EvaluationQuestion } from 'ai';
import { evaluateSilence } from '../../interview-engine/interview/session/silence.server';
import { dialogueState, readInterviewAnswers } from '../../interview-engine/interview/conversation/evaluate.server';
import { interviewQuestions } from '../../interview-engine/interview/conversation/rubric.prompt';
import { latestTurn, turnQuestions, readTurnAnswers } from '../../interview-engine/interview/conversation/ranking.server';
import { emptyRanking, observeTurn, pickThreads } from '../../interview-engine/interview/conversation/ranking';
import type { ConversationMap } from '../../interview-engine/interview/conversation/map';
import { toPassage, type WireEntry } from '../../interview-engine/interview/wire';
import { spec } from '../../interviews/project-closeout/spec';
import { interviewFixtures } from '../interview/fixtures';
import syntheticSilence from './silence-fixtures.json';
import type { Model, Request, Result } from '../../interview-engine/providers/decisionJudge.server';

export type Check = { name: string; path: string[]; op: 'eq' | 'gte' | 'lt' | 'in'; expected: unknown; critical?: boolean };
export type EvalCase = {
  id: string; lane: 'silence' | 'turn' | 'grade'; split: 'development' | 'validation'; source: string;
  state: Request['state']; questions: Record<string, Experimental_EvaluationQuestion>; deadlineMs: number;
  checks: Check[]; transcript: WireEntry[]; map?: ConversationMap; atMs?: number; mapId?: string | null;
};
export const hash = (value: unknown) => new Bun.CryptoHasher('sha256').update(JSON.stringify(value)).digest('hex');

async function silenceRequest(transcript: WireEntry[]): Promise<Request> {
  let captured: Request | undefined;
  const stop = new Error('capture');
  const model: Model = { specificationVersion: 'v4', provider: 'capture', modelId: 'capture', supportedQuestionTypes: ['choice', 'boolean', 'score'],
    doEvaluate(input) { captured = input; throw stop; } };
  try { await evaluateSilence({ transcript, judge: model }); } catch (error) { if (error !== stop) throw error; }
  if (!captured) throw new Error('No silence request captured');
  return captured;
}

export async function prepareCases(directory: string): Promise<EvalCase[]> {
  const real = await Bun.file(`${directory}/real-silence-cases.json`).json() as { cases: { id: string; transcript: WireEntry[]; sourceAlias: string; expected: boolean; labelStatus: string; independentLabel: { severityIfWrong: string } }[] };
  const result: EvalCase[] = [];
  const silence = [...syntheticSilence.cases.map(x => ({ ...x, expected: x.expectedContinue, sourceAlias: 'synthetic' })), ...real.cases];
  for (const item of silence) {
    const transcript = item.transcript.slice(-8) as WireEntry[];
    const request = await silenceRequest(transcript);
    const split = item.sourceAlias === 'interview-A' || (item.sourceAlias === 'synthetic' && parseInt(hash(item.id).slice(0, 4), 16) % 2 === 0) ? 'development' : 'validation';
    result.push({ id: `silence:${item.id}`, lane: 'silence', split, source: item.sourceAlias, transcript,
      state: request.state, questions: { ...request.questions }, deadlineMs: 3000,
      checks: item.labelStatus !== 'independently-agreed' ? [] : [{ name: 'continue', path: ['continue'], op: 'eq', expected: item.expected, critical: item.independentLabel.severityIfWrong === 'critical' }] });
  }
  const turns = await Bun.file(`${directory}/turn-cases.json`).json() as { cases: { id: string; sourceAlias: string; transcript: WireEntry[]; map: ConversationMap; atMs: number; mapId: string | null }[] };
  for (const item of turns.cases) result.push({ id: `turn:${item.id}`, lane: 'turn', split: item.sourceAlias === 'interview-A' ? 'development' : 'validation',
    source: item.sourceAlias, transcript: item.transcript, map: item.map, atMs: item.atMs, mapId: item.mapId,
    state: dialogueState(item.transcript.map(toPassage), 'sam'), questions: turnQuestions(item.map, latestTurn(item.transcript)), deadlineMs: 3000, checks: [] });
  for (const item of interviewFixtures.filter(x => Object.values(x.expected).some(value => value.length))) {
    const checks: Check[] = [
      ...item.expected.heard.map(id => ({ name: `heard:${id}`, path: ['objectives', id, 'achieved'], op: 'eq' as const, expected: true })),
      ...item.expected.unheard.map(id => ({ name: `unheard:${id}`, path: ['objectives', id, 'achieved'], op: 'eq' as const, expected: false, critical: true })),
      ...(item.expected.highReadings ?? []).map(id => ({ name: `high:${id}`, path: ['readings', id, 'value'], op: 'gte' as const, expected: 2.5 })),
      ...(item.expected.lowReadings ?? []).map(id => ({ name: `low:${id}`, path: ['readings', id, 'value'], op: 'lt' as const, expected: 2 })),
      ...(item.expected.blankReadings ?? []).map(id => ({ name: `blank:${id}`, path: ['readings', id, 'value'], op: 'eq' as const, expected: null })),
    ];
    result.push({ id: `grade:${item.id}`, lane: 'grade', split: parseInt(hash(item.id).slice(0, 4), 16) % 3 === 0 ? 'validation' : 'development', source: 'synthetic',
      transcript: item.transcript, state: dialogueState(item.transcript.map(toPassage), 'sam'), questions: interviewQuestions(spec, item.transcript.map(toPassage)), deadlineMs: 8000, checks });
  }
  const manifest = await Bun.file(`${directory}/sources.json`).json() as { sources: { alias: string; path: string; sha256: string }[] };
  for (const alias of ['interview-A', 'interview-B']) {
    const source = manifest.sources.find(x => x.alias === alias)!;
    const bytes = await Bun.file(source.path).arrayBuffer();
    if (new Bun.CryptoHasher('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error('Archive source changed');
    const row = JSON.parse(new TextDecoder().decode(bytes));
    const transcript = JSON.parse(row.transcript_json) as WireEntry[];
    const boundaries = [.25, .5, .75, 1].map(fraction => {
      const upto = Math.floor(transcript.length * fraction);
      return transcript.slice(0, upto).findLastIndex(p => p.speaker === 'trainee') + 1;
    });
    boundaries.push(alias === 'interview-A' ? 123 : 79);
    for (const count of boundaries) {
      const prefix = transcript.slice(0, count);
      result.push({ id: `grade:${alias}-${prefix.at(-1)!.id}`, lane: 'grade', split: alias === 'interview-A' ? 'development' : 'validation', source: alias,
        transcript: prefix, state: dialogueState(prefix.map(toPassage), 'sam'), questions: interviewQuestions(spec, prefix.map(toPassage)), deadlineMs: 8000, checks: [] });
    }
  }
  if (new Set(result.map(x => x.id)).size !== result.length) throw new Error('Duplicate case ID');
  return result;
}

export function interpret(item: EvalCase, answers: Result['answers']) {
  if (item.lane === 'silence') {
    const answer = answers.continue;
    if (answer?.type !== 'choice' || answer.probabilities?.continue == null) throw new Error('Incomplete silence answer');
    return { probability: answer.probabilities.continue, continue: answer.probabilities.continue >= .85, state: answer.choice };
  }
  if (item.lane === 'turn') {
    const reading = readTurnAnswers(item.map!, answers, item.transcript.at(-1)!.id, item.atMs!);
    const ranking = observeTurn(emptyRanking(), item.map!, reading, latestTurn(item.transcript)[0]!.id);
    return { ...reading, new: reading.novel >= .8, feedbackNew: (reading.feedback ?? 0) >= .8, wakeCandidate: reading.novel >= .8 || (reading.feedback ?? 0) >= .8,
      pick: pickThreads(item.map!, ranking) };
  }
  const grade = readInterviewAnswers(spec, item.transcript.map(toPassage), answers);
  return { ...grade, objectives: Object.fromEntries(grade.objectives.map(x => [x.id, x])) };
}

export function scoreChecks(checks: Check[], output: unknown) {
  return checks.map(check => {
    const actual = check.path.reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, output);
    const pass = check.op === 'eq' ? actual === check.expected : check.op === 'in' ? Array.isArray(check.expected) && check.expected.includes(actual)
      : typeof actual === 'number' && typeof check.expected === 'number' && (check.op === 'gte' ? actual >= check.expected : actual < check.expected);
    return { ...check, actual, pass };
  });
}

/** Experimental gates only; raw distributions and participant-evidence requirements stay intact. */
export function calibrate(item: Pick<EvalCase, 'lane'>, answers: Result['answers'], output: Record<string, unknown>, gates: { silence: number; explored: number }) {
  if (item.lane === 'silence') return { ...output, continue: Number(output.probability) >= gates.silence };
  if (item.lane !== 'grade') return output;
  const grade = structuredClone(output);
  for (const [id, objective] of Object.entries(grade.objectives as Record<string, { level: string; achieved: boolean; evidence: unknown }>)) {
    const answer = answers[`objective:${id}`];
    if (answer?.type === 'choice' && answer.choice === 'explored' && objective.evidence && (answer.probabilities?.explored ?? 0) >= gates.explored) {
      objective.level = 'explored';
      objective.achieved = true;
    }
  }
  return grade;
}
