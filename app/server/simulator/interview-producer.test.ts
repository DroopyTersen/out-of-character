import { fixtureFoundry } from '../../../ai/foundry-fixture';
import { afterEach, expect, setSystemTime, test } from 'bun:test';
import { InterviewProducer, producerServices, rundownText } from './interview-producer';
import { CUE_OUTCOMES, PRODUCER_LIMITS, type CueFollowThrough, type CueOutcome, type ProducerLogRecord, type ResearchRequest } from '../../../core/interview-producer';
import type { CoverageLevel, InterviewObjectiveReading } from '../../../core/interview';
import type { DirectorSignal } from '../../../core/simulator/director';
import type { TranscriptEntry } from '../../../core/simulator/types';

afterEach(() => setSystemTime());
const epoch = 1_800_000_000_000;
const usage = { inputTokens: 10, outputTokens: 5 };
const facts = [{ text: 'OpenStreetMap is a collaborative, openly licensed world map.', url: 'https://www.openstreetmap.org/about', title: 'About OpenStreetMap' }];
const request = (name: string, clue: string | null = null): ResearchRequest => ({ kind: 'product', name, clue, passageIds: ['p2'] });
type Services = typeof producerServices;
type Generated = Awaited<ReturnType<Services['generateProducer']>>;
type Lookup = Awaited<ReturnType<Services['lookupInterviewBackground']>>;
const generated = (cue: string | null, research: ResearchRequest | null = null): Generated => ({ cue, evidenceIds: cue ? ['p2'] : [], research, model: 'gpt-6.1-sol', usage });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(done => setTimeout(done, 0)); };

// Only the paid adapters are substituted; triggers, queueing, budgets, validation and delivery are real.
function fixture(overrides: Partial<Services> = {}, canDeliverCue?: () => boolean) {
  setSystemTime(epoch);
  let transcript: TranscriptEntry[] = [
    { id: 'p1', speaker: 'client', text: 'What did the team build?', startMs: 0, endMs: 1000 },
    { id: 'p2', speaker: 'trainee', text: 'We integrated OpenStreetMap and Mapbox for the routing layer.', startMs: 1000, endMs: 4000 },
  ];
  let coverage: InterviewObjectiveReading[] = [];
  let connected = true;
  const sent: Record<string, any>[] = [];
  const calls = { generate: [] as Parameters<Services['generateProducer']>[0][],
    card: [] as Parameters<Services['checkCard']>[0][], lookup: [] as Parameters<Services['lookupInterviewBackground']>[0][] };
  const producer = new InterviewProducer({
    clientId: 'sam-cedar', startedAt: epoch, foundry: fixtureFoundry, typesafeKey: 'typesafe-fixture',
    settled: () => transcript, coverage: () => coverage, send: event => { if (!connected) return false; sent.push(event); return true; },
    canDeliverCue,
    services: {
      generateProducer: async input => { calls.generate.push(input); return overrides.generateProducer ? overrides.generateProducer(input) : generated(null); },
      checkCard: async input => { calls.card.push(input); return overrides.checkCard ? overrides.checkCard(input) : { probability: .99, usage }; },
      lookupInterviewBackground: async input => { calls.lookup.push(input); return overrides.lookupInterviewBackground ? overrides.lookupInterviewBackground(input) : { status: 'found', facts, retrievedAt: Date.now(), queries: ['OpenStreetMap about'] }; },
    },
  });
  const say = (speaker: 'client' | 'trainee', text: string) => { transcript = [...transcript, { id: `p${transcript.length + 1}`, speaker, text, startMs: Date.now() - epoch, endMs: Date.now() - epoch + 1000 }]; };
  const advance = (ms: number) => setSystemTime(Date.now() + ms);
  const observe = (signals: DirectorSignal[], researchProbability?: number, followThrough?: CueFollowThrough) => producer.observe({ transcript: [...transcript], capturedAt: Date.now(), signals, researchProbability, followThrough });
  const setLevel = (id: string, level: CoverageLevel) => {
    coverage = [...coverage.filter(item => item.id !== id), { id, level, levels: null, probability: .9, achieved: level === 'explored', evidence: null }];
  };
  const of = <S extends ProducerLogRecord['source']>(source: S) => producer.records.filter(item => item.source === source) as Extract<ProducerLogRecord, { source: S }>[];
  return { producer, sent, calls, say, advance, observe, setLevel, of, setConnected: (value: boolean) => { connected = value; }, transcript: () => transcript };
}
const concern = (condition: 'boundary-pressure' | 'leading' | 'source-confusion' | 'invented-facts', probability = .8): DirectorSignal => ({ condition, probability });

test('a generated direction waits for Sam output to finish and records actual delivery separately', async () => {
  let quiet = false;
  const f = fixture({ generateProducer: async () => generated('Ask what they changed in the release guide.') }, () => quiet);
  f.observe([concern('leading')]);
  await f.producer.settle();
  expect(f.sent).toHaveLength(0);
  expect(f.of('producer')[0]).toMatchObject({ outcome: 'deferred', deferredAt: epoch });
  f.advance(3000); f.say('client', 'What happened in the rehearsal?');
  f.producer.tick();
  expect(f.sent).toHaveLength(0);
  quiet = true;
  f.advance(1000); f.producer.tick();
  const record = f.of('producer')[0]!;
  expect(record).toMatchObject({ outcome: 'sent', sentAt: epoch + 4000, delivery: { afterPassageId: 'p3' } });
  expect(f.sent).toHaveLength(1);
  expect(f.producer.summary().cues).toBe(1);
});

