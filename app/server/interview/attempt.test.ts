import { afterEach, expect, setSystemTime, test } from 'bun:test';
import { emptyInterviewReadings } from '../../../core/interview';
import { emptyMap, type ConversationMap } from '../../../interview-engine/interview/conversation/map';
import { CANCEL_NOTE, HOLD_NOTE, NOTE_HEADERS, TURN_NOTE } from '../../../interview-engine/interview/conversation/notes';
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
  reading: { passageId: input.transcript.at(-1)!.id, atMs: input.atMs, focus: null, keys: {}, natural: {}, states: {}, novel: .9 },
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
  changes: { added: [...map.entities, ...map.threads].map(item => item.id), changed: [], dropped: [], kept: [] }, research, pace: { verdict: 'explore' as const, reason: 'Open threads remain.' }, model: 'gpt-6.1-sol', usage: { inputTokens: 1, outputTokens: 1 },
});
const listening = [HOLD_NOTE, TURN_NOTE, CANCEL_NOTE];
/** Events carrying a thread or map note, alone or handed over with the turn note. */
const noteEvents = (sent: Record<string, unknown>[], kind?: keyof typeof NOTE_HEADERS) =>
  sent.filter(event => String(event.event_id).startsWith('note-') && !listening.includes(String(event.content)) && (!kind || String(event.content).startsWith(NOTE_HEADERS[kind])));
/** Turn-taking notes sent on their own. */
const turnNotes = (sent: Record<string, unknown>[]) => sent.filter(event => String(event.event_id).startsWith('note-') && listening.includes(String(event.content))).map(event => event.content);
const nextTick = () => new Promise(resolve => setTimeout(resolve, 600));

