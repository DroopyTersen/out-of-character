import { afterEach, expect, setSystemTime, test } from 'bun:test';
import { emptyInterviewReadings } from '../../../core/interview';
import { emptySkills, SESSION_IDLE_TIMEOUT_MS, SESSION_IDLE_WARNING_MS, SESSION_LIMIT_SECONDS } from '../../../core/simulator/types';
import { emptyMap, type ConversationMap } from '../../../core/interview-map';
import { NOTE_HEADERS } from '../../../core/interview-notes';
import { PRODUCER_VERSION, type ResearchRequest } from '../../../core/interview-producer';
import type { producerServices } from './interview-producer';
import { TRANSCRIPT_LIMIT } from '../../../core/simulator/state';
import { LiveSessionGone } from './live.server';
import { parseArchive } from '../../../scripts/simulator-transcripts';

import { attempt, capability, request, activityPoll, fixture, settle, waitFor } from './session-fixture';
afterEach(() => setSystemTime());
const interviewAttempt = { ...attempt, scenarioId: 'project-closeout', clientId: 'sam-cedar' };
const fixtureUsage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
/** Jev finds every participant turn new to the map, so each one wakes Sol once the floor allows. */
const novelTurn: typeof producerServices.evaluateTurn = async input => ({
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
  changes: { added: [...map.entities, ...map.threads].map(item => item.id), changed: [], dropped: [], kept: [] }, research, model: 'gpt-6.1-sol', usage: { inputTokens: 1, outputTokens: 1 },
});
const noteEvents = (sent: Record<string, unknown>[], kind?: keyof typeof NOTE_HEADERS) =>
  sent.filter(event => String(event.event_id).startsWith('note-') && (!kind || String(event.content).startsWith(NOTE_HEADERS[kind])));
const nextTick = () => new Promise(resolve => setTimeout(resolve, 600));

