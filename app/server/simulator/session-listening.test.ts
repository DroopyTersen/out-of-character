import { afterEach, expect, setSystemTime, test } from 'bun:test';
import { CANCEL_NOTE, HOLD_NOTE, TURN_NOTE } from '../../../core/interview-notes';
import { attempt, capability, fixture, request, settle, waitFor } from './session-fixture';

// The listening hold across real session ownership; only the provider and paid judges are substituted.
afterEach(() => setSystemTime());
const interviewAttempt = { ...attempt, scenarioId: 'project-closeout', clientId: 'sam-cedar' };
type Fixture = Awaited<ReturnType<typeof fixture>>;
const read = async (response: Response | Promise<Response>) => (await response).json() as Promise<Record<string, any>>;
const poll = (f: Fixture) => read(f.session.fetch(request('poll')));
/** A browser report with Sam silent and the participant's microphone quiet for `inputQuietMs`. */
const heard = (f: Fixture, inputQuietMs: number) => f.session.fetch(new Request('https://session/poll', { method: 'POST', headers: { Authorization: capability },
  body: JSON.stringify({ active: inputQuietMs < 300, audio: false, outputQuietMs: 60_000, inputQuietMs }) }));
const notes = (f: Fixture) => f.socket.sent.filter(event => String(event.event_id).startsWith('note-')).map(event => event.content);
async function live(input: typeof interviewAttempt & { listening?: string } = interviewAttempt, f?: Fixture) {
  f ??= await fixture();
  // The exchange happened a few seconds ago, so the participant's answer has settled by the time the test listens.
  setSystemTime(Date.now() - 5000);
  await f.session.fetch(request('start', capability, input));
  await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.output_transcript.delta', event_id: 'out-1', delta: 'Who owns the site today?', start_ms: 0, end_ms: 1200 });
  f.socket.emit({ type: 'session.input_transcript.delta', event_id: 'in-1', delta: 'Our team does, since the vendor handed it over last spring.', start_ms: 1500, end_ms: 4000 });
  setSystemTime();
  return f;
}
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

test('every interview listens quietly, through resume and restart, and a tab still sending the old choice is heard the same', async () => {
  const f = await live({ ...interviewAttempt, listening: 'ack' });
  expect(f.created[0]).toEqual({ listening: true });
  expect((await poll(f)).interview.listening).toBe('quiet');
  f.socket.emit({ type: 'session.closed', reason: 'connection_lost', usage: { seconds: 30 } });
  await settle(f);
  await resume(f);
  expect(f.created[1]).toMatchObject({ listening: true, context: expect.stringContaining('Our team does') });
  const replacement = await restart(f);
  expect(await poll(replacement)).toMatchObject({ status: 'paused', interview: { listening: 'quiet' } });
  await resume(replacement);
  expect(replacement.created[0]).toMatchObject({ listening: true });
  await replacement.session.fetch(request('end'));
  await settle(replacement);
  expect(provenance(replacement).listening).toEqual({ mode: 'quiet', windowMs: 2500, holdAfterMs: 300, readWaitMs: 2000, holds: 0, handovers: 0, cancels: 0, wakes: 0 });
  await f.session.fetch(request('end')); // Stop the original owner's timer.
});

test('the session’s own timer hands Sam the turn after the window, and resumed speech cancels it', async () => {
  const f = await live();
  await heard(f, 0);
  await heard(f, 2400);
  expect(notes(f)).toEqual([HOLD_NOTE]);
  // No further report arrives: the floor timer, not the next poll, gives Sam the turn.
  await waitFor(() => notes(f).length === 2);
  expect(notes(f)[1]).toEndWith(TURN_NOTE);
  await heard(f, 0);
  expect(notes(f)[2]).toBe(CANCEL_NOTE);
  await f.session.fetch(request('end'));
  await settle(f);
  const records = JSON.parse(f.interviewRow()!.interventions_json).filter((record: { source: string }) => record.source === 'note');
  expect(records.map((record: { kind: string; handover?: boolean }) => [record.kind, record.handover ?? false]).filter(([kind]: [string]) => kind !== 'list' && kind !== 'map'))
    .toEqual([['hold', false], ['turn', true], ['cancel', false]]);
  expect(records.find((record: { kind: string }) => record.kind === 'turn').quietMs).toBeGreaterThanOrEqual(2500);
  expect(provenance(f).listening).toMatchObject({ mode: 'quiet', holds: 1, handovers: 1, cancels: 1 });
});

test('a pause in the session clears the floor timer, and the resumed session waits for new speech', async () => {
  const f = await live();
  await heard(f, 0);
  await heard(f, 2000);
  expect(notes(f)).toEqual([HOLD_NOTE]);
  f.socket.emit({ type: 'session.closed', reason: 'connection_lost', usage: { seconds: 30 } });
  await settle(f);
  await resume(f);
  const restated = notes(f).length;
  await new Promise(resolve => setTimeout(resolve, 800));
  expect(notes(f).slice(restated).some(note => String(note).endsWith(TURN_NOTE))).toBe(false);
  await f.session.fetch(request('end'));
});

test('an interview saved before the listening hold keeps the earlier turn-taking after a restart', async () => {
  const f = await live();
  const replacement = await restart(f, checkpoint => { delete checkpoint.snapshot.interview.listening; });
  expect((await poll(replacement)).interview).not.toHaveProperty('listening');
  await resume(replacement);
  expect(replacement.created[0]).not.toHaveProperty('listening');
  await heard(replacement, 0);
  await heard(replacement, 2000);
  expect(notes(replacement)).not.toContain(HOLD_NOTE);
  await replacement.session.fetch(request('end'));
  await settle(replacement);
  expect(provenance(replacement)).not.toHaveProperty('listening');
  await f.session.fetch(request('end'));
});

test('an interview saved while a short acknowledgment could be chosen resumes with quiet listening', async () => {
  const f = await live();
  const replacement = await restart(f, checkpoint => { checkpoint.snapshot.interview.listening = 'ack'; });
  expect((await poll(replacement)).interview.listening).toBe('quiet');
  await resume(replacement);
  expect(replacement.created[0]).toMatchObject({ listening: true });
  await heard(replacement, 0);
  await heard(replacement, 400);
  expect(notes(replacement).at(-1)).toBe(HOLD_NOTE);
  await replacement.session.fetch(request('end'));
  await f.session.fetch(request('end'));
});
