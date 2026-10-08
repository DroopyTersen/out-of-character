import { expect, test } from 'bun:test';
import { unpaidProviders } from '../../providers/testFoundry.server';
import { inlineBackground, memoryArchive, memoryRecord, memoryStore, type MemoryRecord } from '../adapters/memory.server';
import { threadKey } from '../conversation/ranking';
import { INTERVIEW_RUBRIC_VERSION } from '../conversation/rubric.prompt';
import { testFraming, testTechniques } from '../conversation/testSpec';
import { FencedError } from '../seams.server';
import type { PublicSnapshot } from './checkpoint';
import { SessionActor, type SessionOptions, type SessionServices, type SessionSpec } from './session.server';

// Ownership tests: the session over the in-memory seams, with fake paid calls and a fake voice provider. Only the
// network is substituted; timing, the lease, checkpoints, fencing and the archive are real.

const criteria = ['zero', 'one', 'two', 'three', 'four'] as const;
const topics = [{ id: 'project', label: 'The project', objectives: [{ id: 'scope', label: 'Scope', criterion: 'Names what was built.' }] }];
const spec: SessionSpec = {
  id: 'fixture-interview', version: 'fixture-v1',
  interviewer: {
    name: 'Riley', role: 'interviewing someone about a recent project', persona: 'Curious and direct.', opening: 'Hi, I’m Riley. What did you build?',
    orientation: ['ORIENTATION'], boundaries: ['BOUNDARY'], techniques: testTechniques,
    voices: [{ id: 'riley-cedar', voice: 'cedar', label: 'Cedar', presentation: 'Male', image: '/riley.png' }],
  },
  framing: testFraming,
  readings: [{ id: 'specificity', label: 'Specificity', description: 'Concrete detail.', rubric: { task: 'How concrete?', criteria } }],
  topics,
};
const capability = `Bearer ${'a'.repeat(64)}`;
const attempt = { id: 'c49f7954-7aab-47f9-a269-752932556c37', scenarioId: spec.id, clientId: 'riley-cedar', sdp: 'v=0\r\no=fixture-offer\r\n' };
const start = JSON.stringify(attempt);
const quietPoll = JSON.stringify({ active: false, audio: false, outputQuietMs: 60_000 });
const EPOCH = 1_800_000_000_000;

class ProviderSocket extends EventTarget {
  readyState = 1;
  sent: Record<string, unknown>[] = [];
  send(text: string) {
    const event = JSON.parse(text);
    this.sent.push(event);
    if (event.type === 'session.close') queueMicrotask(() => this.emit({ type: 'session.closed', reason: 'close_requested', usage: { seconds: 12 } }));
  }
  emit(event: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) })); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.dispatchEvent(new Event('close')); }
}

/** The voice provider: one socket per provider session, ids `provider-1`, `provider-2`, … across every owner. */
function fakeVoice() {
  const sockets = new Map<string, ProviderSocket>();
  const created: { voice: string; instructions: string }[] = [];
  const closed: string[] = [];
  return {
    sockets, created, closed,
    voice: {
      create: async (input: { sdp: string; voice: string; instructions: string }) => {
        const id = `provider-${created.length + 1}`;
        created.push({ voice: input.voice, instructions: input.instructions });
        sockets.set(id, new ProviderSocket());
        return { id, sdp: 'v=0\r\nanswer' };
      },
      attach: async (id: string) => sockets.get(id)!,
      close: async (id: string) => { closed.push(id); },
    },
  };
}

const services: Partial<SessionServices> = {
  generateMap: async input => ({ map: input.previous, update: { vantage: null, preferences: null, entities: [], edges: [], threads: [], revise: [], close: [], drop: [] }, changes: { added: [], changed: [], dropped: [], kept: [] }, research: null, model: 'fixture', usage: { inputTokens: 1, outputTokens: 1 } }),
  evaluateTurn: async input => ({ reading: { passageId: input.transcript.at(-1)!.id, atMs: input.atMs, focus: null, keys: {}, natural: {}, states: {}, novel: 0 }, model: 'fixture', durationMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, answers: {} }),
  lookupInterviewBackground: async () => ({ status: 'unresolved', reason: 'fixture', queries: [] }),
};