test('a direction with no quiet opening expires, and End cancels a deferred direction', async () => {
  const f = fixture({ generateProducer: async () => generated('Ask what they changed in the release guide.') }, () => false);
  f.observe([concern('leading')]); await f.producer.settle();
  f.advance(PRODUCER_LIMITS.cueWait); f.producer.tick();
  expect(f.of('producer')[0]).toMatchObject({ outcome: 'withheld', reason: 'no_quiet_opening' });
  expect(f.sent).toHaveLength(0);
  expect(f.producer.summary().cues).toBe(0);
  f.observe([concern('invented-facts')]); await f.producer.settle();
  f.producer.close();
  expect(f.of('producer')[1]).toMatchObject({ outcome: 'aborted' });
  f.advance(30_000); f.producer.tick();
  expect(f.sent).toHaveLength(0);
});

test('check-ins wait 45 s after a substantive Sam turn and do not repeat on unchanged dialogue', async () => {
  const f = fixture();
  f.say('client', 'How did the handoff go?');
  f.advance(PRODUCER_LIMITS.checkIn - 1);
  f.producer.tick();
  expect(f.calls.generate).toHaveLength(0);
  f.advance(1);
  f.observe([{ condition: 'missed-thread', probability: .7 }, { condition: 'question-stacking', probability: .2 }], .9);
  f.producer.tick();
  await f.producer.settle();
  expect(f.calls.generate).toHaveLength(1);
  expect(f.calls.generate[0]!.triggers).toEqual([{ kind: 'check-in' }, { kind: 'signal', condition: 'missed-thread', probability: .7 }, { kind: 'signal', condition: 'research', probability: .9 }]);

  f.advance(PRODUCER_LIMITS.checkIn);
  f.producer.tick();
  expect(f.calls.generate).toHaveLength(1);
  f.say('trainee', 'It went fine once we had access.');
  f.producer.tick();
  expect(f.calls.generate).toHaveLength(1);
  f.say('client', 'Mm-hmm.');
  f.producer.tick();
  expect(f.calls.generate).toHaveLength(1);
  f.say('client', 'What made access take so long?');
  f.producer.tick();
  await f.producer.settle();
  expect(f.calls.generate).toHaveLength(2);
});

test('persistent signals never summon the producer; each new protection episode consults once', async () => {
  const f = fixture();
  for (let i = 0; i < 3; i++) f.observe([{ condition: 'missed-thread', probability: .95 }, { condition: 'overprobing', probability: .9 }], .95);
  expect(f.calls.generate).toHaveLength(0);

  f.observe([concern('boundary-pressure')]);
  await f.producer.settle();
  f.observe([concern('boundary-pressure', .55)]);
  f.observe([concern('boundary-pressure', .9)]);
  await f.producer.settle();
  expect(f.calls.generate).toHaveLength(1);
  expect(f.calls.generate[0]!.triggers).toEqual([{ kind: 'concern', condition: 'boundary-pressure', probability: .8 }]);

  f.observe([concern('boundary-pressure', .4)]);
  f.observe([concern('boundary-pressure', .7)]);
  await f.producer.settle();
  expect(f.calls.generate).toHaveLength(2);
  expect(f.of('assessment').map(item => item.concerns)).toEqual([[], [], [], ['boundary-pressure'], [], [], [], ['boundary-pressure']]);
});

test('triggers during a consultation merge into one follow-up on the latest dialogue', async () => {
  const first = deferred<Generated>();
  let count = 0;
  const f = fixture({ generateProducer: () => ++count === 1 ? first.promise : Promise.resolve(generated(null)) });
  f.observe([concern('boundary-pressure')]);
  const queuedAt = Date.now() + 1000;
  f.advance(1000);
  f.observe([concern('leading', .7)]);
  f.advance(1000);
  f.observe([concern('leading', .4), concern('invented-facts', .9)]);
  f.observe([concern('leading', .8)]);
  f.say('client', 'Tell me more about the routing layer.');
  first.resolve(generated(null));
  await f.producer.settle();

  expect(f.calls.generate).toHaveLength(2);
  const [, followUp] = f.of('producer');
  expect(followUp).toMatchObject({ queued: true, triggeredAt: queuedAt, lastInputId: 'p3' });
  expect(followUp!.triggers).toEqual([{ kind: 'concern', condition: 'leading', probability: .8 }, { kind: 'concern', condition: 'invented-facts', probability: .9 }]);
  expect(f.calls.generate[1]!.transcript.at(-1)!.id).toBe('p3');
  expect(f.producer.summary()).toMatchObject({ consultations: 2, queued: 1 });
});

