import { afterEach, expect, setSystemTime, test } from 'bun:test';
import { CANCEL_NOTE, HOLD_NOTE, TURN_NOTE } from '../../../core/interview-notes';
import { activityPoll, attempt, capability, fixture, request, settle, waitFor } from './session-fixture';

// The listening hold across real session ownership; only the provider and paid judges are substituted.
afterEach(() => setSystemTime());
const interviewAttempt = { ...attempt, scenarioId: 'project-closeout', clientId: 'sam-cedar' };
type Fixture = Awaited<ReturnType<typeof fixture>>;
const read = async (response: Response | Promise<Response>) => (await response).json() as Promise<Record<string, any>>;
const poll = (f: Fixture) => read(f.session.fetch(request('poll')));
const notes = (f: Fixture) => f.socket.sent.filter(event => String(event.event_id).startsWith('note-')).map(event => event.content);
/** Sam's question, as the participant's answer is about to begin. */
async function live(f?: Fixture) {
  f ??= await fixture();
  await f.session.fetch(request('start', capability, interviewAttempt));
  await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.output_transcript.delta', event_id: 'out-1', delta: 'Who owns the site today?', start_ms: 0, end_ms: 1200 });
  return f;
}
/** The participant's words, transcribed now. */
const say = (f: Fixture, id: string, delta: string) => f.socket.emit({ type: 'session.input_transcript.delta', event_id: id, delta, start_ms: 1500, end_ms: 4000 });
const ANSWER = 'Our team does, since the vendor handed it over last spring.';
const resume = async (f: Fixture) => {
  expect((await f.session.fetch(new Request('https://session/resume', { method: 'POST', headers: { Authorization: capability }, body: JSON.stringify({ sdp: 'v=0\r\no=fixture-resume\r\n' }) }))).status).toBe(200);
  await f.session.fetch(request('ready'));
};
const provenance = (f: Fixture) => JSON.parse(f.interviewRow()!.provenance_json).contextualDirector;
/** A replacement owner restoring the saved checkpoint, changed first by `edit`. */
async function restart(f: Fixture, edit: (checkpoint: any) => void = () => {}) {
  setSystemTime(Date.now() + 30_000);
  // The periodic check saves the checkpoint a replacement owner restores.
  await f.session.alarm();
  await settle(f);
  setSystemTime();
  edit(f.values.get('checkpoint'));
  return fixture({ values: f.values, archive: f.archive, provider: 'replacement' });
}

test('every interview gets the listening hold, again after a resume and after a restart', async () => {
  const f = await live();
  say(f, 'in-1', ANSWER);
  expect(notes(f)).toEqual([HOLD_NOTE]);
  f.socket.emit({ type: 'session.closed', reason: 'connection_lost', usage: { seconds: 30 } });
  await settle(f);
  await resume(f);
  expect(f.created[1]).toEqual({ context: expect.stringContaining('Our team does') });
  say(f, 'in-2', 'The hosting moved with it.');
  expect(notes(f).at(-1)).toBe(HOLD_NOTE);
  const replacement = await restart(f);
  expect(await poll(replacement)).toMatchObject({ status: 'paused' });
  await resume(replacement);
  say(replacement, 'in-3', 'It went fine.');
  expect(notes(replacement).at(-1)).toBe(HOLD_NOTE);
  await replacement.session.fetch(request('end'));
  await settle(replacement);
  expect(provenance(replacement).listening).toMatchObject({ windowMs: 2500, lagMs: 1000, afterSamMs: 1500, readWaitMs: 2000, cancels: 0, wakes: 0 });
  await f.session.fetch(request('end')); // Stop the original owner's timer.
});

test('the session’s own timer hands Sam the turn once the participant’s words stop, however loud their microphone, and their next words cancel it', async () => {
  const f = await live();
  say(f, 'in-1', ANSWER);
  const answeredAt = Date.now();
  expect(notes(f)).toEqual([HOLD_NOTE]);
  // Background noise keeps the microphone loud; it doesn't hold the floor.
  const noise = setInterval(() => f.session.fetch(activityPoll(true, true)), 200);
  try { await waitFor(() => String(notes(f).at(-1)).endsWith(TURN_NOTE)); } finally { clearInterval(noise); }
  // Their last words were said about a second before they arrived: the turn comes 1.5 s after.
  expect(Date.now() - answeredAt).toBeGreaterThanOrEqual(1500);
  expect(notes(f)).toHaveLength(2);
  say(f, 'in-2', 'Well, mostly.');
  expect(notes(f).at(-1)).toBe(CANCEL_NOTE);
  await f.session.fetch(request('end'));
  await settle(f);
  const records = JSON.parse(f.interviewRow()!.interventions_json).filter((record: { source: string }) => record.source === 'note');
  expect(records.map((record: { kind: string; handover?: boolean }) => [record.kind, record.handover ?? false]).filter(([kind]: [string]) => kind !== 'list' && kind !== 'map'))
    .toEqual([['hold', false], ['turn', true], ['cancel', false]]);
  expect(records.find((record: { kind: string }) => record.kind === 'turn').quietMs).toBeGreaterThanOrEqual(2500);
  expect(provenance(f).listening).toMatchObject({ holds: 1, handovers: 1, cancels: 1 });
});

test('a pause in the session clears the floor timer, and the resumed session waits for new words', async () => {
  const f = await live();
  say(f, 'in-1', ANSWER);
  expect(notes(f)).toEqual([HOLD_NOTE]);
  f.socket.emit({ type: 'session.closed', reason: 'connection_lost', usage: { seconds: 30 } });
  await settle(f);
  await resume(f);
  const restated = notes(f).length;
  await new Promise(resolve => setTimeout(resolve, 2000));
  expect(notes(f).slice(restated).some(note => String(note).endsWith(TURN_NOTE))).toBe(false);
  await f.session.fetch(request('end'));
});
