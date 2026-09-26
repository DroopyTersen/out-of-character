import { Database } from 'bun:sqlite';
import { afterEach, expect, mock, setSystemTime, test } from 'bun:test';
import { emptySkills } from '../../../core/simulator/types';
import { LiveSessionGone } from './live.server';

// Bun cannot load the Workers runtime. Substitute only its base-class/storage
// boundary and paid network adapters; exercise the actual session owner/events.
mock.module('cloudflare:workers', () => ({ DurableObject: class {
  constructor(protected ctx: DurableObjectState, protected env: Env) {}
} }));
const { SimulatorSession } = await import('./session');
const migration = await Bun.file(new URL('../../../migrations/0001_simulator_attempts.sql', import.meta.url)).text();
afterEach(() => setSystemTime());
async function waitFor(check: () => boolean) {
  const deadline = performance.now() + 2500;
  while (!check()) {
    if (performance.now() > deadline) throw new Error('Timed out waiting for the session event.');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
const capability = `Bearer ${'a'.repeat(64)}`;
const attempt = { id: 'c49f7954-7aab-47f9-a269-752932556c37', scenarioId: 'sharepoint', clientId: 'morgan', sdp: 'v=0\r\no=fixture-offer\r\n' };
const request = (action: string, cap = capability) => new Request(`https://session/${action}`, { method: 'POST', headers: { Authorization: cap }, body: action === 'start' ? JSON.stringify(attempt) : undefined });

function archiveDatabase() {
  const sqlite = new Database(':memory:');
  sqlite.exec(migration);
  let failNext = false;
  let held: { entered: () => void; wait: Promise<void> } | undefined;
  const d1 = {
    prepare: (sql: string) => ({
      bind: (...args: (string | number | null)[]) => ({
        run: async () => {
          const pause = held;
          held = undefined;
          if (pause) { pause.entered(); await pause.wait; }
          if (failNext) { failNext = false; throw new Error('D1 unavailable'); }
          sqlite.prepare(sql).run(...args);
          return { success: true };
        },
      }),
    }),
  } as unknown as D1Database;
  const row = () => sqlite.query('SELECT * FROM simulator_attempts WHERE id = ?').get(attempt.id) as Record<string, any> | null;
  const holdNext = () => {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    held = { entered, wait };
    return { started, release };
  };
  return { d1, row, failNext: () => { failNext = true; }, holdNext };
}

class ProviderSocket extends EventTarget {
  readyState = 1;
  holdClose = false;
  sent: Record<string, unknown>[] = [];
  send(text: string) {
    const event = JSON.parse(text);
    this.sent.push(event);
    if (event.type === 'session.close' && !this.holdClose) queueMicrotask(() => this.emit({ type: 'session.closed', reason: 'close_requested', usage: { seconds: 12 }, session: { instructions: 'private actor brief' } }));
  }
  emit(event: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) })); }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
}
type FixtureOptions = {
  pendingCreation?: Promise<void>;
  values?: Map<string, unknown>;
  overrides?: Partial<NonNullable<ConstructorParameters<typeof SimulatorSession>[2]>>;
  archive?: ReturnType<typeof archiveDatabase>;
  metadata?: boolean;
};
async function fixture({ pendingCreation, values = new Map<string, unknown>(), overrides = {}, archive = archiveDatabase(), metadata = true }: FixtureOptions = {}) {
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
  const session = new SimulatorSession(ctx, {
    OPENAI_API_KEY: 'fixture', TYPESAFE_API_KEY: 'fixture',
    SIMULATOR_DIRECTOR_ENABLED: overrides.evaluateClient ? 'true' : 'false',
    SIMULATOR_ARCHIVE: archive.d1,
    ...(!metadata ? {} : { CF_VERSION_METADATA: { id: 'test-worker', tag: 'test-release', timestamp: '2026-09-26T00:00:00.000Z' } }),
  } as Env, {
    createLive: async () => { creations++; await pendingCreation; return { session: { id: 'provider-private-id' }, transport: { type: 'webrtc', sdp: 'v=0\r\nanswer' } }; },
    attachLive: async () => socket as unknown as WebSocket,
    evaluateTrainee: async input => { judged.push(input.transcript); return { revision: input.revision, skills: emptySkills(), objectives: [], hint: null, hintId: null, concern: null, model: 'fixture', durationMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, answers: {} }; },
    evaluateClient: async () => { throw new Error('Director should be disabled.'); },
    ...overrides,
  });
  await ready;
  return { session, socket, values, judged, pending, archive, row: archive.row, creations: () => creations, alarm: () => alarm };
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

test('happy hour archives the client voice without live or final judging', async () => {
  let directed = 0;
  const f = await fixture({ overrides: {
    evaluateClient: async () => { directed++; throw new Error('Unexpected social director'); },
  } });
  await f.session.fetch(new Request('https://session/start', {
    method: 'POST', headers: { Authorization: capability }, body: JSON.stringify({ ...attempt, scenarioId: 'happy-hour', clientId: 'jamie' }),
  }));
  await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.output_transcript.delta', delta: 'Hi, I’m Jamie. How is your evening?', start_ms: 100, end_ms: 900 });
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'Great. What do you do for fun?', start_ms: 1000, end_ms: 2000 });
  setSystemTime(Date.now() + 12_000);
  // Let the real session timer see settled speech, which normally starts both judges.
  await new Promise(resolve => setTimeout(resolve, 750));
  expect(f.judged).toHaveLength(0);
  expect(directed).toBe(0);
  const live = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
  expect(live.status).toBe('live');
  expect(live.evaluation).toBeNull();
  const ended = await (await f.session.fetch(request('end'))).json() as Record<string, any>;
  await Promise.all(f.pending);
  expect(ended.status).toBe('ended');
  expect(ended.finalization).toBe('confirmed');
  expect(ended.transcript.map((entry: { speaker: string }) => entry.speaker)).toEqual(['client', 'trainee']);
  expect(ended.evaluation).toBeNull();
  expect(f.judged).toHaveLength(0);
  expect(directed).toBe(0);
  expect(f.socket.readyState).toBe(3);
  expect(f.row()?.archive_state).toBe('final');
  expect(f.row()?.scenario_id).toBe('happy-hour');
  expect(f.row()?.evaluation_json).toBeNull();
  expect(JSON.parse(f.row()!.provenance_json).voice).toBe('marin');
  expect(JSON.parse(f.row()!.transcript_json)).toEqual(ended.transcript);
});
test('normal End keeps a late trainee tail but excludes an unheard client agreement', async () => {
  let graded: { speaker: string; text: string }[] = [];
  const f = await fixture({ overrides: {
    evaluateTrainee: async input => {
      graded = input.transcript;
      const agreement = input.transcript.find(item => item.speaker === 'client' && item.text.includes('I agree'));
      return { revision: input.revision, skills: emptySkills(), objectives: agreement ? [{ id: 'next-step', achieved: true, probability: .99, evidence: { entryId: agreement.id, speaker: agreement.speaker, text: agreement.text } }] : [], hint: null, hintId: null, concern: null, model: 'fixture', durationMs: 1, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, answers: {} };
    },
  } });
  f.socket.holdClose = true;
  let ending: Promise<Response> | undefined;
  try {
    await f.session.fetch(request('start'));
    await f.session.fetch(request('ready'));
    ending = f.session.fetch(request('end'));
    expect((await (await f.session.fetch(request('poll'))).json() as Record<string, any>).status).toBe('ending');
    f.socket.emit({ type: 'session.input_transcript.delta', delta: 'Let us schedule a scoped assessment.', start_ms: 100, end_ms: 900 });
    f.socket.emit({ type: 'session.output_transcript.delta', delta: 'I agree to that next step.', start_ms: 1000, end_ms: 1600 });
    await waitFor(() => f.socket.sent.some(event => event.type === 'session.close'));
    f.socket.emit({ type: 'session.closed', reason: 'close_requested' });
    const result = await (await ending).json() as Record<string, any>;
    expect(result.status).toBe('ended');
    expect(result.finalization).toBe('confirmed');
    expect(result.transcript.map((item: { speaker: string }) => item.speaker)).toEqual(['trainee']);
    expect(graded.map(item => item.speaker)).toEqual(['trainee']);
    expect(result.evaluation.objectives.find((item: { id: string }) => item.id === 'next-step').achieved).toBe(false);
  } finally {
    f.socket.emit({ type: 'session.closed', reason: 'close_requested' });
    await ending;
  }
}, 10_000);
test('provider connection loss during explicit End does not replace the completed message', async () => {
  const f = await fixture();
  f.socket.holdClose = true;
  let ending: Promise<Response> | undefined;
  try {
    await f.session.fetch(request('start'));
    await f.session.fetch(request('ready'));
    ending = f.session.fetch(request('end'));
    expect((await (await f.session.fetch(request('poll'))).json() as Record<string, any>).status).toBe('ending');
    await waitFor(() => f.socket.sent.some(event => event.type === 'session.close'));
    f.socket.emit({ type: 'session.closed', reason: 'connection_lost' });
    const result = await (await ending).json() as Record<string, any>;
    expect(result.status).toBe('ended');
    expect(result.finalization).toBe('confirmed');
    expect(result.message).toBeNull();
  } finally {
    f.socket.emit({ type: 'session.closed', reason: 'close_requested' });
    await ending;
  }
}, 10_000);
test('cancelling during provider creation closes the eventual session', async () => {
  let release!: () => void;
  const f = await fixture({ pendingCreation: new Promise<void>(resolve => { release = resolve; }) });
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
test('the meeting kickoff waits for ready and repeated ready requests cannot replay it', async () => {
  const f = await fixture();
  const started = await (await f.session.fetch(request('start'))).json();
  const openings = () => f.socket.sent.filter(event => event.type === 'session.instructions.append');
  expect(openings()).toHaveLength(0);
  const ready = await Promise.all([f.session.fetch(request('ready')), f.session.fetch(request('ready'))]);
  expect(ready.map(response => response.status)).toEqual([200, 200]);
  expect(openings()).toHaveLength(1);
  expect(openings()[0]).toMatchObject({ event_id: 'opening', delegation_id: null });
  const instruction = openings()[0]!.content;
  expect(typeof instruction).toBe('string');
  const publicStates = [started, ...await Promise.all(ready.map(response => response.json()))];
  expect(JSON.stringify(publicStates)).not.toContain(JSON.stringify(instruction));
  await f.session.fetch(request('end'));
  await f.session.fetch(request('ready'));
  expect(openings()).toHaveLength(1);
});
test('an end arriving before start prevents any paid creation for that attempt', async () => {
  const f = await fixture();
  await f.session.fetch(request('end'));
  expect((await f.session.fetch(request('start'))).status).toBe(409);
  expect(f.creations()).toBe(0);
});
test('an actor delegation receives private role direction instead of starting outside work', async () => {
  const f = await fixture();
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.delegation.created', delegation: { id: 'unexpected-task', target: 'client' } });
  const direction = f.socket.sent.find(event => event.delegation_id === 'unexpected-task');
  expect(direction?.type).toBe('session.thinking.append');
  expect(typeof direction?.content).toBe('string');
  const state = await (await f.session.fetch(request('poll'))).json() as Record<string, unknown>;
  expect(state.status).toBe('live');
  expect(JSON.stringify(state)).not.toContain(JSON.stringify(direction?.content));
  expect(f.creations()).toBe(1);
  await f.session.fetch(request('end'));
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
  await f.session.fetch(request('ready'));
  f.socket.readyState = 3; // Both the existing control socket and reattachment are unavailable.
  const result = await (await f.session.fetch(request('end'))).json() as Record<string, unknown>;
  expect(result.finalization).toBe('unconfirmed');
  expect(result.message).toContain('did not confirm');
  expect(f.values.get('lease')).toMatchObject({ closed: false });
  expect(f.alarm()).toBeGreaterThan(Date.now());
  await waitFor(() => f.row()?.archive_state === 'final');
  expect(f.row()).toMatchObject({ session_status: 'ended', finalization: 'unconfirmed' });
});

test('a replacement session owner closes the persisted provider lease', async () => {
  const original = await fixture();
  await original.session.fetch(request('start'));
  const replacement = await fixture({ values: original.values });
  await replacement.session.alarm();
  expect(replacement.socket.sent.map(event => event.type)).toEqual(['session.close']);
  expect(replacement.values.get('lease')).toMatchObject({ closed: true });
  expect((await replacement.session.fetch(request('poll'))).status).toBe(410);
  await original.session.fetch(request('end'));
});

test('a cancelled attempt remains unusable after its owner restarts', async () => {
  const original = await fixture();
  await original.session.fetch(request('end'));
  const replacement = await fixture({ values: original.values });
  expect((await replacement.session.fetch(request('start'))).status).toBe(409);
  expect(replacement.creations()).toBe(0);
});

test('restart recovery clears an already-closed provider and a lease with no recovered id', async () => {
  const values = new Map<string, unknown>([['lease', { capability, providerId: 'gone', deadline: 0, closed: false }]]);
  const gone = await fixture({ values: values, overrides: { attachLive: async () => { throw new LiveSessionGone(); } } });
  await gone.session.alarm();
  expect(values.get('lease')).toMatchObject({ closed: true });
  await gone.session.alarm();
  expect(values.size).toBe(0);
  values.set('lease', { capability, deadline: 0, closed: false });
  const unknown = await fixture({ values: values });
  await unknown.session.alarm();
  expect(values.size).toBe(0);
});

test('a late same-speaker delta cannot change the passage cited by an objective', async () => {
  let releaseGrade!: () => void;
  let gradingStarted!: () => void;
  let gradingCalls = 0;
  const started = new Promise<void>(resolve => { gradingStarted = resolve; });
  const f = await fixture({ overrides: {
    evaluateTrainee: async input => {
      if (++gradingCalls === 1) {
        gradingStarted();
        await new Promise<void>(resolve => { releaseGrade = resolve; });
      }
      const passage = input.transcript[0]!;
      return { revision: input.revision, skills: emptySkills(), objectives: [{ id: 'capability', achieved: true, probability: .99, evidence: { entryId: passage.id, speaker: passage.speaker, text: passage.text } }], hint: null, hintId: null, concern: null, model: 'fixture', durationMs: 1, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, answers: {} };
    },
  } });
  try {
    await f.session.fetch(request('start'));
    await f.session.fetch(request('ready'));
    f.socket.emit({ type: 'session.input_transcript.delta', delta: 'We can help assess document ownership.', start_ms: 0, end_ms: 1000 });
    await started;
    f.socket.emit({ type: 'session.input_transcript.delta', delta: ' Actually, I cannot promise that.', start_ms: 1100, end_ms: 1500 });
    releaseGrade();
    await Promise.all(f.pending);
    const snapshot = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
    const evidence = snapshot.evaluation.objectives.find((item: { id: string }) => item.id === 'capability').evidence;
    expect(snapshot.transcript).toHaveLength(2);
    expect(evidence.text).toBe(snapshot.transcript.find((item: { id: string }) => item.id === evidence.entryId).text);
    expect(snapshot.transcript[1].text).toContain('cannot promise');
  } finally {
    releaseGrade?.();
    await f.session.fetch(request('end'));
  }
}, 10_000);

test('one transient judging failure retries unchanged dialogue and stops after success', async () => {
  let calls = 0;
  const f = await fixture({ overrides: {
    evaluateTrainee: async input => {
      if (++calls === 1) throw new Error('Transient failure');
      return { revision: input.revision, skills: emptySkills(), objectives: [], hint: null, hintId: null, concern: null, model: 'fixture', durationMs: 1, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, answers: {} };
    },
  } });
  try {
    await f.session.fetch(request('start'));
    await f.session.fetch(request('ready'));
    f.socket.emit({ type: 'session.input_transcript.delta', delta: 'Who owns the workflow?', start_ms: 0, end_ms: 1000 });
    setSystemTime(Date.now() + 2000);
    await waitFor(() => calls === 1);
    await Promise.all(f.pending);
    expect((await (await f.session.fetch(request('poll'))).json() as Record<string, any>).feedbackStatus).toBe('unavailable');
    setSystemTime(Date.now() + 4000);
    await waitFor(() => calls === 2);
    await Promise.all(f.pending);
    const snapshot = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
    expect(snapshot.feedbackStatus).toBe('current');
    expect(snapshot.evaluation.revision).toBe(snapshot.revision);
    setSystemTime(Date.now() + 4000);
    await new Promise(resolve => setTimeout(resolve, 800));
    expect(calls).toBe(2);
  } finally { await f.session.fetch(request('end')); }
}, 10_000);

test('two failed judgments stop retrying until new dialogue earns its own retry', async () => {
  let calls = 0;
  const f = await fixture({ overrides: {
    evaluateTrainee: async input => {
      if (++calls < 4) throw new Error('Transient failure');
      return { revision: input.revision, skills: emptySkills(), objectives: [], hint: null, hintId: null, concern: null, model: 'fixture', durationMs: 1, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, answers: {} };
    },
  } });
  try {
    await f.session.fetch(request('start'));
    await f.session.fetch(request('ready'));
    f.socket.emit({ type: 'session.input_transcript.delta', delta: 'What happens today?', start_ms: 0, end_ms: 1000 });
    setSystemTime(Date.now() + 2000);
    await waitFor(() => calls === 1);
    await Promise.all(f.pending);
    setSystemTime(Date.now() + 4000);
    await waitFor(() => calls === 2);
    await Promise.all(f.pending);
    setSystemTime(Date.now() + 4000);
    await new Promise(resolve => setTimeout(resolve, 800));
    expect(calls).toBe(2);
    f.socket.emit({ type: 'session.input_transcript.delta', delta: 'How much time does it cost?', start_ms: 4000, end_ms: 4800 });
    setSystemTime(Date.now() + 2000);
    await waitFor(() => calls === 3);
    await Promise.all(f.pending);
    setSystemTime(Date.now() + 4000);
    await waitFor(() => calls === 4);
    await Promise.all(f.pending);
    expect((await (await f.session.fetch(request('poll'))).json() as Record<string, any>).feedbackStatus).toBe('current');
  } finally { await f.session.fetch(request('end')); }
}, 10_000);

test('new settled dialogue marks earlier feedback delayed while reassessment is pending', async () => {
  let release!: () => void;
  let calls = 0;
  const f = await fixture({ overrides: {
    evaluateTrainee: async input => {
      if (++calls === 2) await new Promise<void>(resolve => { release = resolve; });
      return { revision: input.revision, skills: emptySkills(), objectives: [], hint: null, hintId: null, concern: null, model: 'fixture', durationMs: 1, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, answers: {} };
    },
  } });
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
  const f = await fixture({ overrides: {
    evaluateClient: async input => {
      assessed();
      await new Promise<void>(done => { resolve = done; });
      return { revision: input.revision, cueId: 'approval-boundary', cueProbability: .99, fidelity: 1, interests: [1], model: 'fixture', durationMs: 1, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, answers: {} };
    },
  } });
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
  await waitFor(() => f.row()?.archive_state === 'final');
  expect(JSON.parse(f.row()!.cues_json).map((cue: { id: string }) => cue.id)).toEqual(newerReply ? [] : ['approval-boundary']);
  if (!newerReply) {
    const privateCue = f.socket.sent.find(event => String(event.event_id).startsWith('cue-'))?.content;
    expect(JSON.stringify(f.row())).not.toContain(String(privateCue));
  }
});

test('live alarm checkpoints dialogue, then End saves the final public score and provenance', async () => {
  const f = await fixture();
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'Who owns the workflow?', start_ms: 100, end_ms: 1300 });
  f.socket.emit({ type: 'session.output_transcript.delta', delta: 'Operations owns it.', start_ms: 1400, end_ms: 2600 });
  setSystemTime(Date.now() + 30_000);
  await f.session.alarm();
  await Promise.all(f.pending);
  expect(f.row()).toMatchObject({
    id: attempt.id, scenario_id: 'sharepoint', client_id: 'morgan',
    archive_state: 'partial', session_status: 'live', finalization: 'pending', ended_at: null,
  });
  expect(JSON.parse(f.row()!.transcript_json).map((entry: { text: string }) => entry.text)).toEqual(['Who owns the workflow?', 'Operations owns it.']);

  const ended = await (await f.session.fetch(request('end'))).json() as Record<string, any>;
  expect(ended.status).toBe('ended');
  await waitFor(() => f.row()?.archive_state === 'final');
  const row = f.row()!;
  expect(row).toMatchObject({ archive_state: 'final', session_status: 'ended', finalization: 'confirmed', usage_seconds: 12 });
  expect(JSON.parse(row.transcript_json)).toEqual(ended.transcript);
  expect(JSON.parse(row.evaluation_json)).toEqual(ended.evaluation);
  expect(row.evaluation_json).not.toContain('answers');
  expect(row.evaluation_json).not.toContain('usage');
  expect(JSON.parse(row.provenance_json)).toMatchObject({ workerId: 'test-worker', workerTag: 'test-release', directorEnabled: false });
  const stored = JSON.stringify(row);
  expect(stored).not.toContain(capability);
  expect(stored).not.toContain('provider-private-id');
  expect(stored).not.toContain('private actor brief');
  expect(stored).not.toContain(String(f.socket.sent.find(event => event.event_id === 'opening')?.content));
});