test('research lookups resolve out of order and each card triggers its own follow-up', async () => {
  const lookups = new Map<string, ReturnType<typeof deferred<Lookup>>>();
  const research = [request('OpenStreetMap'), request('Mapbox')];
  let count = 0;
  const f = fixture({
    generateProducer: async () => generated(null, research[count++] ?? null),
    lookupInterviewBackground: input => { const pending = deferred<Lookup>(); lookups.set(input.target.name, pending); return pending.promise; },
  });
  f.observe([concern('boundary-pressure')]);
  await flush();
  f.observe([concern('leading')]);
  await flush();
  expect(f.calls.lookup.map(item => item.target.name)).toEqual(['OpenStreetMap', 'Mapbox']);
  expect(f.calls.lookup[0]).toMatchObject({ target: { kind: 'product', name: 'OpenStreetMap' }, clue: null, foundry: fixtureFoundry });
  expect(f.calls.generate[1]!.budget).toEqual({ cuesLeft: PRODUCER_LIMITS.cues, researchLeft: PRODUCER_LIMITS.research - 1, lookupsInFlight: 1 });

  lookups.get('Mapbox')!.resolve({ status: 'found', facts: [{ ...facts[0]!, text: 'Mapbox provides mapping APIs.' }], retrievedAt: Date.now(), queries: [] });
  await flush();
  lookups.get('OpenStreetMap')!.resolve({ status: 'found', facts, retrievedAt: Date.now(), queries: [] });
  await f.producer.settle();

  const cards = f.sent.filter(item => String(item.event_id).startsWith('research-'));
  expect(cards.map(item => item.content.split(' ').slice(0, 4).join(' '))).toEqual(['PUBLIC BACKGROUND on Mapbox', 'PUBLIC BACKGROUND on OpenStreetMap']);
  expect(cards[0]!.content).toContain('requested earlier; use it only if it still fits');
  const [osm, mapbox] = f.of('research');
  const followUps = f.calls.generate.slice(2).map(item => item.triggers);
  expect(followUps).toEqual([[{ kind: 'research', researchId: mapbox!.id, status: 'sent' }], [{ kind: 'research', researchId: osm!.id, status: 'sent' }]]);
  expect(f.producer.background().map(item => item.target.name)).toEqual(['OpenStreetMap', 'Mapbox']);
});

test('a card is checked against the latest dialogue: a correction withholds it, a topic change does not', async () => {
  for (const [followUp, probability, outcome] of [['Sorry, I meant OpenStreetCam, the imagery tool.', .2, 'withheld'], ['Anyway, the bigger issue was approvals.', .9, 'sent']] as const) {
    const lookup = deferred<Lookup>();
    let count = 0;
    const f = fixture({
      generateProducer: async () => generated(null, count++ ? null : request('OpenStreetMap')),
      lookupInterviewBackground: () => lookup.promise, checkCard: async () => ({ probability, usage }),
    });
    f.observe([concern('boundary-pressure')]);
    await flush();
    f.say('trainee', followUp);
    lookup.resolve({ status: 'found', facts, retrievedAt: Date.now(), queries: [] });
    await f.producer.settle();

    const [record] = f.of('research');
    expect(f.calls.card[0]!.transcript.at(-1)!.text).toBe(followUp);
    expect(f.calls.card[0]!.request).toMatchObject({ kind: 'product', name: 'OpenStreetMap', clue: null });
    expect(record).toMatchObject({ outcome, check: { probability, lastInputId: 'p3' } });
    expect(f.sent.some(item => item.event_id === record!.id)).toBe(outcome === 'sent');
    expect(f.calls.generate[1]!.triggers).toEqual([{ kind: 'research', researchId: record!.id, status: outcome }]);
  }
});

test('an unresolved lookup is logged without consulting the producer; a result older than 90 s is dropped silently', async () => {
  const f = fixture({
    generateProducer: async () => generated(null, f.calls.generate.length === 1 ? request('Mapbox') : null),
    lookupInterviewBackground: async () => ({ status: 'unresolved', reason: 'Several products share the name.', queries: [] }),
  });
  f.observe([concern('boundary-pressure')]);
  await f.producer.settle();
  const [unresolved] = f.of('research');
  expect(unresolved).toMatchObject({ outcome: 'unresolved', reason: 'Several products share the name.' });
  expect(f.calls.generate).toHaveLength(1);
  expect(f.sent).toHaveLength(0);

  const lookup = deferred<Lookup>();
  const g = fixture({ generateProducer: async () => generated(null, g.calls.generate.length === 1 ? request('Mapbox') : null), lookupInterviewBackground: () => lookup.promise });
  g.observe([concern('boundary-pressure')]);
  await flush();
  g.advance(PRODUCER_LIMITS.researchAge);
  lookup.resolve({ status: 'found', facts, retrievedAt: Date.now(), queries: [] });
  await g.producer.settle();
  expect(g.of('research')[0]).toMatchObject({ outcome: 'expired' });
  expect(g.calls.card).toHaveLength(0);
  expect(g.calls.generate).toHaveLength(1);
  expect(g.sent).toHaveLength(0);
  expect(g.producer.background()).toEqual([]);
});

