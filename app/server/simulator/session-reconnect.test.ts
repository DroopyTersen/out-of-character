import { afterEach, expect, setSystemTime, test } from 'bun:test';
import { SESSION_MAX_RESUMES, SESSION_PAUSE_HOLD_MS } from '../../../core/simulator/types';
import { activityPoll, attempt, capability, fixture, request, settle } from './session-fixture';

// Pause and resume across real session ownership; only the provider and paid judges are substituted.
afterEach(() => setSystemTime());
const interviewAttempt = { ...attempt, scenarioId: 'project-closeout', clientId: 'sam-cedar' };
type Fixture = Awaited<ReturnType<typeof fixture>>;
const action = (name: string, body?: unknown) => new Request(`https://session/${name}`, { method: 'POST', headers: { Authorization: capability }, ...(body ? { body: JSON.stringify(body) } : {}) });
const resume = (f: Fixture) => f.session.fetch(action('resume', { sdp: 'v=0\r\no=fixture-resume\r\n' }));
const read = async (response: Response | Promise<Response>) => (await response).json() as Promise<Record<string, any>>;
const poll = (f: Fixture) => read(f.session.fetch(request('poll')));
async function live(options: Parameters<typeof fixture>[0] = {}, input = attempt) {
  const f = await fixture(options);
  await f.session.fetch(request('start', capability, input));
  await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.input_transcript.delta', event_id: 'in-1', delta: 'Who owns the site today?', start_ms: 0, end_ms: 1200 });
  f.socket.emit({ type: 'session.output_transcript.delta', event_id: 'out-1', delta: 'Our team does.', start_ms: 1300, end_ms: 2000 });
  return f;
}
async function lose(f: Fixture) {
  f.socket.emit({ type: 'session.closed', reason: 'connection_lost', usage: { seconds: 30 } });
  await settle(f);
}
async function reconnect(f: Fixture) {
  const response = await resume(f);
  expect(response.status).toBe(200);
  await f.session.fetch(request('ready'));
}

test('a lost provider connection holds a started conversation instead of ending it', async () => {
  const f = await live();
  const lostAt = Date.now();
  await lose(f);
  const state = await poll(f);
  expect(state).toMatchObject({ status: 'paused', finalization: 'pending', usageSeconds: 30, message: null,
    pause: { reason: 'provider', resumes: 0, maxResumes: SESSION_MAX_RESUMES } });
  expect(state.pause.resumeBy - state.pause.pausedAt).toBe(SESSION_PAUSE_HOLD_MS);
  expect(state.pause.pausedAt).toBeGreaterThanOrEqual(lostAt);
  expect(state.transcript.map((entry: { text: string }) => entry.text)).toEqual(['Who owns the site today?', 'Our team does.']);
  expect(f.values.get('lease')).not.toHaveProperty('providerId');
  expect(f.values.get('checkpoint')).toMatchObject({ snapshot: { status: 'paused' } });
  expect(f.row()).toMatchObject({ archive_state: 'partial', session_status: 'paused' });
  await f.session.fetch(request('end'));
});

test('a browser report pauses and closes the provider session', async () => {
  const f = await live();
  await f.session.fetch(action('pause'));
  await settle(f);
  expect((await poll(f)).pause).toMatchObject({ reason: 'browser' });
  expect(f.socket.sent.filter(event => event.type === 'session.close')).toHaveLength(1);
  expect(f.values.get('lease')).not.toHaveProperty('providerId');
  await f.session.fetch(request('end'));
});

test('a dropped control socket pauses, and the paused alarm retries the unconfirmed closure', async () => {
  const f = await live();
  f.socket.close();
  await settle(f);
  expect((await poll(f)).status).toBe('paused');
  expect(f.values.get('lease')).toMatchObject({ providerId: 'provider-private-id', closed: false });
  await f.session.alarm();
  expect(f.values.get('lease')).not.toHaveProperty('providerId');
  await f.session.fetch(request('end'));
});

test('other provider closures still end the conversation', async () => {
  const f = await live();
  f.socket.emit({ type: 'session.closed', reason: 'session_expired', usage: { seconds: 5 } });
  await settle(f);
  expect(await poll(f)).toMatchObject({ status: 'ended', message: 'The voice session ended.', pause: null });
});

test('a connection lost before the conversation starts still interrupts it', async () => {
  const f = await fixture();
  await f.session.fetch(request('start'));
  f.socket.emit({ type: 'session.closed', reason: 'connection_lost' });
  await settle(f);
  expect((await poll(f)).status).toBe('interrupted');
});

