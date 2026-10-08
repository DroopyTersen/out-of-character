import { afterEach, expect, setSystemTime, test } from 'bun:test';
import { fixtureFoundryEnv } from '../../../ai/foundry-fixture';
import { emptyInterviewReadings } from '../../../core/interview';
import { threadKey } from '../../../core/interview-ranking';
import type { Checkpoint, Lease } from '../../../interview-engine/interview/interview.server';
import type { Narrative, NarrativeRun } from '../../../interview-engine/narrative/narrative.server';
import type { Providers } from '../../../interview-engine/providers/providers.server';
// The simulator fixture substitutes the Workers base class before anything imports it.
import { attempt, capability, fixture, settle, waitFor } from '../simulator/session-fixture';

const { InterviewObject, durableStore, durableBackground } = await import('./durableObject');
afterEach(() => setSystemTime());

/** Durable Object storage as far as the store uses it, with the alarm visible. */
function fakeStorage(values = new Map<string, unknown>()) {
  const calls: string[] = [];
  let alarm: number | null = null;
  const storage = {
    get: async (key: string) => structuredClone(values.get(key)),
    put: async (key: string, value: unknown) => { calls.push(`put ${key}`); values.set(key, structuredClone(value)); },
    delete: async (key: string) => { calls.push(`delete ${key}`); return values.delete(key); },
    setAlarm: async (at: number) => { calls.push('setAlarm'); alarm = at; },
    deleteAlarm: async () => { calls.push('deleteAlarm'); alarm = null; },
    deleteAll: async () => { calls.push('deleteAll'); values.clear(); },
  };
  return { storage: storage as unknown as DurableObjectStorage, values, calls, alarm: () => alarm };
}

const lease: Lease = { capability, deadline: 5, closed: false } as Lease;
const checkpoint = { id: 'checkpoint' } as unknown as Checkpoint;

test('the storage store keeps the lease and checkpoint under the practice simulator’s keys', async () => {
  const f = fakeStorage();
  const store = durableStore(f.storage);
  expect(await store.load()).toEqual({});
  await store.save({ lease, checkpoint });
  expect(f.calls).toEqual(['put lease', 'put checkpoint']);
  expect(await store.load()).toEqual({ lease, checkpoint });
  await store.save({ checkpoint: null });
  expect(f.values.has('checkpoint')).toBe(false);
  // A closed lease hides any checkpoint left beside it.
  await store.save({ lease: { ...lease, closed: true }, checkpoint });
  expect(await store.load()).toEqual({ lease: { ...lease, closed: true } });
  await store.wake(1234);
  expect(f.alarm()).toBe(1234);
  await store.wake(null);
  expect(f.alarm()).toBeNull();
  await store.clear();
  expect(f.values.size).toBe(0);
});

test('background work is handed to waitUntil', () => {
  const tracked: Promise<unknown>[] = [];
  const work = Promise.resolve();
  durableBackground({ waitUntil: promise => { tracked.push(promise); } }).track(work);
  expect(tracked).toEqual([work]);
});

