import { afterEach, expect, setSystemTime, test } from 'bun:test';
import { DirectorHttpError, DirectorOutputError } from '../../providers/structured.server';
import { unpaidProviders } from '../../providers/testFoundry.server';
import type { InterviewObjectiveReading as Reading } from '../../shared/snapshot';
import type { PauseSpan } from '../../shared/timing';
import type { WireEntry as TranscriptEntry, WireSpeaker } from '../wire';
import { emptyMap, type ConversationMap, type MapEntity, type MapThread } from './map';
import { MAP_PROMPT_VERSION, MapOutputError } from './map.server';
import { emptyListNote, NOTE_HEADERS } from './notes';
import * as engine from './producer.server';
import { producerServices } from './producer.server';
import { threadKey, type TurnReading } from './ranking';
import { RANKING_RUBRIC_VERSION } from './ranking.server';
import { PRODUCER_LIMITS, PRODUCER_VERSION, type ProducerLogRecord, type ResearchRequest } from './records';
import { testSpec } from './testSpec';

type InterviewObjectiveReading = Reading<WireSpeaker>;
const fixtureProviders = unpaidProviders({} as never, { agent: 'gpt-6.1-sol', fast: 'gpt-6-luna' });
type Options = ConstructorParameters<typeof engine.InterviewProducer>[0];
/** The producer with the test spec, as the session constructs it with its own. */
class InterviewProducer extends engine.InterviewProducer {
  constructor(options: Omit<Options, 'spec'>) { super({ spec: testSpec, ...options }); }
}

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
type Lookup = Awaited<ReturnType<Services['lookupInterviewBackground']>>;

const routing: MapEntity = { id: 'e1', kind: 'product', label: 'Routing layer', detail: 'Built on OpenStreetMap and Mapbox.', source: 'participant', passageId: 'p2' };
const thread = (id: string, over: Partial<MapThread> = {}): MapThread =>
  ({ id, label: `Thread ${id}`, anchors: ['e1'], unknown: `what happened with ${id}`, guess: `a guess about ${id}`, related: [], topics: [], status: 'open', reason: null, ...over });
const mapWith = (threads: MapThread[], over: Partial<ConversationMap> = {}): ConversationMap =>
  ({ ...emptyMap(), entities: [routing], threads, nextIds: { e: 2, r: 1, t: threads.length + 1 }, ...over });
const mapped = (map: ConversationMap, research: ResearchRequest | null = null): Mapped => ({
  map, update: { vantage: null, preferences: null, entities: [], edges: [], threads: [], revise: [], close: [], drop: [] },
  changes: { added: [], changed: [], dropped: [], kept: [] }, research, model: 'gpt-6.1-sol', usage,
});
/** Jev read every open thread in its current wording; nothing is natural, answered or new unless a test says so. */
function reading(input: Input<'evaluateTurn'>, over: Partial<TurnReading> = {}): Read {
  const keys = Object.fromEntries(input.map.threads.filter(item => item.status === 'open').map(item => [item.id, threadKey(item)]));
  return { reading: { passageId: input.transcript.at(-1)!.id, atMs: input.atMs, focus: null, keys, natural: Object.fromEntries(Object.keys(keys).map(id => [id, .5])), states: {}, novel: 0, ...over }, model: 'fixture', durationMs: 5, usage: jevUsage, answers: {} };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(done => setTimeout(done, 0)); };

