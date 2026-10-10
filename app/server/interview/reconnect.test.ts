import { afterEach, expect, setSystemTime, test } from 'bun:test';
import { emptyMap, type ConversationMap } from '../../../interview-engine/interview/conversation/map';
import { NOTE_HEADERS } from '../../../interview-engine/interview/conversation/notes';
import { threadKey } from '../../../interview-engine/interview/conversation/ranking';
import { interviewAttempt, objectFixture } from './durableObjectFixture';
import { activityPoll, capability, request, settle, waitFor } from '../simulator/session-fixture';

// Pause and resume of an interview across real object ownership; only the provider and paid judges are substituted.
// Ported from the practice simulator's reconnect tests when its interview branches were removed (Phase 5).
afterEach(() => setSystemTime());
type Fixture = Awaited<ReturnType<typeof objectFixture>>;
const action = (name: string, body?: unknown) => new Request(`https://session/${name}`, { method: 'POST', headers: { Authorization: capability }, ...(body ? { body: JSON.stringify(body) } : {}) });
const resume = (f: Fixture) => f.session.fetch(action('resume', { sdp: 'v=0\r\no=fixture-resume\r\n' }));
const read = async (response: Response | Promise<Response>) => (await response).json() as Promise<Record<string, any>>;
const poll = (f: Fixture) => read(f.session.fetch(request('poll')));
async function live(options: Parameters<typeof objectFixture>[0] = {}) {
  const f = await objectFixture(options);
  await f.session.fetch(request('start', capability, interviewAttempt));
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

test('a resumed interview restates Sam’s notes to the new provider session', async () => {
  const epoch = 1_800_000_000_000;
  setSystemTime(epoch);
  const map: ConversationMap = {
    ...emptyMap(), participant: { vantage: 'Their team owns the site today.', preferences: [] },
    entities: [{ id: 'e1', kind: 'product', label: 'Site', detail: 'Owned by the participant’s team.', source: 'participant', passageId: 'p1' }],
    threads: [{ id: 't1', label: 'Site ownership', anchors: ['e1'], unknown: 'who owned the site before', guess: 'another team', related: [], topics: [], status: 'open', reason: null }],
    nextIds: { e: 2, r: 1, t: 2 },
  };
  let maps = 0;
  const f = await live({ overrides: {
    evaluateTurn: async input => ({ reading: { passageId: input.transcript.at(-1)!.id, atMs: input.atMs, focus: null, keys: Object.fromEntries(input.map.threads.map(thread => [thread.id, threadKey(thread)])), natural: Object.fromEntries(input.map.threads.map(thread => [thread.id, .8])), states: {}, novel: .9 }, model: 'fixture', durationMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, answers: {} }),
    generateMap: async () => { maps++; return { map, update: { vantage: null, preferences: null, entities: [], edges: [], threads: [], revise: [], close: [], drop: [] }, changes: { added: ['e1', 't1'], changed: [], dropped: [], kept: [] }, research: null, model: 'gpt-6.1-sol', usage: { inputTokens: 1, outputTokens: 1 } }; },
  } });
  const notes = (sent: Record<string, unknown>[]) => sent.filter(event => String(event.event_id).startsWith('note-')).map(event => String(event.content));
  setSystemTime(epoch + 20_500);
  // Sam's opening is still playing, so the silence watchdog stays out of it.
  await f.session.fetch(activityPoll(true, true));
  await waitFor(() => maps === 1);
  await settle(f);
  await waitFor(() => notes(f.socket.sent).some(note => note.startsWith(NOTE_HEADERS.list)));
  const delivered = notes(f.socket.sent);
  expect(delivered).toHaveLength(2);
  await lose(f);
  await reconnect(f);
  await waitFor(() => notes(f.socket.sent).length === 2);
  expect(notes(f.socket.sent).sort()).toEqual(delivered.sort());
  expect(f.socket.sent.map(event => String(event.event_id))).toContain('resume-2');
  await f.session.fetch(request('end'));
  await settle(f);
  expect(JSON.parse(f.interviewRow()!.interventions_json).filter((record: { source: string; kind: string }) => record.source === 'note' && ['list', 'map'].includes(record.kind))).toHaveLength(4);
});

test('a restarted interview keeps its coverage and summary state, stored inside the checkpoint snapshot', async () => {
  const f = await live();
  await lose(f);
  const before = await poll(f);
  expect(before).toMatchObject({ background: [] });
  expect(before).not.toHaveProperty('interview');
  // The stored shape is unchanged, so checkpoints saved before the interview state moved beside the snapshot still restore.
  const stored = (f.values.get('checkpoint') as { snapshot: Record<string, unknown> }).snapshot;
  expect(stored.interview).toEqual({ evaluation: before.evaluation, summary: null });
  expect(stored.interview).not.toHaveProperty('background');
  const replacement = await objectFixture({ values: f.values, archive: f.archive, provider: 'replacement' });
  const state = await poll(replacement);
  expect(state.evaluation).toEqual(before.evaluation);
  await reconnect(replacement);
  expect(await read(replacement.session.fetch(request('end')))).toMatchObject({ status: 'ended' });
  await settle(replacement);
  expect(replacement.interviewRow()).toMatchObject({ archive_state: 'final', summary_status: 'pending' });
  await f.session.fetch(request('end'));
});