test('the producer reads settled participant turns, maps after its floor, and keeps its notes to Sam private', async () => {
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
    f.socket.emit({ type: 'session.input_transcript.delta', delta: 'I led the 3DEP integration.', start_ms: 0, end_ms: 1000 });
    await nextTick();
    expect(turns).toEqual([]); // Still being transcribed.
    setSystemTime(epoch + 2000);
    await waitFor(() => turns.length === 1);
    await nextTick();
    expect(maps).toHaveLength(0); // Jev's wake waits for Sol's floor.
    // Read and quiet, the answer got its turn note before Sol had mapped anything.
    expect(turnNotes(f.socket.sent)).toEqual([HOLD_NOTE, TURN_NOTE]);
    setSystemTime(epoch + 20_500);
    await waitFor(() => maps.length === 1);
    await settle(f);
    setSystemTime(epoch + 22_000);
    f.socket.emit({ type: 'session.output_transcript.delta', delta: 'Who else worked on it?', start_ms: 21_000, end_ms: 22_000 });
    await nextTick();
    expect(noteEvents(f.socket.sent)).toHaveLength(0); // Held for the next turn boundary, not sent into Sam's question.
    setSystemTime(epoch + 23_000);
    f.socket.emit({ type: 'session.input_transcript.delta', delta: 'Priya ran the data pipeline.', start_ms: 23_000, end_ms: 24_000 });
    setSystemTime(epoch + 26_000);
    await waitFor(() => noteEvents(f.socket.sent).length === 1);
    await waitFor(() => turns.length === 2); // The second answer is read after the notes went out with its first words.
    expect(maps).toHaveLength(1);
    expect(maps[0]!.attemptId).toBe(interviewAttempt.id);
    expect(maps[0]!.passages.map(entry => entry.id)).toEqual(['p1']);
    expect(maps[0]!.tail.reasons).toHaveLength(1);
    expect(maps[0]!.tail.reasons[0]).toContain('(p1)');
    // Sam asked on its own, so one event at the participant's next words: the thread note first, the map, then the hold note.
    const [handed] = noteEvents(f.socket.sent);
    const content = String(handed!.content);
    expect(handed).toMatchObject({ type: 'session.thinking.append', delegation_id: null });
    expect(content.startsWith(NOTE_HEADERS.list)).toBe(true);
    expect(content).toMatch(/PRIVATE UNKNOWN[^]*PRIVATE VANTAGE/);
    expect(content).toEndWith(HOLD_NOTE);
    expect(turnNotes(f.socket.sent)).toEqual([HOLD_NOTE, TURN_NOTE, TURN_NOTE]); // The second answer’s own handover followed its reading.
    f.socket.emit({ type: 'session.output_transcript.delta', delta: 'What did Priya hand over?', start_ms: 26_000, end_ms: 27_000 });
    // Notes are never instructions; Sam's silence after the participant spoke drew the greeting once more.
    expect(f.socket.sent.filter(event => event.type === 'session.instructions.append').map(event => event.event_id)).toEqual(['opening', 'opening-again']);
    f.socket.emit({ type: 'session.thinking.appended', client_event_id: handed!.event_id, start_ms: 2000, end_ms: 2400 });
    const snapshot = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
    expect(snapshot.coaching).toBeNull();
    expect(snapshot.evaluation).toBeNull();
    expect(snapshot.interview.evaluation).toBeDefined();
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE');
    await f.session.fetch(request('end'));
    await (await f.session.fetch(request('report'))).text();
    await Promise.all(f.pending);
    const row = f.interviewRow()!;
    const records = JSON.parse(row.interventions_json).filter((record: { source: string; kind?: string }) => record.source !== 'grade' && !['hold', 'turn', 'cancel'].includes(record.kind!));
    expect(records.map((record: { source: string }) => record.source)).toEqual(['turn', 'map', 'traits', 'note', 'note', 'turn']);
    expect(records[0]).toMatchObject({ passageId: 'p1', outcome: 'read', reading: { novel: .9 } });
    expect(records[1]).toMatchObject({ outcome: 'applied', inputCount: 1, lastInputId: 'p1', changes: { added: ['e1', 't1'] } });
    // Both notes were decided at Sol's map, after the first handover, and held past Sam's question until the participant spoke again.
    const delivery = { eventId: handed!.event_id, status: 'accepted', startMs: 2000, endMs: 2400 };
    expect(records[3]).toMatchObject({ kind: 'list', outcome: 'sent', mapId: records[1].id, nextSamTurnAfterId: 'p3', sentAt: epoch + 23_000, delivery });
    expect(records[4]).toMatchObject({ kind: 'map', outcome: 'sent', sentAt: epoch + 23_000, decidedAt: epoch + 20_500, delivery });
    expect(JSON.parse(row.cues_json)).toEqual([]);
    expect(JSON.parse(row.provenance_json).contextualDirector).toMatchObject({ version: PRODUCER_VERSION, effort: 'low', maps: 1, applied: 1, turns: 2, notes: 2, research: 0 });
    expect(summarized).not.toContain('PRIVATE');
    expect(summarized).not.toContain('interventions');
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

test.each(['accepted', 'rejected'] as const)('interview research %s reaches Sam only in a map note and cannot grade or summarize the participant', async receipt => {
  let participantInput = '', summaryInput = '';
  const lookups: Record<string, unknown>[] = [];
  const maps: Parameters<SessionServices['generateMap']>[0][] = [];
  const fact = { text: 'PUBLIC BACKGROUND FACT', url: 'https://www.usgs.gov/3d-elevation-program', title: 'USGS 3DEP' };
  const f = await objectFixture({ overrides: {
    evaluateTurn: novelTurn,
    evaluate: async input => { participantInput = JSON.stringify(input); return { revision: input.revision, readings: emptyInterviewReadings(), objectives: [], model: 'fixture', durationMs: 1, usage: fixtureUsage, answers: {} }; },
    // Sol asks for a lookup, then files what came back as public background.
    generateMap: async input => {
      maps.push(input);
      return maps.length === 1 ? mapped(input.previous, { kind: 'term', name: '3DEP', clue: null, passageIds: ['p1'] })
        : mapped({ ...input.previous, entities: [{ id: 'e1', kind: 'term', label: '3DEP', detail: fact.text, source: 'research', passageId: 'L1' }], nextIds: { e: 2, r: 1, t: 1 } });
    },
    lookupInterviewBackground: async input => { lookups.push(input); return { status: 'found', facts: [fact], retrievedAt: Date.now(), queries: ['PRIVATE ARCHIVE QUERY'] }; },
    narrate: input => { summaryInput = JSON.stringify(input.passages); return narrated('The participant led an integration.'); },
  } });
  const epoch = 1_800_000_000_000;
  setSystemTime(epoch);
  await f.session.fetch(request('start', capability, interviewAttempt)); await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'I led the 3DEP integration.', start_ms: 0, end_ms: 1000 });
  setSystemTime(epoch + 20_500);
  // Audio the browser hears keeps the silent-greeting watchdog from replacing the voice session.
  await f.session.fetch(activityPoll(false, true));
  await waitFor(() => lookups.length === 1);
  expect(lookups).toEqual([{ target: { kind: 'term', name: '3DEP' }, clue: null, model: 'gpt-6-luna', signal: expect.any(AbortSignal) }]);
  await Promise.all(f.pending);
  expect(noteEvents(f.socket.sent)).toHaveLength(0);
  // The found lookup wakes Sol, which reads it in its log before Sam hears of it.
  setSystemTime(epoch + 41_000);
  await f.session.fetch(activityPoll(false, true));
  await waitFor(() => maps.length === 2);
  await settle(f);
  f.socket.emit({ type: 'session.output_transcript.delta', delta: 'Who else worked on it?', start_ms: 41_000, end_ms: 42_000 });
  await settle(f);
  expect(noteEvents(f.socket.sent)).toHaveLength(0); // Held past Sam's question for the next handover.
  setSystemTime(epoch + 43_000);
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'Priya ran the data pipeline.', start_ms: 43_000, end_ms: 44_000 });
  setSystemTime(epoch + 46_000);
  await waitFor(() => noteEvents(f.socket.sent).length === 1);
  expect(maps[1]!.blocks.join('\n')).toContain('PUBLIC BACKGROUND FACT');
  const note = noteEvents(f.socket.sent, 'map')[0]!;
  expect(note).toMatchObject({ type: 'session.thinking.append', delegation_id: null, content: expect.stringContaining('\nPublic background') });
  const before = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
  expect(before.interview.background).toEqual([]);
  f.socket.emit(receipt === 'accepted' ? { type: 'session.thinking.appended', client_event_id: note.event_id } : { type: 'error', error: { client_event_id: note.event_id } });
  const current = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
  expect(current.interview.background).toHaveLength(receipt === 'accepted' ? 1 : 0);
  expect(current.message).toBeNull();
  expect(JSON.stringify(current)).not.toContain('PRIVATE ARCHIVE QUERY');
  expect(current.interview.evaluation.objectives.filter((item: { achieved: boolean }) => item.achieved)).toEqual([]);
  await f.session.fetch(request('end'));
  await (await f.session.fetch(request('report'))).text(); await Promise.all(f.pending);
  expect(participantInput).not.toContain('PUBLIC BACKGROUND FACT');
  expect(summaryInput).not.toContain('PUBLIC BACKGROUND FACT');
  const records = JSON.parse(f.interviewRow()!.interventions_json);
  const research = records.find((item: any) => item.source === 'research');
  expect(research).toMatchObject({ outcome: 'found', facts: [fact], queries: ['PRIVATE ARCHIVE QUERY'], loggedAt: epoch + 41_000 });
  expect(records.find((item: any) => item.source === 'note' && item.kind === 'map')).toMatchObject({
    kind: 'map', outcome: receipt === 'accepted' ? 'sent' : 'rejected', delivery: { status: receipt }, researchIds: [research.id],
  });
  expect(f.row()).toBeNull();
}, 10_000);

