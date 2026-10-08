import { fixtureFoundryEnv } from '../../../ai/foundry-fixture';
import { emptyInterviewReadings } from '../../../core/interview';
import { threadKey } from '../../../interview-engine/interview/conversation/ranking';
import type { SessionServices } from '../../../interview-engine/interview/interview.server';
import { interviewerBrief } from '../../../interview-engine/interview/voice/brief.server';
import type { Providers } from '../../../interview-engine/providers/providers.server';
import { spec } from '../../../interviews/project-closeout/spec';
// The simulator fixture substitutes the Workers base class before anything imports it.
import { archiveDatabase, attempt, ProviderSocket } from '../simulator/session-fixture';
import type { Narrative, NarrativeRun } from '../../../interview-engine/narrative/narrative.server';
import type { Narrate } from './narrative';
import { socketPair } from '../../../interview-engine/client/testSocket';

const { InterviewObject } = await import('./durableObject');

export const interviewAttempt = { ...attempt, scenarioId: 'project-closeout', clientId: 'sam-cedar' };
const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };

/** A narrative run that writes `text` as its JSON document at once and completes. */
export const unmetered = { inputTokens: null, outputTokens: null, reasoningTokens: null, cachedTokens: null };
export const narrated = (text: string, usage: NonNullable<Narrative['usage']> = unmetered): NarrativeRun => {
  const document = { text };
  return { stream: new ReadableStream({ start(controller) { controller.enqueue(JSON.stringify(document)); controller.close(); } }), result: Promise.resolve({ document, failure: null, usage }) };
};

/** Durable Object storage as far as the store uses it, with its writes and the alarm visible. */
export function fakeStorage(values = new Map<string, unknown>()) {
  const calls: string[] = [];
  let alarm: number | null = null;
  const storage = {
    get: async (key: string) => structuredClone(values.get(key)),
    put: async (key: string, value: unknown) => { calls.push(`put ${key}`); values.set(key, structuredClone(value)); },
    delete: async (key: string) => { calls.push(`delete ${key}`); return values.delete(key); },
    setAlarm: async (at: number) => { calls.push('setAlarm'); alarm = at; },
    deleteAlarm: async () => { calls.push('deleteAlarm'); alarm = null; },
    deleteAll: async () => { calls.push('deleteAll'); values.clear(); },
  };
  return { storage: storage as unknown as DurableObjectStorage, values, calls, alarm: () => alarm };
}

type Options = {
  values?: Map<string, unknown>;
  /** Replaces the fixture's services, and its narrative when `narrate` is given. */
  overrides?: Partial<SessionServices> & { narrate?: Narrate };
  archive?: ReturnType<typeof archiveDatabase>;
  /** The first created provider session's id; a replacement owner needs its own to keep sessions distinct. */
  provider?: string;
};

/**
 * The interview object over the practice simulator's fixture parts: the same fake provider sockets, the same archive
 * database and the same storage map, so a test reads like the practice simulator's session tests.
 */
export async function objectFixture({ values = new Map<string, unknown>(), overrides: { narrate, ...services } = {}, archive = archiveDatabase(), provider = 'provider-private-id' }: Options = {}) {
  const sockets = new Map<string, ProviderSocket>([[provider, new ProviderSocket()]]);
  let latest: string | undefined;
  const socketFor = (id: string) => {
    if (!sockets.has(id)) sockets.set(id, new ProviderSocket());
    return sockets.get(id)!;
  };
  /** Each provider session's resume context: what its instructions add after Sam's brief. */
  const created: { context?: string }[] = [];
  let creations = 0;
  const interviewJudged: unknown[] = [];
  const pending: Promise<unknown>[] = [];
  let ready = Promise.resolve();
  const storage = fakeStorage(values);
  const ctx = {
    storage: storage.storage,
    blockConcurrencyWhile: (fn: () => Promise<void>) => { ready = fn(); }, waitUntil: (promise: Promise<unknown>) => { pending.push(promise); },
  } as unknown as DurableObjectState;
  const voice = {
    create: async (input: { voice: string; instructions: string }) => {
      const id = latest = ++creations === 1 ? provider : `${provider}-${creations}`;
      const context = input.instructions.slice(interviewerBrief(spec, interviewAttempt.clientId).length).trim();
      created.push(context ? { context } : {});
      socketFor(id);
      return { id, sdp: 'v=0\r\nanswer' };
    },
    attach: async (id: string) => socketFor(id),
    close: async () => {},
  };
  let pair = socketPair();
  const allow = { limit: async () => ({ success: true }) };
  const session = new InterviewObject(ctx, {
    ...fixtureFoundryEnv, TYPESAFE_API_KEY: 'fixture', SIMULATOR_ARCHIVE: archive.d1,
    SIMULATOR_ENABLED: 'true', PAID_SERVICES_ENABLED: 'true', RATE_SIMULATOR: allow, RATE_JUDGE: allow,
    CF_VERSION_METADATA: { id: 'test-worker', tag: 'test-release', timestamp: '2026-09-26T00:00:00.000Z' },
  } as unknown as Env, {
    providers: { voice, language: {}, judge: {} } as unknown as Providers,
    services: {
      generateMap: async input => ({ map: input.previous, update: { vantage: null, preferences: null, entities: [], edges: [], threads: [], revise: [], close: [], drop: [] }, changes: { added: [], changed: [], dropped: [], kept: [] }, research: null, pace: { verdict: 'explore' as const, reason: 'Open threads remain.' }, model: 'gpt-6.1-sol', usage: { inputTokens: 1, outputTokens: 1 } }),
      evaluateTurn: async input => ({ reading: { passageId: input.transcript.at(-1)!.id, atMs: input.atMs, focus: null, keys: {}, natural: {}, states: {}, novel: 0 }, model: 'fixture', durationMs: 1, usage, answers: {} }),
      evaluateTraits: async input => ({ traits: Object.fromEntries(input.threads.map(thread => [thread.id, { key: threadKey(thread), spicy: .5, grounding: 0 }])), model: 'fixture', durationMs: 1, usage }),
      lookupInterviewBackground: async () => ({ status: 'unresolved', reason: 'fixture', queries: [] }),
      evaluate: async input => { interviewJudged.push(input.transcript); return { revision: input.revision, readings: emptyInterviewReadings(), objectives: [], model: 'fixture', durationMs: 1 }; },
      ...services,
    },
    narrate: narrate ?? (() => narrated('Fixture summary.')),
    upgrade: () => ({ socket: pair.server, response: new Response(null) }),
  });
  await ready;
  return {
    session, values, interviewJudged, pending, archive, row: archive.row, interviewRow: archive.interviewRow, creations: () => creations, alarm: storage.alarm, storageCalls: storage.calls,
    /** The newest created provider session's socket, or the newest attached one before any creation. */
    get socket() { return latest ? sockets.get(latest)! : [...sockets.values()].at(-1)!; },
    socketFor: (id: string) => sockets.get(id),
    sockets: () => [...sockets.values()], created,
    /** Opens a browser socket to the object as the Worker forwards an enabled upgrade; it opens once the object accepts. */
    openSocket(url: string) {
      const current = pair = socketPair();
      void session.fetch(new Request(url.replace(/^ws/, 'http'), { headers: { Upgrade: 'websocket', Origin: new URL(url.replace(/^ws/, 'http')).origin } })).then(() => current.accept());
      return current.browser;
    },
  };
}