test('research requests are validated, deduplicated, capped and retried only after transient failures', async () => {
  const queue: (ResearchRequest | null)[] = [];
  const lookups: ReturnType<typeof deferred<Lookup>>[] = [];
  const f = fixture({
    generateProducer: async () => generated(null, queue.shift() ?? null),
    lookupInterviewBackground: () => { const pending = deferred<Lookup>(); lookups.push(pending); return pending.promise; },
  });
  const ask = async (next: ResearchRequest) => { queue.push(next); f.observe([concern('boundary-pressure', .4)]); f.observe([concern('boundary-pressure')]); await flush(); };

  await ask({ ...request('Acme Field Systems'), passageIds: ['p2'] });
  await ask({ ...request('OpenStreetMap'), passageIds: ['p1'] });
  await ask(request('OpenStreetMap'));
  await ask(request('openstreetmap.'));
  await ask(request('Mapbox'));
  await ask(request('Mapbox', 'routing layer'));
  expect(f.of('research').map(item => [item.outcome, item.reason])).toEqual([
    ['invalid', 'name_unspoken'], ['invalid', 'passages'], ['pending', undefined], ['duplicate', 'duplicate'], ['pending', undefined], ['busy', 'busy'],
  ]);
  expect(f.calls.lookup).toHaveLength(2);

  lookups[0]!.reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
  lookups[1]!.resolve({ status: 'unresolved', reason: 'Ambiguous.', queries: [] });
  await flush();
  await ask(request('OpenStreetMap'));
  await ask(request('Mapbox'));
  await ask(request('Mapbox', 'routing layer'));
  await ask(request('routing layer'));
  expect(f.of('research').slice(6).map(item => item.outcome)).toEqual(['pending', 'duplicate', 'pending', 'budget']);
  expect(f.of('research')[2]!.outcome).toBe('timeout');
  expect(f.calls.lookup.map(item => [item.target.name, item.clue])).toEqual([['OpenStreetMap', null], ['Mapbox', null], ['OpenStreetMap', null], ['Mapbox', 'routing layer']]);
  lookups[2]!.resolve({ status: 'unresolved', reason: 'x', queries: [] });
  lookups[3]!.resolve({ status: 'unresolved', reason: 'x', queries: [] });
  await f.producer.settle();
});

test('directions arrive despite a new story; spacing and cue budgets still apply', async () => {
  const first = deferred<Generated>();
  let count = 0;
  const f = fixture({
    generateProducer: () => {
      count++;
      if (count === 1) return first.promise;
      return Promise.resolve(generated(`Cue ${count}`, count === 2 ? request('Mapbox') : null));
    },
  });
  f.observe([concern('boundary-pressure')]);
  f.say('trainee', 'There was another surprise: the launch rehearsal caught a missing access role.');
  f.say('client', 'How did the team catch that?');
  first.resolve(generated('Return to the vendor handoff; ask what made it work.'));
  await f.producer.settle();
  expect(f.of('producer')[0]).toMatchObject({ outcome: 'sent', lastInputId: 'p2', delivery: { afterPassageId: 'p4' } });
  expect(f.of('producer')[0]!.check).toBeUndefined();
  expect(f.of('producer')[0]!.checkedAt).toBeUndefined();
  expect(f.sent).toHaveLength(1);
  expect(f.sent[0]).toMatchObject({ type: 'session.instructions.append', content: expect.stringContaining('Return to the vendor handoff; ask what made it work.') });
  expect(f.calls.card).toHaveLength(0);

  // A check-in cue, then its research card's follow-up inside the spacing window, then a concern that skips spacing.
  const checkIn = () => { f.say('client', `Question ${f.transcript().length}?`); f.advance(PRODUCER_LIMITS.checkIn); f.producer.tick(); return f.producer.settle(); };
  await checkIn();
  f.observe([concern('leading')]);
  await f.producer.settle();
  expect(f.of('producer').map(item => [item.triggers[0]!.kind, item.outcome])).toEqual([['concern', 'sent'], ['check-in', 'sent'], ['research', 'spacing'], ['concern', 'sent']]);

  while (f.of('producer').filter(item => item.outcome === 'sent').length < PRODUCER_LIMITS.cues) await checkIn();
  await checkIn();
  expect(f.of('producer').at(-1)!.outcome).toBe('budget');
  const cues = f.sent.filter(item => String(item.event_id).startsWith('cue-'));
  expect(cues).toHaveLength(PRODUCER_LIMITS.cues);
  expect(cues[1]).toEqual({ type: 'session.instructions.append', event_id: expect.stringMatching(/^cue-/), delegation_id: null, content: expect.stringContaining('Cue 2') });
});

test('the rundown is sent only when a band changes, throttled, plus once near the target time', () => {
  const f = fixture();
  const rundowns = () => f.sent.filter(item => String(item.event_id).startsWith('rundown-'));
  f.producer.tick();
  expect(rundowns()).toHaveLength(0);
  f.setLevel('project-delivery', 'touched');
  f.producer.tick();
  expect(rundowns()).toHaveLength(1);
  expect(rundowns()[0]!.content).toStartWith('RUNDOWN (replaces earlier rundowns). About 0 minutes elapsed.\nWhat you delivered: touched: Deliverables & scope; not yet: Your role');

  f.setLevel('project-delivery', 'explored');
  f.advance(PRODUCER_LIMITS.rundownSpacing - 1);
  f.producer.tick();
  f.setLevel('client-access', 'set-aside');
  f.producer.tick();
  expect(rundowns()).toHaveLength(1);
  f.advance(1);
  f.producer.tick();
  f.producer.tick();
  expect(rundowns()).toHaveLength(2);
  expect(rundowns()[1]!.content).not.toContain('Deliverables & scope');
  expect(rundowns()[1]!.content).toContain('set aside: Onboarding & access');

  f.advance(PRODUCER_LIMITS.rundownAt);
  f.producer.tick();
  f.advance(PRODUCER_LIMITS.rundownSpacing);
  f.producer.tick();
  expect(rundowns()).toHaveLength(3);
  expect(rundowns()[2]!.content).toStartWith('RUNDOWN (replaces earlier rundowns). About 25 minutes elapsed.');
  expect(f.of('rundown').map(item => item.reason)).toEqual(['change', 'change', 'time']);
  expect(f.calls.generate).toHaveLength(0);
});

