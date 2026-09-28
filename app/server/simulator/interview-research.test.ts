import { afterEach, expect, setSystemTime, test } from 'bun:test';
import { ContextualDirector, directorServices } from './contextual-director';
import { directorContext } from '../../../ai/simulator/director.server';
import type { DirectorSignal, ResearchRecord } from '../../../core/simulator/director';
import type { TranscriptEntry } from '../../../core/simulator/types';

afterEach(() => setSystemTime());
const epoch = 1_800_000_000_000;
const target = { kind: 'product' as const, name: 'OpenStreetMap', passageId: 'p1' };
const found = { facts: [{ text: 'OpenStreetMap is built by a community of mappers.', url: 'https://www.openstreetmap.org/about', title: 'About OpenStreetMap' }], retrievedAt: epoch, queries: ['OpenStreetMap official overview'] };
const cue = { action: 'intervene' as const, text: 'Respect the limit and follow their own experience.', evidenceIds: ['p1'], model: 'gpt-6-sol', usage: { inputTokens: 10, outputTokens: 10 } };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

// Only paid adapters are substituted: exercise the actual gate, lifetime,
// transcript freshness, note accounting and public/private projections.
function fixture(overrides: Partial<typeof directorServices> = {}, scenarioId = 'project-closeout') {
  setSystemTime(epoch);
  let transcript: TranscriptEntry[] = [{ id: 'p1', speaker: 'trainee', text: 'We integrated OpenStreetMap.', startMs: 0, endMs: 1000 }];
  const sent: Record<string, unknown>[] = [];
  let preparations = 0, searches = 0;
  const director = new ContextualDirector({
    scenarioId, clientId: scenarioId === 'project-closeout' ? 'sam-cedar' : 'morgan', objectives: () => [],
    openaiKey: 'fixture', typesafeKey: 'fixture', settled: () => transcript,
    isFresh: input => JSON.stringify(input) === JSON.stringify(transcript), send: event => { sent.push(event); return true; },
    services: { generateDirector: overrides.generateDirector ?? (async () => cue), recheckDirector: overrides.recheckDirector ?? (async () => ({ probability: .99, usage: { inputTokens: 1, outputTokens: 1 } })),
      prepareInterviewResearch: async input => { preparations++; return overrides.prepareInterviewResearch ? overrides.prepareInterviewResearch(input) : target; },
      lookupInterviewBackground: async input => { searches++; return overrides.lookupInterviewBackground ? overrides.lookupInterviewBackground(input) : found; },
    },
  });
  const observe = (researchProbability = .99, signals: DirectorSignal[] = [], capturedAt = Date.now()) => director.observe(
    director.beginObservation({ audience: 'actor', transcript: [...transcript], revision: transcript.length, capturedAt }), { signals, researchProbability });
  const advance = (text = 'More on the same topic.') => { setSystemTime(Date.now() + 21_000); transcript = [...transcript, { id: `p${transcript.length + 1}`, speaker: 'trainee', text, startMs: 1000, endMs: 2000 }]; };
  return { director, sent, observe, advance, counts: () => ({ preparations, searches }), records: () => director.records.filter((item): item is ResearchRecord => item.source === 'research'), transcript: () => transcript };
}

test('a source becomes public only on receipt; preparation and queries stay private', async () => {
  const f = fixture();
  await f.observe();
  expect(f.sent).toHaveLength(1);
  expect(f.sent[0]).toMatchObject({ type: 'session.thinking.append', delegation_id: null });
  expect(f.director.publicBackground()).toEqual([]);
  expect(f.director.background()[0]?.status).toBe('unknown');
  f.director.providerEvent(String(f.sent[0]!.event_id), true);
  expect(f.director.publicBackground()).toEqual([{ id: f.records()[0]!.id, target: { kind: 'product', name: 'OpenStreetMap' }, facts: found.facts, retrievedAt: epoch }]);
  const publicJson = JSON.stringify(f.director.publicBackground());
  expect(publicJson).not.toContain('queries');
  expect(publicJson).not.toContain('passageId');
  const context = directorContext({ audience: 'actor', reason: { condition: 'invented-facts', probability: .9 }, scenarioId: 'project-closeout', clientId: 'sam-cedar', transcript: f.transcript(), objectives: [], history: f.director.records });
  expect(context.deliveredBackground?.[0]?.facts).toEqual(found.facts);
  expect(context.previousInterventions).toEqual([]);
  f.director.providerEvent(String(f.sent[0]!.event_id), false);
  expect(f.director.publicBackground()).toEqual([]);
  expect(f.director.background()).toEqual([]);
});

test('a declined preparation waits for a new signal episode and stops after three attempts', async () => {
  const f = fixture({ prepareInterviewResearch: async () => null });
  await f.observe();
  for (let index = 0; index < 4; index++) { f.advance(); await f.observe(); }
  expect(f.counts()).toEqual({ preparations: 1, searches: 0 });
  for (let index = 0; index < 4; index++) { await f.observe(.1); f.advance(); await f.observe(); }
  expect(f.counts()).toEqual({ preparations: 3, searches: 0 });
  expect(f.records().map(item => item.outcome)).toEqual(['none', 'none', 'none']);
});

