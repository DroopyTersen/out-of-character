import { afterEach, expect, mock, setSystemTime, test } from 'bun:test';
import { emptySkills } from '../../../core/simulator/types';
import { LiveSessionGone } from './live.server';

// Bun cannot load the Workers runtime. Substitute only its base-class/storage
// boundary and paid network adapters; exercise the actual session owner/events.
mock.module('cloudflare:workers', () => ({ DurableObject: class {
  constructor(protected ctx: DurableObjectState, protected env: Env) {}
} }));
const { SimulatorSession } = await import('./session');
afterEach(() => setSystemTime());
const capability = `Bearer ${'a'.repeat(64)}`;
const attempt = { id: 'c49f7954-7aab-47f9-a269-752932556c37', scenarioId: 'sharepoint', clientId: 'morgan', sdp: 'v=0\r\no=fixture-offer\r\n' };
const request = (action: string, cap = capability) => new Request(`https://session/${action}`, { method: 'POST', headers: { Authorization: cap }, body: action === 'start' ? JSON.stringify(attempt) : undefined });

class ProviderSocket extends EventTarget {
  readyState = 1;
  sent: Record<string, unknown>[] = [];
  send(text: string) {
    const event = JSON.parse(text);
    this.sent.push(event);
    if (event.type === 'session.close') queueMicrotask(() => this.emit({ type: 'session.closed', reason: 'close_requested', usage: { seconds: 12 }, session: { instructions: 'private actor brief' } }));
  }
  emit(event: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) })); }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
}
async function fixture(pendingCreation?: Promise<void>, values = new Map<string, unknown>(), overrides: Partial<NonNullable<ConstructorParameters<typeof SimulatorSession>[2]>> = {}) {
  const socket = new ProviderSocket();
  let ready = Promise.resolve();
  let alarm = 0;
  let creations = 0;
  const judged: unknown[] = [];
  const pending: Promise<unknown>[] = [];
  const ctx = {
    storage: { get: async (key: string) => values.get(key), put: async (key: string, value: unknown) => { values.set(key, structuredClone(value)); }, setAlarm: async (value: number) => { alarm = value; }, deleteAll: async () => values.clear() },
    blockConcurrencyWhile: (fn: () => Promise<void>) => { ready = fn(); }, waitUntil: (promise: Promise<unknown>) => { pending.push(promise); },
  } as unknown as DurableObjectState;
  const session = new SimulatorSession(ctx, { OPENAI_API_KEY: 'fixture', TYPESAFE_API_KEY: 'fixture', SIMULATOR_DIRECTOR_ENABLED: overrides.evaluateClient ? 'true' : 'false' } as Env, {
    createLive: async () => { creations++; await pendingCreation; return { session: { id: 'provider-private-id' }, transport: { type: 'webrtc', sdp: 'v=0\r\nanswer' } }; },
    attachLive: async () => socket as unknown as WebSocket,
    evaluateTrainee: async input => { judged.push(input.transcript); return { revision: input.revision, skills: emptySkills(), objectives: [], hint: null, hintId: null, concern: null, model: 'fixture', durationMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, answers: {} }; },
    evaluateClient: async () => { throw new Error('Director should be disabled.'); },
    ...overrides,
  });
  await ready;
  return { session, socket, values, judged, pending, creations: () => creations, alarm: () => alarm };
}