test('coverage churn cannot use the rundown reserved for the time reminder, and nothing sends after close', () => {
  const f = fixture();
  const rundowns = () => f.of('rundown');
  const churn = () => {
    f.setLevel('project-delivery', rundowns().length % 2 ? 'touched' : 'explored');
    f.producer.tick();
    f.advance(PRODUCER_LIMITS.rundownSpacing);
  };
  while (rundowns().length < PRODUCER_LIMITS.rundowns - 1) churn();
  expect(Date.now() - epoch).toBeLessThan(PRODUCER_LIMITS.rundownAt);
  churn();
  expect(rundowns()).toHaveLength(PRODUCER_LIMITS.rundowns - 1);
  f.advance(PRODUCER_LIMITS.rundownAt);
  f.producer.tick();
  expect(rundowns()).toHaveLength(PRODUCER_LIMITS.rundowns);
  expect(rundowns().at(-1)).toMatchObject({ reason: 'time', outcome: 'sent' });
  expect(rundowns().filter(item => item.reason === 'time')).toHaveLength(1);
  churn();
  expect(rundowns()).toHaveLength(PRODUCER_LIMITS.rundowns);

  const g = fixture();
  g.setLevel('project-delivery', 'touched');
  g.producer.close();
  g.producer.tick();
  g.advance(PRODUCER_LIMITS.rundownAt);
  g.producer.tick();
  expect(g.sent).toHaveLength(0);
  expect(g.producer.records).toEqual([]);
});

test.each(['socket', 'provider'] as const)('the reserved time reminder retries after a %s failure at the budget edge', failure => {
  const f = fixture();
  for (let index = 0; index < PRODUCER_LIMITS.rundowns - 1; index++) {
    f.setLevel('project-delivery', index % 2 ? 'touched' : 'explored');
    f.producer.tick();
    f.advance(PRODUCER_LIMITS.rundownSpacing);
  }
  f.advance(PRODUCER_LIMITS.rundownAt);
  if (failure === 'socket') f.setConnected(false);
  f.producer.tick();
  const failed = f.of('rundown').at(-1)!;
  if (failure === 'provider') {
    f.producer.providerEvent(failed.delivery!.eventId, false);
    f.producer.providerEvent(failed.delivery!.eventId, false); // Duplicate receipts do not refund twice.
  }
  expect(failed).toMatchObject({ reason: 'time', outcome: 'error' });
  expect(f.producer.summary().rundowns).toBe(PRODUCER_LIMITS.rundowns - 1);
  f.setConnected(true);
  f.producer.tick();
  expect(f.of('rundown').at(-1)).toBe(failed);
  f.advance(PRODUCER_LIMITS.rundownSpacing);
  f.producer.tick();
  expect(f.of('rundown').at(-1)).toMatchObject({ reason: 'time', outcome: 'sent' });
  expect(f.producer.summary().rundowns).toBe(PRODUCER_LIMITS.rundowns);
});

test('delivery acknowledgments decide which cards explain Sam’s claims and which become public', async () => {
  let count = 0;
  const names = ['OpenStreetMap', 'Mapbox', 'routing layer'];
  const f = fixture({ generateProducer: async () => generated(null, count < 3 ? request(names[count++]!) : null) });
  f.observe([concern('boundary-pressure')]);
  await flush();
  f.observe([concern('leading')]);
  await f.producer.settle();
  f.observe([concern('invented-facts')]);
  await f.producer.settle();
  const [accepted, rejected, unknown] = f.of('research');
  f.producer.providerEvent(accepted!.id, true);
  f.producer.providerEvent(rejected!.id, false);
  expect(accepted!.delivery).toMatchObject({ status: 'accepted', acknowledgedAt: Date.now(), afterPassageId: 'p2' });
  expect(f.producer.background().map(item => [item.target.name, item.status])).toEqual([['OpenStreetMap', 'accepted'], ['routing layer', 'unknown']]);
  expect(f.producer.publicBackground()).toEqual([{ id: accepted!.id, target: { kind: 'product', name: 'OpenStreetMap' }, facts, retrievedAt: accepted!.retrievedAt! }]);
  expect(unknown!.delivery!.status).toBe('unknown');

  f.advance(2000);
  f.producer.transcriptChanged({ id: 'p3', speaker: 'client', text: 'Mm-h', startMs: 0, endMs: 1 }, 'p2');
  expect(accepted!.nextSamTurnAt).toBeUndefined();
  f.advance(2000);
  f.say('client', 'What did Mapbox handle?');
  f.producer.transcriptChanged(f.transcript().at(-1)!, 'p2');
  expect(accepted!).toMatchObject({ nextSamTurnAt: Date.now(), nextSamTurnAfterId: 'p2' });
  f.advance(1000);
  f.producer.transcriptChanged({ id: 'p9', speaker: 'client', text: 'And after that?', startMs: 0, endMs: 1 }, 'p8');
  expect(accepted!).toMatchObject({ nextSamTurnAt: Date.now() - 1000, nextSamTurnAfterId: 'p2' });
  expect(f.producer.summary().latency.lookup).toEqual({ count: 3, p50: 0, p90: 0 });
});

