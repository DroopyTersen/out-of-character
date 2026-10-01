import { fixtureFoundry } from '../../../ai/foundry-fixture';
import { afterEach, expect, setSystemTime, test } from 'bun:test';
import { MAP_PROMPT_VERSION, MapOutputError } from '../../../ai/interview/map.server';
import { RANKING_RUBRIC_VERSION } from '../../../ai/interview/ranking.server';
import { emptyMap, type ConversationMap, type MapEntity, type MapThread } from '../../../core/interview-map';
import { EMPTY_LIST_NOTE, NOTE_HEADERS } from '../../../core/interview-notes';
import { PRODUCER_LIMITS, PRODUCER_VERSION, type ProducerLogRecord, type ResearchRequest } from '../../../core/interview-producer';
import { threadKey, type TurnReading } from '../../../core/interview-ranking';
import type { TranscriptEntry } from '../../../core/simulator/types';
import { InterviewProducer, producerServices } from './interview-producer';

afterEach(() => setSystemTime());
const epoch = 1_800_000_000_000;
const usage = { inputTokens: 10, outputTokens: 5 };
const jevUsage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
const facts = [{ text: 'OpenStreetMap is a collaborative, openly licensed world map.', url: 'https://www.openstreetmap.org/about', title: 'About OpenStreetMap' }];
const request = (name: string, clue: string | null = null): ResearchRequest => ({ kind: 'product', name, clue, passageIds: ['p2'] });
const MINUTE = 'a minute has passed since your last call';
const novelReason = (id: string) => `the participant's latest turn (${id}) adds something the map lacks`;

type Services = typeof producerServices;
type Input<K extends keyof Services> = Parameters<Services[K]>[0];
type Mapped = Awaited<ReturnType<Services['generateMap']>>;
type Read = Awaited<ReturnType<Services['evaluateTurn']>>;
type Traits = Awaited<ReturnType<Services['evaluateTraits']>>;
type Lookup = Awaited<ReturnType<Services['lookupInterviewBackground']>>;

const routing: MapEntity = { id: 'e1', kind: 'product', label: 'Routing layer', detail: 'Built on OpenStreetMap and Mapbox.', source: 'participant', passageId: 'p2' };
const thread = (id: string, over: Partial<MapThread> = {}): MapThread =>
  ({ id, label: `Thread ${id}`, anchors: ['e1'], unknown: `what happened with ${id}`, guess: `a guess about ${id}`, related: [], topics: [], status: 'open', reason: null, ...over });
const mapWith = (threads: MapThread[], over: Partial<ConversationMap> = {}): ConversationMap =>
  ({ ...emptyMap(), entities: [routing], threads, nextIds: { e: 2, r: 1, t: threads.length + 1 }, ...over });
const mapped = (map: ConversationMap, research: ResearchRequest | null = null): Mapped => ({
  map, update: { keep: [], drop: [], participant: null, entities: [], edges: [], threads: [] },
  changes: { added: [], changed: [], dropped: [], kept: [] }, research, model: 'gpt-6.1-sol', usage,
});
/** Jev read every open thread in its current wording; nothing is natural, answered or new unless a test says so. */
function reading(input: Input<'evaluateTurn'>, over: Partial<TurnReading> = {}): Read {
  const keys = Object.fromEntries(input.map.threads.filter(item => item.status === 'open').map(item => [item.id, threadKey(item)]));
  return { reading: { passageId: input.transcript.at(-1)!.id, atMs: input.atMs, focus: null, keys, natural: {}, states: {}, novel: 0, ...over }, model: 'fixture', durationMs: 5, usage: jevUsage, answers: {} };
}
const traits = (input: Input<'evaluateTraits'>): Traits =>
  ({ traits: Object.fromEntries(input.threads.map(item => [item.id, { key: threadKey(item), spicy: .5, grounding: .5 }])), model: 'fixture', durationMs: 5, usage: jevUsage });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(done => setTimeout(done, 0)); };