function fixture({ record = memoryRecord(), voice = fakeVoice(), archive = memoryArchive(), lazyWake = false }: { record?: MemoryRecord; voice?: ReturnType<typeof fakeVoice>; archive?: ReturnType<typeof memoryArchive>; lazyWake?: boolean } = {}) {
  let clock = EPOCH;
  const graded: string[][] = [];
  const events: unknown[] = [];
  const store = memoryStore(record);
  const background = inlineBackground();
  const providers = unpaidProviders(voice.voice);
  const options: SessionOptions = {
    spec, providers, store, background, archive, lazyWake,
    now: () => clock, log: event => events.push(event),
    services: {
      ...services,
      evaluate: async input => {
        graded.push(input.transcript.map(entry => entry.id));
        const passage = input.transcript.find(entry => entry.speaker === 'trainee')!;
        return {
          revision: input.revision, model: 'fixture', durationMs: 1, readings: {},
          objectives: [{ id: 'scope', level: 'explored', achieved: true, probability: .9, levels: null, evidence: { entryId: passage.id, speaker: 'trainee', text: passage.text } }],
        };
      },
    },
  };
  const send = (actor: SessionActor, action: string, body?: string, cap = capability) => actor.handle({ action, capability: cap, ...(body != null ? { body } : {}) });
  return {
    record, voice, archive, store, background, graded, events, options, send,
    restore: () => SessionActor.restore(options),
    at: (ms: number) => { clock = EPOCH + ms; },
    now: () => clock,
  };
}

const say = (socket: ProviderSocket, type: 'input' | 'output', id: string, delta: string, startMs: number) =>
  socket.emit({ type: `session.${type}_transcript.delta`, event_id: id, delta, start_ms: startMs, end_ms: startMs + 900 });
const body = (reply: { body: unknown }) => reply.body as PublicSnapshot;

/** Starts an attempt, connects it and has both sides speak once. */
async function conversation(f: ReturnType<typeof fixture>) {
  const actor = await f.restore();
  const started = await f.send(actor, 'start', start);
  expect(started.status).toBe(200);
  f.at(1000);
  await f.send(actor, 'ready');
  const socket = f.voice.sockets.get('provider-1')!;
  say(socket, 'output', 'e1', 'Hi, I’m Riley. What did you build?', 0);
  f.at(3000);
  say(socket, 'input', 'e2', 'A claims portal for the adjusters.', 1500);
  return { actor, socket, started };
}

