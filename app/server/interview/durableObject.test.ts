import { afterEach, expect, setSystemTime, test } from 'bun:test';
import { emptyInterviewReadings } from '../../../core/interview';
import type { Checkpoint, Lease } from '../../../interview-engine/interview/interview.server';
import type { Narrative, NarrativeRun } from '../../../interview-engine/narrative/narrative.server';
import { capability, settle, waitFor } from '../simulator/session-fixture';
// The object fixture substitutes the Workers base class (through the simulator fixture) before the object loads.
import { fakeStorage, interviewAttempt, objectFixture } from './durableObjectFixture';

const { durableStore, durableBackground } = await import('./durableObject');
afterEach(() => setSystemTime());

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
  // A closed lease keeps the terminal checkpoint saved with it until the final row is acknowledged.
  await store.save({ lease: { ...lease, closed: true }, checkpoint });
  expect(await store.load()).toEqual({ lease: { ...lease, closed: true }, checkpoint });
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
  const passage = transcript.find(passage => passage.speaker === 'participant')!;
  return { revision, readings: emptyInterviewReadings(), model: 'fixture', durationMs: 1, usage, answers: {},
    objectives: [{ id: 'project-delivery', level: 'explored' as const, levels: { 'not-yet': .01, touched: .03, explored: .95, 'set-aside': .01 }, achieved: true, probability: .95, evidence: { entryId: passage.id, speaker: passage.speaker, text: passage.text } }] };
};
// The frozen archive row records this summary without usage, as the fixture's earlier summary reported none.
const summary = (): NarrativeRun => {
  const document = { text: 'Fixture summary.' };
  return { stream: new ReadableStream<string>({ start(controller) { controller.enqueue(JSON.stringify(document)); controller.close(); } }), result: Promise.resolve({ document, failure: null, usage: null } as unknown as Narrative) };
};

const body = (action: string) => action === 'start' ? JSON.stringify(interviewAttempt) : action === 'poll' ? JSON.stringify({ active: false, audio: false }) : undefined;
const send = (target: { fetch(request: Request): Promise<Response> }, action: string, cap = capability) =>
  target.fetch(new Request(`https://session/${action}`, { method: 'POST', headers: { Authorization: cap }, body: body(action) }));

/** The object with every coverage grade marking project delivery explored, and the summary the frozen row recorded. */
async function interviewObject() {
  const grades: number[] = [];
  const f = await objectFixture({ overrides: {
    evaluate: async input => { grades.push(input.revision); return graded(input.revision, input.transcript) as never; },
    narrate: summary,
  } });
  return { ...f, grades };
}


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

test('the interview object preserves the scripted protocol and archive contract', async () => {
  const next = await interviewObject();
  const after = await script({ fetch: request => next.session.fetch(request), get socket() { return next.socket; }, pending: next.pending, grades: () => next.grades.length, values: next.values });

  expect(after.replies.map(([action, status]) => [action, status])).toEqual([['poll', 404], ['start', 200], ['start', 403], ['ready', 200], ['poll', 200], ['pause', 200], ['poll', 200], ['end', 200], ['poll', 200], ['report', 200], ['poll', 200]]);
  const final = after.replies.at(-1)![2] as Record<string, any>;
  expect(final).toMatchObject({ planId: 'project-closeout', voiceId: 'sam-cedar', status: 'ended', report: { status: 'completed', report: { text: 'Fixture summary.' } } });
  expect(final.transcript.map((passage: { speaker: string; text: string }) => [passage.speaker, passage.text])).toEqual([
    ['interviewer', 'Hi, I’m Sam. What did you deliver?'], ['participant', 'We built a permit intake portal.'],
  ]);
  for (const key of ['scenarioId', 'clientId', 'coaching', 'interview']) expect(final).not.toHaveProperty(key);
  expect(after.paused).toMatchObject({ definition: { plan: { id: 'project-closeout' } }, snapshot: { status: 'paused' } });
  expect(next.values.get('lease')).toMatchObject({ capability, closed: true });
  expect(next.values.has('checkpoint')).toBe(false);
  expect(next.interviewRow()).toMatchObject({ spec_id: 'project-closeout', archive_state: 'final', summary_status: 'ready' });
}, 15_000);

test('the alarm wakes the session: an end that arrived before its start is forgotten once the hold passes', async () => {
  const epoch = 1_800_000_000_000;
  setSystemTime(epoch);
  const next = await interviewObject();
  expect((await send(next.session, 'end')).status).toBe(200);
  expect(next.values.get('lease')).toMatchObject({ capability, closed: true });
  expect(next.alarm()).toBe(epoch + 60_000);
  setSystemTime(epoch + 60_000);
  await next.session.alarm();
  expect(next.values.size).toBe(0);
  expect(next.storageCalls.at(-1)).toBe('deleteAll');
});

test('the report waits for an end and is refused without participant speech', async () => {
  const next = await interviewObject();
  expect((await send(next.session, 'start')).status).toBe(200);
  await send(next.session, 'ready');
  expect(await (await send(next.session, 'report')).json() as unknown).toEqual({ error: 'End the conversation before requesting its report.' });
  expect((await send(next.session, 'end')).status).toBe(200);
  await settle(next);
  const report = await send(next.session, 'report');
  expect(report.status).toBe(422);
  expect(await report.json() as unknown).toEqual({ error: 'There is not enough scored conversation to review.' });
  expect((await (await send(next.session, 'poll')).json() as { report: { status: string } }).report.status).toBe('ineligible');
});

