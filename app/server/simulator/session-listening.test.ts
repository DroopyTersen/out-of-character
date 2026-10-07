import { afterEach, expect, setSystemTime, test } from 'bun:test';
import { CANCEL_NOTE, HOLD_NOTES, TURN_NOTE } from '../../../core/interview-notes';
import { attempt, capability, fixture, request, settle, waitFor } from './session-fixture';

// The listening mode across real session ownership; only the provider and paid judges are substituted.
afterEach(() => setSystemTime());
const interviewAttempt = { ...attempt, scenarioId: 'project-closeout', clientId: 'sam-cedar' };
type Fixture = Awaited<ReturnType<typeof fixture>>;
const read = async (response: Response | Promise<Response>) => (await response).json() as Promise<Record<string, any>>;
const poll = (f: Fixture) => read(f.session.fetch(request('poll')));
/** A browser report with Sam silent and the participant's microphone quiet for `inputQuietMs`. */
const heard = (f: Fixture, inputQuietMs: number) => f.session.fetch(new Request('https://session/poll', { method: 'POST', headers: { Authorization: capability },
  body: JSON.stringify({ active: inputQuietMs < 300, audio: false, outputQuietMs: 60_000, inputQuietMs }) }));
const notes = (f: Fixture) => f.socket.sent.filter(event => String(event.event_id).startsWith('note-')).map(event => event.content);
async function live(input: typeof interviewAttempt & { listening?: string }) {
  const f = await fixture();
  await f.session.fetch(request('start', capability, input));
  await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.output_transcript.delta', event_id: 'out-1', delta: 'Who owns the site today?', start_ms: 0, end_ms: 1200 });
  f.socket.emit({ type: 'session.input_transcript.delta', event_id: 'in-1', delta: 'Our team does, since the vendor handed it over last spring.', start_ms: 1500, end_ms: 4000 });
  return f;
}
const resume = async (f: Fixture) => {
  expect((await f.session.fetch(new Request('https://session/resume', { method: 'POST', headers: { Authorization: capability }, body: JSON.stringify({ sdp: 'v=0\r\no=fixture-resume\r\n' }) }))).status).toBe(200);
  await f.session.fetch(request('ready'));
};
const provenance = (f: Fixture) => JSON.parse(f.interviewRow()!.provenance_json).contextualDirector;

test('the chosen listening mode reaches every provider session and the interview diagnostics, through resume and restart', async () => {
  const f = await live({ ...interviewAttempt, listening: 'ack' });
  expect(f.created[0]).toEqual({ listening: 'ack' });
  expect((await poll(f)).interview.listening).toBe('ack');
  f.socket.emit({ type: 'session.closed', reason: 'connection_lost', usage: { seconds: 30 } });
  await settle(f);
  await resume(f);
  expect(f.created[1]).toMatchObject({ listening: 'ack', context: expect.stringContaining('Our team does') });
  setSystemTime(Date.now() + 30_000);
  // The periodic check saves the checkpoint a replacement owner restores.
  await f.session.alarm();
  await settle(f);
  const replacement = await fixture({ values: f.values, archive: f.archive, provider: 'replacement' });
  expect(await poll(replacement)).toMatchObject({ status: 'paused', interview: { listening: 'ack' } });
  await resume(replacement);
  expect(replacement.created[0]).toMatchObject({ listening: 'ack' });
  await replacement.session.fetch(request('end'));
  await settle(replacement);
  expect(provenance(replacement).listening).toMatchObject({ mode: 'ack', windowMs: 1000, holdAfterMs: 300, holds: 0, handovers: 0, cancels: 0 });
  await f.session.fetch(request('end')); // Stop the original owner's timer.
});

test('the session’s own timer hands Sam the turn after the window, and resumed speech cancels it', async () => {
  const f = await live({ ...interviewAttempt, listening: 'ack' });
  await heard(f, 0);
  await heard(f, 400);
  expect(notes(f)).toEqual([HOLD_NOTES.ack]);
  // No further report arrives: the floor timer, not the next poll, gives Sam the turn.
  await waitFor(() => notes(f).length === 2);
  expect(notes(f)[1]).toBe(TURN_NOTE);
  await heard(f, 0);
  expect(notes(f)).toEqual([HOLD_NOTES.ack, TURN_NOTE, CANCEL_NOTE]);
  await f.session.fetch(request('end'));
  await settle(f);
  const records = JSON.parse(f.interviewRow()!.interventions_json).filter((record: { source: string }) => record.source === 'note');
  expect(records.map((record: { kind: string; handover?: boolean }) => [record.kind, record.handover ?? false])).toEqual([['hold', false], ['turn', true], ['cancel', false]]);
  expect(records[1].quietMs).toBeGreaterThanOrEqual(1000);
  expect(provenance(f).listening).toMatchObject({ mode: 'ack', holds: 1, handovers: 1, cancels: 1 });
});

test('a pause in the session clears the floor timer, and the resumed session waits for new speech', async () => {
  const f = await live({ ...interviewAttempt, listening: 'ack' });
  await heard(f, 0);
  await heard(f, 400);
  expect(notes(f)).toEqual([HOLD_NOTES.ack]);
  f.socket.emit({ type: 'session.closed', reason: 'connection_lost', usage: { seconds: 30 } });
  await settle(f);
  await resume(f);
  const restated = notes(f).length;
  await new Promise(resolve => setTimeout(resolve, 1300));
  expect(notes(f).slice(restated)).not.toContain(TURN_NOTE);
  await f.session.fetch(request('end'));
});

test('an interview started without a mode keeps the earlier turn-taking', async () => {
  const f = await live(interviewAttempt);
  expect(f.created[0]).toEqual({});
  expect((await poll(f)).interview).not.toHaveProperty('listening');
  await heard(f, 0);
  await heard(f, 2000);
  expect(notes(f)).toEqual([]);
  await f.session.fetch(request('end'));
  await settle(f);
  expect(provenance(f)).not.toHaveProperty('listening');
});