test('a live but silent attempt has a final archive; a creation failure has none', async () => {
  const silent = await fixture();
  await silent.session.fetch(request('start'));
  await silent.session.fetch(request('ready'));
  await silent.session.fetch(request('end'));
  await waitFor(() => silent.row()?.archive_state === 'final');
  expect(JSON.parse(silent.row()!.transcript_json)).toEqual([]);
  expect(silent.row()!.evaluation_json).toBeNull();

  const failed = await fixture({ overrides: { createLive: async () => { throw new Error('Provider unavailable'); } } });
  expect((await failed.session.fetch(request('start'))).status).toBe(502);
  await Promise.allSettled(failed.pending);
  expect(failed.row()).toBeNull();
});

test('failed final D1 save is best effort and closure lease cleanup continues', async () => {
  const f = await fixture();
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'I need a plan.', start_ms: 100, end_ms: 900 });
  f.archive.failNext();
  await f.session.fetch(request('end'));
  await Promise.all(f.pending);
  expect(f.row()).toBeNull();
  expect(f.values.get('lease')).toMatchObject({ closed: true });
  setSystemTime(Date.now() + 300_001);
  await f.session.alarm();
  expect(f.values.size).toBe(0);
  expect(f.row()).toBeNull();
});

test('restart closes the provider and leaves the last successful checkpoint partial', async () => {
  const active = await fixture();
  await active.session.fetch(request('start'));
  await active.session.fetch(request('ready'));
  active.socket.emit({ type: 'session.input_transcript.delta', delta: 'A captured question.', start_ms: 100, end_ms: 900 });
  setSystemTime(Date.now() + 30_000);
  await active.session.alarm();
  await Promise.all(active.pending);
  expect(active.row()?.archive_state).toBe('partial');
  const replacement = await fixture({ values: active.values, archive: active.archive });
  await replacement.session.alarm();
  expect(replacement.row()).toMatchObject({ archive_state: 'partial', session_status: 'live', finalization: 'pending' });
  expect(JSON.parse(replacement.row()!.transcript_json)[0].text).toBe('A captured question.');
  expect((await replacement.session.fetch(request('poll'))).status).toBe(410);
  await active.session.fetch(request('end')); // Stop the original fixture's timer after simulating restart.
});