// --- An approved ad hoc debrief: the object resolves its spec at start and pins it for every later owner. ---

const { specCatalog, memoryDebriefStore } = await import('./debriefs');
const { approveDebrief } = await import('../../../interview-engine/setup/approve.server');
const { vendorReview } = await import('../../../interview-engine/setup/setup.test');
const { spec: closeout } = await import('../../../interviews/project-closeout/spec');

async function adHocCatalog() {
  const store = memoryDebriefStore();
  const approved = await approveDebrief(closeout, vendorReview);
  await store.put({ id: approved.id, version: approved.version, base: closeout.id, approvedAt: 1000, record: { ...vendorReview, id: approved.id, base: closeout.id } });
  return { catalog: specCatalog(store), approved };
}
const adHocStart = (planId: string, cap = capability) => (target: { fetch(request: Request): Promise<Response> }) =>
  target.fetch(new Request('https://session/start', { method: 'POST', headers: { Authorization: cap }, body: JSON.stringify({ ...interviewAttempt, planId }) }));

test('an attempt under an approved debrief runs, archives and resumes under that debrief’s id and version, and reports with its narrative', async () => {
  const epoch = 1_800_000_000_000;
  setSystemTime(epoch);
  const { catalog, approved } = await adHocCatalog();
  const reports: unknown[] = [];
  const narrate = (input: unknown) => { reports.push(input); return summary(); };
  const first = await objectFixture({ catalog, overrides: { narrate: narrate as never } });
  expect((await adHocStart('no-such-debrief')(first.session)).status).toBe(400);
  expect(first.values.has('spec')).toBe(false);
  const started = await adHocStart(approved.id)(first.session);
  expect(started.status).toBe(200);
  expect(first.values.get('spec')).toMatchObject({ plan: { id: approved.id, version: approved.version, goals: vendorReview.goals } });
  setSystemTime(epoch + 1000);
  await send(first.session, 'ready');
  // Sam's brief is the approved debrief's, not the base template's.
  expect(first.created).toHaveLength(1);
  first.socket.emit({ type: 'session.output_transcript.delta', event_id: 'o1', delta: 'Hi, I’m Sam. What was your part in this vendor relationship?', start_ms: 0, end_ms: 900 });
  first.socket.emit({ type: 'session.input_transcript.delta', event_id: 'i1', delta: 'I owned the renewal and the weekly vendor calls.', start_ms: 1500, end_ms: 2400 });
  setSystemTime(epoch + 4000);
  await waitFor(() => first.interviewJudged.length >= 1);
  await settle(first);
  expect((await send(first.session, 'pause')).status).toBe(200);
  await settle(first);
  expect(first.interviewRow()).toMatchObject({ scenario_id: approved.id, spec_id: approved.id, spec_version: approved.version, archive_state: 'partial' });

  // A replacement owner restores from the same storage and resolves the same debrief, by id and version.
  const second = await objectFixture({ catalog: specCatalog(memoryDebriefStore()), values: first.values, archive: first.archive, provider: 'provider-second', overrides: { narrate: narrate as never } });
  const polled = await (await send(second.session, 'poll')).json() as { planId: string; status: string };
  expect(polled).toMatchObject({ planId: approved.id, status: 'paused' });
  setSystemTime(epoch + 6000);
  expect((await send(second.session, 'end')).status).toBe(200);
  await settle(second);
  expect((await send(second.session, 'report')).status).toBe(200);
  await settle(second);
  expect(reports).toHaveLength(1);
  expect(reports[0]).toMatchObject({ format: vendorReview.report });
  expect(Object.keys(reports[0] as object).sort()).toEqual(['format', 'transcript']);
  expect(second.interviewRow()).toMatchObject({ spec_id: approved.id, spec_version: approved.version, archive_state: 'final', summary_status: 'ready' });
});

test('a start that names a debrief still honours an end that arrived first, and a pinned attempt ignores other debriefs', async () => {
  const epoch = 1_800_000_000_000;
  setSystemTime(epoch);
  const { catalog, approved } = await adHocCatalog();
  const f = await objectFixture({ catalog });
  expect((await send(f.session, 'end')).status).toBe(200);
  expect(f.values.get('lease')).toMatchObject({ closed: true });
  const started = await adHocStart(approved.id)(f.session);
  expect(started.status).toBe(409);
  expect(f.values.get('spec')).toMatchObject({ plan: { id: approved.id, version: approved.version, goals: vendorReview.goals } });
  expect(f.creations()).toBe(0);
  // Once pinned, a start under the base template is a mismatch, not a new attempt.
  expect((await send(f.session, 'start')).status).toBe(400);
  setSystemTime(epoch + 60_000);
  await f.session.alarm();
  expect(f.values.size).toBe(0);
});

test('an owner whose stored debrief is no longer served fails to restore instead of running the wrong spec', async () => {
  const { approved } = await adHocCatalog();
  const values = new Map<string, unknown>([['spec', { id: approved.id, version: approved.version }]]);
  await expect(objectFixture({ values, catalog: specCatalog(memoryDebriefStore()) })).rejects.toThrow('no longer served');
});
