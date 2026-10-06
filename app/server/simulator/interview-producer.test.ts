import { fixtureFoundry } from '../../../ai/foundry-fixture';
import { afterEach, expect, setSystemTime, test } from 'bun:test';
import { MAP_PROMPT_VERSION, MapOutputError } from '../../../ai/interview/map.server';
import { RANKING_RUBRIC_VERSION } from '../../../ai/interview/ranking.server';
import { DirectorHttpError, DirectorOutputError } from '../../../ai/simulator/sol.server';
import { emptyMap, type ConversationMap, type MapEntity, type MapPace, type MapThread } from '../../../core/interview-map';
import { emptyListNote, NOTE_HEADERS, noteHeaders } from '../../../core/interview-notes';
import { PRODUCER_LIMITS, PRODUCER_VERSION, type ProducerLogRecord, type ResearchRequest } from '../../../core/interview-producer';
import { threadKey, type TurnReading } from '../../../core/interview-ranking';
import type { PauseSpan } from '../../../core/simulator/state';
import type { TranscriptEntry } from '../../../core/simulator/types';
import type { InterviewObjectiveReading } from '../../../core/interview';
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
  map, update: { vantage: null, preferences: null, entities: [], edges: [], threads: [], revise: [], close: [], drop: [] },
  changes: { added: [], changed: [], dropped: [], kept: [] }, research, pace: { verdict: 'explore' as const, reason: 'Open threads remain.' }, model: 'gpt-6.1-sol', usage,
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

