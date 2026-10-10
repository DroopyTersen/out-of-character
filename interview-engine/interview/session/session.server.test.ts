import { resolveInterview } from '../definition.server';
import { expect, test } from 'bun:test';
import { unpaidProviders } from '../../providers/testFoundry.server';
import type { Judge } from '../../providers/judge.server';
import { createJevJudge } from '../../providers/jevJudge.server';
import { createDecisionJudge, type Fetch } from '../../providers/decisionJudge.server';
import { evaluateSilence } from './silence.server';
import { inlineBackground, memoryArchive, memoryRecord, memoryStore, type MemoryRecord } from '../adapters/memory.server';
import { INTERVIEW_RUBRIC_VERSION } from '../conversation/rubric.prompt';
import { testFraming, testTechniques } from '../conversation/testSpec';
import { FencedError, type InterviewArchiveRow } from '../seams.server';
import type { InterviewSnapshot as PublicSnapshot } from '../../shared/snapshot';
import { SessionActor, type SessionOptions, type SessionServices } from './session.server';
import { resumeInstruction, typedAnswerCue } from './voice.prompt';

// Ownership tests: the session over the in-memory seams, with fake paid calls and a fake voice provider. Only the
// network is substituted; timing, the lease, checkpoints, fencing and the archive are real.

