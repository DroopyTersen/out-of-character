import { afterEach, expect, setSystemTime, test } from 'bun:test';
import { emptyInterviewReadings } from '../../../core/interview';
import { emptyMap, type ConversationMap } from '../../../interview-engine/interview/conversation/map';
import { NOTE_HEADERS } from '../../../interview-engine/interview/conversation/notes';
import { threadKey } from '../../../interview-engine/interview/conversation/ranking';
import { PRODUCER_VERSION, type ResearchRequest } from '../../../interview-engine/interview/conversation/records';
import type { SessionServices } from '../../../interview-engine/interview/interview.server';
import { toPassage } from '../../../interview-engine/interview/wire';
import type { Narrative } from '../../../interview-engine/narrative/narrative.server';
import type { Passage } from '../../../interview-engine/shared/transcript';
import { interviewAttempt, narrated, objectFixture } from './durableObjectFixture';
import { activityPoll, capability, request, settle, waitFor } from '../simulator/session-fixture';

// Ported from the practice simulator's session tests when its interview branches were removed (Phase 5).
afterEach(() => setSystemTime());

const fixtureUsage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
/** Jev finds every participant turn new to the map, so each one wakes Sol once the floor allows. */
const novelTurn: SessionServices['evaluateTurn'] = async input => ({
  reading: { passageId: input.transcript.at(-1)!.id, atMs: input.atMs, focus: null, keys: Object.fromEntries(input.map.threads.map(thread => [thread.id, threadKey(thread)])), natural: Object.fromEntries(input.map.threads.map(thread => [thread.id, .8])), states: {}, novel: .9 },
  model: 'fixture', durationMs: 1, usage: fixtureUsage, answers: {},
});
const solMap = (): ConversationMap => ({
  ...emptyMap(), participant: { vantage: 'PRIVATE VANTAGE: led the 3DEP integration', preferences: [] },
  entities: [{ id: 'e1', kind: 'product', label: '3DEP integration', detail: 'Built by the participant’s team.', source: 'participant', passageId: 'p1' }],
  threads: [{ id: 't1', label: 'Integration team', anchors: ['e1'], unknown: 'PRIVATE UNKNOWN: who else worked on it', guess: 'a small team', related: [], topics: [], status: 'open', reason: null }],
  nextIds: { e: 2, r: 1, t: 2 },
});
const mapped = (map: ConversationMap, research: ResearchRequest | null = null) => ({
  map, update: { vantage: null, preferences: null, entities: [], edges: [], threads: [], revise: [], close: [], drop: [] },
  changes: { added: [...map.entities, ...map.threads].map(item => item.id), changed: [], dropped: [], kept: [] }, research, model: 'gpt-6.1-sol', usage: { inputTokens: 1, outputTokens: 1 },
});
const noteEvents = (sent: Record<string, unknown>[], kind?: keyof typeof NOTE_HEADERS) =>
  sent.filter(event => String(event.event_id).startsWith('note-') && (!kind || String(event.content).startsWith(NOTE_HEADERS[kind])));
const nextTick = () => new Promise(resolve => setTimeout(resolve, 600));