// Only the paid calls are substituted; timing, the log, ranking, validation, budgets and delivery are real. Notes go
// out as soon as they're decided unless `held`, which waits for Sam's words as the live session does.
function fixture(overrides: Partial<Services> = {}, channel?: 'session.instructions.append', { held = false } = {}) {
  setSystemTime(epoch);
  let transcript: TranscriptEntry[] = [
    { id: 'p1', speaker: 'client', text: 'What did the team build?', startMs: 0, endMs: 1000 },
    { id: 'p2', speaker: 'trainee', text: 'We integrated OpenStreetMap and Mapbox for the routing layer.', startMs: 1000, endMs: 4000 },
  ];
  let connected: boolean | 'throw' = true;
  let talking = false;
  let coverage: InterviewObjectiveReading[] = [];
  const sent: Record<string, unknown>[] = [];
  const calls = { map: [] as Input<'generateMap'>[], turn: [] as Input<'evaluateTurn'>[], traits: [] as Input<'evaluateTraits'>[], lookup: [] as Input<'lookupInterviewBackground'>[] };
  const pauses: PauseSpan[] = [];
  const producer = new InterviewProducer({
    attemptId: 'attempt-1', startedAt: epoch, foundry: fixtureFoundry, typesafeKey: 'typesafe-fixture', channel, pauses: () => pauses, immediate: !held,
    settled: () => transcript, coverage: () => coverage, talking: () => talking, send: event => { if (connected === 'throw') throw new Error('socket closed'); if (!connected) return false; sent.push(event); return true; },
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
  /** Sam starts speaking, as the live transcript reports each of Sam's deltas. */
  const sam = (text = 'Tell me more?') => { const previous = transcript.at(-1)?.id ?? null; const entry = say('client', text); producer.transcriptChanged(entry, previous); return entry; };
  /** Sam asks, the participant answers, and the tick reads the new turn. */
  const turn = async (ms: number, text = 'It took a while to get right.') => { at(ms); say('client', 'Tell me more?'); say('trainee', text); await step(); };
  const at = (ms: number) => setSystemTime(epoch + ms);
  const step = async (ms?: number) => { if (ms != null) at(ms); producer.tick(Date.now()); await flush(); };
  const of = <S extends ProducerLogRecord['source']>(source: S) => producer.records.filter(item => item.source === source) as Extract<ProducerLogRecord, { source: S }>[];
  const notes = (kind?: keyof typeof NOTE_HEADERS) => sent.filter(event => !kind || String(event.content).startsWith(NOTE_HEADERS[kind])).map(event => String(event.content));
  return {
    producer, sent, calls, pauses, say, sam, grow, turn, at, step, of, notes,
    setConnected: (value: boolean | 'throw') => { connected = value; },
    setTalking: (value: boolean) => { talking = value; },
    setCoverage: (levels: InterviewObjectiveReading['level'][]) => { coverage = levels.map((level, i) => ({ id: `o${i}`, level, achieved: level === 'explored', probability: null, levels: null, evidence: null })); },
  };
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

test('two fairly new turns since Sol’s last call wake it, a turn that grew counting once', async () => {
  const f = fixture({ evaluateTurn: async input => reading(input, { novel: .6 }) });
  await f.step(0);
  f.grow('p2', 'We integrated OpenStreetMap and Mapbox for the routing layer, then rebuilt it twice.');
  await f.step(1000);
  expect(f.calls.turn).toHaveLength(2);
  await f.step(21_000);
  expect(f.calls.map).toHaveLength(0);
  await f.turn(22_000);
  await f.step(22_500);
  expect(f.calls.map.map(item => item.tail.reasons)).toEqual([["the participant's last 2 turns add things the map lacks"]]);
  // The call starts the count over.
  await f.turn(45_000);
  await f.step(46_000);
  expect(f.calls.map).toHaveLength(1);
});

test('a stall on the thread the participant is on wakes Sol to ask it another way; a stall elsewhere doesn’t', async () => {
  const f = fixture({
    evaluateTurn: async input => {
      const id = input.transcript.at(-1)!.id;
      return reading(input, id === 'p2' ? { novel: .9 } : { focus: 't1', states: id === 'p4' ? { t2: 'stalled' } : { t1: 'stalled' } });
    },
    generateMap: async () => mapped(mapWith([thread('t1'), thread('t2')])),
  });
  await f.step(0);
  await f.step(20_000);
  await f.turn(30_000);
  await f.step(41_000);
  expect(f.calls.map).toHaveLength(1);
  await f.turn(45_000);
  await f.step(45_500);
  expect(f.calls.map[1]!.tail.reasons).toEqual(["the participant's latest turn (p6) didn't move the thread they're on (t1); its gap may need asking another way"]);
  // No hold: the thread waits for Sol's rewrite, not three minutes.
  expect(f.producer.rankingState.holds).toEqual({});
});

test('a new participant preference reaches Sam without waiting out the map-note spacing', async () => {
  const prefer = (vantage: string, preferences: string[] = []) => mapWith([], { participant: { vantage, preferences: preferences.map(text => ({ text, passageId: 'p4' })) } });
  const maps = [prefer('Led the routing integration'), prefer('Led routing and the offline cache'), prefer('Led routing and the offline cache', ['Shorter questions, one at a time'])];
  const f = fixture({ evaluateTurn: async input => reading(input, { novel: .9 }), generateMap: async () => mapped(maps[f.calls.map.length - 1]!) });
  await f.step(0);
  await f.step(20_000);
  expect(f.notes('map')).toHaveLength(1);
  // A reworded vantage waits for the spacing.
  await f.turn(25_000);
  await f.step(40_000);
  expect(f.notes('map')).toHaveLength(1);
  // A preference doesn't, and carries the vantage change with it.
  await f.turn(45_000);
  await f.step(60_000);
  expect(f.notes('map')).toHaveLength(2);
  expect(f.notes('map')[1]).toBe(`${NOTE_HEADERS.map}\nAbout the participant: Led routing and the offline cache.\nThey prefer: Shorter questions, one at a time.\nKnown so far: Routing layer: Built on OpenStreetMap and Mapbox.`);
});

test('a Sol call past its timeout is abandoned, its late result is ignored, and the minute retries the unmapped text', async () => {
  const slow = deferred<Mapped>();
  const f = fixture({
    evaluateTurn: async input => reading(input, { novel: .9 }),
    generateMap: async input => f.calls.map.length === 1 ? slow.promise : mapped(input.previous),
  });
  await f.step(0);
  await f.step(20_000);
  await f.step(69_999);
  expect(f.of('map')[0]!.outcome).toBe('pending');
  await f.step(70_000);
  expect(f.of('map')[0]).toMatchObject({ outcome: 'timeout', completedAt: epoch + 70_000 });
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
      throw outcome === 'invalid' ? new MapOutputError([{ kind: 'dangling', id: 't1', detail: 'anchor e9' }], {}, 'gpt-6.1-sol-2', { inputTokens: 3, outputTokens: 4 }) : new DirectorHttpError(503, 'request-123');
    },
  });
  await f.step(0);
  await f.step(20_000);
  expect(f.of('map')[0]).toMatchObject(outcome === 'invalid'
    ? { outcome, completedAt: epoch + 20_000, defects: [{ kind: 'dangling', id: 't1', detail: 'anchor e9' }], model: 'gpt-6.1-sol-2', usage: { inputTokens: 3, outputTokens: 4 } }
    : { outcome, completedAt: epoch + 20_000, model: 'gpt-6.1-sol', failure: { name: 'DirectorHttpError', status: 503, requestId: 'request-123' } });
  await f.step(79_999);
  expect(f.calls.map).toHaveLength(1);
  await f.step(80_000);
  expect(f.calls.map[1]!.tail.reasons).toEqual([MINUTE]);
  expect(f.of('map')[1]!.outcome).toBe('applied');
  await f.step(140_000);
  expect(f.calls.map).toHaveLength(2);
});