test('the producer reads settled participant turns, maps after its floor, and keeps its notes to Sam private', async () => {
  const turns: string[] = [];
  const maps: Parameters<typeof producerServices.generateMap>[0][] = [];
  let summarized = '';
  const f = await fixture({ overrides: {
    evaluateTurn: async input => { turns.push(input.transcript.at(-1)!.id); return novelTurn(input); },
    generateMap: async input => { maps.push(input); return mapped(solMap()); },
    summarizeInterview: (input, done) => { summarized = JSON.stringify(input); return new ReadableStream({ start(controller) {
      const report = { text: 'The participant led an integration.' }; controller.enqueue(JSON.stringify(report)); done({ report, failure: null, usage: null }); controller.close();
    } }); },
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
    setSystemTime(epoch + 20_500);
    await waitFor(() => noteEvents(f.socket.sent).length === 2);
    await Promise.all(f.pending);
    expect(maps).toHaveLength(1);
    expect(maps[0]!.attemptId).toBe(interviewAttempt.id);
    expect(maps[0]!.passages.map(entry => entry.id)).toEqual(['p1']);
    expect(maps[0]!.tail.reasons).toHaveLength(1);
    expect(maps[0]!.tail.reasons[0]).toContain('(p1)');
    const [list, map] = noteEvents(f.socket.sent);
    expect(list).toMatchObject({ type: 'session.thinking.append', delegation_id: null, content: expect.stringContaining('PRIVATE UNKNOWN') });
    expect(map).toMatchObject({ type: 'session.thinking.append', delegation_id: null, content: expect.stringContaining('PRIVATE VANTAGE') });
    // Notes are never instructions; Sam's silence after the participant spoke drew the greeting once more.
    expect(f.socket.sent.filter(event => event.type === 'session.instructions.append').map(event => event.event_id)).toEqual(['opening', 'opening-again']);
    f.socket.emit({ type: 'session.thinking.appended', client_event_id: list!.event_id, start_ms: 2000, end_ms: 2400 });
    setSystemTime(epoch + 22_000);
    f.socket.emit({ type: 'session.output_transcript.delta', delta: 'Who else worked on it?', start_ms: 21_000, end_ms: 22_000 });
    const snapshot = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
    expect(snapshot.coaching).toBeNull();
    expect(snapshot.evaluation).toBeNull();
    expect(snapshot.interview.evaluation).toBeDefined();
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE');
    expect(f.judged).toHaveLength(0);
    await f.session.fetch(request('end'));
    await (await f.session.fetch(request('report'))).text();
    await Promise.all(f.pending);
    const row = f.interviewRow()!;
    const records = JSON.parse(row.interventions_json).filter((record: { source: string }) => record.source !== 'grade');
    expect(records.map((record: { source: string }) => record.source)).toEqual(['turn', 'map', 'note', 'note', 'traits']);
    expect(records[0]).toMatchObject({ passageId: 'p1', outcome: 'read', reading: { novel: .9 } });
    expect(records[1]).toMatchObject({ outcome: 'applied', inputCount: 1, lastInputId: 'p1', changes: { added: ['e1', 't1'] } });
    expect(records[2]).toMatchObject({ kind: 'list', outcome: 'sent', mapId: records[1].id, nextSamTurnAfterId: 'p1', delivery: { status: 'accepted', startMs: 2000, endMs: 2400 } });
    expect(records[3]).toMatchObject({ kind: 'map', outcome: 'sent', nextSamTurnAt: epoch + 22_000, delivery: { status: 'unknown' } });
    expect(JSON.parse(row.cues_json)).toEqual([]);
    expect(JSON.parse(row.provenance_json).contextualDirector).toMatchObject({ version: PRODUCER_VERSION, effort: 'low', maps: 1, applied: 1, turns: 1, notes: 2, research: 0 });
    expect(summarized).not.toContain('PRIVATE');
    expect(summarized).not.toContain('interventions');
    expect(JSON.parse(summarized).transcript).toEqual(snapshot.transcript);
    expect(f.row()).toBeNull();
  } finally { await f.session.fetch(request('end')); }
}, 10_000);

test('long interview silence never creates an automatic turn instruction, including legacy polls', async () => {
  const f = await fixture();
  const epoch = 1_800_000_000_000;
  setSystemTime(epoch);
  try {
    await f.session.fetch(request('start', capability, interviewAttempt));
    await f.session.fetch(request('ready'));
    f.socket.emit({ type: 'session.input_transcript.delta', delta: 'We fixed the release guide.', start_ms: 0, end_ms: 1000 });
    f.socket.emit({ type: 'session.output_transcript.delta', delta: 'That helped the next release.', start_ms: 1000, end_ms: 2000 });
    for (const elapsed of [15_000, 30_000, 45_000, 60_000]) {
      setSystemTime(epoch + elapsed);
      await f.session.fetch(activityPoll(false, false, 60_000));
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
  const f = await fixture({ overrides: { evaluateInterview: async input => {
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
  const maps: Parameters<typeof producerServices.generateMap>[0][] = [];
  const fact = { text: 'PUBLIC BACKGROUND FACT', url: 'https://www.usgs.gov/3d-elevation-program', title: 'USGS 3DEP' };
  const f = await fixture({ overrides: {
    evaluateTurn: novelTurn,
    evaluateInterview: async input => { participantInput = JSON.stringify(input); return { revision: input.revision, readings: emptyInterviewReadings(), objectives: [], model: 'fixture', durationMs: 1, usage: fixtureUsage, answers: {} }; },
    // Sol asks for a lookup, then files what came back as public background.
    generateMap: async input => {
      maps.push(input);
      return maps.length === 1 ? mapped(input.previous, { kind: 'term', name: '3DEP', clue: null, passageIds: ['p1'] })
        : mapped({ ...input.previous, entities: [{ id: 'e1', kind: 'term', label: '3DEP', detail: fact.text, source: 'research', passageId: 'L1' }], nextIds: { e: 2, r: 1, t: 1 } });
    },
    lookupInterviewBackground: async input => { lookups.push(input); return { status: 'found', facts: [fact], retrievedAt: Date.now(), queries: ['PRIVATE ARCHIVE QUERY'] }; },
    summarizeInterview: (input, done) => { summaryInput = JSON.stringify(input); return new ReadableStream({ start(controller) {
      const report = { text: 'The participant led an integration.' }; controller.enqueue(JSON.stringify(report)); done({ report, failure: null, usage: null }); controller.close();
    } }); },
  } });
  const epoch = 1_800_000_000_000;
  setSystemTime(epoch);
  await f.session.fetch(request('start', capability, interviewAttempt)); await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'I led the 3DEP integration.', start_ms: 0, end_ms: 1000 });
  setSystemTime(epoch + 20_500);
  // Audio the browser hears keeps the silent-greeting watchdog from replacing the voice session.
  await f.session.fetch(activityPoll(false, true));
  await waitFor(() => lookups.length === 1);
  expect(lookups).toEqual([{ target: { kind: 'term', name: '3DEP' }, clue: null, foundry: expect.objectContaining({ resourceName: 'fixture-foundry', agentModel: 'gpt-6.1-sol', fastModel: 'gpt-6-luna' }), signal: expect.any(AbortSignal) }]);
  await Promise.all(f.pending);
  expect(noteEvents(f.socket.sent)).toHaveLength(0);
  // The found lookup wakes Sol, which reads it in its log before Sam hears of it.
  setSystemTime(epoch + 41_000);
  await f.session.fetch(activityPoll(false, true));
  await waitFor(() => noteEvents(f.socket.sent).length === 1);
  await Promise.all(f.pending);
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
  expect(records.find((item: any) => item.source === 'note')).toMatchObject({
    kind: 'map', outcome: receipt === 'accepted' ? 'sent' : 'rejected', delivery: { status: receipt }, researchIds: [research.id],
  });
  expect(f.row()).toBeNull();
}, 10_000);

test('contextual coaching runs for scored sessions and keeps actor history out of public state', async () => {
  let generations = 0;
  const f = await fixture({ overrides: {
    evaluateTrainee: async input => ({ revision: input.revision, skills: emptySkills(), objectives: [], privateDiagnostic: 'must never enter public feedback', concern: null, model: 'fixture', durationMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, answers: {}, signals: [{ condition: 'objective:problem', selected: true }] }),
    evaluateClient: async input => ({ revision: input.revision, model: 'fixture', durationMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, answers: {}, signals: [{ condition: 'role', probability: .99 }] }),
    generateDirector: async input => { generations++; return { action: 'intervene', text: input.audience === 'actor' ? 'PRIVATE: Ask the consultant to propose the scope.' : 'Ask which approval is currently blocked.', evidenceIds: [input.transcript[0]!.id], model: 'gpt-6.1-sol', usage: { inputTokens: 100, outputTokens: 15 } }; },
  } });
  setSystemTime(1_800_000_000_000);
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'You should design the whole plan for us.', start_ms: 0, end_ms: 1000 });
  setSystemTime(1_800_000_002_000);
  await waitFor(() => generations === 2);
  const current = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
  expect(current.coaching?.text).toBe('Ask which approval is currently blocked.');
  expect(JSON.stringify(current)).not.toContain('PRIVATE:');
  expect(JSON.stringify(current)).not.toContain('signals');
  expect(current.evaluation).not.toHaveProperty('privateDiagnostic');
  expect(JSON.stringify(current)).not.toContain('must never enter public feedback');
  const cues = f.socket.sent.filter(event => String(event.event_id).startsWith('cue-'));
  expect(cues).toHaveLength(1);
  if (cues[0]) f.socket.emit({ type: 'error', error: { client_event_id: cues[0].event_id } });
  await f.session.fetch(request('end'));
  await waitFor(() => f.row()?.archive_state === 'final');
  const archived = JSON.parse(f.row()!.interventions_json);
  expect(archived.filter((row: any) => row.source === 'director')).toHaveLength(2);
  expect(archived.filter((row: any) => row.source === 'observation')).toHaveLength(2);
  expect(archived.find((item: any) => item.source === 'director' && item.audience === 'actor')).toMatchObject({ outcome: 'sent', delivery: { status: 'rejected' } });
  const exported = parseArchive(f.row()!);
  const observation = exported.interventions.find((item: any) => item.source === 'observation' && item.audience === 'actor');
  expect(observation).toMatchObject({ outcome: 'started', model: 'fixture', signals: [{ condition: 'role', probability: .99 }] });
  expect(exported.interventions.find((item: any) => item.source === 'director' && item.audience === 'actor').observationId).toBe(observation.id);
  expect(JSON.stringify(current)).not.toContain(observation.id);
  expect(JSON.parse(f.row()!.cues_json)).toEqual([]);
  expect(JSON.parse(f.row()!.provenance_json).contextualDirector).toMatchObject({ model: 'gpt-6.1-sol', effort: 'low' });
}, 10_000);

test('ending the session does not wait for pending contextual generation', async () => {
  let release!: () => void;
  const f = await fixture({ overrides: {
    evaluateTrainee: async input => ({ revision: input.revision, skills: emptySkills(), objectives: [], concern: null, model: 'fixture', durationMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, answers: {}, signals: [{ condition: 'stalled', probability: .99 }] }),
    generateDirector: async input => {
      await new Promise<void>(done => { release = done; });
      return { action: 'intervene', text: 'Late advice must not appear.', evidenceIds: [input.transcript[0]!.id], model: 'gpt-6.1-sol', usage: { inputTokens: 1, outputTokens: 1 } };
    },
  } });
  setSystemTime(1_800_000_000_000);
  await f.session.fetch(request('start')); await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'Let us try the same approach again.', start_ms: 0, end_ms: 1000 });
  setSystemTime(1_800_000_002_000);
  await waitFor(() => !!release);
  const ended = await (await f.session.fetch(request('end'))).json() as Record<string, any>;
  expect(ended.status).toBe('ended');
  expect(ended.coaching).toBeNull();
  await waitFor(() => f.row()?.archive_state === 'final');
  expect(JSON.parse(f.row()!.interventions_json).find((row: any) => row.source === 'director').outcome).toBe('aborted');
  release(); await Promise.all(f.pending);
  expect(JSON.stringify(await (await f.session.fetch(request('poll'))).json())).not.toContain('Late advice');
}, 10_000);

test('End archives pending Jev attempts as aborted and ignores a late actor judgment', async () => {
  let grades = 0;
  let releaseActor!: () => void;
  const f = await fixture({ overrides: {
    evaluateTrainee: async input => {
      if (++grades === 1) await new Promise<void>((_, reject) => input.signal!.addEventListener('abort', () => reject(new DOMException('Ended', 'AbortError')), { once: true }));
      return { revision: input.revision, skills: emptySkills(), objectives: [], concern: null, model: 'fixture', durationMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, answers: {}, signals: [] };
    },
    evaluateClient: async input => {
      await new Promise<void>(resolve => { releaseActor = resolve; });
      return { revision: input.revision, model: 'fixture', durationMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, answers: {}, signals: [{ condition: 'role', probability: .99 }] };
    },
  } });
  setSystemTime(1_800_000_000_000);
  await f.session.fetch(request('start')); await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'What would success look like?', start_ms: 0, end_ms: 1000 });
  setSystemTime(1_800_000_002_000);
  await waitFor(() => grades === 1 && !!releaseActor);
  await f.session.fetch(request('end'));
  await waitFor(() => f.row()?.archive_state === 'final');
  const archived = f.row()!;
  const observations = parseArchive(archived).interventions;
  expect(observations.map((row: any) => row.audience).sort()).toEqual(['actor', 'trainee']);
  for (const observation of observations) expect(observation).toMatchObject({ source: 'observation', outcome: 'aborted', signals: [], completedAt: expect.any(Number) });
  releaseActor(); await Promise.all(f.pending);
  expect(f.row()).toEqual(archived);
  expect(f.socket.sent.filter(event => String(event.event_id).startsWith('cue-'))).toHaveLength(0);
}, 10_000);