// Only the paid calls are substituted; timing, the log, ranking, validation, budgets and delivery are real.
function fixture(overrides: Partial<Services> = {}, channel?: 'session.instructions.append') {
  setSystemTime(epoch);
  let transcript: TranscriptEntry[] = [
    { id: 'p1', speaker: 'client', text: 'What did the team build?', startMs: 0, endMs: 1000 },
    { id: 'p2', speaker: 'trainee', text: 'We integrated OpenStreetMap and Mapbox for the routing layer.', startMs: 1000, endMs: 4000 },
  ];
  let connected: boolean | 'throw' = true;
  const sent: Record<string, unknown>[] = [];
  const calls = { map: [] as Input<'generateMap'>[], turn: [] as Input<'evaluateTurn'>[], traits: [] as Input<'evaluateTraits'>[], lookup: [] as Input<'lookupInterviewBackground'>[] };
  const producer = new InterviewProducer({
    attemptId: 'attempt-1', startedAt: epoch, foundry: fixtureFoundry, typesafeKey: 'typesafe-fixture', channel,
    settled: () => transcript, coverage: () => [], send: event => { if (connected === 'throw') throw new Error('socket closed'); if (!connected) return false; sent.push(event); return true; },
    services: {
      generateMap: async input => { calls.map.push(input); return overrides.generateMap ? overrides.generateMap(input) : mapped(input.previous); },
      evaluateTurn: async input => { calls.turn.push(input); return overrides.evaluateTurn ? overrides.evaluateTurn(input) : reading(input); },
      evaluateTraits: async input => { calls.traits.push(input); return overrides.evaluateTraits ? overrides.evaluateTraits(input) : traits(input); },
      lookupInterviewBackground: async input => {
        calls.lookup.push(input);
        return overrides.lookupInterviewBackground ? overrides.lookupInterviewBackground(input) : { status: 'found', facts, retrievedAt: Date.now(), queries: ['OpenStreetMap about'] };
      },
    },
  });
  const say = (speaker: 'client' | 'trainee', text: string) => {
    const entry: TranscriptEntry = { id: `p${transcript.length + 1}`, speaker, text, startMs: Date.now() - epoch, endMs: Date.now() - epoch + 1000 };
    transcript = [...transcript, entry];
    return entry;
  };
  const grow = (id: string, text: string) => {
    transcript = transcript.map(entry => entry.id === id ? { ...entry, text } : entry);
    return transcript.find(entry => entry.id === id)!;
  };
  /** Sam asks, the participant answers, and the tick reads the new turn. */
  const turn = async (ms: number, text = 'It took a while to get right.') => { at(ms); say('client', 'Tell me more?'); say('trainee', text); await step(); };
  const at = (ms: number) => setSystemTime(epoch + ms);
  const step = async (ms?: number) => { if (ms != null) at(ms); producer.tick(Date.now()); await flush(); };
  const of = <S extends ProducerLogRecord['source']>(source: S) => producer.records.filter(item => item.source === source) as Extract<ProducerLogRecord, { source: S }>[];
  const notes = (kind?: keyof typeof NOTE_HEADERS) => sent.filter(event => !kind || String(event.content).startsWith(NOTE_HEADERS[kind])).map(event => String(event.content));
  return { producer, sent, calls, say, grow, turn, at, step, of, notes, setConnected: (value: boolean | 'throw') => { connected = value; } };
}

test('Sol calls on the minute only when participant text is unlogged, and a wake an earlier call already logged is dropped', async () => {
  const late = deferred<Read>();
  const f = fixture({ evaluateTurn: async input => input.transcript.at(-1)!.id === 'p4' ? late.promise : reading(input) });
  await f.step(0);
  await f.step(20_000);
  expect(f.calls.map).toHaveLength(0);

  f.at(59_000); f.say('client', 'And then?'); f.say('trainee', 'Then we rebuilt the offline cache.');
  await f.step();
  await f.step(60_000);
  expect(f.calls.map).toHaveLength(1);
  expect(f.calls.map[0]!.tail.reasons).toEqual([MINUTE]);
  expect(f.calls.map[0]!.blocks).toHaveLength(1);
  // The turn reading lands after the call that logged it: its wake has nothing left to say.
  f.at(61_000); late.resolve(reading(f.calls.turn[1]!, { novel: .9 })); await flush();
  await f.step(80_000);
  await f.step(121_000);
  expect(f.calls.map).toHaveLength(1);

  f.at(125_000); f.say('trainee', 'We also tested it with field crews.');
  await f.step();
  expect(f.calls.map).toHaveLength(2);
  expect(f.calls.map[1]!.tail.reasons).toEqual([MINUTE]);
  expect(f.calls.map[1]!.blocks).toHaveLength(2);
  expect(f.calls.map[1]!.blocks[1]).toStartWith('[p5 · participant');
  expect(f.of('map').map(item => [item.outcome, item.startedAt - epoch, item.lastInputId])).toEqual([['applied', 60_000, 'p4'], ['applied', 125_000, 'p5']]);
  // An empty map gives Sam nothing to read.
  expect(f.sent).toHaveLength(0);
});

