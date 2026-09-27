import { Database } from 'bun:sqlite';
import { afterEach, expect, mock, setSystemTime, test } from 'bun:test';
import { emptyInterviewReadings } from '../../../core/interview';
import { emptySkills, SESSION_IDLE_TIMEOUT_MS, SESSION_IDLE_WARNING_MS, SESSION_LIMIT_SECONDS } from '../../../core/simulator/types';
import { TRANSCRIPT_LIMIT } from '../../../core/simulator/state';
import { LiveSessionGone } from './live.server';
import { parseArchive } from '../../../scripts/simulator-transcripts';

// Bun cannot load the Workers runtime. Substitute only its base-class/storage
// boundary and paid network adapters; exercise the actual session owner/events.
mock.module('cloudflare:workers', () => ({ DurableObject: class {
  constructor(protected ctx: DurableObjectState, protected env: Env) {}
} }));
const { SimulatorSession } = await import('./session');
const migration = await Bun.file(new URL('../../../migrations/0001_simulator_attempts.sql', import.meta.url)).text();
const interviewMigration = await Bun.file(new URL('../../../migrations/0002_interview_attempts.sql', import.meta.url)).text();
const interventionsMigration = await Bun.file(new URL('../../../migrations/0002_simulator_interventions.sql', import.meta.url)).text();
afterEach(() => setSystemTime());
async function waitFor(check: () => boolean) {
  const deadline = performance.now() + 2500;
  while (!check()) {
    if (performance.now() > deadline) throw new Error('Timed out waiting for the session event.');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
const capability = `Bearer ${'a'.repeat(64)}`;
const attempt = { id: 'c49f7954-7aab-47f9-a269-752932556c37', scenarioId: 'sharepoint', clientId: 'morgan', sdp: 'v=0\r\no=fixture-offer\r\n' };
const interviewAttempt = { ...attempt, scenarioId: 'project-closeout', clientId: 'sam-cedar' };
const request = (action: string, cap = capability, input = attempt) => new Request(`https://session/${action}`, { method: 'POST', headers: { Authorization: cap }, body: action === 'start' ? JSON.stringify(input) : undefined });
const activityPoll = (active: boolean, audio = false) => new Request('https://session/poll', { method: 'POST', headers: { Authorization: capability }, body: JSON.stringify({ active, audio }) });

test('contextual coaching runs for scored sessions and keeps actor history out of public state', async () => {
  let generations = 0;
  const f = await fixture({ overrides: {
    evaluateTrainee: async input => ({ revision: input.revision, skills: emptySkills(), objectives: [], privateDiagnostic: 'must never enter public feedback', concern: null, model: 'fixture', durationMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, answers: {}, signals: [{ condition: 'objective:problem', selected: true }] }),
    evaluateClient: async input => ({ revision: input.revision, model: 'fixture', durationMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, answers: {}, signals: [{ condition: 'role', probability: .99 }] }),
    generateDirector: async input => { generations++; return { action: 'intervene', text: input.audience === 'actor' ? 'PRIVATE: Ask the consultant to propose the scope.' : 'Ask which approval is currently blocked.', evidenceIds: [input.transcript[0]!.id], model: 'gpt-6-sol', usage: { inputTokens: 100, outputTokens: 15 } }; },
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
  expect(JSON.parse(f.row()!.provenance_json).contextualDirector).toMatchObject({ model: 'gpt-6-sol', effort: 'none' });
}, 10_000);

test('ending the session does not wait for pending contextual generation', async () => {
  let release!: () => void;
  const f = await fixture({ overrides: {
    evaluateTrainee: async input => ({ revision: input.revision, skills: emptySkills(), objectives: [], concern: null, model: 'fixture', durationMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, answers: {}, signals: [{ condition: 'stalled', probability: .99 }] }),
    generateDirector: async input => {
      await new Promise<void>(done => { release = done; });
      return { action: 'intervene', text: 'Late advice must not appear.', evidenceIds: [input.transcript[0]!.id], model: 'gpt-6-sol', usage: { inputTokens: 1, outputTokens: 1 } };
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

function archiveDatabase() {
  const sqlite = new Database(':memory:');
  sqlite.exec(migration);
  sqlite.exec(interviewMigration);
  sqlite.exec(interventionsMigration);
  let failNext = false;
  let held: { entered: () => void; wait: Promise<void> } | undefined;
  const d1 = {
    prepare: (sql: string) => ({
      bind: (...args: (string | number | null)[]) => ({
        run: async () => {
          const pause = held;
          held = undefined;
          if (pause) { pause.entered(); await pause.wait; }
          if (failNext) { failNext = false; throw new Error('D1 unavailable'); }
          sqlite.prepare(sql).run(...args);
          return { success: true };
        },
      }),
    }),
  } as unknown as D1Database;
  const row = () => sqlite.query('SELECT * FROM simulator_attempts WHERE id = ?').get(attempt.id) as Record<string, any> | null;
  const interviewRow = () => sqlite.query('SELECT * FROM interview_attempts WHERE id = ?').get(attempt.id) as Record<string, any> | null;
  const holdNext = () => {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    held = { entered, wait };
    return { started, release };
  };
  return { d1, row, interviewRow, failNext: () => { failNext = true; }, holdNext };
}

class ProviderSocket extends EventTarget {
  readyState = 1;
  holdClose = false;
  sent: Record<string, unknown>[] = [];
  send(text: string) {
    const event = JSON.parse(text);
    this.sent.push(event);
    if (event.type === 'session.close' && !this.holdClose) queueMicrotask(() => this.emit({ type: 'session.closed', reason: 'close_requested', usage: { seconds: 12 }, session: { instructions: 'private actor brief' } }));
  }
  emit(event: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) })); }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
}
type FixtureOptions = {
  pendingCreation?: Promise<void>;
  values?: Map<string, unknown>;
  overrides?: Partial<NonNullable<ConstructorParameters<typeof SimulatorSession>[2]>>;
  archive?: ReturnType<typeof archiveDatabase>;
  metadata?: boolean;
};
async function fixture({ pendingCreation, values = new Map<string, unknown>(), overrides = {}, archive = archiveDatabase(), metadata = true }: FixtureOptions = {}) {
  const socket = new ProviderSocket();
  let ready = Promise.resolve();
  let alarm = 0;
  let creations = 0;
  const judged: unknown[] = [];
  const interviewJudged: unknown[] = [];
  const pending: Promise<unknown>[] = [];
  const ctx = {
    storage: { get: async (key: string) => values.get(key), put: async (key: string, value: unknown) => { values.set(key, structuredClone(value)); }, setAlarm: async (value: number) => { alarm = value; }, deleteAll: async () => values.clear() },
    blockConcurrencyWhile: (fn: () => Promise<void>) => { ready = fn(); }, waitUntil: (promise: Promise<unknown>) => { pending.push(promise); },
  } as unknown as DurableObjectState;
  const session = new SimulatorSession(ctx, {
    OPENAI_API_KEY: 'fixture', TYPESAFE_API_KEY: 'fixture', OPENROUTER_API_KEY: 'fixture',
    SIMULATOR_DIRECTOR_ENABLED: overrides.evaluateClient || overrides.evaluateInterviewer ? 'true' : 'false',
    SIMULATOR_ARCHIVE: archive.d1,
    ...(!metadata ? {} : { CF_VERSION_METADATA: { id: 'test-worker', tag: 'test-release', timestamp: '2026-09-26T00:00:00.000Z' } }),
  } as Env, {
    createLive: async () => { creations++; await pendingCreation; return { session: { id: 'provider-private-id' }, transport: { type: 'webrtc', sdp: 'v=0\r\nanswer' } }; },
    attachLive: async () => socket as unknown as WebSocket,
    evaluateTrainee: async input => { judged.push(input.transcript); return { revision: input.revision, skills: emptySkills(), objectives: [], concern: null, model: 'fixture', durationMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, answers: {}, signals: [] }; },
    evaluateClient: async input => ({ revision: input.revision, model: 'fixture', durationMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, answers: {}, signals: [] }),
    generateDirector: async input => ({ action: 'intervene', text: 'Own only decisions within the client role.', evidenceIds: [input.transcript[0]!.id], model: 'gpt-6-sol', usage: { inputTokens: 1, outputTokens: 1 } }),
    recheckDirector: async () => ({ probability: .99, usage: { inputTokens: 1, outputTokens: 1 } }),
    evaluateInterview: async input => { interviewJudged.push(input.transcript); return { revision: input.revision, readings: emptyInterviewReadings(), objectives: [], model: 'fixture', durationMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, answers: {} }; },
    evaluateInterviewer: async () => { throw new Error('Interview director should be disabled.'); },
    ...overrides,
  });
  await ready;
  return { session, socket, values, judged, interviewJudged, pending, archive, row: archive.row, interviewRow: archive.interviewRow, creations: () => creations, alarm: () => alarm };
}

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

test('interview End preserves covered topics and returns pending before one summary completes', async () => {
  let releaseSummary!: (text: string) => void;
  const summaryResult = new Promise<string>(resolve => { releaseSummary = resolve; });
  const summarized: { speaker: string; text: string }[][] = [];
  const interviewJudged: { achievedIds: string[]; transcript: { speaker: string; text: string }[] }[] = [];
  const f = await fixture({ overrides: {
    evaluateInterview: async input => {
      interviewJudged.push({ achievedIds: [...(input.achievedIds ?? [])], transcript: input.transcript });
      const passage = input.transcript[0]!;
      return {
        revision: input.revision, readings: emptyInterviewReadings(),
        objectives: input.achievedIds?.includes('project-delivery') ? [] : [{ id: 'project-delivery', achieved: true, probability: .99, evidence: { entryId: passage.id, speaker: passage.speaker, text: passage.text } }],
        model: 'fixture', durationMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, answers: {},
      };
    },
    summarizeInterview: async input => { summarized.push(input.transcript); return summaryResult; },
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
    expect(covered).toMatchObject({ achieved: true, evidence: { speaker: 'trainee', text: 'We built a permit intake portal.' } });
    expect(interviewJudged[0]!.achievedIds).toEqual([]);
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
    expect(interviewJudged[1]!.achievedIds).toEqual(['project-delivery']);
    expect(interviewJudged[1]!.transcript.map(entry => entry.text)).toEqual(['We built a permit intake portal.', 'Jen resolved our access issue.']);
    expect(ended.interview.evaluation.objectives.find((item: { id: string }) => item.id === 'project-delivery')).toEqual(covered);
    await waitFor(() => summarized.length === 1);
    expect(summarized[0]!.map(entry => entry.speaker)).toEqual(['trainee', 'trainee']);
    expect(f.interviewRow()).toMatchObject({ archive_state: 'final', summary_status: 'pending' });
    expect(JSON.parse(f.interviewRow()!.evaluation_json).objectives.find((item: { id: string }) => item.id === 'project-delivery')).toEqual(covered);
    expect(f.row()).toBeNull();
    expect((await f.session.fetch(request('poll', `Bearer ${'b'.repeat(64)}`))).status).toBe(403);
    expect((await f.session.fetch(request('poll', ''))).status).toBe(401);

    releaseSummary('The participant credited Jen with resolving the access issue.');
    await Promise.all(f.pending);
    const ready = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
    expect(ready.interview.summary).toEqual({ status: 'ready', text: 'The participant credited Jen with resolving the access issue.' });
    expect(f.interviewRow()).toMatchObject({ summary_status: 'ready', summary_text: ready.interview.summary.text });
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
    summarizeInterview: async () => { throw new Error('Provider contained private request data.'); },
  } });
  await f.session.fetch(request('start', capability, interviewAttempt));
  await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'We shipped the migration despite the handoff delay.', start_ms: 100, end_ms: 900 });
  await f.session.fetch(request('end'));
  await Promise.all(f.pending);
  const snapshot = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
  expect(snapshot.interview.summary).toEqual({ status: 'unavailable', text: null });
  expect(f.interviewRow()).toMatchObject({ archive_state: 'final', summary_status: 'unavailable', summary_text: null });
  expect(JSON.parse(f.interviewRow()!.transcript_json)[0].text).toBe('We shipped the migration despite the handoff delay.');
  expect(JSON.stringify(snapshot)).not.toContain('Provider contained');
  expect(f.row()).toBeNull();
});

test('interview director repeats a useful cue only after fresh evidence and its cooldown', async () => {
  let directed = 0;
  let simulatorDirected = 0;
  let generated = 0;
  const f = await fixture({ overrides: {
    generateDirector: async () => { generated++; throw new Error('Interview producer is not implemented yet.'); },
    evaluateClient: async () => { simulatorDirected++; throw new Error('Wrong director.'); },
    evaluateInterviewer: async input => {
      directed++;
      return { revision: input.revision, cueId: 'follow-thread', cueProbability: .99, model: 'fixture', durationMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, answers: {} };
    },
    summarizeInterview: async () => 'The participant discussed the project.',
  } });
  const cues = () => f.socket.sent.filter(event => String(event.event_id).startsWith('cue-'));
  try {
    await f.session.fetch(request('start', capability, interviewAttempt));
    await f.session.fetch(request('ready'));
    f.socket.emit({ type: 'session.input_transcript.delta', delta: 'The access handoff took three weeks.', start_ms: 100, end_ms: 900 });
    setSystemTime(Date.now() + 2000);
    await f.session.fetch(activityPoll(true));
    await waitFor(() => cues().length === 1);

    f.socket.emit({ type: 'session.input_transcript.delta', delta: 'Jen eventually found the owner.', start_ms: 2000, end_ms: 2900 });
    setSystemTime(Date.now() + 30_000);
    await f.session.fetch(activityPoll(true));
    await waitFor(() => directed >= 2);
    expect(cues()).toHaveLength(1);

    setSystemTime(Date.now() + 91_000);
    await f.session.fetch(activityPoll(true));
    await new Promise(resolve => setTimeout(resolve, 600));
    expect(cues()).toHaveLength(1);
    expect(directed).toBe(2);
    f.socket.emit({ type: 'session.input_transcript.delta', delta: 'We made the ownership clear for the next team.', start_ms: 4000, end_ms: 4900 });
    setSystemTime(Date.now() + 2000);
    await f.session.fetch(activityPoll(true));
    await waitFor(() => cues().length === 2);
    expect(simulatorDirected).toBe(0);
    expect(generated).toBe(0);
    const snapshot = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
    expect(snapshot.coaching).toBeNull();
    expect(JSON.stringify(snapshot)).not.toContain(String(cues()[0]!.content));
  } finally {
    await f.session.fetch(request('end'));
  }
  await Promise.all(f.pending);
  expect(JSON.parse(f.interviewRow()!.cues_json)).toHaveLength(2);
  expect(JSON.parse(f.interviewRow()!.provenance_json).directorEnabled).toBe(true);
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
test('server alarm closes abandoned practice without browser cooperation', async () => {
  const f = await fixture();
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  expect(f.alarm()).toBeGreaterThan(Date.now());
  setSystemTime(Date.now() + 40_000);
  await f.session.alarm();
  const result = await (await f.session.fetch(request('poll'))).json() as Record<string, unknown>;
  expect(result.status).toBe('ended');
  expect(result.finalization).toBe('confirmed');
  expect(f.socket.sent.some(event => event.type === 'session.close')).toBe(true);
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

test('the shared consultant ownership correction reaches only the actor', async () => {
  const f = await fixture({ overrides: {
    evaluateClient: async input => ({ revision: input.revision, model: 'fixture', durationMs: 1, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, answers: {}, signals: [{ condition: 'role', probability: .99 }] }),
  } });
  await f.session.fetch(request('start'));
  await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'Please design the consultancy plan for me.', start_ms: 0, end_ms: 900 });
  await waitFor(() => f.socket.sent.some(event => String(event.event_id).startsWith('cue-')));
  await Promise.all(f.pending);
  const cue = f.socket.sent.find(event => String(event.event_id).startsWith('cue-'))!;
  expect(cue).toMatchObject({ type: 'session.thinking.append', delegation_id: null });
  const snapshot = await (await f.session.fetch(request('poll'))).json() as Record<string, unknown>;
  expect(JSON.stringify(snapshot)).not.toContain(String(cue.content));
  await f.session.fetch(request('end'));
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
  await new Promise(resolve => setTimeout(resolve, 1600));
  const first = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
  expect(first.feedbackStatus).toBe('current');
  f.socket.emit({ type: 'session.output_transcript.delta', delta: 'Operations does, but do not contact them yet.', start_ms: 1100, end_ms: 2300 });
  await new Promise(resolve => setTimeout(resolve, 1600));
  const waiting = await (await f.session.fetch(request('poll'))).json() as Record<string, any>;
  expect(waiting.evaluation.revision).toBe(first.evaluation.revision);
  expect(waiting.feedbackStatus).toBe('delayed');
  // Wait for the owner cadence to start the next request, then release its result.
  while (!release) await new Promise(resolve => setTimeout(resolve, 100));
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
  expect(JSON.parse(row.provenance_json)).toMatchObject({ workerId: 'test-worker', workerTag: 'test-release', contextualDirector: { model: 'gpt-6-sol', effort: 'none' } });
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

test('restart closes the provider and leaves the last successful checkpoint partial', async () => {
  const active = await fixture();
  await active.session.fetch(request('start'));
  await active.session.fetch(request('ready'));
  active.socket.emit({ type: 'session.input_transcript.delta', delta: 'A captured question.', start_ms: 100, end_ms: 900 });
  setSystemTime(Date.now() + 30_000);
  await active.session.alarm();
  await Promise.all(active.pending);
  expect(active.row()?.archive_state).toBe('partial');
  const replacement = await fixture({ values: active.values, archive: active.archive });
  await replacement.session.alarm();
  expect(replacement.row()).toMatchObject({ archive_state: 'partial', session_status: 'live', finalization: 'pending' });
  expect(JSON.parse(replacement.row()!.transcript_json)[0].text).toBe('A captured question.');
  expect((await replacement.session.fetch(request('poll'))).status).toBe(410);
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