test('actor detection stops after six submitted notes while trainee grading continues', async () => {
  let assessments = 0, grades = 0;
  const f = await fixture({ overrides: {
    evaluateTrainee: async input => { grades++; return { revision: input.revision, skills: emptySkills(), objectives: [], concern: null, model: 'fixture', durationMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, answers: {}, signals: [] }; },
    evaluateClient: async input => { assessments++; return { revision: input.revision, model: 'fixture', durationMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, answers: {}, signals: [{ condition: 'role', probability: .99 }] }; },
  } });
  const epoch = 1_800_000_000_000;
  setSystemTime(epoch);
  await f.session.fetch(request('start')); await f.session.fetch(request('ready'));
  for (let round = 0; round < 8; round++) {
    setSystemTime(epoch + round * 61_000);
    await f.session.fetch(request('poll'));
    f.socket.emit({ type: 'session.output_transcript.delta', delta: 'I can approve the whole release.', start_ms: round * 5000, end_ms: round * 5000 + 900 });
    f.socket.emit({ type: 'session.input_transcript.delta', delta: 'Can you confirm the approval boundary?', start_ms: round * 5000 + 1000, end_ms: round * 5000 + 1900 });
    f.socket.emit({ type: 'session.output_transcript.delta', delta: 'Yes, I approve all of it.', start_ms: round * 5000 + 2000, end_ms: round * 5000 + 2900 });
    setSystemTime(epoch + round * 61_000 + 2000);
    await waitFor(() => grades === round + 1);
    await Promise.all(f.pending);
  }
  expect(assessments).toBe(6);
  expect(f.socket.sent.filter(event => String(event.event_id).startsWith('cue-'))).toHaveLength(6);
  expect(grades).toBe(8);
  await f.session.fetch(request('end'));
}, 15_000);

test('session ownership, authoritative transcript, close acknowledgment, and public projection', async () => {
  const f = await fixture();
  expect((await f.session.fetch(request('start'))).status).toBe(200);
  expect((await f.session.fetch(request('poll', `Bearer ${'b'.repeat(64)}`))).status).toBe(403);
  await f.session.fetch(request('ready'));
  const speech = { type: 'session.input_transcript.delta', event_id: 'one', delta: 'Who owns that process?', start_ms: 100, end_ms: 2000 };
  f.socket.emit(speech); f.socket.emit(speech);
  const result = await (await f.session.fetch(request('end'))).json() as Record<string, any>;
  expect(result.status).toBe('ended');
  expect(result.finalization).toBe('confirmed');
  expect(result.usageSeconds).toBe(12);
  expect(result.transcript).toHaveLength(1);
  expect(result.transcript[0].text).toBe('Who owns that process?');
  expect(f.judged).toHaveLength(1);
  expect(JSON.stringify(result)).not.toContain('private');
  expect(JSON.stringify(result)).not.toContain('answers');
  expect(f.socket.readyState).toBe(3);
});

