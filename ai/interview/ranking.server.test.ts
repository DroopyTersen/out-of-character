import { expect, test } from 'bun:test';
import { emptyMap, type ConversationMap, type MapThread } from '../../core/interview-map';
import { threadKey } from '../../core/interview-ranking';
import type { TranscriptEntry } from '../../core/simulator/types';
import type { InterviewAnswers } from './evaluate.server';
import { latestTurn, readTraitAnswers, readTurnAnswers, traitQuestions, traitState, turnQuestions } from './ranking.server';

const thread = (id: string, changes: Partial<MapThread> = {}): MapThread => ({
  id, label: `Thread ${id}`, anchors: ['e1'], unknown: `unknown ${id}`, guess: 'a guess Jev never sees', related: [], topics: ['client-decisions'], status: 'open', reason: null, ...changes,
});
const map: ConversationMap = {
  ...emptyMap(),
  participant: { vantage: 'Tech lead, weeks 1–8.', preferences: [] },
  entities: [{ id: 'e1', kind: 'product', label: 'Route Planner', detail: 'Plans routes for field crews.', source: 'participant', passageId: 'p2' }],
  threads: [thread('t1'), thread('t2', { status: 'done', reason: 'Answered.' }), thread('t3')],
};
const transcript: TranscriptEntry[] = [
  { id: 'p1', speaker: 'client', text: 'What did it do?', startMs: 0, endMs: 1000 },
  { id: 'p2', speaker: 'trainee', text: 'It planned routes for field crews.', startMs: 1500, endMs: 4000 },
  { id: 'p3', speaker: 'trainee', text: 'Mm.', startMs: 4100, endMs: 4300 },
];

test('the latest turn is the participant passages since Sam last spoke, without backchannels', () => {
  expect(latestTurn(transcript).map(entry => entry.id)).toEqual(['p2']);
  expect(latestTurn(transcript.slice(0, 1))).toEqual([]);
});

test('turn questions cover focus, newness and each open thread; closed threads, guesses and topics stay out', () => {
  const questions = turnQuestions(map, latestTurn(transcript));
  expect(Object.keys(questions)).toEqual(['focus', 'new', 'natural:t1', 'state:t1', 'natural:t3', 'state:t3']);
  expect(Object.keys((questions.focus as { criteria: object }).criteria)).toEqual(['none', 't1', 't3']);
  expect(Object.keys((questions['state:t1'] as { criteria: object }).criteria)).toEqual(['open', 'answered', 'declined', 'stalled']);
  expect(JSON.stringify(questions.new)).toContain('Route Planner');
  expect(JSON.stringify(questions.new)).toContain('(p2)');
  const text = JSON.stringify(questions);
  expect(text).not.toContain('a guess Jev never sees');
  expect(text).not.toContain('client-decisions');
  expect(Object.keys(turnQuestions({ ...map, threads: [] }, latestTurn(transcript)))).toEqual(['new']);
});

test('turn answers become a reading; an invalid answer rejects the whole reading', () => {
  const answers: InterviewAnswers = {
    focus: { type: 'choice', choice: 't3' }, new: { type: 'boolean', probability: .7 },
    'natural:t1': { type: 'boolean', probability: .2 }, 'state:t1': { type: 'choice', choice: 'stalled' },
    'natural:t3': { type: 'boolean', probability: .9 }, 'state:t3': { type: 'choice', choice: 'open' },
  };
  expect(readTurnAnswers(map, answers, 'p2', 5000)).toEqual({
    passageId: 'p2', atMs: 5000, focus: 't3', novel: .7, natural: { t1: .2, t3: .9 }, states: { t1: 'stalled', t3: 'open' },
  });
  expect(readTurnAnswers(map, { ...answers, focus: { type: 'choice', choice: 'none' } }, 'p2', 5000).focus).toBeNull();
  expect(() => readTurnAnswers(map, { ...answers, focus: { type: 'choice', choice: 't2' } }, 'p2', 5000)).toThrow('focus');
  expect(() => readTurnAnswers(map, { ...answers, 'state:t1': { type: 'choice', choice: 'later' } }, 'p2', 5000)).toThrow('state:t1');
  expect(readTurnAnswers({ ...map, threads: [] }, { new: { type: 'boolean', probability: .1 } }, 'p2', 5000)).toMatchObject({ focus: null, natural: {}, states: {} });
});

test('trait questions read spicy and grounding per thread against the map’s facts, keyed to the thread’s wording', () => {
  const threads = [map.threads[0]!];
  expect(Object.keys(traitQuestions(threads))).toEqual(['spicy:t1', 'grounding:t1']);
  expect(traitState(map)).toEqual({ participant: 'Tech lead, weeks 1–8.', known: ['Route Planner (product): Plans routes for field crews.'] });
  const traits = readTraitAnswers(threads, { 'spicy:t1': { type: 'boolean', probability: .8 }, 'grounding:t1': { type: 'boolean', probability: .3 } });
  expect(traits).toEqual({ t1: { key: threadKey(threads[0]!), spicy: .8, grounding: .3 } });
});