test('settled answers drive private optional notes without gating Sam’s turns', async () => {
  const turns: string[] = [];
  const maps: Parameters<SessionServices['generateMap']>[0][] = [];
  let summarized = '';
  const f = await objectFixture({ overrides: {
    evaluateTurn: async input => { turns.push(input.transcript.at(-1)!.id); return novelTurn(input); },
    generateMap: async input => { maps.push(input); return mapped(solMap()); },
    narrate: input => { summarized = JSON.stringify(input.passages); return narrated('The participant led an integration.'); },
  } });
  const epoch = 1_800_000_000_000;
  setSystemTime(epoch);
  try {
    await f.session.fetch(request('start', capability, interviewAttempt));
    await f.session.fetch(request('ready'));
    expect(maps).toHaveLength(0);
    f.socket.emit({ type: 'session.input_transcript.delta', delta: 'I led the 3DEP integration.', start_ms: 0, end_ms: 1000 });
    await nextTick();
    expect(turns).toEqual([]);
    setSystemTime(epoch + 2000);
    await waitFor(() => turns.length === 1);
    expect(maps).toHaveLength(0);
    expect(noteEvents(f.socket.sent)).toEqual([]);
    setSystemTime(epoch + 20_500);
    await waitFor(() => noteEvents(f.socket.sent).length === 2);
    expect(maps).toHaveLength(1);
    expect(maps[0]!.passages.map(entry => entry.id)).toEqual(['p1']);
    const notes = noteEvents(f.socket.sent);
    expect(notes.every(event => event.type === 'session.thinking.append')).toBe(true);
    expect(String(notes[0]!.content)).toContain('PRIVATE VANTAGE');
    expect(String(notes[1]!.content)).toContain('PRIVATE UNKNOWN');
    expect(notes.every(event => !String(event.content).includes('Turn note:'))).toBe(true);
    for (const note of notes) f.socket.emit({ type: 'session.thinking.appended', client_event_id: note.event_id, start_ms: 2000, end_ms: 2400 });
    setSystemTime(epoch + 22_000);
    f.socket.emit({ type: 'session.output_transcript.delta', delta: 'Who else worked on it?', start_ms: 21_000, end_ms: 22_000 });
    f.socket.emit({ type: 'session.input_transcript.delta', delta: 'Priya ran the data pipeline.', start_ms: 23_000, end_ms: 24_000 });
    setSystemTime(epoch + 26_000);
    await waitFor(() => turns.includes('p3'));
    expect(noteEvents(f.socket.sent)).toHaveLength(2);
    const snapshot = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
    expect(snapshot.coaching).toBeNull();
    expect(snapshot.evaluation).toBeNull();
    expect(snapshot.interview.evaluation).toBeDefined();
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE');
    await f.session.fetch(request('end'));
    await (await f.session.fetch(request('report'))).text();
    await Promise.all(f.pending);
    const row = f.interviewRow()!;
    const records = JSON.parse(row.interventions_json) as Record<string, any>[];
    expect(records.filter(record => record.source === 'map')).toMatchObject([{ outcome: 'applied', inputCount: 1, lastInputId: 'p1' }]);
    expect(records.filter(record => record.source === 'note').map(record => record.delivery.status)).toEqual(['accepted', 'accepted']);
    expect(records.filter(record => record.source === 'turn').map(record => record.passageId)).toEqual(['p1', 'p1', 'p3']);
    expect(JSON.parse(row.provenance_json).contextualDirector).toMatchObject({ version: PRODUCER_VERSION, maps: 1, applied: 1, turns: 3, notes: 2, research: 0 });
    expect(summarized).not.toContain('PRIVATE');
    expect(JSON.parse(summarized)).toEqual(snapshot.transcript.map(toPassage));
    expect(f.row()).toBeNull();
  } finally { await f.session.fetch(request('end')); }
}, 10_000);

test('long interview silence never creates an automatic turn instruction', async () => {
  const f = await objectFixture();
  const epoch = 1_800_000_000_000;
  setSystemTime(epoch);
  try {
    await f.session.fetch(request('start', capability, interviewAttempt));
    await f.session.fetch(request('ready'));
    f.socket.emit({ type: 'session.input_transcript.delta', delta: 'We fixed the release guide.', start_ms: 0, end_ms: 1000 });
    f.socket.emit({ type: 'session.output_transcript.delta', delta: 'That helped the next release.', start_ms: 1000, end_ms: 2000 });
    for (const elapsed of [15_000, 30_000, 45_000, 60_000]) {
      setSystemTime(epoch + elapsed);
      await f.session.fetch(activityPoll(false));
      await new Promise(resolve => setTimeout(resolve, 600));
    }
    expect(f.socket.sent.filter(event => event.type === 'session.instructions.append').map(event => event.event_id)).toEqual(['opening']);
    await f.session.fetch(request('end'));
    await Promise.all(f.pending);
    const records = JSON.parse(f.interviewRow()!.interventions_json);
    expect(records.some((item: { source: string }) => item.source === 'continuity')).toBe(false);
  } finally { await f.session.fetch(request('end')); }
}, 10_000);