test('close aborts pending work and ignores late results', async () => {
  const pending = deferred<Generated>();
  const f = fixture({ generateProducer: () => pending.promise });
  f.observe([concern('boundary-pressure')]);
  f.producer.close();
  pending.resolve(generated('Late cue'));
  await f.producer.settle();
  f.observe([concern('leading')]);
  f.setLevel('project-delivery', 'touched');
  f.producer.tick();
  f.producer.delegation('delegation-1', 'client', true);
  expect(f.of('producer')).toHaveLength(1);
  expect(f.of('producer')[0]).toMatchObject({ outcome: 'aborted' });
  expect(f.sent).toHaveLength(0);
  expect(f.producer.canObserve).toBe(false);
  expect(f.producer.records.some(item => item.source === 'delegation')).toBe(false);
});

test('a participant correction during a research identity check prevents the stale card from being sent', async () => {
  const pending = deferred<{ probability: number; usage: typeof usage }>();
  let count = 0;
  const f = fixture({
    generateProducer: async () => count++ ? generated(null) : generated(null, request('Mapbox')),
    checkCard: () => pending.promise,
  });
  f.observe([concern('leading')]);
  await flush();
  f.say('trainee', 'Actually I meant a different product, and I would rather not discuss the vendor.');
  pending.resolve({ probability: .99, usage });
  await f.producer.settle();
  expect(f.sent).toHaveLength(0);
  expect(f.of('research')[0]).toMatchObject({ outcome: 'withheld', reason: 'dialogue_changed' });
  expect(f.producer.publicBackground()).toEqual([]);
});

test('results that complete past generation, check, or research deadlines cannot send a note', async () => {
  for (const step of ['generation', 'card', 'unresolved'] as const) {
    const f = fixture({
      generateProducer: async () => {
        if (step === 'generation') f.advance(PRODUCER_LIMITS.generation);
        return step === 'card' || step === 'unresolved' ? generated(null, request('Mapbox')) : generated('Ask about the handoff.');
      },
      checkCard: async () => { f.advance(PRODUCER_LIMITS.check); return { probability: .99, usage }; },
      lookupInterviewBackground: async () => {
        if (step === 'unresolved') { f.advance(PRODUCER_LIMITS.researchAge); return { status: 'unresolved', reason: 'Ambiguous identity.', queries: [] }; }
        return { status: 'found', facts, retrievedAt: Date.now(), queries: [] };
      },
    });
    f.observe([concern('leading')]);
    await f.producer.settle();
    expect(f.sent).toHaveLength(0);
    expect(f.calls.generate).toHaveLength(1);
    const record = step === 'card' || step === 'unresolved' ? f.of('research')[0] : f.of('producer')[0];
    expect(record!.outcome).toBe(step === 'unresolved' ? 'expired' : 'timeout');
  }
});

test('failed research delivery can be requested again and a failed time rundown retries after spacing', async () => {
  for (const rejection of ['socket', 'provider'] as const) {
    let count = 0;
    const f = fixture({ generateProducer: async () => generated(null, count++ === 1 ? null : request('Mapbox')) });
    if (rejection === 'socket') f.setConnected(false);
    f.observe([concern('leading')]);
    await f.producer.settle();
    const first = f.of('research')[0]!;
    if (rejection === 'provider') f.producer.providerEvent(first.id, false);
    else count = 2; // A failed socket send does not cause a research-result consultation.
    expect(first.outcome).toBe('error');
    expect(f.producer.publicBackground()).toEqual([]);
    f.setConnected(true);
    f.observe([concern('boundary-pressure')]);
    await f.producer.settle();
    expect(f.calls.lookup).toHaveLength(2);
    expect(f.of('research')[1]!.outcome).toBe('sent');
    f.producer.close();
  }

  const f = fixture();
  f.setConnected(false);
  f.advance(PRODUCER_LIMITS.rundownAt);
  f.producer.tick();
  f.setConnected(true);
  f.producer.tick();
  expect(f.sent).toHaveLength(0);
  f.advance(PRODUCER_LIMITS.rundownSpacing);
  f.producer.tick();
  expect(f.sent).toHaveLength(1);
  expect(f.of('rundown').map(record => record.outcome)).toEqual(['error', 'sent']);
  f.producer.providerEvent(f.of('rundown')[1]!.id, false);
  f.advance(PRODUCER_LIMITS.rundownSpacing);
  f.producer.tick();
  expect(f.sent).toHaveLength(2);
  expect(f.of('rundown').map(record => record.outcome)).toEqual(['error', 'error', 'sent']);
});

test('rundown text lists every area and marks untouched topics', () => {
  const text = rundownText([{ id: 'process-tools', level: 'explored' }], 12 * 60_000);
  expect(text.split('\n')).toHaveLength(4);
  expect(text).toContain('About 12 minutes elapsed.');
  expect(text).toContain('How the team worked: not yet: What worked well');
  expect(text).not.toContain('Tools & process');
});