test('interview End re-grades coverage over the whole interview and returns pending before one summary completes', async () => {
  const summaryUsage = { inputTokens: 43, outputTokens: 17, reasoningTokens: 9, cachedTokens: 11 };
  let releaseSummary: ((text: string) => void) | undefined;
  const summarized: Passage[][] = [];
  const interviewJudged: { transcript: { speaker: string; text: string }[] }[] = [];
  const f = await objectFixture({ overrides: {
    evaluate: async input => {
      interviewJudged.push({ transcript: input.transcript });
      const passage = input.transcript[0]!;
      const evidence = { entryId: passage.id, speaker: passage.speaker, text: passage.text };
      // The final re-grade sees the whole interview and may withdraw a live checkmark.
      const reading = interviewJudged.length === 1
        ? { level: 'explored' as const, levels: { 'not-yet': .01, touched: .03, explored: .95, 'set-aside': .01 }, achieved: true, probability: .95 }
        : { level: 'touched' as const, levels: { 'not-yet': .1, touched: .7, explored: .15, 'set-aside': .05 }, achieved: false, probability: .15 };
      return {
        revision: input.revision, readings: emptyInterviewReadings(), objectives: [{ id: 'project-delivery', ...reading, evidence }],
        model: 'fixture', durationMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, answers: {},
      };
    },
    narrate: input => {
      summarized.push(input.passages);
      let done!: (result: Narrative) => void;
      const result = new Promise<Narrative>(resolve => { done = resolve; });
      return { stream: new ReadableStream({ start(controller) {
        controller.enqueue('{\"text\":');
        releaseSummary = text => { controller.enqueue(JSON.stringify(text) + '}'); done({ document: { text }, failure: null, usage: summaryUsage }); controller.close(); releaseSummary = undefined; };
      } }), result };
    },
  } });
  f.socket.holdClose = true;
  let ending: Promise<Response> | undefined;
  try {
    await f.session.fetch(request('start', capability, interviewAttempt));
    await f.session.fetch(request('ready'));
    f.socket.emit({ type: 'session.input_transcript.delta', delta: 'We built a permit intake portal.', start_ms: 100, end_ms: 900 });
    await waitFor(() => interviewJudged.length === 1);
    await Promise.all(f.pending);
    const live = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
    const covered = live.interview.evaluation.objectives.find((item: { id: string }) => item.id === 'project-delivery');
    expect(covered).toMatchObject({ level: 'explored', achieved: true, evidence: { speaker: 'trainee', text: 'We built a permit intake portal.' } });
    ending = f.session.fetch(request('end'));
    expect((await (await f.session.fetch(request('poll'))).json() as Record<string, any>).status).toBe('ending');
    f.socket.emit({ type: 'session.input_transcript.delta', delta: 'Jen resolved our access issue.', start_ms: 2000, end_ms: 2900 });
    f.socket.emit({ type: 'session.output_transcript.delta', delta: 'I heard that no one helped.', start_ms: 1000, end_ms: 1600 });
    await waitFor(() => f.socket.sent.some(event => event.type === 'session.close'));
    f.socket.emit({ type: 'session.closed', reason: 'close_requested' });

    const ended = await (await ending).json() as Record<string, any>;
    expect(ended.status).toBe('ended');
    expect(ended.finalization).toBe('confirmed');
    expect(ended.interview.summary).toEqual({ status: 'pending', text: null });
    expect(ended.evaluation).toBeNull();
    expect(ended.transcript.map((entry: { speaker: string }) => entry.speaker)).toEqual(['trainee', 'trainee']);
    expect(interviewJudged).toHaveLength(2);
    expect(interviewJudged[1]!.transcript.map(entry => entry.text)).toEqual(['We built a permit intake portal.', 'Jen resolved our access issue.']);
    const final = ended.interview.evaluation.objectives.find((item: { id: string }) => item.id === 'project-delivery');
    expect(final).toMatchObject({ level: 'touched', achieved: false, evidence: covered.evidence });
    await Promise.all(f.pending);
    expect(summarized).toHaveLength(0);
    expect((await f.session.fetch(request('report', `Bearer ${'b'.repeat(64)}`))).status).toBe(403);
    const response = await f.session.fetch(request('report'));
    const body = response.text();
    // A reloaded page rejoins the running narrative: what was written so far, then the rest, with no second run.
    const rejoined = (await f.session.fetch(request('report'))).text();
    expect(summarized).toHaveLength(1);
    expect(summarized[0]!.map(entry => entry.speaker)).toEqual(['participant', 'participant']);
    expect(f.interviewRow()).toMatchObject({ archive_state: 'final', summary_status: 'pending' });
    expect(JSON.parse(f.interviewRow()!.evaluation_json).objectives.find((item: { id: string }) => item.id === 'project-delivery')).toEqual(final);
    // Each grade's bands, probabilities and evidence IDs are archived privately, without passage text.
    const grades = JSON.parse(f.interviewRow()!.interventions_json).filter((item: { source: string }) => item.source === 'grade');
    expect(grades.map((item: Record<string, unknown>) => [item.final, item.outcome, item.inputCount])).toEqual([[false, 'graded', 1], [true, 'graded', 2]]);
    expect(grades[0].objectives).toEqual([{ id: 'project-delivery', shown: ['explored', covered.evidence.entryId], graded: ['explored', covered.evidence.entryId], levels: [.01, .03, .95, .01] }]);
    expect(grades[1].objectives).toEqual([{ id: 'project-delivery', shown: ['touched', covered.evidence.entryId], graded: ['touched', covered.evidence.entryId], levels: [.1, .7, .15, .05] }]);
    expect(JSON.stringify(grades)).not.toContain('permit intake');
    expect(JSON.stringify(ended)).not.toContain('"grade"');
    expect(f.row()).toBeNull();
    expect((await f.session.fetch(request('poll', `Bearer ${'b'.repeat(64)}`))).status).toBe(403);
    expect((await f.session.fetch(request('poll', ''))).status).toBe(401);

    expect(f.interviewRow()!.summary_text).toBeNull();
    releaseSummary!('The participant credited Jen with resolving the access issue.');
    expect(JSON.parse(await body)).toEqual({ text: 'The participant credited Jen with resolving the access issue.' });
    expect(await rejoined).toBe(await body);
    await Promise.all(f.pending);
    const ready = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
    expect(ready.interview.summary).toEqual({ status: 'ready', text: 'The participant credited Jen with resolving the access issue.' });
    expect(f.interviewRow()).toMatchObject({ summary_status: 'ready', summary_text: ready.interview.summary.text });
    const summaryDiagnostic = JSON.parse(f.interviewRow()!.provenance_json).interviewSummary;
    expect(summaryDiagnostic).toMatchObject({ model: 'gpt-6.1-sol', version: 'interview-summary-v1', attempts: [{ failure: null, usage: summaryUsage }] });
    expect(summaryDiagnostic.attempts[0].endedAt).toBeGreaterThanOrEqual(summaryDiagnostic.attempts[0].startedAt);
    expect(JSON.stringify(ready)).not.toContain('interviewSummary');
    expect(JSON.parse(f.interviewRow()!.transcript_json)).toEqual(ended.transcript);
    expect(f.row()).toBeNull();
  } finally {
    releaseSummary?.('Fallback summary.');
    f.socket.emit({ type: 'session.closed', reason: 'close_requested' });
    await ending;
  }
}, 10_000);