test('session ownership, authoritative transcript, close acknowledgment, and public projection', async () => {
  const f = await fixture();
  expect((await f.session.fetch(request('start'))).status).toBe(200);
  expect((await f.session.fetch(request('poll', `Bearer ${'b'.repeat(64)}`))).status).toBe(403);
  await f.session.fetch(request('ready'));
  const speech = { type: 'session.input_transcript.delta', event_id: 'one', delta: 'Who owns that process?', start_ms: 100, end_ms: 2000 };
  f.socket.emit(speech); f.socket.emit(speech);
  const result = await (await f.session.fetch(request('end'))).json() as Record<string, any>;
  expect(result.status).toBe('ended');
  expect(result.finalization).toBe('confirmed');
  expect(result.usageSeconds).toBe(12);
  expect(result.transcript).toHaveLength(1);
  expect(result.transcript[0].text).toBe('Who owns that process?');
  expect(f.judged).toHaveLength(1);
  expect(JSON.stringify(result)).not.toContain('private');
  expect(JSON.stringify(result)).not.toContain('answers');
  expect(f.socket.readyState).toBe(3);
});
test('cancelling during provider creation closes the eventual session', async () => {
  let release!: () => void;
  const f = await fixture(new Promise<void>(resolve => { release = resolve; }));
  const starting = f.session.fetch(request('start'));
  // Wait until creation actually reaches the paid boundary, then race cancellation.
  while (!f.creations()) await Promise.resolve();
  const ending = f.session.fetch(request('end'));
  release();
  expect((await starting).status).toBe(409);
  const result = await (await ending).json() as Record<string, unknown>;
  expect(result.finalization).toBe('confirmed');
  expect(f.socket.sent.some(event => event.type === 'session.close')).toBe(true);
});
test('concurrent starts create only one paid session', async () => {
  const f = await fixture();
  const responses = await Promise.all([f.session.fetch(request('start')), f.session.fetch(request('start'))]);
  expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
  expect(f.creations()).toBe(1);
  await f.session.fetch(request('end'));
});
test('an end arriving before start prevents any paid creation for that attempt', async () => {
  const f = await fixture();
  await f.session.fetch(request('end'));
  expect((await f.session.fetch(request('start'))).status).toBe(409);
  expect(f.creations()).toBe(0);
});
test('server alarm closes abandoned practice without browser cooperation', async () => {
  const f = await fixture();
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  expect(f.alarm()).toBeGreaterThan(Date.now());
  setSystemTime(Date.now() + 40_000);
  await f.session.alarm();
  const result = await (await f.session.fetch(request('poll'))).json() as Record<string, unknown>;
  expect(result.status).toBe('ended');
  expect(result.finalization).toBe('confirmed');
  expect(f.socket.sent.some(event => event.type === 'session.close')).toBe(true);
});
test('a browser that keeps polling still cannot outlive the attempt deadline', async () => {
  const f = await fixture();
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  setSystemTime(Date.now() + 601_000);
  await f.session.fetch(request('poll'));
  await f.session.alarm();
  const result = await (await f.session.fetch(request('poll'))).json() as Record<string, unknown>;
  expect(result.status).toBe('ended');
  expect(result.finalization).toBe('confirmed');
});
test('failed provider finalization remains explicit and retains a closure lease', async () => {
  const f = await fixture();
  await f.session.fetch(request('start'));
  f.socket.readyState = 3; // Both the existing control socket and reattachment are unavailable.
  const result = await (await f.session.fetch(request('end'))).json() as Record<string, unknown>;
  expect(result.finalization).toBe('unconfirmed');
  expect(result.message).toContain('did not confirm');
  expect(f.values.get('lease')).toMatchObject({ closed: false });
  expect(f.alarm()).toBeGreaterThan(Date.now());
});

test('a replacement session owner closes the persisted provider lease', async () => {
  const original = await fixture();
  await original.session.fetch(request('start'));
  const replacement = await fixture(undefined, original.values);
  await replacement.session.alarm();
  expect(replacement.socket.sent.map(event => event.type)).toEqual(['session.close']);
  expect(replacement.values.get('lease')).toMatchObject({ closed: true });
  expect((await replacement.session.fetch(request('poll'))).status).toBe(410);
  await original.session.fetch(request('end'));
});

test('a cancelled attempt remains unusable after its owner restarts', async () => {
  const original = await fixture();
  await original.session.fetch(request('end'));
  const replacement = await fixture(undefined, original.values);
  expect((await replacement.session.fetch(request('start'))).status).toBe(409);
  expect(replacement.creations()).toBe(0);
});

