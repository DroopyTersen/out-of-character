import { fixtureFoundryEnv } from '../../../ai/foundry-fixture';
import { Database } from 'bun:sqlite';
import { mock } from 'bun:test';
import { emptySkills } from '../../../core/simulator/types';
import { emptyInterviewReadings } from '../../../core/interview';
import { threadKey } from '../../../core/interview-ranking';

// Bun cannot load the Workers runtime. Substitute only its base-class/storage
// boundary and paid network adapters; exercise the actual session owner/events.
mock.module('cloudflare:workers', () => ({ DurableObject: class {
  constructor(protected ctx: DurableObjectState, protected env: Env) {}
} }));
const { SimulatorSession } = await import('./session');
const migration = await Bun.file(new URL('../../../migrations/0001_simulator_attempts.sql', import.meta.url)).text();
const interventionsMigration = await Bun.file(new URL('../../../migrations/0002_simulator_interventions.sql', import.meta.url)).text();
const reportMigration = await Bun.file(new URL('../../../migrations/0003_simulator_report.sql', import.meta.url)).text();
const interviewMigration = await Bun.file(new URL('../../../migrations/0002_interview_attempts.sql', import.meta.url)).text();
const interviewInterventionsMigration = await Bun.file(new URL('../../../migrations/0003_interview_interventions.sql', import.meta.url)).text();
export async function waitFor(check: () => boolean, timeout = 2500) {
  const deadline = performance.now() + timeout;
  while (!check()) {
    if (performance.now() > deadline) throw new Error('Timed out waiting for the session event.');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
export const capability = `Bearer ${'a'.repeat(64)}`;
export const attempt = { id: 'c49f7954-7aab-47f9-a269-752932556c37', scenarioId: 'sharepoint', clientId: 'morgan', sdp: 'v=0\r\no=fixture-offer\r\n' };
export const request = (action: string, cap = capability, input = attempt) => new Request(`https://session/${action}`, { method: 'POST', headers: { Authorization: cap }, body: action === 'start' ? JSON.stringify(input) : action === 'poll' ? JSON.stringify({ active: false, audio: false, outputQuietMs: 60_000 }) : undefined });
// The fake media endpoint has no Sam audio; quietMs is only a legacy client field.
export const activityPoll = (active: boolean, audio = false, quietMs?: number | null) => new Request('https://session/poll', { method: 'POST', headers: { Authorization: capability }, body: JSON.stringify({ active, audio, outputQuietMs: 60_000, ...(quietMs === undefined ? {} : { quietMs }) }) });

function archiveDatabase() {
  const sqlite = new Database(':memory:');
  sqlite.exec(migration);
  sqlite.exec(interventionsMigration);
  sqlite.exec(reportMigration);
  sqlite.exec(interviewMigration);
  sqlite.exec(interviewInterventionsMigration);
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
          const result = sqlite.prepare(sql).run(...args);
          return { success: true, meta: { changes: result.changes } };
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
export async function fixture({ pendingCreation, values = new Map<string, unknown>(), overrides = {}, archive = archiveDatabase(), metadata = true }: FixtureOptions = {}) {
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
    ...fixtureFoundryEnv, TYPESAFE_API_KEY: 'fixture',
    SIMULATOR_ARCHIVE: archive.d1,
    ...(!metadata ? {} : { CF_VERSION_METADATA: { id: 'test-worker', tag: 'test-release', timestamp: '2026-09-26T00:00:00.000Z' } }),
  } as Env, {
    createLive: async () => { creations++; await pendingCreation; return { session: { id: 'provider-private-id' }, transport: { type: 'webrtc', sdp: 'v=0\r\nanswer' } }; },
    attachLive: async () => socket as unknown as WebSocket,
    evaluateTrainee: async input => { judged.push(input.transcript); return { revision: input.revision, skills: emptySkills(), objectives: [], concern: null, model: 'fixture', durationMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, answers: {}, signals: [] }; },
    evaluateClient: async input => ({ revision: input.revision, model: 'fixture', durationMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, answers: {}, signals: [] }),
    generateDirector: async input => ({ action: 'intervene', text: 'Own only decisions within the client role.', evidenceIds: [input.transcript[0]!.id], model: 'gpt-6.1-sol', usage: { inputTokens: 1, outputTokens: 1 } }),
    recheckDirector: async () => ({ probability: .99, usage: { inputTokens: 1, outputTokens: 1 } }),
    generateMap: async input => ({ map: input.previous, update: { keep: [], drop: [], participant: null, entities: [], edges: [], threads: [] }, changes: { added: [], changed: [], dropped: [], kept: [] }, research: null, model: 'gpt-6.1-sol', usage: { inputTokens: 1, outputTokens: 1 } }),
    evaluateTurn: async input => ({ reading: { passageId: input.transcript.at(-1)!.id, atMs: input.atMs, focus: null, keys: {}, natural: {}, states: {}, novel: 0 }, model: 'fixture', durationMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, answers: {} }),
    evaluateTraits: async input => ({ traits: Object.fromEntries(input.threads.map(thread => [thread.id, { key: threadKey(thread), spicy: 0, grounding: 0 }])), model: 'fixture', durationMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }),
    lookupInterviewBackground: async () => ({ status: 'unresolved', reason: 'fixture', queries: [] }),
    generateReport: () => { throw new Error('No report provider configured in this fixture.'); },
    evaluateInterview: async input => { interviewJudged.push(input.transcript); return { revision: input.revision, readings: emptyInterviewReadings(), objectives: [], model: 'fixture', durationMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, answers: {} }; },
    summarizeInterview: (_input, done) => new ReadableStream({ start(controller) { const report = { text: 'Fixture summary.' }; controller.enqueue(JSON.stringify(report)); done({ report, failure: null, usage: null }); controller.close(); } }),
    ...overrides,
  });
  await ready;
  return { session, socket, values, judged, interviewJudged, pending, archive, row: archive.row, interviewRow: archive.interviewRow, creations: () => creations, alarm: () => alarm };
}