test('duplicate public targets are not searched again after a resolved episode', async () => {
  const f = fixture();
  await f.observe(); await f.observe(.1); f.advance(); await f.observe();
  expect(f.counts()).toEqual({ preparations: 2, searches: 1 });
  expect(f.records().at(-1)?.outcome).toBe('duplicate');
});

test('two research notes share the six-note actor cap', async () => {
  let index = 0;
  const f = fixture({ prepareInterviewResearch: async () => ({ ...target, name: `Public product ${++index}` }) });
  for (let i = 0; i < 3; i++) { await f.observe(.1); await f.observe(); f.advance(); }
  expect(f.counts().preparations).toBe(2);
  expect(f.sent).toHaveLength(2);
  for (let i = 0; i < 6; i++) {
    await f.observe(0, [{ condition: 'leading', probability: .1 }]);
    await f.observe(0, [{ condition: 'leading', probability: .99 }]);
    f.advance();
  }
  expect(f.sent).toHaveLength(6);
  expect(f.director.summary().notes).toBe(6);
});

test('a Sol review owns the slot and a recently sent correction delays research admission', async () => {
  const pending = deferred<typeof cue>();
  const f = fixture({ generateDirector: () => pending.promise });
  const work = f.observe(.99, [{ condition: 'boundary-pressure', probability: .7 }, { condition: 'overprobing', probability: .99 }]);
  expect(f.counts().preparations).toBe(0);
  pending.resolve(cue); await work;
  await f.observe(.99, []);
  expect(f.counts().preparations).toBe(0);
  f.advance(); await f.observe();
  expect(f.counts().preparations).toBe(1);
});

test.each(['busy', 'recent'] as const)('a finished lookup is dropped when Sol has %s work', async mode => {
  const search = deferred<typeof found>();
  const producer = deferred<typeof cue>();
  const f = fixture({ lookupInterviewBackground: () => search.promise, generateDirector: () => producer.promise });
  const research = f.observe();
  await Promise.resolve();
  const direction = f.observe(0, [{ condition: 'leading', probability: .99 }]);
  if (mode === 'recent') { producer.resolve(cue); await direction; }
  search.resolve(found); await research;
  expect(f.records()[0]?.outcome).toBe('blocked');
  expect(f.sent.filter(item => String(item.event_id).startsWith('research-'))).toEqual([]);
  producer.resolve(cue); await direction;
  // A new signal episode may use another attempt after the correction settles.
  // No retry is started automatically when the displaced result is dropped.
  expect(f.counts().searches).toBe(1);
  f.advance(); await f.observe();
  expect(f.counts().searches).toBe(2);
  expect(f.records().at(-1)?.outcome).toBe('sent');
});

test.each(['none', 'error', 'timeout'] as const)('lookup %s keeps its attempt budget and follows the target reuse rule', async outcome => {
  let lookups = 0;
  const f = fixture({ lookupInterviewBackground: async () => {
    if (++lookups > 1) return found;
    if (outcome === 'error') throw new Error('Provider unavailable');
    if (outcome === 'timeout') throw new DOMException('Timed out', 'TimeoutError');
    return null;
  } });
  await f.observe(); await f.observe(.1); f.advance(); await f.observe();
  expect(f.records()[0]?.outcome).toBe(outcome);
  expect(f.counts().preparations).toBe(2);
  expect(f.counts().searches).toBe(outcome === 'none' ? 1 : 2);
  expect(f.records().at(-1)?.outcome).toBe(outcome === 'none' ? 'duplicate' : 'sent');
});

test('research expiry includes the Jev delay and discards late provider success', async () => {
  const search = deferred<typeof found>();
  const f = fixture({ lookupInterviewBackground: () => search.promise });
  setSystemTime(epoch + 2000);
  const work = f.observe(.99, [], epoch);
  await Promise.resolve();
  setSystemTime(epoch + 25_001);
  search.resolve(found); await work;
  expect(f.sent).toEqual([]);
  expect(f.records()[0]?.outcome).toBe('timeout');
});

test.each(['prepare', 'search'] as const)('End aborts research during %s and freezes its archive record', async stage => {
  const preparation = deferred<typeof target>(); const search = deferred<typeof found>();
  let signal: AbortSignal | undefined;
  const f = fixture(stage === 'prepare'
    ? { prepareInterviewResearch: input => { signal = input.signal; return preparation.promise; } }
    : { lookupInterviewBackground: input => { signal = input.signal; return search.promise; } });
  const work = f.observe(); await Promise.resolve(); await Promise.resolve();
  f.director.close();
  const ended = structuredClone(f.records());
  expect(signal?.aborted).toBe(true);
  expect(ended[0]?.outcome).toBe('aborted');
  preparation.resolve(target); search.resolve(found); await work;
  expect(f.records()).toEqual(ended);
  expect(f.sent).toEqual([]);
});

test('stale assessments, invalid probabilities, and simulator sessions cannot start research', async () => {
  const f = fixture();
  const observation = f.director.beginObservation({ audience: 'actor', transcript: f.transcript(), revision: 1, capturedAt: epoch });
  f.advance();
  await f.director.observe(observation, { signals: [], researchProbability: .99 });
  for (const probability of [NaN, 1.1, -.1, .49]) await f.observe(probability);
  expect(f.counts().preparations).toBe(0);
  const simulator = fixture({}, 'sharepoint'); await simulator.observe();
  expect(simulator.counts().preparations).toBe(0);
});
