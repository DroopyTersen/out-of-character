import { expect, test } from 'bun:test';
import { emptyMap, type ConversationMap, type MapThread } from '../../core/interview-map';
import { threadKey } from '../../core/interview-ranking';
import type { TranscriptEntry } from '../../core/simulator/types';
import type { InterviewAnswers } from './evaluate.server';
import { evaluateTurn, latestTurn, readTraitAnswers, readTurnAnswers, traitQuestions, traitState, turnQuestions } from './ranking.server';

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

test('the latest turn is the participant passages since Sam last said more than a backchannel, without backchannels', () => {
  expect(latestTurn(transcript).map(entry => entry.id)).toEqual(['p2']);
  expect(latestTurn(transcript.slice(0, 1))).toEqual([]);
  const split: TranscriptEntry[] = [
    ...transcript, { id: 'p4', speaker: 'client', text: 'Mm-hm.', startMs: 4400, endMs: 4700 }, { id: 'p5', speaker: 'trainee', text: 'Mostly for the bids team.', startMs: 4800, endMs: 6000 },
  ];
  expect(latestTurn(split).map(entry => entry.id)).toEqual(['p2', 'p5']);
  expect(latestTurn([...split, { id: 'p6', speaker: 'client', text: 'Right.', startMs: 6100, endMs: 6300 }]).map(entry => entry.id)).toEqual(['p2', 'p5']);
  expect(latestTurn([...split, { id: 'p6', speaker: 'client', text: 'Who were they?', startMs: 6100, endMs: 7000 }])).toEqual([]);
});

test('turn questions cover focus, newness and each open thread; closed threads, guesses and topics stay out', () => {
  const questions = turnQuestions(map, latestTurn(transcript));
  expect(Object.keys(questions)).toEqual(['focus', 'new', 'natural:t1', 'state:t1', 'natural:t3', 'state:t3']);
  expect(Object.keys((questions.focus as { criteria: object }).criteria)).toEqual(['none', 't1', 't3']);
  expect(Object.keys((questions['state:t1'] as { criteria: object }).criteria)).toEqual(['open', 'answered', 'declined', 'stalled']);
  expect(JSON.stringify(questions.new)).toContain('Route Planner (Plans routes for field crews.)');
  expect(JSON.stringify(questions['state:t1'])).toContain('What does the latest participant turn do to this gap?');
  expect(JSON.stringify(questions['state:t1'])).toContain('The latest participant turn is p2,');
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
    passageId: 'p2', atMs: 5000, focus: 't3', novel: .7, keys: { t1: threadKey(map.threads[0]!), t3: threadKey(map.threads[2]!) },
    natural: { t1: .2, t3: .9 }, states: { t1: 'stalled', t3: 'open' },
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

test('a Jev selection that isn’t its own top option is retried once; a second one fails the turn', async () => {
  // Substitute paid HTTP only; the real SDK parses and validates the answers.
  const state = (choice: string, probabilities: Record<string, number>) => ({ type: 'choice', choice, probabilities });
  const reply = (focus: Record<string, number>) => ({
    model: 'jev-1.13.0', usage: { input_tokens: 900, output_tokens: 6 },
    answers: {
      focus: state('t3', focus), new: { type: 'noul', noul: .2 }, 'natural:t1': { type: 'noul', noul: .1 }, 'natural:t3': { type: 'noul', noul: .8 },
      'state:t1': state('open', { open: .9, answered: .05, declined: .03, stalled: .02 }), 'state:t3': state('open', { open: .6, answered: .3, declined: .05, stalled: .05 }),
    },
  });
  const bad = reply({ none: .1, t1: .6, t3: .3 });
  const good = reply({ none: .1, t1: .2, t3: .7 });
  const replies = (bodies: unknown[]) => {
    let calls = 0;
    const request = Object.assign(async (url: string | URL | Request) => {
      expect(url).toBe('https://api.typesafe.ai/v1/systemone');
      return Response.json(bodies[calls++]);
    }, { preconnect: fetch.preconnect });
    return { request, calls: () => calls };
  };
  const input = { transcript, map, apiKey: 'fixture-key', atMs: 5000 };
  const flaky = replies([bad, good]);
  const result = await evaluateTurn(input, flaky.request);
  expect(flaky.calls()).toBe(2);
  expect(result.reading).toMatchObject({ passageId: 'p2', focus: 't3', natural: { t1: .1, t3: .8 }, states: { t1: 'open', t3: 'open' } });
  const broken = replies([bad, bad]);
  await expect(evaluateTurn(input, broken.request)).rejects.toThrow('highest-probability');
  expect(broken.calls()).toBe(2);
});