test('rundown text reports a declined topic as set aside, not as a gap to revisit', () => {
  const text = rundownText([{ id: 'client-pace', level: 'set-aside' }, { id: 'process-tools', level: 'touched' }], 5 * 60_000);
  const line = (label: string) => text.split('\n').find(item => item.startsWith(label))!;
  expect(line('Working with the client')).toMatch(/set aside: [^;]*Pace/);
  expect(line('Working with the client')).not.toMatch(/(touched|not yet): [^;]*Pace/);
  expect(line('How the team worked')).toContain('touched: Tools & process');
});


async function directedFixture(overrides: Partial<Services> = {}) {
  const f = fixture({ generateProducer: async () => generated('Ask how the vendor handoff worked.'), ...overrides });
  f.observe([concern('leading')]);
  await f.producer.settle();
  const record = f.of('producer')[0]!;
  f.producer.providerEvent(record.delivery!.eventId, true, { startMs: 4000, endMs: 5000 });
  return { ...f, record };
}
function followThrough(f: Awaited<ReturnType<typeof directedFixture>>, outcome: CueOutcome, probability = .95): CueFollowThrough {
  return { cueId: f.producer.cue()!.id, outcome, responseIds: [f.transcript().at(-1)!.id],
    probabilities: Object.fromEntries(CUE_OUTCOMES.map(key => [key, key === outcome ? probability : (1 - probability) / 4])) as Record<CueOutcome, number> };
}

test('a missed instruction waits for cue spacing, recovers once, and cannot start a replacement chain', async () => {
  const f = await directedFixture();
  f.advance(10_000); f.say('client', 'Anything else before we finish?');
  f.observe([], undefined, followThrough(f, 'missed'));
  f.producer.tick();
  expect(f.calls.generate).toHaveLength(1);
  f.advance(19_999); f.producer.tick();
  expect(f.calls.generate).toHaveLength(1);
  f.advance(1); f.producer.tick();
  await f.producer.settle();
  expect(f.calls.generate[1]!.triggers).toEqual([{ kind: 'cue-recovery', cueId: f.record.id, probability: .95 }]);
  const replacement = f.of('producer')[1]!;
  expect(replacement).toMatchObject({ outcome: 'sent', recoveryUsed: true });
  expect(f.record.recoveryUsed).toBe(true);
  f.producer.providerEvent(replacement.delivery!.eventId, true, { endMs: 31_000 });
  f.advance(30_000); f.say('client', 'That should wrap things up.');
  f.observe([], undefined, followThrough(f, 'missed'));
  f.producer.tick(); f.producer.tick();
  expect(f.calls.generate).toHaveLength(2);
  expect(f.of('assessment').at(-1)!.followThrough).toMatchObject({ cueId: replacement.id, outcome: 'missed' });
  expect(f.producer.cue()).toBeUndefined();
});

test.each(['followed', 'deferred', 'retired', 'not-yet-assessable'] as const)('%s direction does not summon a correction', async outcome => {
  const f = await directedFixture();
  f.advance(30_000); f.say('client', 'How did you divide responsibility with the vendor?');
  f.observe([], undefined, followThrough(f, outcome)); f.producer.tick();
  expect(f.calls.generate).toHaveLength(1);
  expect(!!f.producer.cue()).toBe(outcome !== 'followed' && outcome !== 'retired');
});

test('uncertain misses, stale dialogue and old-cue assessments do not request recovery', async () => {
  const f = await directedFixture();
  f.advance(30_000); f.say('client', 'Anything else?');
  f.observe([], undefined, followThrough(f, 'missed', .55)); f.producer.tick();
  expect(f.calls.generate).toHaveLength(1);
  const oldTranscript = [...f.transcript()];
  const missed = followThrough(f, 'missed');
  f.say('trainee', 'Actually, the whole story started with a release decision.');
  f.producer.observe({ transcript: oldTranscript, capturedAt: Date.now(), signals: [], followThrough: missed }); f.producer.tick();
  expect(f.calls.generate).toHaveLength(1);
  f.observe([concern('boundary-pressure')]); await f.producer.settle();
  f.producer.observe({ transcript: f.transcript(), capturedAt: Date.now(), signals: [], followThrough: missed });
  expect(f.of('producer')[1]!.followThrough).toBeUndefined();
});

test('unacknowledged or rejected instructions cannot be assessed, and receipt does not imply follow-through', async () => {
  const f = fixture({ generateProducer: async () => generated('Ask about the handoff.') });
  f.observe([concern('leading')]); await f.producer.settle();
  const record = f.of('producer')[0]!;
  expect(f.producer.cue()).toBeUndefined();
  f.producer.providerEvent(record.delivery!.eventId, true);
  expect(f.producer.cue()).toBeUndefined(); // No comparable session timeline supplied.
  f.producer.providerEvent(record.delivery!.eventId, true, { endMs: 5000 });
  expect(f.producer.cue()).toMatchObject({ id: record.id, endMs: 5000 });
  expect(record.followThrough).toBeUndefined();
  f.producer.providerEvent(record.delivery!.eventId, false);
  expect(f.producer.cue()).toBeUndefined();
});