const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
const graded = (revision: number, transcript: { id: string; speaker: string; text: string }[]) => {
  const passage = transcript[0]!;
  return { revision, readings: emptyInterviewReadings(), model: 'fixture', durationMs: 1, usage, answers: {},
    objectives: [{ id: 'project-delivery', level: 'explored' as const, levels: { 'not-yet': .01, touched: .03, explored: .95, 'set-aside': .01 }, achieved: true, probability: .95, evidence: { entryId: passage.id, speaker: passage.speaker, text: passage.text } }] };
};
const producer = {
  generateMap: async (input: { previous: unknown }) => ({ map: input.previous, update: { vantage: null, preferences: null, entities: [], edges: [], threads: [], revise: [], close: [], drop: [] }, changes: { added: [], changed: [], dropped: [], kept: [] }, research: null, pace: { verdict: 'explore' as const, reason: 'Open threads remain.' }, model: 'gpt-6.1-sol', usage: { inputTokens: 1, outputTokens: 1 } }),
  evaluateTurn: async (input: { transcript: { id: string }[]; atMs: number }) => ({ reading: { passageId: input.transcript.at(-1)!.id, atMs: input.atMs, focus: null, keys: {}, natural: {}, states: {}, novel: 0 }, model: 'fixture', durationMs: 1, usage, answers: {} }),
  evaluateTraits: async (input: { threads: { id: string }[] }) => ({ traits: Object.fromEntries(input.threads.map(thread => [thread.id, { key: threadKey(thread as never), spicy: .5, grounding: 0 }])), model: 'fixture', durationMs: 1, usage }),
  lookupInterviewBackground: async () => ({ status: 'unresolved' as const, reason: 'fixture', queries: [] }),
};
// The frozen archive row records this summary without usage, as the fixture's earlier summary reported none.
const summary = (): NarrativeRun => {
  const document = { text: 'Fixture summary.' };
  return { stream: new ReadableStream<string>({ start(controller) { controller.enqueue(JSON.stringify(document)); controller.close(); } }), result: Promise.resolve({ document, failure: null, usage: null } as unknown as Narrative) };
};

/** The new object over the practice simulator's fixture parts: its sockets, its archive database, the same env. */
async function interviewObject(spare: Awaited<ReturnType<typeof fixture>>) {
  const values = new Map<string, unknown>();
  const storage = fakeStorage(values);
  const pending: Promise<unknown>[] = [];
  const grades: number[] = [];
  let ready = Promise.resolve();
  const ctx = { storage: storage.storage, blockConcurrencyWhile: (fn: () => Promise<void>) => { ready = fn(); }, waitUntil: (promise: Promise<unknown>) => { pending.push(promise); } } as unknown as DurableObjectState;
  const voice = {
    create: async () => { spare.socketFor('provider-private-id'); return { id: 'provider-private-id', sdp: 'v=0\r\nanswer' }; },
    attach: async (id: string) => spare.socketFor(id)!,
    close: async () => {},
  };
  const object = new InterviewObject(ctx, {
    ...fixtureFoundryEnv, TYPESAFE_API_KEY: 'fixture', SIMULATOR_ARCHIVE: spare.archive.d1,
    CF_VERSION_METADATA: { id: 'test-worker', tag: 'test-release', timestamp: '2026-09-26T00:00:00.000Z' },
  } as Env, {
    providers: { voice, language: {}, judge: {} } as unknown as Providers,
    services: { ...producer, evaluate: async (input: { revision: number; transcript: { id: string; speaker: string; text: string }[] }) => { grades.push(input.revision); return graded(input.revision, input.transcript) as never; } } as never,
    narrate: summary,
  });
  await ready;
  return { object, values, pending, storage, grades, socket: spare.socket, row: spare.interviewRow };
}

const interviewAttempt = { ...attempt, scenarioId: 'project-closeout', clientId: 'sam-cedar' };
const body = (action: string) => action === 'start' ? JSON.stringify(interviewAttempt) : action === 'poll' ? JSON.stringify({ active: false, audio: false, outputQuietMs: 60_000 }) : undefined;
const send = (target: { fetch(request: Request): Promise<Response> }, action: string, cap = capability) =>
  target.fetch(new Request(`https://session/${action}`, { method: 'POST', headers: { Authorization: cap }, body: body(action) }));

const uuids = (value: unknown) => JSON.parse(JSON.stringify(value).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'uuid'));