test('resume seeds a new provider session and continues the same transcript', async () => {
  const f = await live();
  const deadline = (f.values.get('lease') as { deadline: number }).deadline;
  await lose(f);
  const pausedAt = Date.now();
  setSystemTime(pausedAt + 20_000);
  const resumed = await read(resume(f));
  expect(resumed.sdp).toBe('v=0\r\nanswer');
  expect(resumed.snapshot).toMatchObject({ status: 'connecting', pause: { resumes: 1 } });
  expect(f.creations()).toBe(2);
  expect(f.created[1]!.context).toContain('Who owns the site today?');
  expect(f.created[1]!.context).toContain('Our team does.');
  expect(f.values.get('lease')).toMatchObject({ providerId: 'provider-private-id-2' });

  expect(await read(f.session.fetch(request('ready')))).toMatchObject({ status: 'live', pause: null, message: null });
  await f.session.fetch(request('ready'));
  const instructions = f.socket.sent.filter(event => event.type === 'session.instructions.append');
  expect(instructions.map(event => event.event_id)).toEqual(['resume-2']);
  expect(typeof instructions[0]!.content).toBe('string');
  // Paused time does not count against the live limit.
  expect((f.values.get('lease') as { deadline: number }).deadline - deadline).toBeGreaterThanOrEqual(20_000);

  // Provider clocks restart at zero; the reply still follows the paused gap and opens its own passage.
  f.socket.emit({ type: 'session.output_transcript.delta', event_id: 'out-1', delta: 'As I was saying,', start_ms: 0, end_ms: 600 });
  // The superseded session can neither add speech nor end the resumed one.
  const old = f.sockets()[0]!;
  old.emit({ type: 'session.input_transcript.delta', event_id: 'late', delta: 'A late fragment.', start_ms: 3000, end_ms: 3500 });
  old.emit({ type: 'session.closed', reason: 'connection_lost' });
  const state = await poll(f);
  expect(state.status).toBe('live');
  expect(state.transcript.map((entry: { text: string }) => entry.text)).toEqual(['Who owns the site today?', 'Our team does.', 'As I was saying,']);
  expect(state.transcript[2].startMs).toBeGreaterThanOrEqual(2000 + 20_000);

  const ended = await read(f.session.fetch(request('end')));
  expect(ended).toMatchObject({ status: 'ended', finalization: 'confirmed', usageSeconds: 42 });
  await settle(f);
  const row = f.row()!;
  expect(JSON.stringify(row)).not.toContain('provider-private-id');
  const connection = JSON.parse(row.provenance_json).connection;
  expect(connection.segments.map((segment: { epoch: number; finalization: string }) => [segment.epoch, segment.finalization])).toEqual([[1, 'confirmed'], [2, 'confirmed']]);
  expect(connection.segments[0].closeReason).toBe('connection_lost');
  expect(connection.pauses).toHaveLength(1);
  expect(connection.pauses[0]).toMatchObject({ reason: 'provider' });
  expect(connection.pauses[0].durationMs).toBeGreaterThanOrEqual(20_000);
});

test('resuming from live first pauses the current provider session', async () => {
  const f = await live();
  const response = await resume(f);
  expect(response.status).toBe(200);
  expect(f.sockets()[0]!.sent.some(event => event.type === 'session.close')).toBe(true);
  expect(f.creations()).toBe(2);
  await f.session.fetch(request('end'));
});

test('a resume abandoned before its media connected yields to the next one', async () => {
  const f = await live();
  await lose(f);
  expect((await resume(f)).status).toBe(200);
  await reconnect(f);
  expect(f.creations()).toBe(3);
  expect(f.sockets()[1]!.sent.some(event => event.type === 'session.close')).toBe(true);
  expect(await poll(f)).toMatchObject({ status: 'live', pause: null });
  await f.session.fetch(request('end'));
});

test('a failed reconnect stays paused and can be tried again', async () => {
  const f = await live({ failCreation: creation => creation === 2 });
  await lose(f);
  const failed = await resume(f);
  expect(failed.status).toBe(502);
  expect((await read(failed)).snapshot).toMatchObject({ status: 'paused', message: 'The voice connection could not be re-established. Try again.', pause: { resumes: 1 } });
  await reconnect(f);
  expect((await poll(f)).status).toBe('live');
  await f.session.fetch(request('end'));
});