test('interview End re-grades coverage over the whole interview and returns pending before one summary completes', async () => {
  const summaryUsage = { inputTokens: 43, outputTokens: 17, reasoningTokens: 9, cachedTokens: 11 };
  let releaseSummary: ((text: string) => void) | undefined;
  const summarized: { speaker: string; text: string }[][] = [];
  const interviewJudged: { transcript: { speaker: string; text: string }[] }[] = [];
  const f = await fixture({ overrides: {
    evaluateInterview: async input => {
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
    summarizeInterview: (input, done) => { summarized.push(input.transcript); return new ReadableStream({ start(controller) {
      controller.enqueue('{\"text\":');
      releaseSummary = text => { controller.enqueue(JSON.stringify(text) + '}'); done({ report: { text }, failure: null, usage: summaryUsage }); controller.close(); releaseSummary = undefined; };
    } }); },
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
    expect(f.judged).toHaveLength(0);
    expect(interviewJudged).toHaveLength(2);
    expect(interviewJudged[1]!.transcript.map(entry => entry.text)).toEqual(['We built a permit intake portal.', 'Jen resolved our access issue.']);
    const final = ended.interview.evaluation.objectives.find((item: { id: string }) => item.id === 'project-delivery');
    expect(final).toMatchObject({ level: 'touched', achieved: false, evidence: covered.evidence });
    await Promise.all(f.pending);
    expect(summarized).toHaveLength(0);
    expect((await f.session.fetch(request('report', `Bearer ${'b'.repeat(64)}`))).status).toBe(403);
    const response = await f.session.fetch(request('report'));
    const body = response.text();
    expect((await f.session.fetch(request('report'))).status).toBe(409);
    expect(summarized).toHaveLength(1);
    expect(summarized[0]!.map(entry => entry.speaker)).toEqual(['trainee', 'trainee']);
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
  const f = await fixture({ overrides: {
    summarizeInterview: () => { throw new Error('Provider contained private request data.'); },
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

test.each(['accepted', 'rejected'] as const)('a list note receipt %s is archived, and a rejected note goes out again at the next pick', async receipt => {
  let turns = 0;
  const f = await fixture({ overrides: {
    evaluateTurn: async input => { turns++; return novelTurn(input); },
    generateMap: async () => mapped(solMap()),
  } });
  const epoch = 1_800_000_000_000;
  setSystemTime(epoch);
  await f.session.fetch(request('start', capability, interviewAttempt)); await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'I led the 3DEP integration.', start_ms: 0, end_ms: 1000 });
  setSystemTime(epoch + 20_500);
  await waitFor(() => noteEvents(f.socket.sent, 'list').length === 1);
  await Promise.all(f.pending);
  const first = noteEvents(f.socket.sent, 'list')[0]!;
  f.socket.emit(receipt === 'accepted'
    ? { type: 'session.thinking.appended', client_event_id: first.event_id, start_ms: 2000, end_ms: 2400 }
    : { type: 'error', error: { client_event_id: first.event_id } });
  expect((await (await f.session.fetch(request('poll'))).json() as Record<string, any>).message).toBeNull();
  f.socket.emit({ type: 'session.output_transcript.delta', delta: 'Who else worked on it?', start_ms: 21_000, end_ms: 22_000 });
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'Our lead coordinated it.', start_ms: 22_000, end_ms: 23_000 });
  setSystemTime(epoch + 25_000);
  await waitFor(() => turns === 2);
  await Promise.all(f.pending);
  const lists = noteEvents(f.socket.sent, 'list');
  expect(lists).toHaveLength(receipt === 'accepted' ? 1 : 2);
  if (receipt === 'rejected') expect(lists[1]!.content).toBe(first.content);
  await f.session.fetch(request('end'));
  await Promise.all(f.pending);
  const notes = JSON.parse(f.interviewRow()!.interventions_json).filter((item: { source: string; kind?: string }) => item.source === 'note' && item.kind === 'list');
  expect(notes[0]).toMatchObject({ outcome: receipt === 'accepted' ? 'sent' : 'rejected', delivery: { status: receipt, ...(receipt === 'accepted' ? { startMs: 2000, endMs: 2400 } : {}) } });
  expect(notes).toHaveLength(lists.length);
}, 10_000);

test('End freezes an unfinished Sol call without delaying its summary', async () => {
  let release: (() => void) | undefined;
  const f = await fixture({ overrides: {
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

test('happy hour archives the client voice without live or final judging', async () => {
  let directed = 0;
  const f = await fixture({ overrides: {
    evaluateClient: async () => { directed++; throw new Error('Unexpected social director'); },
  } });
  await f.session.fetch(new Request('https://session/start', {
    method: 'POST', headers: { Authorization: capability }, body: JSON.stringify({ ...attempt, scenarioId: 'happy-hour', clientId: 'jamie' }),
  }));
  await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.output_transcript.delta', delta: 'Hi, I’m Jamie. How is your evening?', start_ms: 100, end_ms: 900 });
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'Great. What do you do for fun?', start_ms: 1000, end_ms: 2000 });
  setSystemTime(Date.now() + 12_000);
  // Let the real session timer see settled speech, which normally starts both judges.
  await new Promise(resolve => setTimeout(resolve, 750));
  expect(f.judged).toHaveLength(0);
  expect(directed).toBe(0);
  const live = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
  expect(live.status).toBe('live');
  expect(live.evaluation).toBeNull();
  const ended = await (await f.session.fetch(request('end'))).json() as Record<string, any>;
  await Promise.all(f.pending);
  expect(ended.status).toBe('ended');
  expect(ended.finalization).toBe('confirmed');
  expect(ended.transcript.map((entry: { speaker: string }) => entry.speaker)).toEqual(['client', 'trainee']);
  expect(ended.evaluation).toBeNull();
  expect(f.judged).toHaveLength(0);
  expect(directed).toBe(0);
  expect(f.socket.readyState).toBe(3);
  expect(f.row()?.archive_state).toBe('final');
  expect(f.row()?.scenario_id).toBe('happy-hour');
  expect(JSON.parse(f.row()!.provenance_json).contextualDirector).toBeNull();
  expect(JSON.parse(f.row()!.interventions_json)).toEqual([]);
  expect(f.row()?.evaluation_json).toBeNull();
  expect(JSON.parse(f.row()!.provenance_json).voice).toBe('coral');
  expect(JSON.parse(f.row()!.transcript_json)).toEqual(ended.transcript);
});
test('normal End keeps a late trainee tail but excludes an unheard client agreement', async () => {
  let graded: { speaker: string; text: string }[] = [];
  const f = await fixture({ overrides: {
    evaluateTrainee: async input => {
      graded = input.transcript;
      const agreement = input.transcript.find(item => item.speaker === 'client' && item.text.includes('I agree'));
      return { revision: input.revision, skills: emptySkills(), objectives: agreement ? [{ id: 'next-step', achieved: true, probability: .99, evidence: { entryId: agreement.id, speaker: agreement.speaker, text: agreement.text } }] : [], concern: null, model: 'fixture', durationMs: 1, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, answers: {}, signals: [] };
    },
  } });
  f.socket.holdClose = true;
  let ending: Promise<Response> | undefined;
  try {
    await f.session.fetch(request('start'));
    await f.session.fetch(request('ready'));
    ending = f.session.fetch(request('end'));
    expect((await (await f.session.fetch(request('poll'))).json() as Record<string, any>).status).toBe('ending');
    f.socket.emit({ type: 'session.input_transcript.delta', delta: 'Let us schedule a scoped assessment.', start_ms: 100, end_ms: 900 });
    f.socket.emit({ type: 'session.output_transcript.delta', delta: 'I agree to that next step.', start_ms: 1000, end_ms: 1600 });
    await waitFor(() => f.socket.sent.some(event => event.type === 'session.close'));
    f.socket.emit({ type: 'session.closed', reason: 'close_requested' });
    const result = await (await ending).json() as Record<string, any>;
    expect(result.status).toBe('ended');
    expect(result.finalization).toBe('confirmed');
    expect(result.transcript.map((item: { speaker: string }) => item.speaker)).toEqual(['trainee']);
    expect(graded.map(item => item.speaker)).toEqual(['trainee']);
    expect(result.evaluation.objectives.some((item: { id: string; achieved: boolean }) => item.id === 'next-step' && item.achieved)).toBe(false);
  } finally {
    f.socket.emit({ type: 'session.closed', reason: 'close_requested' });
    await ending;
  }
}, 10_000);
test('provider connection loss during explicit End does not replace the completed message', async () => {
  const f = await fixture();
  f.socket.holdClose = true;
  let ending: Promise<Response> | undefined;
  try {
    await f.session.fetch(request('start'));
    await f.session.fetch(request('ready'));
    ending = f.session.fetch(request('end'));
    expect((await (await f.session.fetch(request('poll'))).json() as Record<string, any>).status).toBe('ending');
    await waitFor(() => f.socket.sent.some(event => event.type === 'session.close'));
    f.socket.emit({ type: 'session.closed', reason: 'connection_lost' });
    const result = await (await ending).json() as Record<string, any>;
    expect(result.status).toBe('ended');
    expect(result.finalization).toBe('confirmed');
    expect(result.message).toBeNull();
  } finally {
    f.socket.emit({ type: 'session.closed', reason: 'close_requested' });
    await ending;
  }
}, 10_000);
test('cancelling during provider creation closes the eventual session', async () => {
  let release!: () => void;
  const f = await fixture({ pendingCreation: new Promise<void>(resolve => { release = resolve; }) });
  const starting = f.session.fetch(request('start'));
  // Wait until creation actually reaches the paid boundary, then race cancellation.
  while (!f.creations()) await Promise.resolve();
  const ending = f.session.fetch(request('end'));
  release();
  expect((await starting).status).toBe(409);
  const result = await (await ending).json() as Record<string, unknown>;
  expect(result.finalization).toBe('confirmed');
  expect(f.socket.sent.some(event => event.type === 'session.close')).toBe(true);
});
test('concurrent starts create only one paid session', async () => {
  const f = await fixture();
  const responses = await Promise.all([f.session.fetch(request('start')), f.session.fetch(request('start'))]);
  expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
  expect(f.creations()).toBe(1);
  await f.session.fetch(request('end'));
});
test('the meeting kickoff waits for ready and repeated ready requests cannot replay it', async () => {
  const f = await fixture();
  const started = await (await f.session.fetch(request('start'))).json();
  const openings = () => f.socket.sent.filter(event => event.type === 'session.instructions.append');
  expect(openings()).toHaveLength(0);
  const ready = await Promise.all([f.session.fetch(request('ready')), f.session.fetch(request('ready'))]);
  expect(ready.map(response => response.status)).toEqual([200, 200]);
  expect(openings()).toHaveLength(1);
  expect(openings()[0]).toMatchObject({ event_id: 'opening', delegation_id: null });
  const instruction = openings()[0]!.content;
  expect(typeof instruction).toBe('string');
  const publicStates = [started, ...await Promise.all(ready.map(response => response.json()))];
  expect(JSON.stringify(publicStates)).not.toContain(JSON.stringify(instruction));
  await f.session.fetch(request('end'));
  await f.session.fetch(request('ready'));
  expect(openings()).toHaveLength(1);
});
test('an end arriving before start prevents any paid creation for that attempt', async () => {
  const f = await fixture();
  await f.session.fetch(request('end'));
  expect((await f.session.fetch(request('start'))).status).toBe(409);
  expect(f.creations()).toBe(0);
});
test('an actor delegation receives private role direction instead of starting outside work', async () => {
  const f = await fixture();
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.delegation.created', delegation: { id: 'unexpected-task', target: 'client' } });
  const direction = f.socket.sent.find(event => event.delegation_id === 'unexpected-task');
  expect(direction?.type).toBe('session.thinking.append');
  expect(typeof direction?.content).toBe('string');
  const state = await (await f.session.fetch(request('poll'))).json() as Record<string, unknown>;
  expect(state.status).toBe('live');
  expect(JSON.stringify(state)).not.toContain(JSON.stringify(direction?.content));
  expect(f.creations()).toBe(1);
  await f.session.fetch(request('end'));
});
test('server alarm holds abandoned practice, closes its provider, and ends it after the hold', async () => {
  const f = await fixture();
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  expect(f.alarm()).toBeGreaterThan(Date.now());
  const lost = Date.now() + 40_000;
  setSystemTime(lost);
  await f.session.alarm();
  await settle(f);
  expect(f.socket.sent.some(event => event.type === 'session.close')).toBe(true);
  expect(f.values.get('checkpoint')).toBeDefined();
  expect(f.values.get('lease')).not.toHaveProperty('providerId');
  expect(f.row()).toMatchObject({ archive_state: 'partial', session_status: 'paused' });
  setSystemTime(lost + 15 * 60_000);
  await f.session.alarm();
  const result = await (await f.session.fetch(request('poll'))).json() as Record<string, unknown>;
  expect(result).toMatchObject({ status: 'ended', finalization: 'confirmed', pause: null });
  expect(result.message).toContain('did not return within 15 minutes');
  expect(f.values.get('checkpoint')).toBeUndefined();
});
for (const polling of [false, true]) test(`a connection that never becomes ready closes ${polling ? 'despite polling' : 'after abandonment'}`, async () => {
  const f = await fixture();
  await f.session.fetch(request('start'));
  const startedAt = Date.now();
  if (polling) {
    for (let seconds = 20; seconds <= 60; seconds += 20) {
      setSystemTime(startedAt + seconds * 1000);
      await f.session.fetch(activityPoll(true, true));
    }
  } else setSystemTime(startedAt + 40_000);
  await f.session.alarm();
  await Promise.all(f.pending);
  const result = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
  expect(['ended', 'interrupted']).toContain(result.status);
  expect(result.finalization).toBe('confirmed');
  expect(f.socket.sent.filter(event => event.type === 'session.close')).toHaveLength(1);
  expect(f.row()).toBeNull();
});
test('late ready cannot turn an expired connection into live practice', async () => {
  const f = await fixture();
  await f.session.fetch(request('start'));
  const startedAt = Date.now();
  for (const seconds of [20, 40]) {
    setSystemTime(startedAt + seconds * 1000);
    await f.session.fetch(activityPoll(true, true));
  }
  setSystemTime(startedAt + 60_001);
  await f.session.fetch(request('ready'));
  await Promise.all(f.pending);
  const snapshot = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
  expect(snapshot.status).toBe('interrupted');
  expect(snapshot.finalization).toBe('confirmed');
  expect(snapshot.message).toContain('timed out');
  expect(f.socket.sent.some(event => event.type === 'session.instructions.append')).toBe(false);
  expect(f.row()).toBeNull();
});
test('a completed slow connection gets a fresh page-contact grace', async () => {
  let release!: () => void;
  const f = await fixture({ pendingCreation: new Promise<void>(resolve => { release = resolve; }) });
  const starting = f.session.fetch(request('start'));
  while (!f.creations()) await Promise.resolve();
  setSystemTime(Date.now() + 40_000);
  release();
  expect((await starting).status).toBe(200);
  await f.session.alarm();
  const connecting = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
  expect(connecting.status).toBe('connecting');
  expect(connecting.finalization).toBe('pending');
  expect((await (await f.session.fetch(request('ready'))).json() as Record<string, any>).status).toBe('live');
  await f.session.fetch(request('end'));
});

test('regular conversation activity keeps a practice live beyond ten minutes', async () => {
  const f = await fixture();
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  const startedAt = Date.now();
  try {
    for (let step = 1; step <= 22; step++) {
      setSystemTime(startedAt + step * 30_000);
      const snapshot = await (await f.session.fetch(activityPoll(true))).json() as Record<string, any>;
      expect(snapshot.status).toBe('live');
      expect(snapshot.warning).toBeNull();
    }
    expect(f.socket.sent.some(event => event.type === 'session.close')).toBe(false);
  } finally { await f.session.fetch(request('end')); }
});
test('quiet polls warn after three minutes and close after five', async () => {
  const f = await fixture();
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  const startedAt = Date.now();
  for (let step = 1; step <= SESSION_IDLE_TIMEOUT_MS / 30_000; step++) {
    setSystemTime(startedAt + step * 30_000);
    const snapshot = await (await f.session.fetch(activityPoll(false))).json() as Record<string, any>;
    if (step * 30_000 < SESSION_IDLE_WARNING_MS) expect(snapshot.warning).toBeNull();
    if (step * 30_000 === SESSION_IDLE_WARNING_MS) {
      expect(snapshot.warning?.kind).toBe('idle');
      expect(Math.abs(snapshot.warning.endsAt - (startedAt + SESSION_IDLE_TIMEOUT_MS))).toBeLessThan(10);
    }
  }
  await waitFor(() => f.socket.sent.some(event => event.type === 'session.close'));
  await Promise.all(f.pending);
  const ended = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
  expect(ended.status).toBe('ended');
  expect(ended.finalization).toBe('confirmed');
});
test('Continue and playing audio each clear an idle warning', async () => {
  const f = await fixture();
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  const startedAt = Date.now();
  try {
    setSystemTime(startedAt + SESSION_IDLE_WARNING_MS);
    expect((await (await f.session.fetch(activityPoll(false))).json() as Record<string, any>).warning?.kind).toBe('idle');
    expect((await (await f.session.fetch(activityPoll(true))).json() as Record<string, any>).warning).toBeNull();
    setSystemTime(startedAt + 2 * SESSION_IDLE_WARNING_MS);
    expect((await (await f.session.fetch(activityPoll(false))).json() as Record<string, any>).warning?.kind).toBe('idle');
    expect((await (await f.session.fetch(activityPoll(false, true))).json() as Record<string, any>).warning).toBeNull();
    setSystemTime(startedAt + 2 * SESSION_IDLE_WARNING_MS + SESSION_IDLE_WARNING_MS - 1000);
    expect((await (await f.session.fetch(activityPoll(false))).json() as Record<string, any>).status).toBe('live');
  } finally { await f.session.fetch(request('end')); }
});
test('a browser that keeps polling still cannot outlive the attempt deadline', async () => {
  const f = await fixture();
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  setSystemTime(Date.now() + (SESSION_LIMIT_SECONDS * 1000) + 20_001);
  await f.session.fetch(activityPoll(true, true));
  await f.session.alarm();
  const result = await (await f.session.fetch(request('poll'))).json() as Record<string, unknown>;
  expect(result.status).toBe('ended');
  expect(result.finalization).toBe('confirmed');
});
test('the 60-minute warning and automatic audio drain stay bounded by twenty seconds', async () => {
  const f = await fixture();
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  const startedAt = Date.now();
  for (let step = 1; step <= (SESSION_LIMIT_SECONDS - 60) / 30; step++) {
    setSystemTime(startedAt + step * 30_000);
    const snapshot = await (await f.session.fetch(activityPoll(false, true))).json() as Record<string, any>;
    expect(snapshot.status).toBe('live');
  }
  const warning = (await (await f.session.fetch(activityPoll(false, true))).json() as Record<string, any>).warning;
  expect(warning?.kind).toBe('limit');
  expect(Math.abs(warning.endsAt - (startedAt + SESSION_LIMIT_SECONDS * 1000))).toBeLessThan(25);
  setSystemTime(warning.endsAt);
  expect((await (await f.session.fetch(activityPoll(false, true))).json() as Record<string, any>).status).toBe('live');
  setSystemTime(warning.endsAt + 19_000);
  expect((await (await f.session.fetch(activityPoll(false, true))).json() as Record<string, any>).status).toBe('live');
  setSystemTime(warning.endsAt + 20_001);
  await f.session.fetch(activityPoll(false, true));
  await waitFor(() => f.socket.sent.some(event => event.type === 'session.close'));
  await Promise.all(f.pending);
  expect((await (await f.session.fetch(request('poll'))).json() as Record<string, any>).status).toBe('ended');
});
test('transcript capacity warns before closing after a short quiet drain', async () => {
  const f = await fixture();
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  const warningAt = Math.ceil(TRANSCRIPT_LIMIT.entries * .9);
  for (let turn = 0; turn < warningAt; turn++) {
    f.socket.emit({
      type: turn % 2 ? 'session.output_transcript.delta' : 'session.input_transcript.delta',
      delta: `Turn ${turn}.`, start_ms: turn * 3000, end_ms: turn * 3000 + 1000,
    });
  }
  const warning = (await (await f.session.fetch(activityPoll(false))).json() as Record<string, any>).warning;
  expect(warning).toMatchObject({ kind: 'capacity' });
  setSystemTime(warning.endsAt + 2500);
  expect((await (await f.session.fetch(activityPoll(false))).json() as Record<string, any>).status).toBe('live');
  setSystemTime(warning.endsAt + 3100);
  await f.session.fetch(activityPoll(false));
  await waitFor(() => f.socket.sent.some(event => event.type === 'session.close'));
  await Promise.all(f.pending);
  const ended = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
  expect(ended.status).toBe('ended');
  expect(ended.transcript).toHaveLength(warningAt);
  expect(ended.message).toContain('transcript capacity');
});
test('failed provider finalization remains explicit and retains a closure lease', async () => {
  const f = await fixture();
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  f.socket.readyState = 3; // Both the existing control socket and reattachment are unavailable.
  const result = await (await f.session.fetch(request('end'))).json() as Record<string, unknown>;
  expect(result.finalization).toBe('unconfirmed');
  expect(result.message).toContain('did not confirm');
  expect(f.values.get('lease')).toMatchObject({ closed: false });
  expect(f.alarm()).toBeGreaterThan(Date.now());
  await waitFor(() => f.row()?.archive_state === 'final');
  expect(f.row()).toMatchObject({ session_status: 'ended', finalization: 'unconfirmed' });
});

test('a replacement session owner closes the persisted provider lease', async () => {
  const original = await fixture();
  await original.session.fetch(request('start'));
  const replacement = await fixture({ values: original.values });
  await replacement.session.alarm();
  expect(replacement.socket.sent.map(event => event.type)).toEqual(['session.close']);
  expect(replacement.values.get('lease')).toMatchObject({ closed: true });
  expect((await replacement.session.fetch(request('poll'))).status).toBe(410);
  await original.session.fetch(request('end'));
});

test('a cancelled attempt remains unusable after its owner restarts', async () => {
  const original = await fixture();
  await original.session.fetch(request('end'));
  const replacement = await fixture({ values: original.values });
  expect((await replacement.session.fetch(request('start'))).status).toBe(409);
  expect(replacement.creations()).toBe(0);
});

test('restart recovery clears an already-closed provider and a lease with no recovered id', async () => {
  const values = new Map<string, unknown>([['lease', { capability, providerId: 'gone', deadline: 0, closed: false }]]);
  const gone = await fixture({ values: values, overrides: { attachLive: async () => { throw new LiveSessionGone(); } } });
  await gone.session.alarm();
  expect(values.get('lease')).toMatchObject({ closed: true });
  await gone.session.alarm();
  expect(values.size).toBe(0);
  values.set('lease', { capability, deadline: 0, closed: false });
  const unknown = await fixture({ values: values });
  await unknown.session.alarm();
  expect(values.size).toBe(0);
});

test('a late same-speaker delta cannot change the passage cited by an objective', async () => {
  let releaseGrade!: () => void;
  let gradingStarted!: () => void;
  let gradingCalls = 0;
  const started = new Promise<void>(resolve => { gradingStarted = resolve; });
  const f = await fixture({ overrides: {
    evaluateTrainee: async input => {
      if (++gradingCalls === 1) {
        gradingStarted();
        await new Promise<void>(resolve => { releaseGrade = resolve; });
      }
      const passage = input.transcript[0]!;
      return { revision: input.revision, skills: emptySkills(), objectives: [{ id: 'capability', achieved: true, probability: .99, evidence: { entryId: passage.id, speaker: passage.speaker, text: passage.text } }], concern: null, model: 'fixture', durationMs: 1, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, answers: {}, signals: [] };
    },
  } });
  try {
    await f.session.fetch(request('start'));
    await f.session.fetch(request('ready'));
    f.socket.emit({ type: 'session.input_transcript.delta', delta: 'We can help assess document ownership.', start_ms: 0, end_ms: 1000 });
    await started;
    f.socket.emit({ type: 'session.input_transcript.delta', delta: ' Actually, I cannot promise that.', start_ms: 1100, end_ms: 1500 });
    releaseGrade();
    await Promise.all(f.pending);
    const snapshot = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
    const evidence = snapshot.evaluation.objectives.find((item: { id: string }) => item.id === 'capability').evidence;
    expect(snapshot.transcript).toHaveLength(2);
    expect(evidence.text).toBe(snapshot.transcript.find((item: { id: string }) => item.id === evidence.entryId).text);
    expect(snapshot.transcript[1].text).toContain('cannot promise');
  } finally {
    releaseGrade?.();
    await f.session.fetch(request('end'));
  }
}, 10_000);

test('the final grade can revoke an earlier historical objective', async () => {
  let calls = 0;
  const f = await fixture({ overrides: {
    evaluateTrainee: async input => {
      const passage = input.transcript[0]!;
      return {
        revision: input.revision, skills: emptySkills(),
        objectives: [{ id: 'capability', achieved: ++calls === 1, probability: calls === 1 ? .99 : .12, evidence: calls === 1 ? { entryId: passage.id, speaker: passage.speaker, text: passage.text } : null }],
        concern: null, model: 'fixture', durationMs: 1,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, answers: {}, signals: [],
      };
    },
  } });
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'We could assess document ownership.', start_ms: 0, end_ms: 900 });
  await waitFor(() => calls === 1);
  await Promise.all(f.pending);
  const live = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
  expect(live.evaluation.objectives.find((item: { id: string }) => item.id === 'capability').achieved).toBe(true);
  const ended = await (await f.session.fetch(request('end'))).json() as Record<string, any>;
  expect(calls).toBe(2);
  expect(ended.evaluation.objectives.find((item: { id: string }) => item.id === 'capability').achieved).toBe(false);
});

test.each([
  ['session.instructions.appended', true, 'accepted'],
  ['session.instructions.appended', false, 'unknown'],
  ['session.thinking.appended', true, 'unknown'],
] as const)('actor direction stays private and archives its receipt (%s, matching=%s)', async (type, matching, status) => {
  const f = await fixture({ overrides: {
    evaluateClient: async input => ({ revision: input.revision, model: 'fixture', durationMs: 1, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, answers: {}, signals: [{ condition: 'role', probability: .99 }] }),
  } });
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'Please design the consultancy plan for me.', start_ms: 0, end_ms: 900 });
  await waitFor(() => f.socket.sent.some(event => String(event.event_id).startsWith('cue-')));
  await Promise.all(f.pending);
  const cue = f.socket.sent.find(event => String(event.event_id).startsWith('cue-'))!;
  expect(cue).toMatchObject({ type: 'session.instructions.append', delegation_id: null });
  f.socket.emit({ type, client_event_id: matching ? cue.event_id : 'opening' });
  const snapshot = await (await f.session.fetch(request('poll'))).json() as Record<string, unknown>;
  expect(JSON.stringify(snapshot)).not.toContain(String(cue.content));
  await f.session.fetch(request('end'));
  await waitFor(() => f.row()?.archive_state === 'final');
  expect(parseArchive(f.row()!).interventions.find((item: any) => item.source === 'director' && item.audience === 'actor')).toMatchObject({
    outcome: 'sent', delivery: { eventId: cue.event_id, status },
  });
});

test('one transient judging failure retries unchanged dialogue and stops after success', async () => {
  let calls = 0;
  const f = await fixture({ overrides: {
    evaluateTrainee: async input => {
      if (++calls === 1) throw new Error('Transient failure');
      return { revision: input.revision, skills: emptySkills(), objectives: [], concern: null, model: 'fixture', durationMs: 1, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, answers: {}, signals: [] };
    },
  } });
  try {
    await f.session.fetch(request('start'));
    await f.session.fetch(request('ready'));
    f.socket.emit({ type: 'session.input_transcript.delta', delta: 'Who owns the workflow?', start_ms: 0, end_ms: 1000 });
    setSystemTime(Date.now() + 2000);
    await waitFor(() => calls === 1);
    await Promise.all(f.pending);
    expect((await (await f.session.fetch(request('poll'))).json() as Record<string, any>).feedbackStatus).toBe('unavailable');
    setSystemTime(Date.now() + 5000);
    await waitFor(() => calls === 2);
    await Promise.all(f.pending);
    const snapshot = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
    expect(snapshot.feedbackStatus).toBe('current');
    expect(snapshot.evaluation.revision).toBe(snapshot.revision);
    setSystemTime(Date.now() + 5000);
    await new Promise(resolve => setTimeout(resolve, 800));
    expect(calls).toBe(2);
  } finally { await f.session.fetch(request('end')); }
}, 10_000);

test('two failed judgments stop retrying until new dialogue earns its own retry', async () => {
  let calls = 0;
  const f = await fixture({ overrides: {
    evaluateTrainee: async input => {
      if (++calls < 4) throw new Error('Transient failure');
      return { revision: input.revision, skills: emptySkills(), objectives: [], concern: null, model: 'fixture', durationMs: 1, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, answers: {}, signals: [] };
    },
  } });
  try {
    await f.session.fetch(request('start'));
    await f.session.fetch(request('ready'));
    f.socket.emit({ type: 'session.input_transcript.delta', delta: 'What happens today?', start_ms: 0, end_ms: 1000 });
    setSystemTime(Date.now() + 2000);
    await waitFor(() => calls === 1);
    await Promise.all(f.pending);
    setSystemTime(Date.now() + 5000);
    await waitFor(() => calls === 2);
    await Promise.all(f.pending);
    setSystemTime(Date.now() + 5000);
    await new Promise(resolve => setTimeout(resolve, 800));
    expect(calls).toBe(2);
    f.socket.emit({ type: 'session.input_transcript.delta', delta: 'How much time does it cost?', start_ms: 4000, end_ms: 4800 });
    setSystemTime(Date.now() + 2000);
    await waitFor(() => calls === 3);
    await Promise.all(f.pending);
    setSystemTime(Date.now() + 5000);
    await waitFor(() => calls === 4);
    await Promise.all(f.pending);
    expect((await (await f.session.fetch(request('poll'))).json() as Record<string, any>).feedbackStatus).toBe('current');
  } finally { await f.session.fetch(request('end')); }
}, 10_000);

test('new settled dialogue marks earlier feedback delayed while reassessment is pending', async () => {
  let release!: () => void;
  let calls = 0;
  const f = await fixture({ overrides: {
    evaluateTrainee: async input => {
      if (++calls === 2) await new Promise<void>(resolve => { release = resolve; });
      return { revision: input.revision, skills: emptySkills(), objectives: [], concern: null, model: 'fixture', durationMs: 1, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, answers: {}, signals: [] };
    },
  } });
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'Who owns the workflow?', start_ms: 0, end_ms: 1000 });
  await waitFor(() => calls === 1);
  await Promise.all(f.pending);
  const first = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
  expect(first.feedbackStatus).toBe('current');
  f.socket.emit({ type: 'session.output_transcript.delta', delta: 'Operations does, but do not contact them yet.', start_ms: 1100, end_ms: 2300 });
  // Hold the actual reassessment rather than racing a fixed timer.
  await waitFor(() => !!release, 7000);
  const waiting = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
  expect(waiting.evaluation.revision).toBe(first.evaluation.revision);
  expect(waiting.feedbackStatus).toBe('delayed');
  release();
  await Promise.all(f.pending);
  const current = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
  expect(current.feedbackStatus).toBe('current');
  expect(current.evaluation.revision).toBe(current.revision);
  await f.session.fetch(request('end'));
}, 10_000);

for (const newerReply of [false, true]) test(`director ${newerReply ? 'rejects a new settled reply' : 'allows continuing client audio'} during assessment`, async () => {
  let resolve!: () => void;
  let assessed!: () => void;
  const started = new Promise<void>(done => { assessed = done; });
  const f = await fixture({ overrides: {
    evaluateClient: async input => {
      assessed();
      await new Promise<void>(done => { resolve = done; });
      return { revision: input.revision, model: 'fixture', durationMs: 1, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, answers: {}, signals: [{ condition: 'role', probability: .99 }] };
    },
  } });
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'Sign today.', start_ms: 0, end_ms: 900 });
  await new Promise(resolve => setTimeout(resolve, 1100));
  f.socket.emit({ type: 'session.output_transcript.delta', delta: 'Sure,', start_ms: 1000, end_ms: 1500 });
  await started;
  f.socket.emit({ type: 'session.output_transcript.delta', delta: ' I can approve it.', start_ms: 1500, end_ms: 2000 });
  if (newerReply) {
    f.socket.emit({ type: 'session.input_transcript.delta', delta: 'Actually, ask your COO first.', start_ms: 2200, end_ms: 3100 });
    f.socket.emit({ type: 'session.output_transcript.delta', delta: 'Yes.', start_ms: 3200, end_ms: 3400 });
    await new Promise(resolve => setTimeout(resolve, 1300));
  }
  resolve();
  await Promise.all(f.pending);
  expect(f.socket.sent.filter(event => String(event.event_id).startsWith('cue-'))).toHaveLength(newerReply ? 0 : 1);
  const snapshot = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
  if (!newerReply) expect(snapshot.feedbackStatus).toBe('current');
  await f.session.fetch(request('end'));
  await waitFor(() => f.row()?.archive_state === 'final');
  expect(JSON.parse(f.row()!.interventions_json).filter((record: { source: string }) => record.source === 'director').map((record: { signal: { condition: string } }) => record.signal.condition)).toEqual(newerReply ? [] : ['role']);
  if (!newerReply) {
    const privateCue = f.socket.sent.find(event => String(event.event_id).startsWith('cue-'))?.content;
    expect(f.row()!.interventions_json).toContain(String(privateCue));
    expect(f.row()!.transcript_json).not.toContain(String(privateCue));
  }
});