test('a failed interview summary remains unavailable while the participant transcript stays archived', async () => {
  const f = await objectFixture({ overrides: {
    narrate: () => { throw new Error('Provider contained private request data.'); },
  } });
  await f.session.fetch(request('start', capability, interviewAttempt));
  await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'We shipped the migration despite the handoff delay.', start_ms: 100, end_ms: 900 });
  await f.session.fetch(request('end'));
  await (await f.session.fetch(request('report'))).text();
  await Promise.all(f.pending);
  const snapshot = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
  expect(snapshot.interview.summary).toEqual({ status: 'unavailable', text: null });
  expect(f.interviewRow()).toMatchObject({ archive_state: 'final', summary_status: 'unavailable', summary_text: null });
  expect(JSON.parse(f.interviewRow()!.provenance_json).interviewSummary.attempts).toEqual([
    { startedAt: expect.any(Number), endedAt: expect.any(Number), failure: 'provider', usage: null },
  ]);
  expect(f.interviewRow()!.provenance_json).not.toContain('Provider contained');
  expect(JSON.parse(f.interviewRow()!.transcript_json)[0].text).toBe('We shipped the migration despite the handoff delay.');
  expect(JSON.stringify(snapshot)).not.toContain('Provider contained');
  expect(f.row()).toBeNull();
});