test('a start, a conversation and an end produce the protocol’s snapshots, a closed lease and the final archive row', async () => {
  const f = fixture();
  const { actor, socket, started } = await conversation(f);
  const first = started.body as { sdp: string; snapshot: PublicSnapshot };
  expect(first.sdp).toBe('v=0\r\nanswer');
  expect(first.snapshot).toMatchObject({ id: attempt.id, scenarioId: spec.id, clientId: 'riley-cedar', status: 'connecting', startedAt: EPOCH, limitSeconds: 3600, revision: 0, transcript: [], evaluation: null, coaching: null, feedbackStatus: 'waiting', finalization: 'pending', usageSeconds: null, interview: { evaluation: null, summary: null, background: [] } });
  expect(Object.keys(first.snapshot)).toEqual(['id', 'scenarioId', 'clientId', 'status', 'startedAt', 'limitSeconds', 'warning', 'revision', 'transcript', 'evaluation', 'coaching', 'feedbackStatus', 'message', 'finalization', 'usageSeconds', 'interview']);
  expect(f.voice.created[0]!.voice).toBe('cedar');
  expect(f.voice.created[0]!.instructions).toStartWith('You are Riley, interviewing someone about a recent project.');
  expect(socket.sent[0]).toMatchObject({ type: 'session.instructions.append', event_id: 'opening', content: 'Speak now in English: “Hi, I’m Riley. What did you build?” Then listen. Do not wait for the participant to speak first.' });
  expect(f.record.lease).toEqual({ capability, providerId: 'provider-1', deadline: EPOCH + 3_600_000, closed: false });
  expect(f.record.wakeAt).toBe(EPOCH + 30_000);

  const live = body(await f.send(actor, 'poll', quietPoll));
  expect(live.status).toBe('live');
  expect(live.revision).toBe(2);
  expect(live.transcript.map(entry => [entry.speaker, entry.text])).toEqual([['client', 'Hi, I’m Riley. What did you build?'], ['trainee', 'A claims portal for the adjusters.']]);

  f.at(10_000);
  const ending = await f.send(actor, 'end');
  expect(body(ending).status).toBe('ended');
  expect(body(ending)).toMatchObject({ finalization: 'confirmed', usageSeconds: 12, feedbackStatus: 'current', interview: { summary: { status: 'pending', text: null } } });
  expect(body(ending).interview.evaluation!.objectives[0]).toMatchObject({ id: 'scope', level: 'explored', evidence: { speaker: 'trainee' } });
  expect(f.record.lease).toEqual({ capability, deadline: EPOCH + 3_600_000, closed: true });
  expect(f.record.checkpoint).toBeUndefined();
  expect(f.record.wakeAt).toBe(EPOCH + 10_000 + 300_000);

  // Terminal reads are flagged for the host's report state and do not refresh anything.
  const after = await f.send(actor, 'poll', quietPoll);
  expect(after.terminal).toBe(true);
  expect(body(after).status).toBe('ended');
  expect(await f.send(actor, 'report')).toEqual({ status: 200, body: null, report: true });

  await f.background.settle();
  const row = f.archive.rows.get(attempt.id)!;
  expect(row).toMatchObject({ id: attempt.id, specId: spec.id, specVersion: 'fixture-v1', voiceId: 'riley-cedar', state: 'final', capturedAt: EPOCH + 10_000 });
  expect(row.transcript.map(passage => passage.speaker)).toEqual(['interviewer', 'participant']);
  expect(row.snapshot.status).toBe('ended');
  expect(row.provenance).toMatchObject({ voice: 'cedar', rubricVersion: INTERVIEW_RUBRIC_VERSION, producer: expect.any(Object) });
  expect(row.provenance.actorDigest).toMatch(/^[0-9a-f]{12}$/);
  expect(row.provenance.openingDigest).toMatch(/^[0-9a-f]{12}$/);
  expect(row.provenance.connection.segments[0]).not.toHaveProperty('providerId');
  expect(row.producerLog.some(record => record.source === 'grade' && record.final)).toBe(true);

  // The narrative settles later; its status and provenance rewrite the final row.
  actor.settleNarrative({ status: 'ready', text: 'A summary.' }, { model: 'fixture', version: 'v1', attempts: [] });
  await f.background.settle();
  expect(f.archive.rows.get(attempt.id)!.snapshot.interview.summary).toEqual({ status: 'ready', text: 'A summary.' });
  expect(f.archive.rows.get(attempt.id)!.provenance.narrative).toBeDefined();

  // The wake after closure clears the attempt.
  await actor.wake();
  expect(f.record.lease).toBeUndefined();
  expect(f.record.clears).toBe(1);
});

test('the capability is checked before anything else, and an end before start leaves a closed lease', async () => {
  const f = fixture();
  const actor = await f.restore();
  expect(await f.send(actor, 'poll', undefined, 'Bearer nope')).toEqual({ status: 401, body: { error: 'Session capability is required.' } });
  expect(await f.send(actor, 'poll')).toEqual({ status: 404, body: { error: 'This practice session was not found.' } });
  expect(await f.send(actor, 'start', JSON.stringify({ ...attempt, scenarioId: 'other' }))).toEqual({ status: 400, body: { error: 'Invalid simulator request.' } });
  expect(await f.send(actor, 'end')).toEqual({ status: 200, body: { ended: true } });
  expect(f.record.lease).toEqual({ capability, deadline: EPOCH, closed: true });
  expect(f.record.wakeAt).toBe(EPOCH + 60_000);
  expect(await f.send(actor, 'start', start, `Bearer ${'b'.repeat(64)}`)).toEqual({ status: 403, body: { error: 'Session ownership did not match.' } });
  expect(await f.send(actor, 'start', start)).toEqual({ status: 409, body: { error: 'This attempt has already been used. Start a new attempt.' } });
  expect(f.voice.created).toHaveLength(0);
});