const criteria = ['zero', 'one', 'two', 'three', 'four'] as const;
const topics = [{ id: 'project', label: 'The project', objectives: [{ id: 'scope', label: 'Scope', criterion: 'Names what was built.' }] }];
const spec = resolveInterview({
  id: 'fixture-interview', version: 'fixture-v1', title: 'Recent project', goals: 'Learn what was built.',
  topics: [{ id: 'project', label: 'Project', learn: 'Understand the project.', topics: [{ id: 'scope', label: 'Scope', learn: 'Names what was built.' }] }],
  report: { audience: 'The delivery team', format: 'A Markdown account of what was learned.' },
}, {
  interviewer: { name: 'Riley', persona: 'Curious and direct.', voices: [{ id: 'riley-cedar', voice: 'cedar', label: 'Cedar', presentation: 'Male', image: '/riley.png' }] },
  readings: [{ id: 'specificity', label: 'Specificity', description: 'Concrete detail.', rubric: { task: 'How concrete?', criteria: [...criteria] } }],
});
const capability = `Bearer ${'a'.repeat(64)}`;
const attempt = { id: 'c49f7954-7aab-47f9-a269-752932556c37', planId: spec.id, voiceId: 'riley-cedar', sdp: 'v=0\r\no=fixture-offer\r\n' };
const start = JSON.stringify(attempt);
const quietPoll = JSON.stringify({ active: false, audio: false });
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
    plan: structuredClone(spec.plan), config: structuredClone(spec.config), providers, store, background, archive, lazyWake,
    now: () => clock, log: event => events.push(event),
    services: {
      ...services,
      evaluate: async input => {
        graded.push(input.transcript.map(entry => entry.id));
        const passage = input.transcript.find(entry => entry.speaker === 'participant')!;
        return {
          revision: input.revision, model: 'fixture', durationMs: 1, readings: {},
          objectives: [{ id: 'scope', level: 'explored', achieved: true, probability: .9, levels: null, evidence: { entryId: passage.id, speaker: 'participant', text: passage.text } }],
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

test('the initial voice brief receives the accepted purpose and context, without report instructions', async () => {
  const f = fixture();
  f.options.plan.title = 'Delivery retrospective';
  f.options.plan.goals = 'Learn what helped delivery and what to improve.';
  f.options.plan.guidance = 'Begin with what was built and who it was for.';
  f.options.plan.report.format = 'REPORT_LAYOUT_ONLY';
  f.options.context = { background: 'Project Atlas was completed for Harbor Labs.', participant: { name: 'Jordan' } };
  const actor = await f.restore();
  f.options.plan.goals = 'REPLACEMENT_GOALS';
  f.options.context.background = 'REPLACEMENT_CONTEXT';
  await f.send(actor, 'start', start);
  await f.send(actor, 'ready');
  const brief = f.voice.created[0]!.instructions;
  for (const accepted of ['Riley', 'Delivery retrospective', 'Learn what helped delivery and what to improve.', 'Begin with what was built and who it was for.', 'Project Atlas was completed for Harbor Labs.', 'Jordan']) expect(brief).toContain(accepted);
  for (const excluded of ['REPORT_LAYOUT_ONLY', 'REPLACEMENT_GOALS', 'REPLACEMENT_CONTEXT']) expect(brief).not.toContain(excluded);
  const opening = f.voice.sockets.get('provider-1')!.sent.find(event => event.event_id === 'opening')!;
  expect(opening.type).toBe('session.instructions.append');
  expect(opening.content).toContain('Riley');
  expect(opening.content).not.toContain('Project Atlas'); // Full context belongs in the initial brief, not the bounded append.
  await f.send(actor, 'end');
});

test('a start, a conversation and an end produce the protocol’s snapshots, a closed lease and the final archive row', async () => {
  const f = fixture();
  const { actor, socket, started } = await conversation(f);
  const first = started.body as { sdp: string; snapshot: PublicSnapshot };
  expect(first.sdp).toBe('v=0\r\nanswer');
  expect(first.snapshot).toMatchObject({ id: attempt.id, planId: spec.id, voiceId: 'riley-cedar', status: 'connecting', startedAt: EPOCH, limitSeconds: 3600, revision: 0, transcript: [], evaluation: null, feedbackStatus: 'waiting', finalization: 'pending', usageSeconds: null, background: [] });
  for (const legacy of ['scenarioId', 'clientId', 'coaching', 'interview']) expect(first.snapshot).not.toHaveProperty(legacy);
  expect(f.voice.created[0]!.voice).toBe('cedar');
  expect(f.voice.created[0]!.instructions).toContain('Recent project');
  expect(f.voice.created[0]!.instructions).toContain('Learn what was built.');
  expect(socket.sent[0]).toMatchObject({ type: 'session.instructions.append', event_id: 'opening', content: expect.stringContaining('Riley') });
  expect(f.record.lease).toEqual({ capability, providerId: 'provider-1', deadline: EPOCH + 3_600_000, closed: false });
  expect(f.record.wakeAt).toBe(EPOCH + 30_000);

  const live = body(await f.send(actor, 'poll', quietPoll));
  expect(live.status).toBe('live');
  expect(live.revision).toBe(2);
  expect(live.transcript.map(entry => [entry.speaker, entry.text])).toEqual([['interviewer', 'Hi, I’m Riley. What did you build?'], ['participant', 'A claims portal for the adjusters.']]);

  f.at(10_000);
  const ending = await f.send(actor, 'end');
  expect(body(ending).status).toBe('ended');
  expect(body(ending)).toMatchObject({ finalization: 'confirmed', usageSeconds: 12, feedbackStatus: 'current' });
  expect(body(ending).evaluation!.objectives[0]).toMatchObject({ id: 'scope', level: 'explored', evidence: { speaker: 'participant' } });
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
  expect(f.archive.rows.get(attempt.id)!.narrative).toEqual({ status: 'ready', text: 'A summary.' });
  expect(f.archive.rows.get(attempt.id)!.provenance.narrative).toBeDefined();

  // The wake after closure clears the attempt.
  await actor.wake();
  expect(f.record.lease).toBeUndefined();
  expect(f.record.clears).toBe(1);
});

/** An archive that refuses final rows while `refusing` is set, over the in-memory upsert rules. */
function flakyArchive() {
  const archive = memoryArchive();
  const control = { refusing: true };
  const flaky = { ...archive, write: async (row: InterviewArchiveRow) => { if (control.refusing && row.state === 'final') throw new Error('archive outage'); await archive.write(row); } };
  return { archive: flaky, control };
}
const finalFailures = (f: ReturnType<typeof fixture>) => f.events.filter(event => (event as { event?: string; category?: string }).event === 'archive.failed' && (event as { category?: string }).category === 'final');
const dialogue = [['interviewer', 'Hi, I’m Riley. What did you build?'], ['participant', 'A claims portal for the adjusters.']];

test('a final row the archive refuses keeps the terminal checkpoint, and a later owner archives it again without paid work', async () => {
  const { archive, control } = flakyArchive();
  const f = fixture({ archive });
  const { actor, socket } = await conversation(f);
  f.at(10_000);
  expect(body(await f.send(actor, 'end'))).toMatchObject({ status: 'ended', finalization: 'confirmed' });
  expect(finalFailures(f)).toHaveLength(1);
  expect(f.record.lease).toMatchObject({ closed: true });
  expect(f.record.checkpoint).toMatchObject({ savedAt: EPOCH + 10_000, snapshot: { status: 'ended', interview: { summary: { status: 'pending' } } } });
  expect(f.record.wakeAt).toBe(EPOCH + 25_000);
  const paid = { created: f.voice.created.length, closed: [...f.voice.closed], closes: socket.sent.filter(event => event.type === 'session.close').length, graded: f.graded.length };

  // Each wake retries the frozen row until the archive acknowledges it.
  f.at(25_000);
  await actor.wake();
  expect(finalFailures(f)).toHaveLength(2);
  expect(f.record.wakeAt).toBe(EPOCH + 40_000);

  // The owner is lost. The next one restores the terminal checkpoint beside the closed lease and archives it.
  control.refusing = false;
  const next = fixture({ record: f.record, voice: f.voice, archive });
  next.at(40_000);
  const restored = await next.restore();
  const read = await next.send(restored, 'poll', quietPoll);
  expect(read.terminal).toBe(true);
  expect(body(read)).toMatchObject({ status: 'ended', finalization: 'confirmed', usageSeconds: 12 });
  expect(body(read).transcript.map(entry => [entry.speaker, entry.text])).toEqual(dialogue);
  await restored.wake();
  const row = archive.rows.get(attempt.id)!;
  expect(row).toMatchObject({ state: 'final', capturedAt: EPOCH + 10_000, snapshot: { status: 'ended', usageSeconds: 12 }, narrative: { status: 'pending' } });
  expect(row.transcript.map(entry => [entry.speaker, entry.text])).toEqual(dialogue);
  expect(row.producerLog.some(record => record.source === 'grade' && record.final)).toBe(true);
  expect(f.record.checkpoint).toBeUndefined();
  expect(f.record.wakeAt).toBe(EPOCH + 40_000 + 300_000);
  expect({ created: f.voice.created.length, closed: f.voice.closed, closes: socket.sent.filter(event => event.type === 'session.close').length, graded: f.graded.length }).toEqual(paid);
  expect(next.graded).toEqual([]);

  // The narrative rewrites the acknowledged row, and the hold then forgets the attempt.
  restored.settleNarrative({ status: 'ready', text: 'A summary.' }, { model: 'fixture', version: 'v1', attempts: [] });
  await next.background.settle();
  expect(archive.rows.get(attempt.id)!.narrative).toEqual({ status: 'ready', text: 'A summary.' });
  next.at(340_000);
  await restored.wake();
  expect(f.record.lease).toBeUndefined();
  expect(f.record.clears).toBe(1);
});

test('without timers, the next command after the retry time archives the final row, with a narrative that settled meanwhile', async () => {
  const { archive, control } = flakyArchive();
  const f = fixture({ archive, lazyWake: true });
  const { actor } = await conversation(f);
  f.at(10_000);
  await f.send(actor, 'end');
  actor.settleNarrative({ status: 'ready', text: 'A summary.' }, { model: 'fixture', version: 'v1', attempts: [] });
  await f.background.settle();
  expect(finalFailures(f)).toHaveLength(2);
  expect(archive.rows.has(attempt.id)).toBe(false);
  control.refusing = false;
  f.at(20_000);
  await f.send(actor, 'poll', quietPoll);
  expect(archive.rows.has(attempt.id)).toBe(false);
  f.at(25_000);
  expect((await f.send(actor, 'poll', quietPoll)).terminal).toBe(true);
  expect(archive.rows.get(attempt.id)).toMatchObject({ state: 'final', capturedAt: EPOCH + 10_000, narrative: { status: 'ready', text: 'A summary.' } });
  expect(f.record.checkpoint).toBeUndefined();
  expect(f.record.wakeAt).toBe(EPOCH + 25_000 + 300_000);
});

test('the capability is checked before anything else, and an end before start leaves a closed lease', async () => {
  const f = fixture();
  const actor = await f.restore();
  expect(await f.send(actor, 'poll', undefined, 'Bearer nope')).toEqual({ status: 401, body: { error: 'Session capability is required.' } });
  expect(await f.send(actor, 'poll')).toEqual({ status: 404, body: { error: 'This interview session was not found.' } });
  expect(await f.send(actor, 'start', JSON.stringify({ ...attempt, planId: 'other' }))).toEqual({ status: 400, body: { error: 'Invalid interview request.' } });
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
  expect(reply.message).toBe('Interview ended after losing contact with this page.');
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

test('a closed browser link holds a live conversation for the browser to resume, and a fenced close writes nothing', async () => {
  const f = fixture();
  const { actor, socket } = await conversation(f);
  f.at(5000);
  await actor.close('hold');
  await f.background.settle();
  expect(socket.readyState).toBe(3);
  expect(f.record.checkpoint!.snapshot).toMatchObject({ status: 'paused', pause: { reason: 'browser', pausedAt: EPOCH + 5000 } });
  const held = structuredClone(f.record.checkpoint);
  await actor.close('fenced');
  await actor.close('hold');
  expect(f.record.checkpoint).toEqual(held);
  const replacement = fixture({ record: f.record, voice: f.voice, archive: f.archive });
  replacement.at(6000);
  const resumed = await replacement.restore();
  expect(await replacement.send(resumed, 'resume', JSON.stringify({ sdp: attempt.sdp })).then(r => r.status)).toBe(200);
  expect(body(await replacement.send(resumed, 'ready')).status).toBe('live');
  await replacement.send(resumed, 'end');
  await replacement.background.settle();
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

test('live coverage follows participant evidence, retains short answers and corrections, and always grades the final dialogue', async () => {
  const f = fixture();
  const evaluate = f.options.services!.evaluate!;
  const inputs: string[][] = [];
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let releaseSecond!: () => void;
  const secondPending = new Promise<void>(resolve => { releaseSecond = resolve; });
  f.options.services!.evaluate = async input => {
    inputs.push(input.transcript.map(entry => entry.text));
    if (inputs.length === 1) await pending;
    if (inputs.length === 2) await secondPending;
    return evaluate(input);
  };
  const { actor, socket } = await conversation(f);
  // Let the real session timer observe each settled input, using its injected clock.
  const advance = async (ms: number) => { f.at(ms); await Bun.sleep(650); };
  try {
    await advance(5000);
    expect(inputs).toHaveLength(1);
    say(socket, 'output', 'e3', 'Was the release accepted?', 4000);
    f.at(12_000);
    release();
    await f.background.settle();
    expect(body(await f.send(actor, 'poll', quietPoll)).feedbackStatus).toBe('current');
    await advance(13_000);
    expect(inputs).toHaveLength(1);

    say(socket, 'input', 'e4', 'Mm.', 5500);
    await advance(19_000);
    expect(inputs).toHaveLength(1);
    expect(body(await f.send(actor, 'poll', quietPoll)).feedbackStatus).toBe('current');

    say(socket, 'output', 'e5', 'Did the customer sign off?', 6500);
    say(socket, 'input', 'e6', 'Yes.', 7500);
    await advance(25_000);
    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toContain('Did the customer sign off?');
    expect(inputs[1]!.at(-1)).toBe('Yes.');

    say(socket, 'input', 'e7', 'No, it was still a pilot.', 9500);
    f.at(28_000);
    releaseSecond();
    await f.background.settle();
    expect(body(await f.send(actor, 'poll')).feedbackStatus).toBe('delayed');
    await advance(31_000);
    expect(inputs).toHaveLength(3);
    expect(inputs[2]!.at(-1)).toBe('No, it was still a pilot.');
    say(socket, 'output', 'e8', 'What still needed approval?', 11_000);
    await advance(37_000);
    expect(inputs).toHaveLength(3);
    await f.send(actor, 'end');
    expect(inputs).toHaveLength(4);
    expect(inputs[3]!.at(-1)).toBe('What still needed approval?');
    expect(body(await f.send(actor, 'poll')).feedbackStatus).toBe('current');
  } finally { release(); releaseSecond(); await f.send(actor, 'end'); }
}, 10_000);

test('failed live coverage retries once per participant input and interviewer speech does not renew the retry', async () => {
  const f = fixture();
  const evaluate = f.options.services!.evaluate!;
  let calls = 0;
  f.options.services!.evaluate = async input => {
    if (++calls <= 2) throw new Error('Provider unavailable');
    return evaluate(input);
  };
  const { actor, socket } = await conversation(f);
  const advance = async (ms: number) => { f.at(ms); await Bun.sleep(650); await f.background.settle(); };
  try {
    await advance(5000);
    expect(calls).toBe(1);
    await advance(11_000);
    expect(calls).toBe(2);
    say(socket, 'output', 'e3', 'Did the customer sign off?', 4000);
    await advance(17_000);
    expect(calls).toBe(2);
    say(socket, 'input', 'e4', 'No.', 5500);
    await advance(23_000);
    expect(calls).toBe(3);
    expect(body(await f.send(actor, 'poll')).feedbackStatus).toBe('current');
    await f.send(actor, 'end');
    expect(calls).toBe(4);
  } finally { await f.send(actor, 'end'); }
}, 10_000);

const silenceResult = (probability: number) => ({ probability, model: 'fixture', usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 } });
const reminders = (socket: ProviderSocket) => socket.sent.filter(event => String(event.event_id).startsWith('silence-'));

async function stranded(check: SessionServices['evaluateSilence'], judge?: Judge) {
  const f = fixture();
  if (judge) f.options.providers.judge = judge;
  f.options.services!.evaluateSilence = check;
  const { actor, socket } = await conversation(f);
  f.at(4000);
  say(socket, 'output', 'ack', 'That sounds useful.', 4000);
  f.at(8000);
  return { ...f, actor, socket };
}

test('the host-selected judge controls whether a .75 silence result sends a continuation', async () => {
  // Substitute only paid HTTP; exercise each real adapter and the session's continuation action.
  const request: Fetch = async url => Response.json(String(url).includes('typesafe.ai')
    ? { model: 'jev-1.13.0', answers: { continue: { type: 'choice', choice: 'continue', probabilities: { continue: .75, wait: .25, finished: 0 } } } }
    : { model: 'gpt-6-luna', usage: { input_tokens: 100, output_tokens: 0 }, answers: [
      { type: 'choice', name: 'continue', choice: 'continue', confidence: .75,
        probabilities: [{ value: 'continue', probability: .75 }, { value: 'wait', probability: .25 }, { value: 'finished', probability: 0 }] },
    ] });
  const jev = createJevJudge({ apiKey: 'fixture', fetch: request as typeof fetch });
  const decisions = createDecisionJudge({ apiKey: 'fixture', fetch: request });
  for (const [judge, expected] of [[jev, 0], [decisions, 1]] as const) {
    const f = await stranded(evaluateSilence, judge);
    try {
      await f.send(f.actor, 'poll');
      await f.background.settle();
      expect(reminders(f.socket)).toHaveLength(expected);
    } finally { await f.send(f.actor, 'end'); }
  }
});

test('transcript inactivity gets one Jev check per unchanged exchange and a private, acknowledged reminder', async () => {
  const inputs: string[][] = [];
  const f = await stranded(async input => { inputs.push(input.transcript.map(p => p.text)); return silenceResult(.97); });
  try {
    const publicState = body(await f.send(f.actor, 'poll'));
    await f.background.settle();
    expect(inputs).toEqual([['Hi, I’m Riley. What did you build?', 'A claims portal for the adjusters.', 'That sounds useful.']]);
    expect(reminders(f.socket)).toHaveLength(1);
    const id = reminders(f.socket)[0]!.event_id;
    f.socket.emit({ type: 'session.instructions.appended', client_event_id: id });
    for (let sequence = 2; sequence <= 4; sequence++) {
      f.at(9000 + sequence * 1000);
      await f.send(f.actor, 'poll');
    }
    expect(inputs).toHaveLength(1);
    expect(reminders(f.socket)).toHaveLength(1);
    expect(JSON.stringify(publicState)).not.toContain('silence-');
    say(f.socket, 'output', 'continued', 'Who tried it first?', 15_000);
    await f.send(f.actor, 'end');
    await f.background.settle();
    const checks = f.archive.rows.get(attempt.id)!.provenance.connection.segments[0]!.silence;
    expect(checks).toMatchObject([{ id, version: 'interview-silence-v2', outcome: 'sent', probability: .97, quietMs: 4000, acknowledgedAt: EPOCH + 8000, nextSpeech: { speaker: 'interviewer', passageId: 'p4' } }]);
  } finally { await f.send(f.actor, 'end'); }
});

test.each([.03, .6])('a wait or uncertain silence judgment (%s) keeps listening without polling Jev repeatedly', async probability => {
  let calls = 0;
  const f = await stranded(async () => { calls++; return silenceResult(probability); });
  try {
    await f.send(f.actor, 'poll');
    await f.background.settle();
    f.at(20_000);
    await f.send(f.actor, 'poll');
    expect(calls).toBe(1);
    expect(reminders(f.socket)).toHaveLength(0);
    await f.send(f.actor, 'end');
    await f.background.settle();
    expect(f.archive.rows.get(attempt.id)!.provenance.connection.segments[0]!.silence).toMatchObject([{ outcome: 'wait', probability }]);
  } finally { await f.send(f.actor, 'end'); }
});

test('four seconds without transcript growth starts Jev even when the browser reports sound', async () => {
  let calls = 0;
  const f = await stranded(async () => { calls++; return silenceResult(.97); });
  try {
    f.at(5000);
    await f.send(f.actor, 'poll', JSON.stringify({ sequence: 1, active: false, audio: true }));
    expect(calls).toBe(0);
    f.at(7999);
    await f.send(f.actor, 'poll', JSON.stringify({ sequence: 2, active: true, audio: true }));
    expect(calls).toBe(0);
    f.at(8000);
    await f.send(f.actor, 'poll', JSON.stringify({ sequence: 3, active: true, audio: true }));
    await f.background.settle();
    expect(calls).toBe(1);
    expect(reminders(f.socket)).toHaveLength(1);
  } finally { await f.send(f.actor, 'end'); }
});

test('the server timer checks transcript inactivity without any browser quiet reports', async () => {
  let calls = 0;
  const f = await stranded(async () => { calls++; return silenceResult(.97); });
  try {
    f.at(7999);
    await Bun.sleep(550);
    expect(calls).toBe(0);
    f.at(8000);
    await Bun.sleep(550);
    await f.background.settle();
    expect(calls).toBe(1);
    expect(reminders(f.socket)).toHaveLength(1);
  } finally { await f.send(f.actor, 'end'); }
});

test.each(['input', 'output'] as const)('new %s transcript text restarts the four-second interval', async speaker => {
  let calls = 0;
  const f = await stranded(async () => { calls++; return silenceResult(.03); });
  try {
    f.at(7000);
    say(f.socket, speaker, 'new-fragment', 'And one more thing—', 5000);
    f.at(10_999);
    await f.send(f.actor, 'poll');
    expect(calls).toBe(0);
    f.at(11_000);
    await f.send(f.actor, 'poll');
    await f.background.settle();
    expect(calls).toBe(1);
  } finally { await f.send(f.actor, 'end'); }
});

test.each(['input', 'output'] as const)('a pending silence decision is discarded when %s transcript text arrives', async speaker => {
  const result = deferred<ReturnType<typeof silenceResult>>();
  let calls = 0;
  const f = await stranded(async () => { calls++; return result.promise; });
  try {
    await f.send(f.actor, 'poll');
    expect(calls).toBe(1);
    f.at(9500);
    say(f.socket, speaker, 'fresh', 'Actually, let me explain—', 6000);
    await f.send(f.actor, 'poll');
    result.resolve(silenceResult(.99));
    await f.background.settle();
    expect(calls).toBe(1);
    expect(reminders(f.socket)).toHaveLength(0);
    await f.send(f.actor, 'end');
    await f.background.settle();
    expect(f.archive.rows.get(attempt.id)!.provenance.connection.segments[0]!.silence).toMatchObject([{ outcome: 'aborted' }]);
  } finally { result.resolve(silenceResult(.99)); await f.send(f.actor, 'end'); }
});

test('playback activity changes cannot cancel a pending transcript judgment', async () => {
  const result = deferred<ReturnType<typeof silenceResult>>();
  let calls = 0;
  const f = await stranded(async () => { calls++; return result.promise; });
  try {
    await f.send(f.actor, 'poll');
    expect(calls).toBe(1);
    await f.send(f.actor, 'poll', JSON.stringify({ sequence: 1, active: false, audio: true }));
    await f.send(f.actor, 'poll', JSON.stringify({ sequence: 2, active: false, audio: false }));
    f.at(10_500);
    result.resolve(silenceResult(.99));
    await f.background.settle();
    expect(calls).toBe(1);
    expect(reminders(f.socket)).toHaveLength(1);
  } finally { result.resolve(silenceResult(.99)); await f.send(f.actor, 'end'); }
});

test.each(['end', 'pause', 'fence'] as const)('a pending silence decision cannot speak after %s', async action => {
  const result = deferred<ReturnType<typeof silenceResult>>();
  const f = await stranded(async () => result.promise);
  try {
    await f.send(f.actor, 'poll');
    let ending: Promise<unknown> | undefined;
    if (action === 'end') ending = f.send(f.actor, 'end');
    if (action === 'pause') await f.send(f.actor, 'pause');
    if (action === 'fence') { memoryStore(f.record); await f.actor.wake(); }
    result.resolve(silenceResult(.99));
    await ending;
    await f.background.settle();
    expect(reminders(f.socket)).toHaveLength(0);
    if (action === 'pause') {
      await f.send(f.actor, 'resume', JSON.stringify({ sdp: attempt.sdp }));
      await f.send(f.actor, 'ready');
      const resumed = f.voice.sockets.get('provider-2')!;
      expect(reminders(resumed)).toHaveLength(0);
      await f.send(f.actor, 'poll');
      expect(reminders(resumed)).toHaveLength(0); // Old dialogue does not replace the resume greeting.
    }
  } finally { result.resolve(silenceResult(.99)); await f.send(f.actor, 'end'); }
});

test('a failed silence check is recorded once; it never fails the interview or retries an unchanged exchange', async () => {
  let calls = 0;
  const f = await stranded(async () => { calls++; throw new Error('Do not retain this provider body.'); });
  try {
    await f.send(f.actor, 'poll');
    await f.background.settle();
    f.at(20_000);
    const snapshot = body(await f.send(f.actor, 'poll'));
    expect(snapshot).toMatchObject({ status: 'live', message: null });
    expect(calls).toBe(1);
    expect(reminders(f.socket)).toHaveLength(0);
    await f.send(f.actor, 'end');
    await f.background.settle();
    const checks = f.archive.rows.get(attempt.id)!.provenance.connection.segments[0]!.silence;
    expect(checks).toMatchObject([{ outcome: 'error', failure: { name: 'Error' } }]);
    expect(JSON.stringify(checks)).not.toContain('provider body');
  } finally { await f.send(f.actor, 'end'); }
});


test.each([false, true])('resume preserves the accepted definition when the original context exists=%s', async hasContext => {
  const original = fixture();
  if (hasContext) original.options.context = { participant: { name: 'Priya' }, background: 'Atlas is the project name.' };
  const { actor } = await conversation(original);
  const accepted = actor.definition;
  original.options.plan.goals = 'CHANGED GOALS';
  original.options.plan.report.format = 'CHANGED REPORT';
  original.options.context = { participant: { name: 'Someone else' }, background: 'CHANGED BACKGROUND' };
  await original.send(actor, 'pause');
  await original.background.settle();
  await actor.close('fenced');
  const replacement = fixture({ record: original.record, voice: original.voice, archive: original.archive });
  replacement.options.plan.goals = 'NEW CALLER GOALS';
  replacement.options.context = { participant: { name: 'New caller' } };
  replacement.at(5000);
  const resumed = await replacement.restore();
  expect(resumed.definition).toEqual(accepted);
  const copy = resumed.definition;
  copy.plan.goals = 'MUTATED COPY';
  expect(resumed.definition.plan.goals).toBe('Learn what was built.');
  expect((await replacement.send(resumed, 'resume', JSON.stringify({ sdp: attempt.sdp }))).status).toBe(200);
  const instructions = original.voice.created.at(-1)!.instructions;
  expect(instructions).toContain('Learn what was built.');
  expect(instructions).not.toContain('CHANGED');
  expect(instructions).not.toContain('NEW CALLER');
  expect(instructions.includes('Atlas')).toBe(hasContext);
  await replacement.send(resumed, 'end');
  await replacement.background.settle();
});

// Typed answers: saved before they are acknowledged, forwarded once to the same provider session, and frozen.

const typed = (id: string, text: string) => JSON.stringify({ id, text });
const forwards = (socket: ProviderSocket) => socket.sent.filter(event => String(event.event_id).startsWith('typed-'));
type Receipt = { acceptedId: string; snapshot: PublicSnapshot };
/** Holds the next checkpoint write until released; `fail` makes it throw once released. */
function holdCheckpoint(f: ReturnType<typeof fixture>, { fail = false } = {}) {
  const gate = deferred();
  const reached = deferred();
  const original = f.store.save;
  let held = false;
  f.store.save = async patch => {
    if (patch.checkpoint && !held) {
      held = true;
      reached.resolve();
      await gate.promise;
      if (fail) throw new Error('store outage');
    }
    await original(patch);
  };
  return { release: gate.resolve, reached: reached.promise };
}
const checkpointWrites = (f: ReturnType<typeof fixture>) => {
  const writes: string[][] = [];
  const original = f.store.save;
  f.store.save = async patch => { if (patch.checkpoint) writes.push(patch.checkpoint.snapshot.transcript.map(entry => entry.id)); await original(patch); };
  return writes;
};

test('a typed answer is checkpointed before its receipt, forwarded once, and frozen against later speech', async () => {
  const f = fixture();
  const { actor, socket } = await conversation(f);
  const id = crypto.randomUUID();
  const text = '  We cut the review queue from five days to one.  ';
  const hold = holdCheckpoint(f);
  f.at(4000);
  let settled = false;
  const sending = f.send(actor, 'submitText', typed(id, text)).then(result => { settled = true; return result; });
  await hold.reached;
  // Appended at once, on the speech timeline, but not yet acknowledged or delivered.
  expect(actor.transcript().at(-1)).toEqual({ id: `typed-${id}`, speaker: 'participant', text, startMs: 4000, endMs: 4000 });
  expect(settled).toBe(false);
  expect(forwards(socket)).toHaveLength(0);
  hold.release();
  const accepted = await sending;
  expect(accepted.status).toBe(200);
  const receipt = accepted.body as Receipt;
  expect(receipt.acceptedId).toBe(id);
  expect(receipt.snapshot.transcript.at(-1)!.id).toBe(`typed-${id}`);
  expect(f.record.checkpoint!.snapshot.transcript.at(-1)).toMatchObject({ id: `typed-${id}`, text });
  expect(forwards(socket)).toEqual([{ type: 'session.thinking.append', event_id: `typed-${id}`, delegation_id: null, content: typedAnswerCue(text) }]);
  expect(String(forwards(socket)[0]!.content)).toContain(text);
  // Speech within two seconds starts a new passage rather than extending the typed one.
  say(socket, 'input', 'e3', 'And it stuck.', 4500);
  expect(actor.transcript().map(entry => [entry.id, entry.text])).toEqual([
    ['p1', 'Hi, I’m Riley. What did you build?'], ['p2', 'A claims portal for the adjusters.'], [`typed-${id}`, text], ['p4', 'And it stuck.'],
  ]);
  await f.send(actor, 'end');
  await f.background.settle();
  expect(f.archive.rows.get(attempt.id)!.transcript.map(entry => entry.id)).toContain(`typed-${id}`);
});

test('a typed answer is validated, deduplicated by id, and refused unless the interview is live', async () => {
  const f = fixture();
  const actor = await f.restore();
  await f.send(actor, 'start', start);
  const id = crypto.randomUUID();
  expect(await f.send(actor, 'submitText', typed(id, 'Too early.'))).toEqual({ status: 409, body: { error: 'The interview is not live.' } });
  await f.send(actor, 'ready');
  const socket = f.voice.sockets.get('provider-1')!;
  expect(await f.send(actor, 'submitText', typed(id, '  \n '))).toEqual({ status: 400, body: { error: 'Invalid interview request.' } });
  expect(await f.send(actor, 'submitText', typed('not-a-uuid', 'Hello.'))).toEqual({ status: 400, body: { error: 'Invalid interview request.' } });
  expect(await f.send(actor, 'submitText', typed(id, 'x'.repeat(2001)))).toEqual({ status: 400, body: { error: 'Invalid interview request.' } });
  expect((await f.send(actor, 'submitText', typed(id, 'A claims portal.'))).status).toBe(200);
  const revision = actor.snapshot()!.revision;
  const again = await f.send(actor, 'submitText', typed(id, 'A claims portal.'));
  expect(again.status).toBe(200);
  expect((again.body as Receipt).acceptedId).toBe(id);
  expect(actor.transcript().filter(entry => entry.id === `typed-${id}`)).toHaveLength(1);
  expect(actor.snapshot()!.revision).toBe(revision);
  expect(forwards(socket)).toHaveLength(1);
  expect(await f.send(actor, 'submitText', typed(id, 'Something else.'))).toEqual({ status: 409, body: { error: 'This answer was already sent with different text.' } });
  await f.send(actor, 'pause');
  await f.background.settle();
  expect(actor.snapshot()!.status).toBe('paused');
  expect(await f.send(actor, 'submitText', typed(crypto.randomUUID(), 'While paused.'))).toEqual({ status: 409, body: { error: 'The interview is not live.' } });
  await f.send(actor, 'end');
  expect(await f.send(actor, 'submitText', typed(crypto.randomUUID(), 'After the end.'))).toEqual({ status: 409, body: { error: 'The interview is not live.' } });
  expect(actor.transcript().map(entry => entry.id)).toEqual([`typed-${id}`]);
});

test('concurrent sends of the same typed answer share one save and one delivery', async () => {
  const f = fixture();
  const { actor, socket } = await conversation(f);
  const writes = checkpointWrites(f);
  const id = crypto.randomUUID();
  const [first, second] = await Promise.all([f.send(actor, 'submitText', typed(id, 'Five days to one.')), f.send(actor, 'submitText', typed(id, 'Five days to one.'))]);
  expect(first).toEqual(second);
  expect(first.status).toBe(200);
  expect(writes).toHaveLength(1);
  expect(writes[0]).toContain(`typed-${id}`);
  expect(forwards(socket)).toHaveLength(1);
  await f.send(actor, 'end');
});

test('a failed save is retryable with the same id, and the retry writes the checkpoint again', async () => {
  const f = fixture();
  const { actor, socket } = await conversation(f);
  const hold = holdCheckpoint(f, { fail: true });
  hold.release();
  const id = crypto.randomUUID();
  expect(await f.send(actor, 'submitText', typed(id, 'Five days to one.'))).toEqual({ status: 503, body: { error: 'Your answer could not be saved. Try again.' } });
  expect(actor.transcript().at(-1)!.id).toBe(`typed-${id}`);
  expect(f.record.checkpoint).toBeUndefined();
  expect(forwards(socket)).toHaveLength(0);
  const retried = await f.send(actor, 'submitText', typed(id, 'Five days to one.'));
  expect(retried.status).toBe(200);
  expect((retried.body as Receipt).acceptedId).toBe(id);
  expect(f.record.checkpoint!.snapshot.transcript.map(entry => entry.id)).toContain(`typed-${id}`);
  expect(actor.transcript().filter(entry => entry.id === `typed-${id}`)).toHaveLength(1);
  // The interviewer hears the answer once it is finally saved, not only after a resume.
  expect(forwards(socket)).toHaveLength(1);
  expect(forwards(socket)[0]!.event_id).toBe(`typed-${id}`);
  await f.send(actor, 'end');
});

test('a retry of a saved typed answer is acknowledged while paused and after the end', async () => {
  const f = fixture();
  const { actor } = await conversation(f);
  const id = crypto.randomUUID();
  expect((await f.send(actor, 'submitText', typed(id, 'Five days to one.'))).status).toBe(200);
  await f.send(actor, 'pause');
  await f.background.settle();
  expect(actor.snapshot()!.status).toBe('paused');
  const paused = await f.send(actor, 'submitText', typed(id, 'Five days to one.'));
  expect(paused.status).toBe(200);
  expect((paused.body as Receipt).acceptedId).toBe(id);
  await f.send(actor, 'end');
  const ended = await f.send(actor, 'submitText', typed(id, 'Five days to one.'));
  expect(ended.status).toBe(200);
  expect((ended.body as Receipt).snapshot.status).toBe('ended');
  expect(actor.transcript().filter(entry => entry.id === `typed-${id}`)).toHaveLength(1);
});

test('a typed answer saved after its session paused is not forwarded; the resumed interviewer responds to it', async () => {
  const f = fixture();
  const { actor, socket } = await conversation(f);
  const hold = holdCheckpoint(f);
  const id = crypto.randomUUID();
  f.at(4000);
  const sending = f.send(actor, 'submitText', typed(id, 'Five days to one.'));
  await hold.reached;
  await f.send(actor, 'pause');
  expect(actor.snapshot()!.status).toBe('paused');
  hold.release();
  expect((await sending).status).toBe(200);
  await f.background.settle();
  expect(forwards(socket)).toHaveLength(0);
  expect(f.record.checkpoint!.snapshot.transcript.at(-1)!.id).toBe(`typed-${id}`);
  expect((await f.send(actor, 'resume', JSON.stringify({ sdp: attempt.sdp }))).status).toBe(200);
  await f.send(actor, 'ready');
  const resumed = f.voice.sockets.get('provider-2')!;
  expect(forwards(resumed)).toHaveLength(0);
  expect(String(resumed.sent[0]!.content)).toContain('typed that last answer rather than speaking it');
  expect(f.voice.created[1]!.instructions).toContain('The participant: Five days to one.');
  await f.send(actor, 'end');
});

test('a provider rejection of a typed answer keeps it and pauses for a reconnect', async () => {
  const f = fixture();
  const { actor, socket } = await conversation(f);
  const id = crypto.randomUUID();
  expect((await f.send(actor, 'submitText', typed(id, 'Five days to one.'))).status).toBe(200);
  socket.emit({ type: 'error', error: { client_event_id: `typed-${id}` } });
  await f.background.settle();
  const paused = body(await f.send(actor, 'poll', quietPoll));
  expect(paused).toMatchObject({ status: 'paused', message: 'Your answer is saved. Reconnect to continue.', pause: { reason: 'provider' } });
  expect(paused.transcript.at(-1)!.id).toBe(`typed-${id}`);
  expect(f.record.checkpoint!.segments[0]!.typedErrors).toEqual([{ id: `typed-${id}`, at: EPOCH + 3000 }]);
  await f.send(actor, 'end');
});

test('an end while a typed answer’s save is failing still ends the attempt and removes its checkpoint', async () => {
  const f = fixture();
  const { actor } = await conversation(f);
  f.at(30_000);
  await actor.wake();
  expect(f.record.checkpoint).toBeDefined();
  const hold = holdCheckpoint(f, { fail: true });
  const id = crypto.randomUUID();
  const sending = f.send(actor, 'submitText', typed(id, 'Five days to one.'));
  await hold.reached;
  const ending = f.send(actor, 'end');
  hold.release();
  expect((await sending).status).toBe(503);
  expect(body(await ending).status).toBe('ended');
  expect(f.record.checkpoint).toBeUndefined();
  await f.background.settle();
  expect(f.archive.rows.get(attempt.id)!.transcript.map(entry => entry.id)).toContain(`typed-${id}`);
});

const composing = (sequence: number, value?: boolean) => JSON.stringify({ sequence, active: true, audio: false, ...(value === undefined ? {} : { composing: value }) });

test('composing cancels a pending silence judgment, and closing the draft starts a fresh four-second interval', async () => {
  const first = deferred<ReturnType<typeof silenceResult>>();
  let calls = 0;
  const f = await stranded(async () => ++calls === 1 ? first.promise : silenceResult(.99));
  try {
    await f.send(f.actor, 'poll');
    expect(calls).toBe(1);
    await f.send(f.actor, 'poll', composing(1, true));
    first.resolve(silenceResult(.99));
    await f.background.settle();
    expect(reminders(f.socket)).toHaveLength(0);
    f.at(20_000);
    await f.send(f.actor, 'poll');
    await f.send(f.actor, 'poll', composing(2));
    expect(calls).toBe(1);
    // A stale report cannot close the draft.
    await f.send(f.actor, 'poll', composing(2, false));
    f.at(30_000);
    await f.send(f.actor, 'poll');
    expect(calls).toBe(1);
    await f.send(f.actor, 'poll', composing(3, false));
    f.at(33_999);
    await f.send(f.actor, 'poll');
    expect(calls).toBe(1);
    f.at(34_000);
    await f.send(f.actor, 'poll');
    await f.background.settle();
    expect(calls).toBe(2);
    expect(reminders(f.socket)).toHaveLength(1);
    await f.send(f.actor, 'end');
    await f.background.settle();
    expect(f.archive.rows.get(attempt.id)!.provenance.connection.segments[0]!.silence).toMatchObject([{ outcome: 'aborted' }, { outcome: 'sent' }]);
  } finally { first.resolve(silenceResult(.99)); await f.send(f.actor, 'end'); }
});

test('an unnumbered poll cannot open a draft', async () => {
  let calls = 0;
  const f = await stranded(async () => { calls++; return silenceResult(.97); });
  try {
    await f.send(f.actor, 'poll', JSON.stringify({ active: true, audio: false, composing: true }));
    await f.background.settle();
    expect(calls).toBe(1);
    expect(reminders(f.socket)).toHaveLength(1);
  } finally { await f.send(f.actor, 'end'); }
});

test('a ready carrying an open draft protects the session from its first moment live', async () => {
  let calls = 0;
  const f = fixture();
  f.options.services!.evaluateSilence = async () => { calls++; return silenceResult(.97); };
  const actor = await f.restore();
  await f.send(actor, 'start', start);
  expect((await f.send(actor, 'ready', JSON.stringify({ active: false }))).status).toBe(400);
  expect(actor.snapshot()!.status).toBe('connecting');
  expect(body(await f.send(actor, 'ready', composing(5, true))).status).toBe('live');
  const socket = f.voice.sockets.get('provider-1')!;
  try {
    say(socket, 'output', 'e1', 'What did you build?', 0);
    say(socket, 'input', 'e2', 'A claims portal.', 1500);
    say(socket, 'output', 'e3', 'That sounds useful.', 3000);
    f.at(20_000);
    await f.send(actor, 'poll');
    expect(calls).toBe(0);
    await f.send(actor, 'poll', composing(6, false));
    f.at(24_000);
    await f.send(actor, 'poll');
    await f.background.settle();
    expect(calls).toBe(1);
  } finally { await f.send(actor, 'end'); }
});

test('the resume cue treats a typed last answer as complete and keeps the cut-off wording for speech', () => {
  const transcript = [
    { id: 'p1', speaker: 'interviewer' as const, text: 'What did you build?', startMs: 0, endMs: 900 },
    { id: 'typed-c49f7954-7aab-47f9-a269-752932556c37', speaker: 'participant' as const, text: 'A claims portal.', startMs: 1000, endMs: 1000 },
  ];
  const typedCue = resumeInstruction('Riley', transcript, 5000);
  expect(typedCue).toContain('The participant typed that last answer rather than speaking it, and it is complete. Respond to it now, then listen.');
  expect(typedCue).not.toContain('cut off');
  const spoken = resumeInstruction('Riley', [transcript[0]!, { ...transcript[1]!, id: 'p2' }], 5000);
  expect(spoken).toContain('may have been cut off');
  expect(typedAnswerCue('A "quoted" answer.')).toBe('The participant typed this answer instead of speaking: "A "quoted" answer.". Respond to it now as if they had said it aloud.');
});

const notes = (socket: ProviderSocket) => socket.sent.filter(event => String(event.event_id).startsWith('note-'));
/** A live conversation whose producer writes Sam a map note on its next map call. */
async function noted() {
  const f = fixture();
  f.options.services!.evaluateTurn = async input => ({ reading: { passageId: input.transcript.at(-1)!.id, atMs: input.atMs, focus: null, keys: {}, natural: {}, states: {}, novel: 1 }, model: 'fixture', durationMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, answers: {} });
  f.options.services!.generateMap = async input => ({
    map: { ...input.previous, participant: { vantage: 'Tech lead on the claims portal', preferences: [] } },
    update: { vantage: 'Tech lead on the claims portal', preferences: null, entities: [], edges: [], threads: [], revise: [], close: [], drop: [] },
    changes: { added: [], changed: ['participant'], dropped: [], kept: [] }, research: null, model: 'fixture', usage: { inputTokens: 1, outputTokens: 1 },
  });
  const { actor, socket } = await conversation(f);
  f.at(8000);
  say(socket, 'output', 'ack', 'And what was your part?', 8000);
  // Once past the map floor, successive ticks read the turn, call Sol and write the note.
  const produce = async () => {
    for (let round = 0; round < 4; round++) {
      (actor as unknown as { tick(): void }).tick();
      await f.background.settle();
    }
  };
  return { ...f, actor, socket, produce };
}

test('producer notes wait while a draft is open and reach Sam just before the typed answer', async () => {
  const f = await noted();
  await f.send(f.actor, 'poll', composing(1, true));
  f.at(30_000);
  await f.produce();
  expect(notes(f.socket)).toHaveLength(0);
  const id = crypto.randomUUID();
  expect((await f.send(f.actor, 'submitText', typed(id, 'I led the build.'))).status).toBe(200);
  expect(notes(f.socket)).toHaveLength(1);
  const order = f.socket.sent.map(event => String(event.event_id));
  expect(order.indexOf(String(notes(f.socket)[0]!.event_id))).toBeLessThan(order.indexOf(`typed-${id}`));
  await f.send(f.actor, 'end');
});

test('closing a draft without sending releases the held notes; a closed session never hears them', async () => {
  const f = await noted();
  await f.send(f.actor, 'poll', composing(1, true));
  f.at(30_000);
  await f.produce();
  expect(notes(f.socket)).toHaveLength(0);
  await f.send(f.actor, 'poll', composing(10, false));
  expect(notes(f.socket)).toHaveLength(1);
  // Later notes go straight through once the draft is closed.
  const g = await noted();
  await g.send(g.actor, 'poll', composing(1, true));
  g.at(30_000);
  await g.produce();
  expect(notes(g.socket)).toHaveLength(0);
  await g.send(g.actor, 'pause');
  g.at(40_000);
  await g.send(g.actor, 'resume', JSON.stringify({ sdp: attempt.sdp }));
  await g.send(g.actor, 'ready', composing(10, true));
  const resumed = g.voice.sockets.get('provider-2')!;
  await g.send(g.actor, 'poll', composing(11, false));
  await f.send(f.actor, 'end');
  await g.send(g.actor, 'end');
  await g.background.settle();
  // The producer restates its notes to the resumed session itself; the one held for the closed session is dropped.
  const written = g.archive.rows.get(attempt.id)!.producerLog.flatMap(record => record.source === 'note' ? [record.delivery.eventId] : []);
  expect(written.length).toBeGreaterThanOrEqual(2);
  expect(notes(g.socket)).toHaveLength(0);
  expect(notes(resumed).map(event => event.event_id)).toEqual(written.slice(1));
});
