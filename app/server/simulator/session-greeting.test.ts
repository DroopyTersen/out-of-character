import { afterEach, expect, setSystemTime, test } from 'bun:test';
import { activityPoll, archiveDatabase, attempt, capability, fixture, request, settle, waitFor } from './session-fixture';
import { interviewAttempt, objectFixture } from '../interview/durableObjectFixture';

// The provider can accept the opening and never speak; the session owner notices the silence. The practice
// simulator's session and the interview object share this watchdog, so each test runs against both.
afterEach(() => setSystemTime());
type Options = { values?: Map<string, unknown>; archive?: ReturnType<typeof archiveDatabase>; provider?: string };
type Fixture = Awaited<ReturnType<typeof objectFixture>> | Awaited<ReturnType<typeof fixture>>;
type Host = { host: string; open: (options: Options) => Promise<Fixture>; input: typeof attempt; row: (f: Fixture) => Record<string, any> | null };
const hosts: Host[] = [
  { host: 'practice', open: (options: Options) => fixture(options), input: attempt, row: (f: Fixture) => f.row() },
  { host: 'interview', open: (options: Options) => objectFixture(options), input: interviewAttempt, row: (f: Fixture) => f.interviewRow() },
];
const action = (name: string, body?: unknown) => new Request(`https://session/${name}`, { method: 'POST', headers: { Authorization: capability }, ...(body ? { body: JSON.stringify(body) } : {}) });
const read = async (response: Response | Promise<Response>) => (await response).json() as Promise<Record<string, any>>;
const poll = (f: Fixture) => read(f.session.fetch(request('poll')));
const instructions = (f: Fixture) => f.socket.sent.filter(event => event.type === 'session.instructions.append');
const greetings = (f: Fixture) => instructions(f).map(event => event.event_id);
/** Lets the 500 ms live tick observe the current system time. */
const ticked = () => Bun.sleep(600);
async function started(host: Host) {
  const f = await host.open({});
  await f.session.fetch(request('start', capability, host.input));
  const readyAt = Date.now();
  setSystemTime(readyAt);
  await f.session.fetch(request('ready'));
  return { f, readyAt };
}
async function replaced(f: Fixture) {
  await waitFor(() => f.socket.sent.some(event => event.type === 'session.close'));
  await settle(f);
}
async function reconnect(f: Fixture) {
  expect((await f.session.fetch(action('resume', { sdp: 'v=0\r\no=fixture-resume\r\n' }))).status).toBe(200);
  await f.session.fetch(request('ready'));
}

test.each(hosts)('a greeting met with silence is sent again, then the voice session is replaced ($host)', async host => {
  const { f, readyAt } = await started(host);
  f.socket.emit({ type: 'session.instructions.appended', client_event_id: 'opening' });
  setSystemTime(readyAt + 9_500);
  await ticked();
  expect(greetings(f)).toEqual(['opening']);
  setSystemTime(readyAt + 10_500);
  await waitFor(() => greetings(f).length === 2);
  const [opening, again] = instructions(f);
  expect(again).toMatchObject({ event_id: 'opening-again', content: opening!.content });

  // Still silent: the server pauses, and the browser resumes that pause on its own.
  setSystemTime(readyAt + 25_500);
  await replaced(f);
  expect(await poll(f)).toMatchObject({ status: 'paused', message: null, pause: { reason: 'provider' } });
  await reconnect(f);
  // Nothing was said, so the new session opens the conversation rather than resuming one.
  expect(f.created[1]).toEqual({});
  expect(greetings(f)).toEqual(['opening-2']);
  expect(instructions(f)[0]!.content).toBe(opening!.content);
  f.socket.emit({ type: 'session.output_transcript.delta', event_id: 'out-1', delta: 'Thanks for making time today.', start_ms: 400, end_ms: 2000 });
  setSystemTime(readyAt + 50_000);
  await ticked();
  expect(greetings(f)).toEqual(['opening-2']);
  expect(await poll(f)).toMatchObject({ status: 'live', message: null });

  await f.session.fetch(request('end'));
  await settle(f);
  const segments = JSON.parse(host.row(f)!.provenance_json).connection.segments;
  expect(segments[0].greeting).toEqual({ sentAt: readyAt, acknowledgedAt: readyAt, retriedAt: readyAt + 10_500, repliedAt: null, abandonedAt: readyAt + 25_500 });
  expect(segments[1].greeting).toEqual({ sentAt: readyAt + 25_500, acknowledgedAt: null, retriedAt: null, repliedAt: readyAt + 25_500, abandonedAt: null });
});

test.each(hosts)('a second silent voice session reports the problem instead of being replaced again ($host)', async host => {
  const { f, readyAt } = await started(host);
  setSystemTime(readyAt + 25_500);
  await replaced(f);
  await reconnect(f);
  setSystemTime(readyAt + 51_000);
  await ticked();
  expect(await poll(f)).toMatchObject({ status: 'live', message: 'The voice service is not responding. You can end this attempt and try again.' });
  expect(f.creations()).toBe(2);
  // A late reply clears the report.
  f.socket.emit({ type: 'session.output_transcript.delta', event_id: 'out-1', delta: 'Sorry, I was on mute.', start_ms: 0, end_ms: 1200 });
  expect(await poll(f)).toMatchObject({ status: 'live', message: null });
  await f.session.fetch(request('end'));
});

test.each(hosts)('speech, or audio the browser hears, postpones the watchdog ($host)', async host => {
  const { f, readyAt } = await started(host);
  setSystemTime(readyAt + 8_000);
  f.socket.emit({ type: 'session.input_transcript.delta', event_id: 'in-1', delta: 'Hello? Can you hear me?', start_ms: 7000, end_ms: 8000 });
  setSystemTime(readyAt + 12_000);
  await ticked();
  expect(greetings(f)).toEqual(['opening']);
  setSystemTime(readyAt + 17_000);
  await f.session.fetch(activityPoll(false, true));
  setSystemTime(readyAt + 26_500);
  await ticked();
  expect(greetings(f)).toEqual(['opening']);
  setSystemTime(readyAt + 27_500);
  await waitFor(() => greetings(f).length === 2);
  expect((await poll(f)).status).toBe('live');
  await f.session.fetch(request('end'));
});

test.each(hosts)('a restart before Sam spoke resumes with the opening, not a reconnect ($host)', async host => {
  const { f } = await started(host);
  const opening = instructions(f)[0]!.content;
  f.socket.emit({ type: 'session.input_transcript.delta', event_id: 'in-1', delta: 'Hello?', start_ms: 3000, end_ms: 3500 });
  // The periodic check saves the checkpoint a replacement owner restores.
  await f.session.alarm();
  await settle(f);
  const replacement = await host.open({ values: f.values, archive: f.archive, provider: 'replacement' });
  expect(await poll(replacement)).toMatchObject({ status: 'paused', pause: { reason: 'restart' } });
  await reconnect(replacement);
  expect(replacement.created[0]).toEqual({});
  expect(greetings(replacement)).toEqual(['opening-2']);
  expect(instructions(replacement)[0]!.content).toBe(opening);
  await replacement.session.fetch(request('end'));
  await f.session.fetch(request('end')); // Stop the original owner's timer.
});