type Target = { fetch(request: Request): Promise<Response>; socket: { emit(event: unknown): void; sent: Record<string, unknown>[] }; pending: Promise<unknown>[]; grades: () => number; values: Map<string, unknown> };
/** One scripted attempt, at fixed clock times, returning every reply as status and JSON text. */
async function script(target: Target) {
  const epoch = 1_800_000_000_000;
  const replies: [string, number, unknown][] = [];
  const call = async (action: string, cap = capability) => {
    const response = await send(target, action, cap);
    const text = await response.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* a streamed report */ }
    replies.push([action, response.status, parsed]);
    return response;
  };
  setSystemTime(epoch);
  await call('poll');
  await call('start');
  await call('start', `Bearer ${'b'.repeat(64)}`);
  setSystemTime(epoch + 1000);
  await call('ready');
  target.socket.emit({ type: 'session.output_transcript.delta', event_id: 'o1', delta: 'Hi, I’m Sam. What did you deliver?', start_ms: 0, end_ms: 900 });
  target.socket.emit({ type: 'session.input_transcript.delta', event_id: 'i1', delta: 'We built a permit intake portal.', start_ms: 1500, end_ms: 2400 });
  setSystemTime(epoch + 4000);
  await waitFor(() => target.grades() >= 1);
  await settle(target);
  await call('poll');
  await call('pause');
  await settle(target);
  const paused = structuredClone(target.values.get('checkpoint'));
  await call('poll');
  setSystemTime(epoch + 6000);
  await call('end');
  await settle(target);
  await call('poll');
  await call('report');
  await settle(target);
  await call('poll');
  return { replies, paused };
}

/** Frozen from the practice simulator's session running this script before its interview branches were removed (Phase 5). */
const frozen = await Bun.file(new URL('./scripted-attempt.json', import.meta.url)).json() as { replies: [string, number, unknown][]; paused: unknown; lease: unknown; checkpoint: boolean; row: unknown };

test('the interview object answers a scripted attempt exactly as the practice simulator’s session did', async () => {
  const spare = await fixture();
  const next = await interviewObject(spare);
  const after = await script({ fetch: request => next.object.fetch(request), get socket() { return spare.socket; }, pending: next.pending, grades: () => next.grades.length, values: next.values });

  expect(after.replies.map(([action, status]) => [action, status])).toEqual([['poll', 404], ['start', 200], ['start', 403], ['ready', 200], ['poll', 200], ['pause', 200], ['poll', 200], ['end', 200], ['poll', 200], ['report', 200], ['poll', 200]]);
  expect(after.replies).toEqual(frozen.replies);
  // The paused checkpoint is the one a restore reads; the note ids inside it are random.
  expect(after.paused).toBeDefined();
  expect(uuids(after.paused)).toEqual(frozen.paused);
  expect(next.values.get('lease')).toEqual(frozen.lease);
  expect(next.values.has('checkpoint')).toBe(frozen.checkpoint);
  expect(uuids(next.row())).toEqual(frozen.row);
}, 15_000);

test('the alarm wakes the session: an end that arrived before its start is forgotten once the hold passes', async () => {
  const epoch = 1_800_000_000_000;
  setSystemTime(epoch);
  const next = await interviewObject(await fixture());
  expect((await send(next.object, 'end')).status).toBe(200);
  expect(next.values.get('lease')).toMatchObject({ capability, closed: true });
  expect(next.storage.alarm()).toBe(epoch + 60_000);
  setSystemTime(epoch + 60_000);
  await next.object.alarm();
  expect(next.values.size).toBe(0);
  expect(next.storage.calls.at(-1)).toBe('deleteAll');
});

test('the report waits for an end and is refused without participant speech', async () => {
  const spare = await fixture();
  const next = await interviewObject(spare);
  expect((await send(next.object, 'start')).status).toBe(200);
  await send(next.object, 'ready');
  expect(await (await send(next.object, 'report')).json() as unknown).toEqual({ error: 'End the conversation before requesting its report.' });
  expect((await send(next.object, 'end')).status).toBe(200);
  await settle(next);
  const report = await send(next.object, 'report');
  expect(report.status).toBe(422);
  expect(await report.json() as unknown).toEqual({ error: 'There is not enough scored conversation to review.' });
  expect((await (await send(next.object, 'poll')).json() as { report: { status: string } }).report.status).toBe('ineligible');
});