test('resume enforces its budget and hold, and pausing near a hard limit ends instead', async () => {
  const f = await live();
  for (let resumes = 0; resumes < SESSION_MAX_RESUMES; resumes++) {
    await lose(f);
    await reconnect(f);
  }
  await lose(f);
  const refused = await resume(f);
  expect(refused.status).toBe(409);
  expect((await read(refused)).error).toContain('too many times');

  const held = await live();
  await lose(held);
  setSystemTime(Date.now() + SESSION_PAUSE_HOLD_MS);
  expect((await resume(held)).status).toBe(409);
  await held.session.alarm();
  expect(await poll(held)).toMatchObject({ status: 'ended', pause: null });

  const late = await live();
  setSystemTime(Date.now() + 3600_000 - 30_000);
  await late.session.fetch(activityPoll(true, true));
  await lose(late);
  const state = await poll(late);
  expect(state.status).toBe('ended');
  expect(state.message).toContain('close to its limit');
  await f.session.fetch(request('end'));
});

test('End while paused finalizes what was captured', async () => {
  const f = await live();
  await lose(f);
  const ended = await read(f.session.fetch(request('end')));
  expect(ended).toMatchObject({ status: 'ended', finalization: 'confirmed', pause: null });
  await settle(f);
  expect(f.row()).toMatchObject({ archive_state: 'final', session_status: 'ended' });
  expect(f.judged.at(-1)).toHaveLength(2);
  expect(f.values.get('checkpoint')).toBeUndefined();
  expect(f.values.get('lease')).toMatchObject({ closed: true });
  const pause = JSON.parse(f.row()!.provenance_json).connection.pauses[0];
  expect(pause.resumedAt).toBeNull();
});

test('a restart while paused keeps the hold for its browser', async () => {
  const f = await live();
  await lose(f);
  const before = (await poll(f)).pause;
  const replacement = await fixture({ values: f.values, archive: f.archive, provider: 'replacement' });
  const state = await poll(replacement);
  expect(state).toMatchObject({ status: 'paused', pause: { reason: 'provider', pausedAt: before.pausedAt, resumeBy: before.resumeBy } });
  expect(state.transcript).toHaveLength(2);
  expect(replacement.creations()).toBe(0);
  await reconnect(replacement);
  expect(replacement.created[0]!.context).toContain('Who owns the site today?');
  expect((await poll(replacement)).status).toBe('live');
  expect(await read(replacement.session.fetch(request('end')))).toMatchObject({ status: 'ended', finalization: 'confirmed' });
  await settle(replacement);
  expect(replacement.row()).toMatchObject({ archive_state: 'final', session_status: 'ended' });
  expect(JSON.parse(replacement.row()!.transcript_json)).toHaveLength(2);
  await f.session.fetch(request('end'));
});

test('a restart holds a live conversation for its browser and closes the orphaned provider session', async () => {
  const f = await live();
  setSystemTime(Date.now() + 30_000);
  // The periodic check saves the checkpoint a replacement owner restores.
  await f.session.alarm();
  await settle(f);
  const replacement = await fixture({ values: f.values, archive: f.archive, provider: 'replacement' });
  const state = await poll(replacement);
  expect(state).toMatchObject({ status: 'paused', message: null, pause: { reason: 'restart', resumes: 0, maxResumes: SESSION_MAX_RESUMES } });
  expect(state.transcript).toHaveLength(2);
  expect(replacement.alarm()).toBeLessThanOrEqual(Date.now() + 1000);
  await replacement.session.alarm();
  await settle(replacement);
  expect(replacement.socketFor('provider-private-id')!.sent.map(event => event.type)).toEqual(['session.close']);
  await reconnect(replacement);
  expect(replacement.created[0]!.context).toContain('Our team does.');
  expect(await read(replacement.session.fetch(request('end')))).toMatchObject({ status: 'ended', finalization: 'confirmed' });
  await settle(replacement);
  const connection = JSON.parse(replacement.row()!.provenance_json).connection;
  expect(connection.segments.map((segment: { epoch: number; finalization: string }) => [segment.epoch, segment.finalization])).toEqual([[1, 'confirmed'], [2, 'confirmed']]);
  expect(connection.pauses).toMatchObject([{ reason: 'restart' }]);
  await f.session.fetch(request('end')); // Stop the original owner's timer.
});

test('a resumed interview restates its rundown to the new provider session', async () => {
  const f = await live({}, interviewAttempt);
  await lose(f);
  await reconnect(f);
  const ids = f.socket.sent.map(event => String(event.event_id));
  expect(ids).toContain('resume-2');
  expect(ids.some(id => id.startsWith('rundown-'))).toBe(true);
  await f.session.fetch(request('end'));
  await settle(f);
  expect(JSON.parse(f.interviewRow()!.interventions_json).some((record: { source: string; reason?: string }) => record.source === 'rundown' && record.reason === 'resume')).toBe(true);
});