test('a live wake checkpoints the attempt and reschedules itself', async () => {
  const f = fixture();
  const { actor } = await conversation(f);
  f.at(30_000);
  await f.send(actor, 'poll', quietPoll);
  await actor.wake();
  expect(f.record.wakeAt).toBe(EPOCH + 60_000);
  expect(f.record.checkpoint).toMatchObject({ savedAt: EPOCH + 30_000, reachedLive: true, epoch: 1, resumes: 0, snapshot: { status: 'live', revision: 2, interview: { summary: null } } });
  expect(f.record.checkpoint!.producer).toBeDefined();
  await f.background.settle();
  expect(f.archive.rows.get(attempt.id)!.state).toBe('partial');
  await f.send(actor, 'end');
  await f.background.settle();
});

test('a stale owner is fenced on its next save, and the new owner holds the attempt for the browser to resume', async () => {
  const record = memoryRecord();
  const voice = fakeVoice();
  const archive = memoryArchive();
  const a = fixture({ record, voice, archive });
  const { actor: first, socket } = await conversation(a);
  a.at(30_000);
  await first.wake();

  // A second owner opens the same record: it restores the checkpoint and holds the attempt.
  const b = fixture({ record, voice, archive });
  b.at(31_000);
  const second = await b.restore();
  expect(second.snapshot()).toMatchObject({ status: 'paused', pause: { reason: 'restart', pausedAt: EPOCH + 31_000, resumes: 0, maxResumes: 5 } });
  expect(record.checkpoint!.snapshot.status).toBe('paused');
  expect(record.wakeAt).toBe(EPOCH + 32_000);

  // The first owner's next write is refused: it stops, drops its socket and answers 409 from then on.
  const writes = archive.writes.length;
  a.at(60_000);
  await first.wake();
  expect(socket.readyState).toBe(3);
  expect(a.events).toContainEqual({ type: 'session', event: 'fenced', id: attempt.id });
  expect(await a.send(first, 'poll', quietPoll)).toEqual({ status: 409, body: { error: 'Another owner has taken over this attempt.' } });
  await expect(a.store.save({})).rejects.toBeInstanceOf(FencedError);
  await a.background.settle();
  expect(archive.writes.length).toBe(writes);

  // The second owner closes the orphaned provider session, then resumes on a new one seeded with the conversation.
  b.at(32_000);
  await second.wake();
  expect(voice.closed).toEqual(['provider-1']);
  const resumed = await b.send(second, 'resume', JSON.stringify({ sdp: attempt.sdp }));
  expect(resumed.status).toBe(200);
  expect(voice.created[1]!.instructions).toContain('CONVERSATION SO FAR');
  expect(voice.created[1]!.instructions).toContain('The participant: A claims portal for the adjusters.');
  b.at(33_000);
  expect(body(await b.send(second, 'ready')).status).toBe('live');
  expect(voice.sockets.get('provider-2')!.sent[0]).toMatchObject({ event_id: 'resume-2' });
  expect(record.lease).toMatchObject({ providerId: 'provider-2', deadline: EPOCH + 3_600_000 + 2000 });
  expect(body(await b.send(second, 'end')).status).toBe('ended');
  await b.background.settle();
  expect(archive.rows.get(attempt.id)!.provenance.connection.pauses).toEqual([{ reason: 'restart', pausedAt: EPOCH + 31_000, resumedAt: EPOCH + 33_000, durationMs: 2000 }]);
});