test('the private archive keeps consecutive probability changes, failed grades, and the final result', async () => {
  let calls = 0;
  const f = await objectFixture({ overrides: { evaluate: async input => {
    calls++;
    if (calls === 3) throw new Error('Synthetic evaluation failure');
    const probability = calls === 1 ? .9 : .92;
    return { revision: input.revision, readings: emptyInterviewReadings(), model: 'fixture', durationMs: 1,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, answers: {}, objectives: [{
        id: 'project-delivery', level: 'explored', achieved: true, probability,
        levels: { 'not-yet': 0, touched: 1 - probability, explored: probability, 'set-aside': 0 },
        evidence: { entryId: 'p1', speaker: 'trainee', text: 'We built a booking portal.' },
      }] };
  } } });
  const epoch = 1_800_000_000_000;
  setSystemTime(epoch);
  try {
    await f.session.fetch(request('start', capability, interviewAttempt));
    await f.session.fetch(request('ready'));
    for (let index = 0; index < 3; index++) {
      setSystemTime(epoch + index * 6000);
      f.socket.emit({ type: 'session.input_transcript.delta', delta: index ? 'I owned the import job.' : 'We built a booking portal.', start_ms: index * 6000, end_ms: index * 6000 + 1000 });
      setSystemTime(epoch + index * 6000 + 2000);
      await f.session.fetch(request('poll'));
      await waitFor(() => calls === index + 1);
      await Promise.all(f.pending);
    }
    await f.session.fetch(request('end'));
    await Promise.all(f.pending);
    const records = JSON.parse(f.interviewRow()!.interventions_json).filter((item: { source: string }) => item.source === 'grade');
    expect(records.map((item: { outcome: string }) => item.outcome)).toEqual(['graded', 'graded', 'evaluation_error', 'graded']);
    expect(records[0].objectives[0].levels).toEqual([0, .1, .9, 0]);
    expect(records[1].objectives[0].levels).toEqual([0, .08, .92, 0]);
    expect(records[1].objectives[0].shown).toEqual(records[0].objectives[0].shown);
    expect(records[3].final).toBe(true);
  } finally { await f.session.fetch(request('end')); }
}, 10_000);

test.each(['accepted', 'rejected'] as const)('a private note receipt %s is archived and rejection retries without a turn instruction', async receipt => {
  const f = await objectFixture({ overrides: { evaluateTurn: novelTurn, generateMap: async () => mapped(solMap()) } });
  const epoch = 1_800_000_000_000;
  setSystemTime(epoch);
  try {
    await f.session.fetch(request('start', capability, interviewAttempt)); await f.session.fetch(request('ready'));
    f.socket.emit({ type: 'session.input_transcript.delta', delta: 'I led the 3DEP integration.', start_ms: 0, end_ms: 1000 });
    setSystemTime(epoch + 20_500);
    await waitFor(() => noteEvents(f.socket.sent, 'list').length === 1);
    const first = noteEvents(f.socket.sent, 'list')[0]!;
    f.socket.emit(receipt === 'accepted'
      ? { type: 'session.thinking.appended', client_event_id: first.event_id, start_ms: 2000, end_ms: 2400 }
      : { type: 'error', error: { client_event_id: first.event_id } });
    expect((await (await f.session.fetch(request('poll'))).json() as Record<string, any>).message).toBeNull();
    await nextTick();
    const lists = noteEvents(f.socket.sent, 'list');
    expect(lists).toHaveLength(receipt === 'accepted' ? 1 : 2);
    if (receipt === 'rejected') expect(lists[1]!.content).toBe(first.content);
    expect(lists.every(event => !String(event.content).includes('Turn note:'))).toBe(true);
    await f.session.fetch(request('end')); await Promise.all(f.pending);
    const notes = JSON.parse(f.interviewRow()!.interventions_json).filter((item: { source: string; kind?: string }) => item.source === 'note' && item.kind === 'list');
    expect(notes[0]).toMatchObject({ outcome: receipt === 'accepted' ? 'sent' : 'rejected', delivery: { status: receipt, ...(receipt === 'accepted' ? { startMs: 2000, endMs: 2400 } : {}) } });
    expect(notes).toHaveLength(lists.length);
  } finally { await f.session.fetch(request('end')); }
}, 10_000);

test('End freezes an unfinished Sol call without delaying its summary', async () => {
  let release: (() => void) | undefined;
  const f = await objectFixture({ overrides: {
    evaluateTurn: novelTurn,
    generateMap: async () => { await new Promise<void>(resolve => { release = resolve; }); return mapped(solMap()); },
  } });
  setSystemTime(1_800_000_000_000);
  await f.session.fetch(request('start', capability, interviewAttempt)); await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'The access handoff took three weeks.', start_ms: 100, end_ms: 900 });
  setSystemTime(1_800_000_020_500);
  await waitFor(() => !!release);
  await f.session.fetch(request('end'));
  await (await f.session.fetch(request('report'))).text();
  await waitFor(() => f.interviewRow()?.summary_status === 'ready');
  const archived = f.interviewRow()!;
  expect(JSON.parse(archived.interventions_json).find((row: { source: string }) => row.source === 'map').outcome).toBe('aborted');
  release!(); await Promise.all(f.pending);
  expect(f.interviewRow()).toEqual(archived);
  expect(noteEvents(f.socket.sent)).toHaveLength(0);
}, 10_000);