test('a queued recovery is dropped when another cue supersedes it; unrelated queued work survives', async () => {
  const pending = deferred<Generated>();
  let calls = 0;
  const f = await directedFixture({ generateProducer: async () => ++calls === 2 ? pending.promise : generated('Ask about ownership.') });
  f.advance(30_000); f.say('client', 'Anything else?');
  f.observe([], undefined, followThrough(f, 'missed'));
  f.observe([concern('boundary-pressure')]); // Another consultation is already running.
  f.producer.tick(); // Queue one recovery behind it.
  f.observe([concern('invented-facts')]); // Merge an independent protection concern.
  pending.resolve(generated('Respect their boundary and ask about the offered alternative.'));
  await f.producer.settle();
  expect(f.calls.generate).toHaveLength(3);
  expect(f.calls.generate[2]!.triggers).toEqual([{ kind: 'concern', condition: 'invented-facts', probability: .8 }]);
});

test('recovery in flight cannot send after the direction is retired or the interview ends', async () => {
  for (const end of [false, true]) {
    const pending = deferred<Generated>(); let count = 0;
    const f = await directedFixture({ generateProducer: async () => ++count === 1 ? generated('Ask about the handoff.') : pending.promise });
    f.advance(30_000); f.say('client', 'Anything else?');
    f.observe([], undefined, followThrough(f, 'missed')); f.producer.tick();
    if (end) f.producer.close();
    else { f.say('trainee', 'I do not want to talk about the handoff.'); f.observe([], undefined, followThrough(f, 'retired')); }
    pending.resolve(generated('Return to the handoff.')); await f.producer.settle();
    expect(f.sent.filter(event => event.type === 'session.instructions.append')).toHaveLength(1);
    expect(f.of('producer')[1]!.outcome).toBe(end ? 'aborted' : 'withheld');
  }
});

for (const queued of [false, true]) test(`a new story can defer a ${queued ? 'queued' : 'in-flight'} recovery without withholding its direction`, async () => {
  const pending = deferred<Generated>(); let count = 0;
  const f = await directedFixture({ generateProducer: async () => {
    count++;
    return count === 1 ? generated('Ask about the handoff.') : count === 2 ? pending.promise : generated('Return to the handoff; ask how the team prepared it.');
  } });
  f.advance(30_000); f.say('client', 'Anything else?');
  f.observe([], undefined, followThrough(f, 'missed'));
  if (queued) f.observe([concern('source-confusion')]);
  f.producer.tick();
  f.say('trainee', 'One more thing: a junior developer caught a duplicate payment before launch.');
  f.say('client', 'What did they notice?');
  f.observe([], undefined, followThrough(f, 'deferred'));
  pending.resolve(generated(queued ? null : 'Return to the handoff; ask how the team prepared it.'));
  await f.producer.settle();
  expect(f.sent.filter(event => event.type === 'session.instructions.append')).toHaveLength(2);
  expect(f.calls.generate).toHaveLength(queued ? 3 : 2);
  expect(f.of('producer').at(-1)).toMatchObject({ outcome: 'sent', queued, recoveryUsed: true, delivery: { afterPassageId: f.transcript().at(-1)!.id } });
});

test('a retired recovery does not suppress a queued boundary correction', async () => {
  const first = deferred<Generated>(), correction = deferred<Generated>(); let count = 0;
  const f = await directedFixture({ generateProducer: async () => {
    count++;
    return count === 1 ? generated('Ask about the handoff.') : count === 2 ? first.promise : correction.promise;
  } });
  f.advance(30_000); f.say('client', 'Anything else?');
  f.observe([], undefined, followThrough(f, 'missed'));
  f.observe([concern('source-confusion')]); // Keep an ordinary consultation in flight.
  f.producer.tick(); // Recovery waits behind it.
  f.observe([concern('boundary-pressure')]);
  first.resolve(generated(null)); await flush();
  expect(f.calls.generate[2]!.triggers.map(item => item.kind)).toEqual(['cue-recovery', 'concern']);
  f.say('trainee', 'I cannot discuss the handoff. I can explain how our access queue worked.');
  f.observe([], undefined, followThrough(f, 'retired'));
  correction.resolve(generated('Respect their limit and ask about the access queue.'));
  await f.producer.settle();
  expect(f.of('producer')[2]!.outcome).toBe('sent');
  expect(f.sent.filter(event => event.type === 'session.instructions.append')).toHaveLength(2);
});

test('a recovery that returns no direction stops reassessing the spent cue', async () => {
  let count = 0;
  const f = await directedFixture({ generateProducer: async () => generated(++count === 1 ? 'Ask about the handoff.' : null) });
  f.advance(30_000); f.say('client', 'Anything else?');
  f.observe([], undefined, followThrough(f, 'missed')); f.producer.tick();
  await f.producer.settle();
  expect(f.of('producer')[1]!.outcome).toBe('none');
  expect(f.producer.cue()).toBeUndefined();
  expect(f.record.followThrough?.outcome).toBe('missed');
});

test('exhausted cue budget cannot spend a recovery consultation', async () => {
  const f = await directedFixture();
  for (let index = 1; index < PRODUCER_LIMITS.cues; index++) {
    f.observe([concern('leading', .1)]); f.observe([concern('leading')]);
    await f.producer.settle();
  }
  const last = f.of('producer').at(-1)!;
  f.producer.providerEvent(last.delivery!.eventId, true, { endMs: 5000 });
  f.advance(30_000); f.say('client', 'Anything else?');
  f.observe([], undefined, followThrough(f, 'missed')); f.producer.tick();
  expect(f.calls.generate).toHaveLength(PRODUCER_LIMITS.cues);
  expect(last.recoveryUsed).toBeUndefined();
});