test('restart recovery clears an already-closed provider and a lease with no recovered id', async () => {
  const values = new Map<string, unknown>([['lease', { capability, providerId: 'gone', deadline: 0, closed: false }]]);
  const gone = await fixture(undefined, values, { attachLive: async () => { throw new LiveSessionGone(); } });
  await gone.session.alarm();
  expect(values.get('lease')).toMatchObject({ closed: true });
  await gone.session.alarm();
  expect(values.size).toBe(0);
  values.set('lease', { capability, deadline: 0, closed: false });
  const unknown = await fixture(undefined, values);
  await unknown.session.alarm();
  expect(values.size).toBe(0);
});

test('new settled dialogue marks earlier feedback delayed while reassessment is pending', async () => {
  let release!: () => void;
  let calls = 0;
  const f = await fixture(undefined, undefined, {
    evaluateTrainee: async input => {
      if (++calls === 2) await new Promise<void>(resolve => { release = resolve; });
      return { revision: input.revision, skills: emptySkills(), objectives: [], hint: null, hintId: null, concern: null, model: 'fixture', durationMs: 1, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, answers: {} };
    },
  });
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'Who owns the workflow?', start_ms: 0, end_ms: 1000 });
  await new Promise(resolve => setTimeout(resolve, 1600));
  const first = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
  expect(first.feedbackStatus).toBe('current');
  f.socket.emit({ type: 'session.output_transcript.delta', delta: 'Operations does, but do not contact them yet.', start_ms: 1100, end_ms: 2300 });
  await new Promise(resolve => setTimeout(resolve, 1600));
  const waiting = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
  expect(waiting.evaluation.revision).toBe(first.evaluation.revision);
  expect(waiting.feedbackStatus).toBe('delayed');
  // Wait for the owner cadence to start the next request, then release its result.
  while (!release) await new Promise(resolve => setTimeout(resolve, 100));
  release();
  await Promise.all(f.pending);
  const current = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
  expect(current.feedbackStatus).toBe('current');
  expect(current.evaluation.revision).toBe(current.revision);
  await f.session.fetch(request('end'));
}, 10_000);

for (const newerReply of [false, true]) test(`director ${newerReply ? 'rejects a new settled reply' : 'allows continuing client audio'} during assessment`, async () => {
  let resolve!: () => void;
  let assessed!: () => void;
  const started = new Promise<void>(done => { assessed = done; });
  const f = await fixture(undefined, undefined, {
    evaluateClient: async input => {
      assessed();
      await new Promise<void>(done => { resolve = done; });
      return { revision: input.revision, cueId: 'approval-boundary', cueProbability: .99, fidelity: 1, interests: [1], model: 'fixture', durationMs: 1, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, answers: {} };
    },
  });
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'Sign today.', start_ms: 0, end_ms: 900 });
  await new Promise(resolve => setTimeout(resolve, 1100));
  f.socket.emit({ type: 'session.output_transcript.delta', delta: 'Sure,', start_ms: 1000, end_ms: 1500 });
  await started;
  f.socket.emit({ type: 'session.output_transcript.delta', delta: ' I can approve it.', start_ms: 1500, end_ms: 2000 });
  if (newerReply) {
    f.socket.emit({ type: 'session.input_transcript.delta', delta: 'Actually, ask your COO first.', start_ms: 2200, end_ms: 3100 });
    f.socket.emit({ type: 'session.output_transcript.delta', delta: 'Yes.', start_ms: 3200, end_ms: 3400 });
    await new Promise(resolve => setTimeout(resolve, 1300));
  }
  resolve();
  await Promise.all(f.pending);
  expect(f.socket.sent.filter(event => String(event.event_id).startsWith('cue-'))).toHaveLength(newerReply ? 0 : 1);
  const snapshot = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
  if (!newerReply) expect(snapshot.feedbackStatus).toBe('current');
  await f.session.fetch(request('end'));
});