test('a failed partial save leaves closure scheduled and the next alarm can save current dialogue', async () => {
  const f = await fixture();
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'A first question.', start_ms: 100, end_ms: 900 });
  setSystemTime(Date.now() + 30_000);
  await f.session.fetch(request('poll'));
  f.archive.failNext();
  await f.session.alarm();
  await Promise.all(f.pending);
  expect(f.row()).toBeNull();
  expect(f.alarm()).toBeGreaterThan(Date.now());

  f.socket.emit({ type: 'session.output_transcript.delta', delta: 'Operations owns it.', start_ms: 1000, end_ms: 1900 });
  setSystemTime(Date.now() + 30_000);
  await f.session.fetch(request('poll'));
  await f.session.alarm();
  await Promise.all(f.pending);
  expect(f.row()).toMatchObject({ archive_state: 'partial', session_status: 'live' });
  expect(JSON.parse(f.row()!.transcript_json).map((entry: { text: string }) => entry.text)).toEqual(['A first question.', 'Operations owns it.']);
  await f.session.fetch(request('end'));
});

test('a stalled failing final save does not delay End or the provider closure alarm', async () => {
  const f = await fixture();
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  f.socket.readyState = 3;
  f.archive.failNext();
  const held = f.archive.holdNext();
  try {
    const ended = await (await f.session.fetch(request('end'))).json() as Record<string, unknown>;
    await held.started;
    expect(ended.finalization).toBe('unconfirmed');
    expect(f.values.get('lease')).toMatchObject({ closed: false });
    expect(f.alarm()).toBeGreaterThan(Date.now() + 14_000);
    expect(f.alarm()).toBeLessThan(Date.now() + 16_000);
  } finally { held.release(); }
  await Promise.all(f.pending);
  expect(f.row()).toBeNull();
});

test('missing version metadata is stored as null without losing the final archive', async () => {
  const f = await fixture({ metadata: false });
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  await f.session.fetch(request('end'));
  await Promise.all(f.pending);
  expect(f.row()?.archive_state).toBe('final');
  expect(JSON.parse(f.row()!.provenance_json)).toMatchObject({ workerId: null, workerTag: null });
});

test('a delayed live checkpoint cannot replace the completed archive', async () => {
  const f = await fixture();
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'The original question.', start_ms: 100, end_ms: 900 });
  setSystemTime(Date.now() + 30_000);
  const held = f.archive.holdNext();
  await f.session.alarm();
  await held.started;
  try {
    f.socket.emit({ type: 'session.input_transcript.delta', delta: ' The final detail.', start_ms: 1000, end_ms: 1500 });
    await f.session.fetch(request('end'));
    await waitFor(() => f.row()?.archive_state === 'final');
  } finally { held.release(); }
  await Promise.all(f.pending);
  expect(f.row()).toMatchObject({ archive_state: 'final', session_status: 'ended' });
  expect(JSON.parse(f.row()!.transcript_json).map((entry: { text: string }) => entry.text)).toEqual(['The original question. The final detail.']);
});