test.each(['accepted', 'rejected'] as const)('a list note receipt %s is archived, and a rejected note goes out again with the retried handover', async receipt => {
  let turns = 0, maps = 0;
  const f = await objectFixture({ overrides: {
    evaluateTurn: async input => { turns++; return novelTurn(input); },
    generateMap: async () => { maps++; return mapped(solMap()); },
  } });
  const epoch = 1_800_000_000_000;
  setSystemTime(epoch);
  await f.session.fetch(request('start', capability, interviewAttempt)); await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'I led the 3DEP integration.', start_ms: 0, end_ms: 1000 });
  setSystemTime(epoch + 20_500);
  await waitFor(() => maps === 1);
  await settle(f);
  // Sol mapped after the first answer was handed over, so its notes wait for the next one.
  setSystemTime(epoch + 22_000);
  f.socket.emit({ type: 'session.output_transcript.delta', delta: 'Who else worked on it?', start_ms: 21_000, end_ms: 22_000 });
  setSystemTime(epoch + 23_000);
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'Our lead coordinated it.', start_ms: 23_000, end_ms: 24_000 });
  setSystemTime(epoch + 26_000);
  await waitFor(() => noteEvents(f.socket.sent, 'list').length === 1);
  const first = noteEvents(f.socket.sent, 'list')[0]!;
  f.socket.emit(receipt === 'accepted'
    ? { type: 'session.thinking.appended', client_event_id: first.event_id, start_ms: 2000, end_ms: 2400 }
    : { type: 'error', error: { client_event_id: first.event_id } });
  expect((await (await f.session.fetch(request('poll'))).json() as Record<string, any>).message).toBeNull();
  f.socket.emit({ type: 'session.output_transcript.delta', delta: 'What did the lead own?', start_ms: 26_000, end_ms: 27_000 });
  setSystemTime(epoch + 28_000);
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'The cutover schedule.', start_ms: 28_000, end_ms: 29_000 });
  setSystemTime(epoch + 31_000);
  await waitFor(() => turns === 3);
  // Each answer was handed over; the rejected thread note rides with the next handover.
  await waitFor(() => f.socket.sent.filter(event => String(event.content).endsWith(TURN_NOTE)).length === 3);
  await settle(f);
  const lists = noteEvents(f.socket.sent, 'list');
  expect(lists).toHaveLength(receipt === 'accepted' ? 1 : 2);
  // The first delivery rode the hold note; the thread note goes out again with the turn, and the map note sent with it waits for its spacing.
  if (receipt === 'rejected') {
    const resent = String(lists[1]!.content);
    expect(resent).toEndWith(`\n\n${TURN_NOTE}`);
    expect(String(first.content).startsWith(`${resent.slice(0, -TURN_NOTE.length - 2)}\n\n${NOTE_HEADERS.map}`)).toBe(true);
  }
  await f.session.fetch(request('end'));
  await Promise.all(f.pending);
  const notes = JSON.parse(f.interviewRow()!.interventions_json).filter((item: { source: string; kind?: string }) => item.source === 'note' && item.kind === 'list');
  expect(notes[0]).toMatchObject({ outcome: receipt === 'accepted' ? 'sent' : 'rejected', delivery: { status: receipt, ...(receipt === 'accepted' ? { startMs: 2000, endMs: 2400 } : {}) } });
  expect(notes).toHaveLength(lists.length);
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