test('live alarm checkpoints dialogue, then End saves the final public score and provenance', async () => {
  const f = await fixture();
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'Who owns the workflow?', start_ms: 100, end_ms: 1300 });
  f.socket.emit({ type: 'session.output_transcript.delta', delta: 'Operations owns it.', start_ms: 1400, end_ms: 2600 });
  setSystemTime(Date.now() + 30_000);
  await f.session.alarm();
  await Promise.all(f.pending);
  expect(f.row()).toMatchObject({
    id: attempt.id, scenario_id: 'sharepoint', client_id: 'morgan',
    archive_state: 'partial', session_status: 'live', finalization: 'pending', ended_at: null,
  });
  expect(JSON.parse(f.row()!.transcript_json).map((entry: { text: string }) => entry.text)).toEqual(['Who owns the workflow?', 'Operations owns it.']);

  const ended = await (await f.session.fetch(request('end'))).json() as Record<string, any>;
  expect(ended.status).toBe('ended');
  await waitFor(() => f.row()?.archive_state === 'final');
  const row = f.row()!;
  expect(row).toMatchObject({ archive_state: 'final', session_status: 'ended', finalization: 'confirmed', usage_seconds: 12 });
  expect(JSON.parse(row.transcript_json)).toEqual(ended.transcript);
  expect(JSON.parse(row.evaluation_json)).toEqual(ended.evaluation);
  expect(row.evaluation_json).not.toContain('answers');
  expect(row.evaluation_json).not.toContain('usage');
  expect(JSON.parse(row.provenance_json)).toMatchObject({ workerId: 'test-worker', workerTag: 'test-release', contextualDirector: { model: 'gpt-6.1-sol', effort: 'low' } });
  const stored = JSON.stringify(row);
  expect(stored).not.toContain(capability);
  expect(stored).not.toContain('provider-private-id');
  expect(stored).not.toContain('private actor brief');
  expect(stored).not.toContain(String(f.socket.sent.find(event => event.event_id === 'opening')?.content));
});