test('without timers, a command first runs the wake that has come due', async () => {
  const f = fixture({ lazyWake: true });
  const actor = await f.restore();
  await f.send(actor, 'start', start);
  // The page never reported ready and went quiet for longer than the contact grace.
  f.at(40_000);
  const reply = body(await f.send(actor, 'poll', quietPoll));
  expect(reply.message).toBe('Practice ended after losing contact with this page.');
  await f.background.settle();
  expect(actor.snapshot()!.status).toBe('ended');
  expect(f.archive.rows.size).toBe(0);
});

test('a provider drop pauses a live conversation, and a resume continues it with a seeded session', async () => {
  const f = fixture();
  const { actor, socket } = await conversation(f);
  f.at(5000);
  socket.emit({ type: 'session.closed', reason: 'connection_lost' });
  await f.background.settle();
  const paused = body(await f.send(actor, 'poll', quietPoll));
  expect(paused).toMatchObject({ status: 'paused', pause: { reason: 'provider', pausedAt: EPOCH + 5000, resumeBy: EPOCH + 5000 + 15 * 60_000 } });
  expect(f.record.checkpoint!.snapshot.status).toBe('paused');
  const resumed = await f.send(actor, 'resume', JSON.stringify({ sdp: attempt.sdp }));
  expect(resumed.status).toBe(200);
  expect(body(await f.send(actor, 'ready')).status).toBe('live');
  await f.send(actor, 'end');
  await f.background.settle();
});

// Resource lifecycle: a provider session is paid for from creation, so none may be opened for an attempt that is
// ending, and every one that is opened must be recorded for closure or closed at once.

const deferred = <T = void>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(fn => { resolve = fn; }); return { promise, resolve }; };
const wakesOf = (f: ReturnType<typeof fixture>) => {
  const wakes: (number | null)[] = [];
  const original = f.options.store.wake;
  f.options.store.wake = async at => { wakes.push(at); await original(at); };
  return wakes;
};

test('an end that arrives while the lease is being saved waits for it and opens no provider session', async () => {
  const f = fixture();
  const saving = deferred();
  const held = deferred();
  const original = f.options.store.save;
  let saves = 0;
  f.options.store.save = async patch => { await original(patch); if (saves++ === 0) { saving.resolve(); await held.promise; } };
  const actor = await f.restore();
  const opening = f.send(actor, 'start', start);
  await saving.promise;
  const ending = f.send(actor, 'end');
  held.resolve();
  const [started, ended] = await Promise.all([opening, ending]);
  expect(started).toEqual({ status: 409, body: { error: 'The attempt was cancelled.' } });
  expect(body(ended).status).toBe('ended');
  expect(f.voice.created).toHaveLength(0);
  expect(f.record.lease).toEqual({ capability, deadline: EPOCH + 3_600_000, closed: true });
  expect(f.record.wakeAt).toBe(EPOCH + 300_000);
  await f.background.settle();
  expect(f.archive.rows.size).toBe(0);
});

test('a start and an end in the same moment leave nothing open', async () => {
  const f = fixture();
  const actor = await f.restore();
  const [started, ended] = await Promise.all([f.send(actor, 'start', start), f.send(actor, 'end')]);
  expect(started.status).toBe(409);
  expect(body(ended).status).toBe('ended');
  expect(f.voice.created).toHaveLength(0);
  expect(f.record.lease!.closed).toBe(true);
  await actor.wake();
  expect(f.record.lease).toBeUndefined();
});

test('an end that arrives after creation began is answered once the session is recorded, and the session is closed', async () => {
  const f = fixture();
  const creating = deferred();
  const held = deferred();
  const original = f.options.providers.voice.create;
  f.options.providers.voice.create = async input => { creating.resolve(); await held.promise; return original(input); };
  const actor = await f.restore();
  const opening = f.send(actor, 'start', start);
  await creating.promise;
  const ending = f.send(actor, 'end');
  held.resolve();
  const [started, ended] = await Promise.all([opening, ending]);
  expect(started.status).toBe(409);
  expect(body(ended)).toMatchObject({ status: 'ended', finalization: 'confirmed' });
  expect(f.voice.created).toHaveLength(1);
  expect(f.voice.sockets.get('provider-1')!.sent).toContainEqual({ type: 'session.close' });
  expect(f.record.lease).toEqual({ capability, deadline: EPOCH + 3_600_000, closed: true });
});