test('an incomplete Sol response keeps the stop reason and charged usage in the archive', async () => {
  const f = fixture({ generateMap: async () => { throw new DirectorOutputError('max_output_tokens', { inputTokens: 300, outputTokens: 1800, reasoningTokens: 1700 }); } });
  await f.step(60_000);
  expect(f.of('map')[0]).toMatchObject({ outcome: 'error', failure: { name: 'DirectorOutputError', detail: 'max_output_tokens' },
    usage: { inputTokens: 300, outputTokens: 1800, reasoningTokens: 1700 } });
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

test('an applied map sends the map note, reads traits for its new threads, and sends the list note once a thread scores', async () => {
  const map = mapWith([thread('t1', { label: 'Field crews', unknown: 'how crews used the routing layer offline', guess: 'paper maps as a backup' })],
    { participant: { vantage: 'Led the routing integration', preferences: [] } });
  const f = fixture({ evaluateTurn: async input => reading(input, { novel: .9 }), generateMap: async () => mapped(map) });
  await f.step(0);
  await f.step(20_000);
  await f.producer.settle();
  const [solCall] = f.of('map');
  // Before the traits land, every thread scores nothing, so no thread leads yet.
  expect(f.notes()).toEqual([
    `${NOTE_HEADERS.map}\nAbout the participant: Led the routing integration.\nKnown so far: Routing layer: Built on OpenStreetMap and Mapbox.`,
    `${NOTE_HEADERS.list}\nWorth pulling next (Field crews): still unknown: how crews used the routing layer offline. Guess: paper maps as a backup.`,
  ]);
  const notes = f.of('note');
  expect(f.sent.map(event => [event.type, event.event_id, event.delegation_id])).toEqual(notes.map(note => ['session.thinking.append', note.id, null]));
  expect(notes.map(note => [note.kind, note.mapId, note.sentAt, note.delivery])).toEqual([
    ['map', solCall!.id, epoch + 20_000, { eventId: notes[0]!.id, afterPassageId: 'p2', status: 'unknown' }],
    ['list', solCall!.id, epoch + 20_000, { eventId: notes[1]!.id, afterPassageId: 'p2', status: 'unknown' }],
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

test('appended instructions carry the same notes under that channel’s softer headers', async () => {
  const f = fixture({ evaluateTurn: async input => reading(input, { novel: .9 }), generateMap: async () => mapped(mapWith([thread('t1')])) }, 'session.instructions.append');
  await f.step(0);
  await f.step(20_000);
  expect(f.sent.map(event => event.type)).toEqual(['session.instructions.append', 'session.instructions.append']);
  const headers = noteHeaders('session.instructions.append');
  expect(f.sent.map(event => String(event.content).split('\n')[0])).toEqual([headers.map, headers.list]);
});

test('the list note follows the lead: taking up the thread doesn’t resend it, and the empty note replaces it once Sol closes the lead', async () => {
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
  expect(f.notes('list')).toEqual([`${NOTE_HEADERS.list}\nWorth pulling next (Thread t1): still unknown: what happened with t1. Guess: a guess about t1.\nIf that’s answered, then (Thread t2): still unknown: what happened with t2. Guess: a guess about t2.`]);

  await f.turn(25_000, 'The field crews did.');
  const read = f.of('turn')[1]!;
  expect(read.pick).toEqual({ current: 't1', action: 'keep', lead: 't1', nearby: ['t2'], ranked: [['t1', .43, 'nearby'], ['t2', .43, 'nearby']] });
  // The tug became keep-pulling on the same thread: Sam already has it, so nothing is sent.
  expect(f.notes('list')).toHaveLength(1);
  await f.turn(30_000, 'They worked from the trucks.');
  expect(f.notes('list')).toHaveLength(1);
  // Sol closing every thread replaces the note with the empty one, once.
  await f.step(40_000);
  await f.producer.settle();
  expect(f.notes('list')).toHaveLength(2);
  expect(f.notes('list').at(-1)).toBe(emptyListNote());
  await f.turn(45_000, 'That was most of it.');
  expect(f.notes('list')).toHaveLength(2);
});

test('a thread the list note named is closed, off or done, so the note is replaced without it', async () => {
  const maps = [
    mapWith([thread('t1'), thread('t2'), thread('t3')]),
    mapWith([thread('t1'), thread('t2'), thread('t3', { status: 'off', reason: 'Not their area.' })]),
    mapWith([thread('t1'), thread('t2', { status: 'done', reason: 'Answered in p6.' })]),
  ];
  const f = fixture({ evaluateTurn: async input => reading(input, { novel: .9 }), generateMap: async () => mapped(maps[f.calls.map.length - 1]!) });
  await f.step(0);
  await f.step(20_000);
  await f.turn(25_000);
  await f.step(40_000);
  await f.turn(45_000);
  await f.step(60_000);
  expect(f.calls.map).toHaveLength(3);
  const lead = `${NOTE_HEADERS.list}\nWorth pulling next (Thread t1): still unknown: what happened with t1. Guess: a guess about t1.`;
  const next = 'If that’s answered, then (Thread t2): still unknown: what happened with t2. Guess: a guess about t2.';
  expect(f.notes('list')).toEqual([`${lead}\n${next}\nAlso open: Thread t3`, `${lead}\n${next}`, lead]);
});

test('a declined nearby thread is removed from Sam’s note before Sol revises the map', async () => {
  const f = fixture({
    generateMap: async () => mapped(mapWith([thread('t1'), thread('t2'), thread('t3')])),
    evaluateTurn: async input => reading(input, input.transcript.at(-1)!.id === 'p2'
      ? { novel: .9 }
      : { focus: 't1', states: input.transcript.at(-1)!.text.includes('cannot speak') ? { t2: 'declined' } : {} }),
  });
  await f.step(0);
  await f.step(20_000);
  await f.turn(25_000, 'I built that part myself.');
  expect(f.notes('list').at(-1)).toContain('If that’s answered, then (Thread t2)');
  expect(f.notes('list').at(-1)).toContain('Also open: Thread t3');
  await f.turn(26_000, 'I can discuss the build, but cannot speak to the launch.');
  expect(f.calls.map).toHaveLength(1);
  expect(f.notes('list').at(-1)).toContain('Keep pulling (Thread t1)');
  expect(f.notes('list').at(-1)).toContain('If that’s answered, then (Thread t3)');
  expect(f.notes('list').at(-1)).not.toContain('Thread t2');
});

test('a reading that lands while the participant is talking again waits for them to stop before it moves the lead', async () => {
  const f = fixture({
    generateMap: async () => mapped(mapWith([thread('t1'), thread('t2')])),
    evaluateTurn: async input => { const id = input.transcript.at(-1)!.id; return reading(input, id === 'p2' ? { novel: .9 } : { natural: { t2: 1 } }); },
  });
  await f.step(0);
  await f.step(20_000);
  expect(f.notes('list')).toHaveLength(1);
  expect(f.notes('list')[0]).toContain('(Thread t1)');
  f.setTalking(true);
  await f.turn(25_000);
  await f.step(26_000);
  const [, record] = f.of('turn');
  expect(record!.deferred).toBe(true);
  expect(f.notes('list')).toHaveLength(1);
  expect(f.producer.checkpoint().deferredTurnId).toBe(record!.id);
  f.setTalking(false);
  await f.step(27_000);
  expect(f.notes('list')).toHaveLength(2);
  expect(f.notes('list')[1]).toContain('Worth pulling next (Thread t2)');
  expect(record!.pick?.lead).toBe('t2');
  expect(f.of('note').filter(note => note.kind === 'list')[1]!.turnId).toBe(record!.id);
  expect(f.producer.checkpoint().deferredTurnId).toBeNull();
});

test('a lead Sol closes while the participant is talking is replaced once they stop', async () => {
  let maps = 0;
  const f = fixture({
    generateMap: async () => ++maps === 1 ? mapped(mapWith([thread('t1'), thread('t2')])) : mapped(mapWith([thread('t1', { status: 'done' }), thread('t2')])),
    evaluateTurn: async input => reading(input, input.transcript.at(-1)!.id === 'p2' ? { novel: .9 } : {}),
  });
  await f.step(0);
  await f.step(20_000);
  expect(f.notes('list')).toHaveLength(1);
  f.at(79_000); f.say('trainee', 'And the field crews tested it.');
  await f.step();
  expect(f.calls.turn).toHaveLength(2);
  f.setTalking(true);
  await f.step(80_000);
  expect(f.calls.map).toHaveLength(2);
  expect(f.of('turn').some(record => record.deferred)).toBe(false);
  await f.step(81_000);
  expect(f.notes('list')).toHaveLength(1);
  f.setTalking(false);
  await f.step(82_000);
  expect(f.notes('list')).toHaveLength(2);
  expect(f.notes('list')[1]).toContain('(Thread t2)');
});

test('a complaint about the interview sets the lead aside for one turn, and a refresh doesn’t restore it', async () => {
  const f = fixture({
    generateMap: async () => mapped(mapWith([thread('t1'), thread('t2')])),
    evaluateTurn: async input => {
      const last = input.transcript.at(-1)!;
      return reading(input, last.id === 'p2' ? { novel: .9 } : { complaint: last.text.includes('same question') ? .9 : .1, natural: { t2: 1 } });
    },
  });
  await f.step(0);
  await f.step(20_000);
  await f.turn(25_000, 'You keep asking me the same question.');
  const complaint = f.notes('list').at(-1)!;
  expect(complaint).toContain('feedback on the interview itself');
  expect(complaint).not.toContain('pulling');
  expect(f.of('turn').at(-1)!.reading?.complaint).toBe(.9);
  await f.step(80_000);
  expect(f.calls.map).toHaveLength(2);
  expect(f.notes('list').at(-1)).toBe(complaint);
  await f.turn(85_000, 'Fine, the crews used it every day.');
  expect(f.notes('list').at(-1)).toContain('Worth pulling next (Thread t2)');
});

const OFFER_LINE = /^Pace: after their next complete answer, offer once, in place of a new question, to stop here or carry on with Thread t1 or Thread t2\. Their call\.$/m;
/** Sol allows an offer to stop on every map; a turn that says "new" adds what the map lacks. */
function pacedFixture(held = false) {
  let pace: MapPace = { verdict: 'may-offer-finish', reason: 'Only thin threads remain.' };
  let wait: Promise<unknown> | null = null;
  const f = fixture({
    generateMap: async () => { const verdict = pace; if (wait) await wait; return { ...mapped(mapWith([thread('t1'), thread('t2')])), pace: verdict }; },
    evaluateTurn: async input => { const last = input.transcript.at(-1)!; return reading(input, { focus: 't1', novel: last.id === 'p2' || last.text.includes('new') ? .9 : 0 }); },
  }, undefined, { held });
  return { ...f, setPace: (value: MapPace) => { pace = value; }, setWait: (value: Promise<unknown> | null) => { wait = value; } };
}
const offers = (f: ReturnType<typeof fixture>) => f.of('note').filter(note => note.offer);

test('Sam may offer to stop only once Sol allows it, three maps and ten minutes in, and the participant’s answer spends the grant', async () => {
  const f = pacedFixture();
  await f.step(0);
  await f.step(20_000);
  await f.turn(30_000);
  await f.step(85_000);
  await f.turn(90_000);
  await f.step(150_000);
  expect(f.of('map').filter(item => item.outcome === 'applied')).toHaveLength(3);
  expect(f.of('map')[0]!.pace).toEqual({ verdict: 'may-offer-finish', reason: 'Only thin threads remain.' });
  await f.turn(590_000);
  expect(f.notes('list').join('\n')).not.toContain('Pace:');

  await f.turn(600_000);
  expect(f.notes('list').at(-1)).toMatch(OFFER_LINE);
  expect(offers(f)).toHaveLength(1);
  // The offer is made once: neither a refresh nor a turn that doesn't answer it resends it.
  await f.step(660_000);
  await f.producer.settle();
  expect(offers(f)).toHaveLength(1);
  // The participant answers it; the grant is spent and the note goes out again without the offer.
  await f.turn(665_000, 'Let’s keep going.');
  expect(f.notes('list').at(-1)).not.toContain('Pace:');
  expect(offers(f)).toHaveLength(1);
  // Sol's next grant waits out the spacing since the last offer.
  await f.step(725_000);
  await f.producer.settle();
  await f.turn(770_000);
  expect(offers(f)).toHaveLength(1);
  await f.turn(781_000);
  expect(offers(f)).toHaveLength(2);
});

test('a turn that adds what the map lacks spends Sol’s grant before an offer, explore never offers, and Sol’s next call grants afresh', async () => {
  const f = pacedFixture();
  await f.step(0);
  await f.step(20_000);
  await f.turn(30_000);
  await f.step(85_000);
  await f.turn(90_000);
  await f.step(150_000);
  // Sol's call on this turn is still running when it is read: its newness outdates the grant Sol made before it.
  const blocked = deferred<void>();
  f.setWait(blocked.promise);
  f.setPace({ verdict: 'explore', reason: 'They just raised something new.' });
  await f.turn(600_000, 'Something new came up.');
  expect(f.of('map').at(-1)!.outcome).toBe('pending');
  expect(offers(f)).toHaveLength(0);
  f.setWait(null);
  blocked.resolve();
  await f.producer.settle();
  await f.turn(665_000);
  expect(offers(f)).toHaveLength(0);
  f.setPace({ verdict: 'may-offer-finish', reason: 'Only thin threads remain.' });
  await f.turn(730_000);
  expect(offers(f)).toHaveLength(1);
});

test('notes decided while Sam is quiet wait for Sam’s next words, map first and latest of each kind, so none lands in the participant’s pause', async () => {
  const f = fixture({
    generateMap: async () => mapped(mapWith([thread('t1'), thread('t2')], { participant: { vantage: 'Routing lead.', preferences: [] } })),
    evaluateTurn: async input => { const id = input.transcript.at(-1)!.id; return reading(input, { novel: id === 'p2' ? .9 : 0, natural: id === 'p2' ? {} : { t2: 1 } }); },
  }, undefined, { held: true });
  await f.step(0);
  await f.step(20_000);
  expect(f.of('map')).toHaveLength(1);
  expect(f.sent).toHaveLength(0);
  // Neither a backchannel nor the participant releases them.
  f.at(21_000);
  f.sam('Mm-hmm.');
  f.say('trainee', 'And then the crews');
  await f.step(25_000);
  expect(f.sent).toHaveLength(0);
  // Their turn moved the lead before Sam spoke: only the newer thread note goes out.
  f.at(26_000);
  const next = f.sam('Who');
  expect(f.notes().map(text => text.split('\n')[0])).toEqual([NOTE_HEADERS.map, NOTE_HEADERS.list]);
  expect(f.notes('list')[0]).toContain('(Thread t2)');
  const [map, list] = f.of('note');
  expect([map!.decidedAt, map!.sentAt, list!.decidedAt, list!.sentAt, list!.nextSamTurnAt, list!.delivery.afterPassageId])
    .toEqual([epoch + 20_000, epoch + 26_000, epoch + 25_000, epoch + 26_000, epoch + 26_000, next.id]);
  expect(f.producer.summary().notes).toBe(2);
  // Sam's next delta has nothing left to send.
  f.producer.transcriptChanged(f.grow(next.id, 'Who used it?'), 'p4');
  expect(f.sent).toHaveLength(2);
});

test('a held note is dropped by a pause, the resume restates at once, and a held offer is dropped if the participant spoke since', async () => {
  const f = pacedFixture(true);
  await f.step(0);
  await f.step(20_000);
  f.sam();
  expect(f.sent).toHaveLength(2);
  await f.turn(30_000);
  await f.step(85_000);
  await f.turn(90_000);
  await f.step(150_000);
  f.sam();
  const before = f.sent.length;
  // An offer decided in their pause waits; they speak again before Sam does, so it is dropped and decided afresh.
  await f.turn(600_000);
  f.say('trainee', 'Oh, and one more thing.');
  f.setTalking(true);
  f.sam('Right, and then?');
  expect(f.sent).toHaveLength(before);
  expect(offers(f)).toHaveLength(0);
  f.setTalking(false);
  await f.step(602_000);
  f.sam('So what then?');
  expect(offers(f)).toHaveLength(1);
  expect(f.notes('list').at(-1)).toMatch(OFFER_LINE);

  await f.turn(605_000, 'Let’s keep going.');
  f.at(606_000);
  const span: PauseSpan = { from: epoch + 606_000, to: null };
  f.pauses.push(span);
  f.producer.pause();
  f.at(620_000);
  span.to = epoch + 620_000;
  const sent = f.sent.length;
  f.producer.resume(Date.now());
  // The notes in force are restated without waiting for Sam; the held one was dropped.
  expect(f.sent.length).toBeGreaterThan(sent);
  expect(f.notes('list').at(-1)).not.toContain('Pace:');
  const restated = f.sent.length;
  f.sam('Where were we?');
  expect(f.sent).toHaveLength(restated);
});

test('withdrawing every map fact supersedes the previous map note', async () => {
  const f = fixture({
    evaluateTurn: async input => reading(input, { novel: .9 }),
    generateMap: async () => mapped(f.calls.map.length === 1 ? mapWith([]) : emptyMap()),
  });
  await f.step(0);
  await f.step(20_000);
  expect(f.notes('map').at(-1)).toContain('Built on OpenStreetMap and Mapbox.');
  await f.turn(25_000, 'That was only a made-up example. Disregard those details.');
  await f.step(40_000);
  await f.step(80_000);
  expect(f.notes('map')).toHaveLength(2);
  expect(f.notes('map').at(-1)).toContain('withdrawn');
  expect(f.notes('map').at(-1)).not.toContain('OpenStreetMap');
});

test('map notes wait 60 s between sends, carry a reworded fact, and a rejected one is resent after the spacing', async () => {
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

  // Sol corrects a fact by rewording it; Sam gets the correction once the spacing allows.
  await f.turn(145_000);
  await f.step(150_000);
  expect(f.of('map')[2]!.outcome).toBe('applied');
  await f.step(199_999);
  expect(f.notes('map')).toHaveLength(3);
  await f.step(200_000);
  expect(f.notes('map')).toHaveLength(4);
  expect(f.notes('map')[3]).toEndWith('Known so far: Routing layer: Routing built on OpenStreetMap tiles and Mapbox.');
});

test('a rejected or unsent list note goes out again at the next pick, and receipts record their timing', async () => {
  const natural: Record<string, string> = { p4: 't2', p6: 't2', p8: 't1', p10: 't1' };
  const f = fixture({
    evaluateTurn: async input => { const id = input.transcript.at(-1)!.id; return reading(input, { novel: id === 'p2' ? .9 : 0, natural: natural[id] ? { [natural[id]]: 1 } : {} }); },
    generateMap: async () => mapped(mapWith([thread('t1'), thread('t2')])),
  });
  await f.step(0);
  await f.step(20_000);
  const first = f.of('note').find(note => note.kind === 'list')!;
  f.at(21_000);
  f.producer.providerEvent(first.id, true, { startMs: 2000, endMs: 2400 });
  expect(first.delivery).toEqual({ eventId: first.id, afterPassageId: 'p2', status: 'accepted', acknowledgedAt: epoch + 21_000, startMs: 2000, endMs: 2400 });

  await f.turn(25_000);
  const next = f.of('note').filter(note => note.kind === 'list')[1]!;
  f.producer.providerEvent(next.id, false);
  await f.turn(30_000);
  f.setConnected(false);
  await f.turn(35_000);
  f.setConnected(true);
  await f.turn(40_000);
  const list = f.of('note').filter(note => note.kind === 'list');
  expect(list.map(note => [note.outcome, /\((Thread t\d)\)/.exec(note.text)![1]])).toEqual([
    ['sent', 'Thread t1'], ['rejected', 'Thread t2'], ['sent', 'Thread t2'], ['error', 'Thread t1'], ['sent', 'Thread t1'],
  ]);
  expect(list[2]!.text).toBe(list[1]!.text);
  expect(f.notes('list')).toHaveLength(4);
});

test('rejecting a list note a newer one replaced does not resend the newer one', async () => {
  const f = fixture({
    evaluateTurn: async input => { const id = input.transcript.at(-1)!.id; return reading(input, { novel: id === 'p2' ? .9 : 0, natural: id === 'p2' ? {} : { t2: 1 } }); },
    generateMap: async () => mapped(mapWith([thread('t1'), thread('t2')])),
  });
  await f.step(0);
  await f.step(20_000);
  await f.turn(25_000);
  const [first, next] = f.of('note').filter(note => note.kind === 'list');
  expect(next!.text).toContain('(Thread t2)');
  f.producer.providerEvent(first!.id, false);
  expect(first!.outcome).toBe('rejected');
  await f.turn(30_000);
  expect(f.notes('list')).toHaveLength(2);
  f.producer.providerEvent(next!.id, false);
  await f.turn(35_000);
  expect(f.notes('list')).toEqual([first!.text, next!.text, next!.text]);
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
    evaluateTurn: async input => { const id = input.transcript.at(-1)!.id; return reading(input, { novel: id === 'p2' ? .9 : 0, natural: id === 'p4' ? { t2: 1 } : {} }); },
    generateMap: async () => mapped(mapWith([thread('t1'), thread('t2')])),
  });
  await f.step(0);
  await f.step(20_000);
  const [map, list] = f.of('note');
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

test('a found lookup wakes Sol without new text, an unresolved one waits in the log and cannot be cited, and a map note carries the lookup its research fact cites', async () => {
  const research: MapEntity = { id: 'e2', kind: 'product', label: 'OpenStreetMap', detail: facts[0]!.text, source: 'research', passageId: 'L1' };
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
  expect(f.calls.map[0]!.lookups).toEqual([]);
  expect(f.calls.map[1]!.lookups).toEqual(['L1']);
  expect(f.calls.map[1]!.blocks).toEqual([...f.calls.map[0]!.blocks,
    '[event L1 · 0.5 min] Public research about the product "OpenStreetMap" (public background, not project fact): OpenStreetMap is a collaborative, openly licensed world map. [About OpenStreetMap]']);
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
  expect(f.calls.map[2]!.blocks.at(-1)).toContain('[event L2 · 0.8 min] Public research about the product "Mapbox" found nothing reliable: Several products share the name.');
  expect(unresolved.loggedAt).toBe(epoch + 115_000);
  // A lookup that found nothing has no fact to cite.
  expect(f.calls.map[2]!.lookups).toEqual(['L1']);
});

test('a map note credits only the lookups its research facts cite, not every lookup Sol had read', async () => {
  const known = mapWith([], { participant: { vantage: 'Led the routing integration', preferences: [] } });
  const research: MapEntity = { id: 'e2', kind: 'product', label: 'OpenStreetMap', detail: facts[0]!.text, source: 'research', passageId: 'L1' };
  const results = [mapped(known, request('OpenStreetMap')), mapped(known, request('Mapbox')), mapped({ ...known, entities: [routing, research], nextIds: { e: 3, r: 1, t: 1 } })];
  const f = fixture({
    evaluateTurn: async input => reading(input, { novel: .9 }),
    generateMap: async input => results[f.calls.map.length - 1] ?? mapped(input.previous),
  });
  await f.step(0);
  await f.step(20_000);
  await f.step(40_000);
  await f.step(60_000);
  const [osm, mapbox] = f.of('research');
  expect([osm, mapbox].map(item => [item!.request.name, item!.outcome, item!.eventId])).toEqual([['OpenStreetMap', 'found', 'L1'], ['Mapbox', 'found', 'L2']]);
  expect(f.calls.map[2]!.lookups).toEqual(['L1', 'L2']);
  await f.step(80_000);
  const note = f.of('note').at(-1)!;
  expect(note.text).toContain(`\nPublic background you read, not project fact: OpenStreetMap: ${facts[0]!.text}`);
  expect(note.researchIds).toEqual([osm!.id]);
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

test('a turn Sam has started to answer is still read, and a yes to Sam’s question is new text for Sol', async () => {
  const f = fixture({ evaluateTurn: async input => reading(input, { novel: input.transcript.at(-1)!.id === 'p2' ? .9 : 0 }) });
  await f.step(0);
  await f.step(20_000);
  expect(f.calls.map).toHaveLength(1);
  f.at(25_000); f.say('client', 'Did the crews use it offline?'); f.say('trainee', 'Yes.'); f.say('client', 'How did that go?');
  await f.step();
  expect(f.calls.turn.map(item => item.transcript.map(entry => entry.id).join(','))).toEqual(['p1,p2', 'p1,p2,p3,p4']);
  await f.step(80_000);
  expect(f.calls.map).toHaveLength(2);
  expect(f.calls.map[1]!.tail.reasons).toEqual([MINUTE]);
});

test('a same-length transcript correction is re-read and retracts the earlier answer', async () => {
  const f = fixture({
    generateMap: async () => mapped(mapWith([thread('t1'), thread('t2')])),
    evaluateTurn: async input => reading(input, input.transcript.at(-1)!.id === 'p2' ? { novel: .9 }
      : { focus: 't1', states: { t1: input.transcript.at(-1)!.text === 'We did ship it.' ? 'answered' : 'open' } }),
  });
  await f.step(0);
  await f.step(20_000);
  await f.turn(25_000, 'We did ship it.');
  expect(f.producer.rankingState.holds.t1?.state).toBe('answered');
  f.grow('p4', 'We did skip it.');
  await f.step(26_000);
  expect(f.of('turn').at(-1)?.reading?.states.t1).toBe('open');
  expect(f.producer.rankingState.holds.t1).toBeUndefined();
});

test('turns that settle while Jev is busy are each read in order', async () => {
  const pending = deferred<Read>();
  const f = fixture({ evaluateTurn: async input => input.transcript.at(-1)!.id === 'p4' ? pending.promise : reading(input) });
  await f.step(0);
  await f.turn(5000, 'I handled the build.');
  await f.turn(5500, 'I cannot discuss personnel decisions.');
  await f.turn(6000, 'The tests were finished on Tuesday.');
  f.at(6500);
  pending.resolve(reading(f.calls.turn[1]!));
  await flush();
  await f.step(7000);
  await f.step(7500);
  expect(f.calls.turn.map(input => input.transcript.at(-1)!.text)).toEqual([
    'We integrated OpenStreetMap and Mapbox for the routing layer.',
    'I handled the build.',
    'I cannot discuss personnel decisions.',
    'The tests were finished on Tuesday.',
  ]);
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
  // t1 never scored, so only the map note went out.
  expect(f.producer.summary()).toMatchObject({ maps: 2, applied: 1, turns: 2, notes: 1, research: 1 });
});

test('a pause abandons and releases in-flight work, and the resume restates Sam’s notes outside the budget on a clock that skips the pause', async () => {
  const solCall = deferred<Mapped>();
  const turnRead = deferred<Read>();
  const traitRead = deferred<Traits>();
  const lookup = deferred<Lookup>();
  const f = fixture({
    evaluateTurn: async input => { const n = f.calls.turn.length; return n === 3 ? turnRead.promise : reading(input, n === 2 ? { natural: { t1: 1 } } : { novel: .9 }); },
    generateMap: async () => f.calls.map.length === 2 ? solCall.promise : mapped(mapWith([thread('t1')]), request('OpenStreetMap')),
    evaluateTraits: async input => f.calls.traits.length === 1 ? traitRead.promise : traits(input),
    lookupInterviewBackground: () => lookup.promise,
  });
  await f.step(0);
  await f.step(20_000);
  await f.turn(25_000);
  await f.turn(70_000);
  await f.step(80_000);
  const before = { list: f.notes('list'), map: f.notes('map') };
  expect([before.list.length, before.map.length]).toEqual([1, 1]);

  f.at(81_000);
  const span: PauseSpan = { from: epoch + 81_000, to: null };
  f.pauses.push(span);
  f.producer.pause();
  expect(f.producer.records.filter(item => item.source !== 'note' && item.source !== 'delegation').map(item => [item.source, item.outcome]))
    .toEqual([['turn', 'read'], ['map', 'applied'], ['research', 'aborted'], ['traits', 'aborted'], ['turn', 'read'], ['turn', 'aborted'], ['map', 'aborted']]);
  expect(f.calls.map[1]!.signal.aborted).toBe(true);
  const archived = JSON.stringify(f.producer.records);
  // Late results from the dropped session change nothing, and a paused producer does no work.
  solCall.resolve(mapped(mapWith([thread('t1'), thread('t2')])));
  turnRead.resolve(reading(f.calls.turn[2]!, { novel: .9 }));
  traitRead.resolve(traits(f.calls.traits[0]!));
  lookup.resolve({ status: 'found', facts, retrievedAt: Date.now(), queries: [] });
  await f.producer.settle();
  await f.step(100_000);
  expect(JSON.stringify(f.producer.records)).toBe(archived);
  expect(f.producer.conversationMap.threads.map(item => item.id)).toEqual(['t1']);

  f.at(141_000);
  span.to = epoch + 141_000;
  f.producer.resume(Date.now());
  expect(f.notes('list')).toEqual([...before.list, ...before.list]);
  expect(f.notes('map')).toEqual([...before.map, ...before.map]);
  expect(f.producer.summary().notes).toBe(2);
  await flush();
  expect(f.calls.traits).toHaveLength(2);

  // The abandoned turn is read again, Sol is behind, and the abandoned lookup may be requested again.
  await f.step(142_000);
  expect(f.calls.turn).toHaveLength(4);
  expect(f.calls.turn[3]!.atMs).toBe(82_000);
  expect(f.calls.map).toHaveLength(3);
  expect(f.calls.map[2]!.tail).toMatchObject({ reasons: [MINUTE], elapsedMs: 82_000 });
  await f.producer.settle();
  expect(f.of('research').map(item => item.outcome)).toEqual(['aborted', 'found']);
});

test('a restored producer starts paused with the checkpoint’s map, log and reads, and restates its notes on resume', async () => {
  const lookup = deferred<Lookup>();
  const a = fixture({
    evaluateTurn: async input => reading(input, { novel: .9 }),
    generateMap: async () => mapped(mapWith([thread('t1')]), request('OpenStreetMap')),
    lookupInterviewBackground: () => lookup.promise,
  });
  await a.step(0);
  await a.step(20_000);
  const checkpoint = structuredClone(a.producer.checkpoint());
  const b = fixture({ evaluateTurn: async input => reading(input, { novel: .9 }), generateMap: async () => mapped(mapWith([thread('t1')]), request('OpenStreetMap')) });
  b.producer.restore(checkpoint);
  expect(b.producer.conversationMap).toEqual(a.producer.conversationMap);
  expect(b.of('research').map(item => item.outcome)).toEqual(['aborted']);
  await b.step(30_000);
  expect(b.sent).toHaveLength(0);

  b.producer.resume(Date.now());
  expect(b.notes('list')).toEqual(a.notes('list').slice(-1));
  expect(b.notes('map')).toEqual(a.notes('map').slice(-1));
  await b.step(31_000);
  expect(b.calls.turn).toHaveLength(0); // p2 was read before the checkpoint.
  await b.turn(45_000);
  await b.step(46_000);
  expect(b.calls.map).toHaveLength(1);
  expect(b.calls.map[0]!.blocks).toHaveLength(2);
  await b.producer.settle();
  expect(b.of('research').map(item => item.outcome)).toEqual(['aborted', 'found']);
  expect(b.producer.summary()).toMatchObject({ maps: 2, applied: 2, turns: 2, research: 2 });
});