// Substitute only paid services: tests exercise real scheduling, ranking, validation, persistence and delivery.
function fixture(overrides: Partial<Services> = {}, { empty = false }: { empty?: boolean } = {}) {
  setSystemTime(epoch);
  let transcript: TranscriptEntry[] = empty ? [] : [
    { id: 'p1', speaker: 'client', text: 'What did the team build?', startMs: 0, endMs: 1000 },
    { id: 'p2', speaker: 'trainee', text: 'We integrated OpenStreetMap and Mapbox for the routing layer.', startMs: 1000, endMs: 4000 },
  ];
  let connected: boolean | 'throw' = true;
  let coverage: InterviewObjectiveReading[] = [];
  const sent: Record<string, unknown>[] = [];
  const calls = { map: [] as Input<'generateMap'>[], turn: [] as Input<'evaluateTurn'>[], lookup: [] as Input<'lookupInterviewBackground'>[] };
  const pauses: PauseSpan[] = [];
  const producer = new InterviewProducer({
    attemptId: 'attempt-1', startedAt: epoch, providers: fixtureProviders, pauses: () => pauses,
    settled: () => transcript, coverage: () => coverage, send: event => { if (connected === 'throw') throw new Error('socket closed'); if (!connected) return false; sent.push(event); return true; },
    services: {
      generateMap: async input => { calls.map.push(input); return overrides.generateMap ? overrides.generateMap(input) : mapped(input.previous); },
      evaluateTurn: async input => { calls.turn.push(input); return overrides.evaluateTurn ? overrides.evaluateTurn(input) : reading(input); },
      lookupInterviewBackground: async input => {
        calls.lookup.push(input);
        return overrides.lookupInterviewBackground ? overrides.lookupInterviewBackground(input) : { status: 'found', facts, retrievedAt: Date.now(), queries: ['OpenStreetMap about'] };
      },
    },
  });
  const say = (speaker: 'client' | 'trainee', text: string) => {
    const entry: TranscriptEntry = { id: `p${transcript.length + 1}`, speaker, text, startMs: Date.now() - epoch, endMs: Date.now() - epoch + 1000 };
    const previous = transcript.at(-1)?.id ?? null;
    transcript = [...transcript, entry];
    if (speaker === 'trainee') producer.transcriptChanged(entry, previous);
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
  expect(f.calls.map[1]!.tail.reasons.join(' ')).toContain('public research arrived');
  expect(f.of('map').map(item => item.outcome)).toEqual(['applied', 'error']);
  await f.step(99_999);
  expect(f.calls.map).toHaveLength(2);
  await f.step(100_000);
  expect(f.calls.map[2]!.tail.reasons).toEqual([MINUTE]);
  expect(f.calls.map[2]!.blocks).toEqual(f.calls.map[1]!.blocks);
  expect(f.of('map')[2]!.outcome).toBe('applied');
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


test('an empty interview makes no seed map, turn call or note', async () => {
  const f = fixture({}, { empty: true });
  await f.step(120_000);
  expect(f.calls.map).toEqual([]);
  expect(f.calls.turn).toEqual([]);
  expect(f.sent).toEqual([]);
});

test('a map reaches Sam immediately; Jev scores its gaps against the latest answer without waiting for another answer', async () => {
  const f = fixture({ generateMap: async () => mapped(mapWith([thread('t1')])) });
  await f.step(60_000);
  expect(f.notes('map')).toHaveLength(1);
  expect(f.notes('list')).toHaveLength(0);
  await f.step(60_500);
  expect(f.notes('list')).toHaveLength(1);
  expect(f.notes('list')[0]).toContain('Worth pulling next (Thread t1)');
  expect(f.calls.turn.at(-1)?.transcript.at(-1)?.id).toBe('p2');
  expect(f.sent.every(event => event.type === 'session.thinking.append')).toBe(true);
  expect(f.of('note').map(note => note.kind)).toEqual(['map', 'list']);
  await f.step(61_000);
  expect(f.sent).toHaveLength(2);
});

test('only a changed lead, changed gap or unavailable alternative sends another thread note', async () => {
  const maps = [mapWith([thread('t1'), thread('t2')]), mapWith([thread('t1', { unknown: 'who owned the release' }), thread('t2', { status: 'off', reason: 'They declined.' })])];
  const f = fixture({
    generateMap: async () => mapped(maps[Math.min(f.calls.map.length - 1, 1)]!),
    evaluateTurn: async input => reading(input, { focus: 't1', natural: { t1: .8, t2: .6 } }),
  });
  await f.step(60_000); await f.step(60_500);
  await f.turn(65_000); await f.turn(70_000);
  expect(f.notes('list')).toHaveLength(1);
  await f.step(120_000); await f.step(120_500);
  expect(f.notes('list')).toHaveLength(2);
  expect(f.notes('list')[1]).toContain('who owned the release');
  expect(f.notes('list')[1]).not.toContain('Thread t2');
});

test('map changes and withdrawals reach Sam without a second spacing timer', async () => {
  const maps = [mapWith([]), mapWith([], { entities: [{ ...routing, detail: 'Used a paper map first.' }] }), emptyMap()];
  const f = fixture({ generateMap: async () => mapped(maps[f.calls.map.length - 1]!), evaluateTurn: async input => reading(input, { novel: .9 }) });
  await f.step(0); await f.step(20_000);
  await f.turn(25_000); await f.step(40_000);
  expect(f.notes('map')).toHaveLength(2);
  expect(f.notes('map')[1]).toContain('Used a paper map first.');
  await f.turn(45_000); await f.step(60_000);
  expect(f.notes('map')[2]).toContain('withdrawn');
});

test('rejected and unsent notes retry, receipts carry timing, and rejecting an obsolete note does not resend it', async () => {
  const f = fixture({
    generateMap: async () => mapped(mapWith([thread('t1'), thread('t2')])),
    evaluateTurn: async input => reading(input, { natural: input.transcript.at(-1)!.id === 'p2' ? { t1: .9, t2: .2 } : { t1: .2, t2: .9 } }),
  });
  await f.step(60_000); await f.step(60_500);
  const first = f.of('note').find(note => note.kind === 'list')!;
  f.producer.providerEvent(first.id, true, { startMs: 100, endMs: 200 });
  expect(first.delivery).toMatchObject({ status: 'accepted', startMs: 100, endMs: 200 });
  f.setConnected(false); await f.turn(65_000);
  expect(f.of('note').at(-1)!.outcome).toBe('error');
  f.setConnected(true); await f.turn(66_000);
  const second = f.of('note').at(-1)!;
  expect(second.text).toContain('Thread t2');
  f.producer.providerEvent(first.id, false); await f.step(66_500);
  expect(f.notes('list')).toHaveLength(2);
  f.producer.providerEvent(second.id, false); await f.step(67_000);
  expect(f.notes('list')).toEqual([first.text, second.text, second.text]);
  const mapNote = f.of('note').find(note => note.kind === 'map')!;
  f.producer.providerEvent(mapNote.id, false); await f.step(67_500);
  expect(f.notes('map')).toHaveLength(2);
});

test('notes are bounded even if the provider repeatedly rejects them', async () => {
  const f = fixture({ generateMap: async () => mapped(mapWith([])) });
  await f.step(60_000);
  for (let i = 0; i <= PRODUCER_LIMITS.notes; i++) {
    f.producer.providerEvent(f.of('note').at(-1)!.id, false);
    await f.step(60_500 + i * 500);
  }
  expect(f.sent).toHaveLength(PRODUCER_LIMITS.notes);
});

test('all paid producer calls share a cap that survives a restart', async () => {
  const f = fixture({ generateMap: async () => { throw new Error('temporarily unavailable'); } });
  // Distinct answers are observable inputs, not a fabricated internal counter.
  for (let i = 0; i < PRODUCER_LIMITS.calls; i++) {
    f.say('client', 'What happened next?'); f.say('trainee', `The team completed part ${i}.`);
    f.producer.tick(epoch);
    await f.producer.settle();
  }
  await f.step(60_000);
  expect(f.calls.turn).toHaveLength(PRODUCER_LIMITS.calls);
  expect(f.calls.map).toHaveLength(0);
  const saved = structuredClone(f.producer.checkpoint());
  const next = fixture(); next.producer.restore(saved); next.producer.resume(epoch + 60_000);
  await next.step(120_000);
  expect(next.calls.map).toHaveLength(0);
  expect(next.calls.turn).toHaveLength(0);
});

test('Jev re-reads grown and same-length corrected words, but not an unchanged turn or Sam alone', async () => {
  const f = fixture();
  await f.step(0);
  f.grow('p2', 'We did ship it.'); await f.step(1000);
  f.grow('p2', 'We did skip it.'); await f.step(2000);
  await f.step(2500); f.sam('When did that happen?'); await f.step(3000);
  expect(f.calls.turn.map(call => call.transcript.at(-1)!.text)).toEqual([
    'We integrated OpenStreetMap and Mapbox for the routing layer.', 'We did ship it.', 'We did skip it.',
  ]);
});

test('a late Jev result is dropped, including one for a map that Sol has replaced', async () => {
  const slow = deferred<Read>();
  const f = fixture({
    generateMap: async () => mapped(mapWith([thread('t1')])),
    evaluateTurn: async input => f.calls.turn.length === 2 ? slow.promise : reading(input, { natural: { t1: .9 } }),
  });
  await f.step(0);
  await f.turn(59_000);
  await f.step(60_000);
  slow.resolve(reading(f.calls.turn[1]!, { focus: 't1', states: { t1: 'declined' }, novel: .9 })); await flush();
  expect(f.producer.rankingState.holds).toEqual({});
  await f.step(60_500);
  expect(f.notes('list')[0]).toContain('Thread t1');
  const late = deferred<Read>();
  const timeout = fixture({ evaluateTurn: () => late.promise });
  await timeout.step(0);
  timeout.at(3000); late.resolve(reading(timeout.calls.turn[0]!, { novel: 1 })); await flush();
  expect(timeout.of('turn')[0]!.outcome).toBe('timeout');
  expect(timeout.producer.rankingState.reading).toBeNull();
});

test('research accepts only a participant-named target, serializes, deduplicates and retries failed calls within the cap', async () => {
  const requests = [request('Invented company'), request('OpenStreetMap'), request('openstreetmap'), request('Mapbox'), request('OpenStreetMap'), request('Mapbox'), request('Mapbox', 'new clue')];
  const pending: ReturnType<typeof deferred<Lookup>>[] = [];
  const f = fixture({
    evaluateTurn: async input => reading(input, { novel: .9 }),
    generateMap: async input => mapped(input.previous, requests.shift() ?? null),
    lookupInterviewBackground: () => { const call = deferred<Lookup>(); pending.push(call); return call.promise; },
  });
  await f.step(0); await f.step(20_000);
  await f.turn(25_000); await f.step(40_000);
  await f.turn(45_000); await f.step(60_000);
  await f.turn(65_000); await f.step(80_000);
  expect(f.calls.lookup).toHaveLength(1);
  pending[0]!.reject(new Error('temporary failure')); await flush();
  await f.turn(85_000); await f.step(100_000);
  pending[1]!.resolve({ status: 'unresolved', reason: 'Ambiguous.', queries: [] }); await flush();
  await f.turn(105_000); await f.step(120_000);
  pending[2]!.resolve({ status: 'found', facts, retrievedAt: Date.now(), queries: [] }); await flush();
  await f.turn(125_000); await f.step(140_000);
  expect(f.of('research').map(record => record.outcome)).toEqual(['invalid', 'error', 'duplicate', 'busy', 'unresolved', 'found', 'budget']);
  expect(f.calls.lookup.map(call => call.target.name)).toEqual(['OpenStreetMap', 'OpenStreetMap', 'Mapbox']);
  expect(f.producer.summary().research).toBe(3);
});

test('a completed lookup survives restart, wakes Sol, and becomes public only after a cited map note is accepted', async () => {
  const research: MapEntity = { id: 'e2', kind: 'product', label: 'OpenStreetMap', detail: facts[0]!.text, source: 'research', passageId: 'L1' };
  const f = fixture({ generateMap: async input => mapped(input.previous, request('OpenStreetMap')) });
  await f.step(60_000); await f.producer.settle();
  const found = f.of('research')[0]!;
  expect(found.loggedAt).toBeUndefined();
  const checkpoint = structuredClone(f.producer.checkpoint());
  const next = fixture({ generateMap: async () => mapped(mapWith([], { entities: [routing, research] })) });
  next.producer.restore(checkpoint); next.producer.resume(epoch + 70_000);
  await next.step(80_000);
  expect(next.calls.map).toHaveLength(1);
  expect(next.calls.map[0]!.blocks.at(-1)).toContain('[event L1');
  expect(next.calls.map[0]!.lookups).toEqual(['L1']);
  const note = next.of('note').at(-1)!;
  expect(note.researchIds).toEqual([found.id]);
  expect(next.producer.publicBackground()).toEqual([]);
  next.producer.providerEvent(note.id, true);
  expect(next.producer.publicBackground()).toEqual([{ id: found.id, target: { kind: 'product', name: 'OpenStreetMap' }, facts, retrievedAt: found.retrievedAt! }]);
});

test('unresolved research waits for new conversation and never becomes citable background', async () => {
  const f = fixture({
    generateMap: async input => mapped(input.previous, f.calls.map.length === 1 ? request('OpenStreetMap') : null),
    lookupInterviewBackground: async () => ({ status: 'unresolved', reason: 'Ambiguous.', queries: [] }),
  });
  await f.step(60_000); await f.producer.settle(); await f.step(120_000);
  expect(f.calls.map).toHaveLength(1);
  await f.turn(125_000);
  expect(f.calls.map[1]!.blocks.at(-1)).toContain('found nothing reliable: Ambiguous.');
  expect(f.calls.map[1]!.lookups).toEqual([]);
  expect(f.producer.publicBackground()).toEqual([]);
});

test('pause and End discard late work; a fresh session resumes from the map and rereads its current answer', async () => {
  const slow = deferred<Mapped>();
  const f = fixture({ generateMap: () => slow.promise });
  await f.step(60_000); f.producer.pause();
  expect(f.of('map')[0]!.outcome).toBe('aborted');
  const checkpoint = structuredClone(f.producer.checkpoint());
  const next = fixture({ generateMap: async () => mapped(mapWith([thread('t1')])) });
  next.producer.restore(checkpoint); next.producer.resume(epoch + 80_000);
  await next.step(120_000); await next.step(120_500);
  expect(next.notes('list')).toHaveLength(1);
  slow.resolve(mapped(mapWith([thread('t2')]))); await flush();
  expect(f.sent).toEqual([]);
  expect(next.producer.conversationMap.threads.map(thread => thread.id)).toEqual(['t1']);
  const before = structuredClone(next.producer.records);
  next.producer.close(); next.producer.resume(); await next.step(200_000);
  expect(next.producer.records).toEqual(before);
});

test('a failed list send retries on the tick without buying another Jev reading', async () => {
  const f = fixture({ generateMap: async () => mapped(mapWith([thread('t1')])) });
  await f.step(60_000);
  f.setConnected(false); await f.step(60_500);
  expect(f.of('note').at(-1)!.outcome).toBe('error');
  const calls = f.calls.turn.length;
  f.setConnected(true); await f.step(61_000);
  expect(f.notes('list')).toHaveLength(1);
  expect(f.calls.turn).toHaveLength(calls);
});

test('a new voice session receives its map and cue even after the normal note budget is exhausted', async () => {
  const f = fixture({ generateMap: async () => mapped(mapWith([thread('t1')])) });
  await f.step(60_000); await f.step(60_500);
  for (let i = f.sent.length; i < PRODUCER_LIMITS.notes; i++) {
    f.producer.providerEvent(f.of('note').at(-1)!.id, false);
    await f.step(61_000 + i * 500);
  }
  expect(f.sent).toHaveLength(PRODUCER_LIMITS.notes);
  f.producer.pause(); f.producer.resume(epoch + 120_000);
  expect(f.sent.slice(-2).map(event => String(event.content).split('\n')[0])).toEqual([NOTE_HEADERS.map, NOTE_HEADERS.list]);
  expect(f.sent).toHaveLength(PRODUCER_LIMITS.notes + 2);
  await f.step(120_500);
  expect(f.sent).toHaveLength(PRODUCER_LIMITS.notes + 2);
});