test('a provider session created after another owner took over is closed by the owner that created it', async () => {
  const f = fixture();
  const creating = deferred();
  const held = deferred();
  const original = f.options.providers.voice.create;
  f.options.providers.voice.create = async input => { creating.resolve(); await held.promise; return original(input); };
  const actor = await f.restore();
  const opening = f.send(actor, 'start', start);
  await creating.promise;
  // The successor restores a lease that names no provider session, so it can never close this one from the store.
  const other = fixture({ record: f.record, voice: f.voice, archive: f.archive });
  const successor = await other.restore();
  expect(f.record.lease?.providerId).toBeUndefined();
  held.resolve();
  expect(await opening).toEqual({ status: 409, body: { error: 'Another owner has taken over this attempt.' } });
  expect(f.voice.created).toHaveLength(1);
  expect(f.voice.closed).toEqual(['provider-1']);
  expect(f.record.lease?.providerId).toBeUndefined();
  await successor.wake();
  expect(f.record.lease).toBeUndefined();
});

test('a closure the provider refuses is retried on a scheduled wake, then given up once the attempt is long over', async () => {
  const f = fixture();
  f.record.lease = { capability, providerId: 'orphan-1', unconfirmed: ['orphan-0'], deadline: EPOCH + 3_600_000, closed: false };
  const wakes = wakesOf(f);
  let refusals = 0;
  f.options.providers.voice.close = async id => { if (id === 'orphan-1') { refusals++; throw new Error('provider outage'); } f.voice.closed.push(id); };
  const actor = await f.restore();
  await expect(actor.wake()).rejects.toThrow('Closure not confirmed.');
  expect(f.voice.closed).toEqual(['orphan-0']);
  expect(f.record.lease).toEqual({ capability, providerId: 'orphan-1', deadline: EPOCH + 3_600_000, closed: false });
  expect(wakes).toEqual([EPOCH + 15_000]);
  f.at(15_000);
  await expect(actor.wake()).rejects.toThrow('Closure not confirmed.');
  expect(wakes).toEqual([EPOCH + 15_000, EPOCH + 30_000]);
  expect(refusals).toBe(2);
  // An hour past the lease's deadline the provider has long ended the session itself.
  f.at(3_600_000 + 60 * 60_000);
  await actor.wake();
  expect(f.record.lease).toMatchObject({ closed: true });
  expect(f.record.lease!.providerId).toBeUndefined();
  expect(f.events).toContainEqual({ type: 'session', event: 'closure.abandoned', id: '' });
  await actor.wake();
  expect(f.record.lease).toBeUndefined();
});

test('a start whose attachment fails ends the attempt, and every later wake schedules the next closure retry', async () => {
  const f = fixture();
  const wakes = wakesOf(f);
  f.options.providers.voice.attach = async () => { throw new Error('provider outage'); };
  f.options.providers.voice.close = async () => { throw new Error('provider outage'); };
  const actor = await f.restore();
  const started = await f.send(actor, 'start', start);
  expect(started.status).toBe(502);
  expect(actor.snapshot()).toMatchObject({ status: 'interrupted', finalization: 'unconfirmed' });
  expect(f.record.lease).toMatchObject({ providerId: 'provider-1', closed: false });
  expect(f.record.wakeAt).toBe(EPOCH + 15_000);
  f.at(15_000);
  await expect(actor.wake()).rejects.toThrow('Closure not confirmed.');
  expect(f.record.wakeAt).toBe(EPOCH + 30_000);
  f.options.providers.voice.close = async id => { f.voice.closed.push(id); };
  f.at(30_000);
  await actor.wake();
  expect(f.voice.closed).toEqual(['provider-1']);
  expect(f.record.lease).toMatchObject({ closed: true });
  expect(wakes.at(-1)).toBe(EPOCH + 30_000 + 300_000);
});