test('a live but silent attempt has a final archive; a creation failure has none', async () => {
  const silent = await fixture();
  await silent.session.fetch(request('start'));
  await silent.session.fetch(request('ready'));
  await silent.session.fetch(request('end'));
  await waitFor(() => silent.row()?.archive_state === 'final');
  expect(JSON.parse(silent.row()!.transcript_json)).toEqual([]);
  expect(silent.row()!.evaluation_json).toBeNull();

  const failed = await fixture({ overrides: { createLive: async () => { throw new Error('Provider unavailable'); } } });
  expect((await failed.session.fetch(request('start'))).status).toBe(502);
  await Promise.allSettled(failed.pending);
  expect(failed.row()).toBeNull();
});

test('failed final D1 save is best effort and closure lease cleanup continues', async () => {
  const f = await fixture();
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'I need a plan.', start_ms: 100, end_ms: 900 });
  f.archive.failNext();
  await f.session.fetch(request('end'));
  await Promise.all(f.pending);
  expect(f.row()).toBeNull();
  expect(f.values.get('lease')).toMatchObject({ closed: true });
  setSystemTime(Date.now() + 300_001);
  await f.session.alarm();
  expect(f.values.size).toBe(0);
  expect(f.row()).toBeNull();
});

test('a replacement owner near the limit finishes the checkpointed conversation and closes its provider', async () => {
  const active = await fixture();
  await active.session.fetch(request('start'));
  await active.session.fetch(request('ready'));
  active.socket.emit({ type: 'session.input_transcript.delta', delta: 'A captured question.', start_ms: 100, end_ms: 900 });
  setSystemTime(Date.now() + 30_000);
  await active.session.alarm();
  await Promise.all(active.pending);
  expect(active.row()?.archive_state).toBe('partial');
  // Too little time remains to hold it for a resume.
  setSystemTime(Date.now() + SESSION_LIMIT_SECONDS * 1000 - 40_000);
  const replacement = await fixture({ values: active.values, archive: active.archive });
  await replacement.session.alarm();
  await Promise.all(replacement.pending);
  expect(replacement.socket.sent.map(event => event.type)).toEqual(['session.close']);
  expect(replacement.row()).toMatchObject({ archive_state: 'final', session_status: 'interrupted', finalization: 'confirmed' });
  expect(JSON.parse(replacement.row()!.transcript_json)[0].text).toBe('A captured question.');
  const result = await (await replacement.session.fetch(request('poll'))).json() as Record<string, any>;
  expect(result.status).toBe('interrupted');
  expect(result.message).toContain('service restart');
  expect(replacement.values.get('checkpoint')).toBeUndefined();
  expect(replacement.values.get('lease')).toMatchObject({ closed: true });
  await active.session.fetch(request('end')); // Stop the original fixture's timer after simulating restart.
});