test('a novel turn wakes Sol at its floor, and wakes during a call merge into one follow-up', async () => {
  const first = deferred<Mapped>();
  const f = fixture({
    evaluateTurn: async input => reading(input, { novel: input.transcript.at(-1)!.id === 'p2' ? .79 : .8 }),
    generateMap: async input => f.calls.map.length === 1 ? first.promise : mapped(input.previous),
  });
  await f.step(0);
  await f.turn(5000);
  await f.step(19_999);
  expect(f.calls.map).toHaveLength(0);
  await f.step(20_000);
  expect(f.calls.map.map(item => item.tail.reasons)).toEqual([[novelReason('p4')]]);

  await f.turn(22_000);
  await f.turn(25_000);
  f.at(31_000); first.resolve(mapped(emptyMap())); await flush();
  await f.step(39_999);
  expect(f.calls.map).toHaveLength(1);
  await f.step(40_000);
  expect(f.calls.map).toHaveLength(2);
  expect(f.calls.map[1]!.tail.reasons).toEqual([novelReason('p6'), novelReason('p8')]);
  expect(f.calls.map[1]!.tail.lastPassageId).toBe('p8');
  expect(f.calls.map[1]!.passages.map(item => item.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']);
});

test('a Sol call past its timeout is abandoned, its late result is ignored, and the minute retries the unmapped text', async () => {
  const slow = deferred<Mapped>();
  const f = fixture({
    evaluateTurn: async input => reading(input, { novel: .9 }),
    generateMap: async input => f.calls.map.length === 1 ? slow.promise : mapped(input.previous),
  });
  await f.step(0);
  await f.step(20_000);
  await f.step(49_999);
  expect(f.of('map')[0]!.outcome).toBe('pending');
  await f.step(50_000);
  expect(f.of('map')[0]).toMatchObject({ outcome: 'timeout', completedAt: epoch + 50_000 });
  expect(f.calls.map[0]!.signal.aborted).toBe(true);
  expect(f.calls.map).toHaveLength(1);

  slow.resolve(mapped(mapWith([thread('t1')])));
  await flush();
  expect(f.producer.conversationMap.threads).toEqual([]);
  expect(f.of('map')[0]!.outcome).toBe('timeout');
  expect(f.sent).toHaveLength(0);

  await f.step(79_999);
  expect(f.calls.map).toHaveLength(1);
  await f.step(80_000);
  expect(f.calls.map).toHaveLength(2);
  expect(f.calls.map[1]!.tail.reasons).toEqual([MINUTE]);
  // Nothing new was said: Sol re-reads the block the abandoned call logged.
  expect(f.calls.map[1]!.blocks).toEqual(f.calls.map[0]!.blocks);
  expect(f.producer.summary()).toMatchObject({ maps: 2, applied: 1 });
});

test.each(['invalid', 'error'] as const)('an %s Sol update leaves the map behind, so the next minute retries without new text', async outcome => {
  const f = fixture({
    evaluateTurn: async input => reading(input, { novel: .9 }),
    generateMap: async () => {
      if (f.calls.map.length > 1) return mapped(mapWith([]));
      throw outcome === 'invalid' ? new MapOutputError([{ kind: 'dangling', id: 't1', detail: 'anchor e9' }], {}, 'gpt-6.1-sol-2', { inputTokens: 3, outputTokens: 4 }) : new Error('upstream 500');
    },
  });
  await f.step(0);
  await f.step(20_000);
  expect(f.of('map')[0]).toMatchObject(outcome === 'invalid'
    ? { outcome, completedAt: epoch + 20_000, defects: [{ kind: 'dangling', id: 't1', detail: 'anchor e9' }], model: 'gpt-6.1-sol-2', usage: { inputTokens: 3, outputTokens: 4 } }
    : { outcome, completedAt: epoch + 20_000, model: 'gpt-6.1-sol' });
  await f.step(79_999);
  expect(f.calls.map).toHaveLength(1);
  await f.step(80_000);
  expect(f.calls.map[1]!.tail.reasons).toEqual([MINUTE]);
  expect(f.of('map')[1]!.outcome).toBe('applied');
  await f.step(140_000);
  expect(f.calls.map).toHaveLength(2);
});

test('a failure after Sol’s map lands leaves the call applied, so the minute does not re-map', async () => {
  const f = fixture({ evaluateTurn: async input => reading(input, { novel: .9 }), generateMap: async () => mapped(mapWith([thread('t1')])) });
  await f.step(0);
  f.setConnected('throw');
  await f.step(20_000);
  expect(f.of('map')[0]).toMatchObject({ outcome: 'applied', completedAt: epoch + 20_000 });
  expect(f.producer.conversationMap.threads.map(item => item.id)).toEqual(['t1']);
  f.setConnected(true);
  await f.step(80_000);
  expect(f.calls.map).toHaveLength(1);
});

test('a failed Sol call that carried only a lookup is retried on the minute', async () => {
  const f = fixture({
    evaluateTurn: async input => reading(input, { novel: .9 }),
    generateMap: async input => {
      if (f.calls.map.length === 2) throw new Error('upstream 500');
      return mapped(input.previous, f.calls.map.length === 1 ? request('OpenStreetMap') : null);
    },
  });
  await f.step(0);
  await f.step(20_000);
  await f.producer.settle();
  await f.step(40_000);
  expect(f.calls.map[1]!.tail.reasons).toEqual(['public research arrived about the product "OpenStreetMap"']);
  expect(f.of('map').map(item => item.outcome)).toEqual(['applied', 'error']);
  await f.step(99_999);
  expect(f.calls.map).toHaveLength(2);
  await f.step(100_000);
  expect(f.calls.map[2]!.tail.reasons).toEqual([MINUTE]);
  expect(f.calls.map[2]!.blocks).toEqual(f.calls.map[1]!.blocks);
  expect(f.of('map')[2]!.outcome).toBe('applied');
});

test('an applied map sends the list note, then the map note, and reads traits for its new threads', async () => {
  const map = mapWith([thread('t1', { label: 'Field crews', unknown: 'how crews used the routing layer offline', guess: 'paper maps as a backup' })],
    { participant: { vantage: 'Led the routing integration', preferences: [] } });
  const f = fixture({ evaluateTurn: async input => reading(input, { novel: .9 }), generateMap: async () => mapped(map) });
  await f.step(0);
  await f.step(20_000);
  await f.producer.settle();
  const [solCall] = f.of('map');
  expect(f.notes()).toEqual([
    `${NOTE_HEADERS.list}\nWorth pulling next (Field crews): still unknown: how crews used the routing layer offline. Guess: paper maps as a backup.`,
    `${NOTE_HEADERS.map}\nAbout the participant: Led the routing integration.\nKnown so far: Routing layer: Built on OpenStreetMap and Mapbox.`,
  ]);
  const notes = f.of('note');
  expect(f.sent.map(event => [event.type, event.event_id, event.delegation_id])).toEqual(notes.map(note => ['session.thinking.append', note.id, null]));
  expect(notes.map(note => [note.kind, note.mapId, note.sentAt, note.delivery])).toEqual([
    ['list', solCall!.id, epoch + 20_000, { eventId: notes[0]!.id, afterPassageId: 'p2', status: 'unknown' }],
    ['map', solCall!.id, epoch + 20_000, { eventId: notes[1]!.id, afterPassageId: 'p2', status: 'unknown' }],
  ]);
  expect(f.of('traits')).toEqual([{ source: 'traits', id: expect.any(String), mapId: solCall!.id, threadIds: ['t1'], startedAt: epoch + 20_000, completedAt: epoch + 20_000,
    outcome: 'read', durationMs: 5, usage: { inputTokens: 10, outputTokens: 5 }, traits: { t1: [.5, .5] } }]);
  expect(f.producer.rankingState.traits.t1).toEqual({ key: threadKey(map.threads[0]!), spicy: .5, grounding: .5 });

  // Traits landing and a turn that doesn't move the pick re-pick to the same note.
  await f.turn(25_000, 'Mostly offline.');
  await f.producer.settle();
  expect(f.sent).toHaveLength(2);
  expect(f.calls.traits).toHaveLength(1);
  expect(f.producer.summary()).toEqual({
    model: 'gpt-6.1-sol', effort: 'low', version: PRODUCER_VERSION, mapPrompt: MAP_PROMPT_VERSION, rankingRubric: RANKING_RUBRIC_VERSION,
    maps: 1, applied: 1, turns: 2, notes: 2, research: 0,
    latency: { sol: { count: 1, p50: 0, p90: 0 }, jevTurn: { count: 2, p50: 0, p90: 0 }, traits: { count: 1, p50: 0, p90: 0 }, lookup: null, noteToSam: null },
  });
});

test('the probe channel carries the same notes', async () => {
  const f = fixture({ evaluateTurn: async input => reading(input, { novel: .9 }), generateMap: async () => mapped(mapWith([thread('t1')])) }, 'session.instructions.append');
  await f.step(0);
  await f.step(20_000);
  expect(f.sent.map(event => event.type)).toEqual(['session.instructions.append', 'session.instructions.append']);
});

test('the list note follows the pick: keep pulling on the focus, and the empty note once Sol closes the lead', async () => {
  const maps = [mapWith([thread('t1'), thread('t2')]), mapWith([thread('t1', { status: 'done', reason: 'Answered in p4.' }), thread('t2', { status: 'off', reason: 'Not their area.' })])];
  const f = fixture({
    evaluateTurn: async input => {
      const id = input.transcript.at(-1)!.id;
      return reading(input, { novel: ['p2', 'p6'].includes(id) ? .9 : 0, focus: ['p4', 'p6'].includes(id) ? 't1' : null });
    },
    generateMap: async () => mapped(maps[Math.min(f.calls.map.length, 2) - 1]!),
  });
  await f.step(0);
  await f.step(20_000);
  await f.producer.settle();
  expect(f.notes('list')).toEqual([`${NOTE_HEADERS.list}\nWorth pulling next (Thread t1): still unknown: what happened with t1. Guess: a guess about t1.\nAlso open: Thread t2`]);

  await f.turn(25_000, 'The field crews did.');
  const read = f.of('turn')[1]!;
  expect(read.pick).toEqual({ current: 't1', action: 'keep', lead: 't1', nearby: ['t2'], ranked: [['t1', .43, 'nearby'], ['t2', .43, 'nearby']] });
  expect(f.of('note').at(-1)).toMatchObject({ kind: 'list', turnId: read.id });
  expect(f.notes('list').at(-1)).toBe(`${NOTE_HEADERS.list}\nKeep pulling (Thread t1): still unknown: what happened with t1. Guess: a guess about t1.\nNearby: Thread t2`);

  // The same pick is not sent again; Sol closing every thread replaces the note with the empty one, once.
  await f.turn(30_000, 'They worked from the trucks.');
  expect(f.notes('list')).toHaveLength(2);
  await f.step(40_000);
  await f.producer.settle();
  expect(f.notes('list')).toHaveLength(3);
  expect(f.notes('list').at(-1)).toBe(EMPTY_LIST_NOTE);
  await f.turn(45_000, 'That was most of it.');
  expect(f.notes('list')).toHaveLength(3);
});

test('map notes wait 60 s between sends and skip rewording, and a rejected one is resent after the spacing', async () => {
  const vantage = (text: string, detail = routing.detail) => mapWith([], { participant: { vantage: text, preferences: [] }, entities: [{ ...routing, detail }] });
  const maps = [vantage('Led the routing integration'), vantage('Led routing and the offline cache'), vantage('Led routing and the offline cache', 'Routing built on OpenStreetMap tiles and Mapbox.')];
  const f = fixture({ evaluateTurn: async input => reading(input, { novel: .9 }), generateMap: async () => mapped(maps[f.calls.map.length - 1]!) });
  await f.step(0);
  await f.step(20_000);
  expect(f.notes('map')).toHaveLength(1);
  await f.turn(25_000);
  await f.step(40_000);
  expect(f.of('map')[1]!.outcome).toBe('applied');
  await f.step(79_999);
  expect(f.notes('map')).toHaveLength(1);
  await f.step(80_000);
  expect(f.notes('map').at(-1)).toBe(`${NOTE_HEADERS.map}\nAbout the participant: Led routing and the offline cache.\nKnown so far: Routing layer: Built on OpenStreetMap and Mapbox.`);
  expect(f.notes('list')).toHaveLength(0);

  const second = f.of('note')[1]!;
  f.producer.providerEvent(second.id, false);
  expect(second).toMatchObject({ outcome: 'rejected', delivery: { status: 'rejected', acknowledgedAt: epoch + 80_000 } });
  await f.step(139_999);
  expect(f.notes('map')).toHaveLength(2);
  await f.step(140_000);
  expect(f.notes('map')).toHaveLength(3);
  expect(f.notes('map')[2]).toBe(f.notes('map')[1]!);

  await f.turn(145_000);
  await f.step(150_000);
  expect(f.of('map')[2]!.outcome).toBe('applied');
  await f.step(200_000);
  expect(f.notes('map')).toHaveLength(3);
});

test('a rejected or unsent list note goes out again at the next pick, and receipts record their timing', async () => {
  const focus: Record<string, string | null> = { p4: 't1', p6: 't1', p8: null, p10: null };
  const f = fixture({
    evaluateTurn: async input => { const id = input.transcript.at(-1)!.id; return reading(input, { novel: id === 'p2' ? .9 : 0, focus: focus[id] ?? null }); },
    generateMap: async () => mapped(mapWith([thread('t1')])),
  });
  await f.step(0);
  await f.step(20_000);
  const first = f.of('note')[0]!;
  f.at(21_000);
  f.producer.providerEvent(first.id, true, { startMs: 2000, endMs: 2400 });
  expect(first.delivery).toEqual({ eventId: first.id, afterPassageId: 'p2', status: 'accepted', acknowledgedAt: epoch + 21_000, startMs: 2000, endMs: 2400 });

  await f.turn(25_000);
  const keep = f.of('note').filter(note => note.kind === 'list')[1]!;
  f.producer.providerEvent(keep.id, false);
  await f.turn(30_000);
  f.setConnected(false);
  await f.turn(35_000);
  f.setConnected(true);
  await f.turn(40_000);
  const list = f.of('note').filter(note => note.kind === 'list');
  expect(list.map(note => [note.outcome, note.text.split('\n')[1]!.split(' (')[0]])).toEqual([
    ['sent', 'Worth pulling next'], ['rejected', 'Keep pulling'], ['sent', 'Keep pulling'], ['error', 'Worth pulling next'], ['sent', 'Worth pulling next'],
  ]);
  expect(list[2]!.text).toBe(list[1]!.text);
  expect(f.notes('list')).toHaveLength(4);
});

test('rejecting a list note a newer one replaced does not resend the newer one', async () => {
  const f = fixture({
    evaluateTurn: async input => { const id = input.transcript.at(-1)!.id; return reading(input, { novel: id === 'p2' ? .9 : 0, focus: id === 'p2' ? null : 't1' }); },
    generateMap: async () => mapped(mapWith([thread('t1')])),
  });
  await f.step(0);
  await f.step(20_000);
  await f.turn(25_000);
  const [first, keep] = f.of('note').filter(note => note.kind === 'list');
  expect(keep!.text).toStartWith(`${NOTE_HEADERS.list}\nKeep pulling`);
  f.producer.providerEvent(first!.id, false);
  expect(first!.outcome).toBe('rejected');
  await f.turn(30_000);
  expect(f.notes('list')).toHaveLength(2);
  f.producer.providerEvent(keep!.id, false);
  await f.turn(35_000);
  expect(f.notes('list')).toEqual([first!.text, keep!.text, keep!.text]);
});

test('the note cap stops every note, list and map alike', async () => {
  const f = fixture({
    evaluateTurn: async input => {
      const count = input.transcript.length;
      return reading(input, { novel: count === 2 ? .9 : 0, focus: count === 2 ? null : count % 4 === 0 ? 't1' : 't2' });
    },
    generateMap: async () => mapped(mapWith([thread('t1'), thread('t2')], { participant: { vantage: `Vantage ${f.calls.map.length}`, preferences: [] } })),
  });
  await f.step(0);
  await f.step(20_000);
  expect(f.sent).toHaveLength(2);
  for (let index = 1; index <= 110; index++) await f.turn(20_000 + index * 1000, `Answer ${index}.`);
  await f.step(400_000);
  await f.producer.settle();
  expect(f.of('note')).toHaveLength(PRODUCER_LIMITS.notes);
  expect(f.sent).toHaveLength(PRODUCER_LIMITS.notes);
  expect(f.producer.summary().notes).toBe(PRODUCER_LIMITS.notes);
  expect(f.of('map').length).toBeGreaterThan(1);
});

test('Sam’s next substantive passage after a note is recorded, ignoring backchannels, the participant and growth of a counted passage', async () => {
  const f = fixture({
    evaluateTurn: async input => { const id = input.transcript.at(-1)!.id; return reading(input, { novel: id === 'p2' ? .9 : 0, focus: id === 'p4' ? 't1' : null }); },
    generateMap: async () => mapped(mapWith([thread('t1')])),
  });
  await f.step(0);
  await f.step(20_000);
  const [list, map] = f.of('note');
  f.at(21_000);
  f.producer.transcriptChanged(f.say('client', 'Mm-hmm.'), 'p2');
  expect(list!.nextSamTurnAt).toBeUndefined();
  f.at(22_000);
  f.producer.transcriptChanged(f.grow('p3', 'Mm-hmm. Who used it?'), 'p2');
  expect([list!.nextSamTurnAt, list!.nextSamTurnAfterId, map!.nextSamTurnAt]).toEqual([epoch + 22_000, 'p2', epoch + 22_000]);

  f.at(24_000);
  const answer = f.say('trainee', 'The field crews did.');
  await f.step();
  f.producer.transcriptChanged(answer, 'p3');
  const keep = f.of('note')[2]!;
  expect(keep.nextSamTurnAt).toBeUndefined();
  f.at(26_000);
  f.producer.transcriptChanged(f.grow('p3', 'Mm-hmm. Who used it, and how?'), 'p2');
  expect(keep.nextSamTurnAt).toBeUndefined();
  f.at(27_000);
  f.producer.transcriptChanged(f.say('client', 'What changed for them?'), 'p4');
  expect([keep.nextSamTurnAt, keep.nextSamTurnAfterId, list!.nextSamTurnAt]).toEqual([epoch + 27_000, 'p4', epoch + 22_000]);
});

test('research requests are validated, deduplicated, one at a time, capped, and retried only after a failed lookup', async () => {
  const queue: (ResearchRequest | null)[] = [];
  const lookups: ReturnType<typeof deferred<Lookup>>[] = [];
  const f = fixture({
    evaluateTurn: async input => reading(input, { novel: .9 }),
    generateMap: async input => mapped(input.previous, queue.shift() ?? null),
    lookupInterviewBackground: () => { const pending = deferred<Lookup>(); lookups.push(pending); return pending.promise; },
  });
  let now = 0;
  const ask = async (next: ResearchRequest | null) => { queue.push(next); now += 20_000; await f.turn(now - 1000); await f.step(now); };

  await ask(request('Acme Field Systems'));
  await ask({ ...request('OpenStreetMap'), passageIds: ['p1'] });
  await ask(request('OpenStreetMap'));
  await ask(request('openstreetmap.'));
  await ask(request('Mapbox'));
  expect(f.calls.lookup).toHaveLength(1);
  lookups[0]!.reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
  await flush();
  await ask(request('OpenStreetMap'));
  lookups[1]!.resolve({ status: 'unresolved', reason: 'Ambiguous.', queries: [] });
  await flush();
  await ask(request('Mapbox'));
  lookups[2]!.resolve({ status: 'found', facts, retrievedAt: Date.now(), queries: [] });
  await flush();
  await ask(request('Mapbox', 'routing layer'));
  await ask(request('Mapbox'));
  await ask(null);

  expect(f.of('research').map(item => [item.outcome, item.reason])).toEqual([
    ['invalid', 'name_unspoken'], ['invalid', 'passages'], ['timeout', undefined], ['duplicate', 'duplicate'], ['busy', 'busy'],
    ['unresolved', 'Ambiguous.'], ['found', undefined], ['budget', 'budget'], ['duplicate', 'duplicate'],
  ]);
  expect(f.calls.lookup.map(item => [item.target, item.clue])).toEqual([
    [{ kind: 'product', name: 'OpenStreetMap' }, null], [{ kind: 'product', name: 'OpenStreetMap' }, null], [{ kind: 'product', name: 'Mapbox' }, null],
  ]);
  expect(f.of('research').map(item => item.mapId)).toEqual(f.of('map').slice(0, 9).map(item => item.id));
  expect(f.calls.map.at(-1)!.tail.research).toEqual({ left: 0, requests: [
    { kind: 'product', name: 'Acme Field Systems', clue: null, status: 'rejected (name_unspoken)' },
    { kind: 'product', name: 'OpenStreetMap', clue: null, status: 'rejected (passages)' },
    { kind: 'product', name: 'OpenStreetMap', clue: null, status: 'failed' },
    { kind: 'product', name: 'openstreetmap.', clue: null, status: 'already requested' },
    { kind: 'product', name: 'Mapbox', clue: null, status: 'another lookup was running' },
    { kind: 'product', name: 'OpenStreetMap', clue: null, status: 'found nothing reliable' },
    { kind: 'product', name: 'Mapbox', clue: null, status: 'found; see the event in the log' },
    { kind: 'product', name: 'Mapbox', clue: 'routing layer', status: 'no lookups left' },
    { kind: 'product', name: 'Mapbox', clue: null, status: 'already requested' },
  ] });
  expect(f.producer.summary().research).toBe(3);
});

test('a found lookup wakes Sol without new text, an unresolved one waits in the log, and a map note cites only lookups Sol had read', async () => {
  const research: MapEntity = { id: 'e2', kind: 'product', label: 'OpenStreetMap', detail: facts[0]!.text, source: 'research', passageId: null };
  const known = mapWith([], { participant: { vantage: 'Led the routing integration', preferences: [] } });
  const results = [mapped(known, request('OpenStreetMap')), mapped({ ...known, entities: [routing, research] }, request('Mapbox'))];
  const lookups: ReturnType<typeof deferred<Lookup>>[] = [];
  const f = fixture({
    evaluateTurn: async input => reading(input, { novel: .9 }),
    generateMap: async input => results[f.calls.map.length - 1] ?? mapped(input.previous),
    lookupInterviewBackground: () => { const pending = deferred<Lookup>(); lookups.push(pending); return pending.promise; },
  });
  await f.step(0);
  await f.step(20_000);
  expect(f.of('note')[0]).toMatchObject({ kind: 'map' });
  expect(f.of('note')[0]!.researchIds).toBeUndefined();

  f.at(30_000); lookups[0]!.resolve({ status: 'found', facts, retrievedAt: epoch + 29_000, queries: ['OpenStreetMap'] }); await flush();
  const [found] = f.of('research');
  expect(found).toMatchObject({ outcome: 'found', lookupAt: epoch + 30_000, completedAt: epoch + 30_000, queries: ['OpenStreetMap'] });
  expect(found!.loggedAt).toBeUndefined();
  await f.step(40_000);
  expect(f.calls.map[1]!.tail.reasons).toEqual(['public research arrived about the product "OpenStreetMap"']);
  expect(f.calls.map[1]!.blocks).toEqual([...f.calls.map[0]!.blocks,
    '[event · 0.5 min] Public research about the product "OpenStreetMap" (public background, not project fact): OpenStreetMap is a collaborative, openly licensed world map. [About OpenStreetMap]']);
  expect(found!.loggedAt).toBe(epoch + 40_000);

  f.at(45_000); lookups[1]!.resolve({ status: 'unresolved', reason: 'Several products share the name.', queries: [] }); await flush();
  const unresolved = f.of('research')[1]!;
  await f.step(79_999);
  expect(f.notes('map')).toHaveLength(1);
  await f.step(80_000);
  const note = f.of('note')[1]!;
  expect(note).toMatchObject({ kind: 'map', researchIds: [found!.id] });
  expect(note.text).toContain(`\nPublic background you read, not project fact: OpenStreetMap: ${facts[0]!.text}`);
  await f.step(110_000);
  expect(f.calls.map).toHaveLength(2);
  expect(unresolved.loggedAt).toBeUndefined();

  expect(f.producer.publicBackground()).toEqual([]);
  f.producer.providerEvent(note.id, true);
  expect(f.producer.publicBackground()).toEqual([{ id: found!.id, target: { kind: 'product', name: 'OpenStreetMap' }, facts, retrievedAt: epoch + 29_000 }]);

  // The event alone doesn't call Sol on the minute; new participant text does.
  await f.turn(115_000);
  expect(f.calls.map[2]!.tail.reasons).toEqual([MINUTE]);
  expect(f.calls.map[2]!.blocks.at(-1)).toContain('[event · 0.8 min] Public research about the product "Mapbox" found nothing reliable: Several products share the name.');
  expect(unresolved.loggedAt).toBe(epoch + 115_000);
});

test('Jev re-reads a turn that grew without counting another turn on the thread, skips Sam’s turn, and drops a late reading', async () => {
  const late = deferred<Read>();
  const f = fixture({
    evaluateTurn: async input => {
      const id = input.transcript.at(-1)!.id;
      if (id === 'p9') return late.promise;
      return reading(input, id === 'p2' ? { novel: .9 } : id === 'p7' ? { focus: 't1', states: { t1: 'answered' }, novel: .9 } : { focus: 't1' });
    },
    generateMap: async () => mapped(mapWith([thread('t1'), thread('t2')])),
  });
  await f.step(0);
  await f.step(20_000);
  await f.turn(25_000, 'The crews tested it.');
  expect(f.producer.rankingState).toMatchObject({ current: 't1', turnsOnCurrent: 1 });
  f.grow('p4', 'The crews tested it in the hills.');
  await f.step();
  await f.step();
  f.say('trainee', 'For about a month.');
  await f.step();
  expect(f.calls.turn.map(item => item.transcript.at(-1)!.id)).toEqual(['p2', 'p4', 'p4', 'p5']);
  expect(f.calls.turn[2]!.transcript[3]!.text).toBe('The crews tested it in the hills.');
  expect(f.producer.rankingState).toMatchObject({ current: 't1', turnsOnCurrent: 1 });
  f.say('client', 'And then?');
  await f.step();
  expect(f.calls.turn).toHaveLength(4);

  // A new turn counts; its answered reading reaches Sol's next call as a signal.
  f.say('trainee', 'Then we shipped it.');
  await f.step(26_000);
  expect(f.producer.rankingState).toMatchObject({ current: 't1', turnsOnCurrent: 2 });
  await f.step(40_000);
  expect(f.calls.map[1]!.tail.signals).toEqual([{ threadId: 't1', state: 'answered' }]);

  f.at(41_000); f.say('client', 'Who used it first?'); f.say('trainee', 'The northern crew.');
  await f.step();
  f.at(44_000); late.resolve(reading(f.calls.turn.at(-1)!, { focus: 't2', novel: .9 })); await flush();
  expect(f.of('turn').at(-1)).toMatchObject({ outcome: 'timeout', completedAt: epoch + 44_000 });
  expect(f.of('turn').at(-1)!.reading).toBeUndefined();
  expect(f.producer.rankingState.current).toBe('t1');
  await f.step(60_000);
  expect(f.calls.map).toHaveLength(2);
  expect(f.producer.summary().turns).toBe(6);
});

test('a failed trait read is not retried until Sol’s next map, and a thread Sol rewrites during a read is read again', async () => {
  const pending = deferred<Traits>();
  const rewritten = thread('t1', { unknown: 'who maintained the offline tiles' });
  const f = fixture({
    evaluateTurn: async input => reading(input, { novel: .9 }),
    generateMap: async () => mapped(mapWith([f.calls.map.length < 3 ? thread('t1') : rewritten])),
    evaluateTraits: async input => {
      if (f.calls.traits.length === 1) throw new Error('upstream 500');
      return f.calls.traits.length === 2 ? pending.promise : traits(input);
    },
  });
  await f.step(0);
  await f.step(20_000);
  await f.turn(25_000);
  expect(f.of('traits').map(item => item.outcome)).toEqual(['error']);
  expect(f.calls.traits).toHaveLength(1);

  await f.step(40_000);
  expect(f.calls.traits).toHaveLength(2);
  await f.turn(45_000);
  await f.step(60_000);
  expect(f.of('map').map(item => item.outcome)).toEqual(['applied', 'applied', 'applied']);
  expect(f.calls.traits).toHaveLength(2);
  pending.resolve(traits(f.calls.traits[1]!));
  await f.producer.settle();
  expect(f.calls.traits.map(item => item.threads[0]!.unknown)).toEqual(['what happened with t1', 'what happened with t1', 'who maintained the offline tiles']);
  expect(f.of('traits').map(item => item.outcome)).toEqual(['error', 'read', 'read']);
  expect(f.producer.rankingState.traits.t1!.key).toBe(threadKey(rewritten));
});

test('End aborts pending work, ignores late results, and records nothing after', async () => {
  const solCall = deferred<Mapped>();
  const turnRead = deferred<Read>();
  const traitRead = deferred<Traits>();
  const lookup = deferred<Lookup>();
  const f = fixture({
    evaluateTurn: async input => input.transcript.at(-1)!.id === 'p2' ? reading(input, { novel: .9 }) : turnRead.promise,
    generateMap: async () => f.calls.map.length === 1 ? mapped(mapWith([thread('t1')]), request('OpenStreetMap')) : solCall.promise,
    evaluateTraits: () => traitRead.promise,
    lookupInterviewBackground: () => lookup.promise,
  });
  await f.step(0);
  await f.step(20_000);
  f.producer.delegation('delegation-1', 'notes', true);
  await f.turn(25_000);
  await f.step(80_000);
  expect(f.calls.map).toHaveLength(2);
  const sent = f.sent.length;

  f.at(81_000);
  f.producer.close();
  const pending = f.producer.records.filter(item => item.source !== 'note' && item.source !== 'delegation');
  expect(pending.map(item => [item.source, item.outcome])).toEqual([['turn', 'read'], ['map', 'applied'], ['research', 'aborted'], ['traits', 'aborted'], ['turn', 'aborted'], ['map', 'aborted']]);
  expect(pending.slice(2).map(item => item.completedAt)).toEqual([epoch + 81_000, epoch + 81_000, epoch + 81_000, epoch + 81_000]);
  expect(f.calls.map[1]!.signal.aborted).toBe(true);
  const archived = JSON.stringify(f.producer.records);

  solCall.resolve(mapped(mapWith([thread('t1'), thread('t2')], { participant: { vantage: 'Changed', preferences: [] } })));
  turnRead.resolve(reading(f.calls.turn[1]!, { focus: 't1', novel: .9 }));
  traitRead.resolve(traits(f.calls.traits[0]!));
  lookup.resolve({ status: 'found', facts, retrievedAt: Date.now(), queries: [] });
  await f.producer.settle();
  f.producer.providerEvent(f.of('note')[0]!.id, true);
  f.producer.delegation('delegation-2', 'notes', true);
  f.producer.transcriptChanged(f.say('client', 'What changed for the crews?'), 'p4');
  await f.step(200_000);
  expect(JSON.stringify(f.producer.records)).toBe(archived);
  expect(f.sent).toHaveLength(sent);
  expect(f.producer.conversationMap.threads.map(item => item.id)).toEqual(['t1']);
  expect(f.of('delegation')).toEqual([{ source: 'delegation', id: 'delegation-1', createdAt: epoch + 20_000, target: 'notes', replied: true }]);
  expect(f.producer.summary()).toMatchObject({ maps: 2, applied: 1, turns: 2, notes: 2, research: 1 });
});