test('a failed partial save leaves closure scheduled and the next alarm can save current dialogue', async () => {
  const f = await fixture();
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'A first question.', start_ms: 100, end_ms: 900 });
  setSystemTime(Date.now() + 30_000);
  await f.session.fetch(request('poll'));
  f.archive.failNext();
  await f.session.alarm();
  await Promise.all(f.pending);
  expect(f.row()).toBeNull();
  expect(f.alarm()).toBeGreaterThan(Date.now());

  f.socket.emit({ type: 'session.output_transcript.delta', delta: 'Operations owns it.', start_ms: 1000, end_ms: 1900 });
  setSystemTime(Date.now() + 30_000);
  await f.session.fetch(request('poll'));
  await f.session.alarm();
  await Promise.all(f.pending);
  expect(f.row()).toMatchObject({ archive_state: 'partial', session_status: 'live' });
  expect(JSON.parse(f.row()!.transcript_json).map((entry: { text: string }) => entry.text)).toEqual(['A first question.', 'Operations owns it.']);
  await f.session.fetch(request('end'));
});

test('a stalled failing final save does not delay End or the provider closure alarm', async () => {
  const f = await fixture();
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  f.socket.readyState = 3;
  f.archive.failNext();
  const held = f.archive.holdNext();
  try {
    const ended = await (await f.session.fetch(request('end'))).json() as Record<string, unknown>;
    await held.started;
    expect(ended.finalization).toBe('unconfirmed');
    expect(f.values.get('lease')).toMatchObject({ closed: false });
    expect(f.alarm()).toBeGreaterThan(Date.now() + 14_000);
    expect(f.alarm()).toBeLessThan(Date.now() + 16_000);
  } finally { held.release(); }
  await Promise.all(f.pending);
  expect(f.row()).toBeNull();
});

test('missing version metadata is stored as null without losing the final archive', async () => {
  const f = await fixture({ metadata: false });
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  await f.session.fetch(request('end'));
  await Promise.all(f.pending);
  expect(f.row()?.archive_state).toBe('final');
  expect(JSON.parse(f.row()!.provenance_json)).toMatchObject({ workerId: null, workerTag: null });
});

test('a delayed live checkpoint cannot replace the completed archive', async () => {
  const f = await fixture();
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'The original question.', start_ms: 100, end_ms: 900 });
  setSystemTime(Date.now() + 30_000);
  const held = f.archive.holdNext();
  await f.session.alarm();
  await held.started;
  try {
    f.socket.emit({ type: 'session.input_transcript.delta', delta: ' The final detail.', start_ms: 1000, end_ms: 1500 });
    await f.session.fetch(request('end'));
    await waitFor(() => f.row()?.archive_state === 'final');
  } finally { held.release(); }
  await Promise.all(f.pending);
  expect(f.row()).toMatchObject({ archive_state: 'final', session_status: 'ended' });
  expect(JSON.parse(f.row()!.transcript_json).map((entry: { text: string }) => entry.text)).toEqual(['The original question. The final detail.']);
});
