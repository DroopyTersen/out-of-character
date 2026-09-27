import { afterEach, expect, setSystemTime, test } from 'bun:test';
import { ContextualDirector, directorServices } from './contextual-director';
import type { DirectorSignal } from '../../../core/simulator/director';
import { emptySkills, type SessionSnapshot, type TranscriptEntry } from '../../../core/simulator/types';

afterEach(() => setSystemTime());
const epoch = 1_800_000_000_000;
const passage = (id: string, speaker: 'client' | 'trainee', text: string): TranscriptEntry => ({ id, speaker, text, startMs: 0, endMs: 1000 });
function fixture(overrides: Partial<typeof directorServices> = {}) {
  setSystemTime(epoch);
  const snapshot: SessionSnapshot = {
    id: 'attempt', scenarioId: 'proposal', clientId: 'morgan', status: 'live', startedAt: epoch, limitSeconds: 3600,
    warning: null, revision: 1, transcript: [passage('p1', 'client', 'I need a proposal by Friday.'), passage('p2', 'trainee', 'We have lots of features.')],
    evaluation: null, coaching: null, feedbackStatus: 'waiting', message: null, finalization: 'pending', usageSeconds: null,
  };
  const sent: Record<string, unknown>[] = [];
  const calls: Parameters<typeof directorServices.generateDirector>[0][] = [];
  const director = new ContextualDirector({
    scenarioId: snapshot.scenarioId, clientId: snapshot.clientId, objectives: () => snapshot.evaluation?.objectives ?? [],
    isFresh: transcript => JSON.stringify(transcript) === JSON.stringify(snapshot.transcript), openaiKey: 'openai-fixture', typesafeKey: 'typesafe-fixture',
    settled: () => snapshot.transcript, send: value => { sent.push(value); return true; },
    services: {
      generateDirector: async input => { calls.push(input); return { action: 'intervene', text: input.audience === 'trainee' ? 'Ask what decision Friday supports.' : 'Ask the consultant to own the delivery recommendation.', evidenceIds: ['p1'], model: 'gpt-6-sol', usage: { inputTokens: 100, outputTokens: 20 } }; },
      recheckDirector: async () => ({ probability: .99, usage: { inputTokens: 20, outputTokens: 2 } }),
      ...overrides,
    },
  });
  const observe = (signals: DirectorSignal[] = [{ condition: 'objective:decision', selected: true }], audience: 'trainee' | 'actor' = 'trainee', capturedAt = Date.now()) => director.observe({ audience, signals, transcript: [...snapshot.transcript], revision: snapshot.revision, capturedAt });
  return { snapshot, director, sent, calls, observe };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const result = { action: 'intervene' as const, text: 'Ask what decision Friday supports.', evidenceIds: ['p1'], model: 'gpt-6-sol', usage: { inputTokens: 100, outputTokens: 20 } };

test('hint publication is independent from scoring, expires, and does not repeat on an idle snapshot', async () => {
  const f = fixture();
  await f.observe();
  expect(f.director.coaching()?.text).toBe('Ask what decision Friday supports.');
  expect(f.snapshot.evaluation).toBeNull();
  expect(f.sent).toHaveLength(0);
  await f.observe();
  expect(f.calls).toHaveLength(1);
  setSystemTime(epoch + 30_001);
  expect(f.director.coaching()).toBeNull();
  await f.observe();
  expect(f.calls).toHaveLength(1);
});

test('generated concern replaces immediate concern under the same identity and clears on resolution', async () => {
  const pending = deferred<typeof result>();
  const f = fixture({ generateDirector: () => pending.promise });
  const work = f.observe([{ condition: 'mistake', probability: .99 }]);
  const immediate = f.director.coaching()!;
  expect(immediate.kind).toBe('concern');
  expect(immediate.text).toContain('commitment or claim');
  pending.resolve(result);
  await work;
  expect(f.director.coaching()!.id).toBe(immediate.id);
  expect(f.director.coaching()!.text).toBe(result.text);
  await f.observe([{ condition: 'mistake', probability: .1 }]);
  expect(f.director.coaching()).toBeNull();
});

test('a published objective hint survives choice noise and clears when the objective is achieved', async () => {
  const f = fixture();
  await f.observe();
  const hint = f.director.coaching();
  await f.observe([{ condition: 'objective:decision', selected: false }]);
  expect(f.director.coaching()).toEqual(hint);
  f.snapshot.evaluation = { revision: 2, skills: emptySkills(), objectives: [{ id: 'decision', achieved: true, probability: .99, evidence: null }], concern: null, model: 'fixture', durationMs: 1 };
  expect(f.director.coaching()).toBeNull();
});

test('an obsolete mistake judgment cannot show a concern after newer speech', async () => {
  const f = fixture();
  const transcript = [...f.snapshot.transcript];
  f.snapshot.transcript.push(passage('p3', 'trainee', 'I retract that guarantee. We need an estimate first.'));
  await f.director.observe({ audience: 'trainee', signals: [{ condition: 'mistake', probability: .99 }], transcript, revision: 1, capturedAt: epoch });
  expect(f.director.coaching()).toBeNull();
  expect(f.calls).toHaveLength(0);
  expect(f.director.summary().staleGates).toBe(1);
});

test('six submitted actor notes stop generation even when the provider rejects them', async () => {
  const f = fixture();
  for (let i = 0; i < 8; i++) {
    setSystemTime(epoch + i * 21_000);
    f.snapshot.transcript.push(passage(`client-${i}`, 'client', 'I can approve the whole release.'));
    f.snapshot.revision++;
    await f.observe([{ condition: 'role', probability: .1 }], 'actor');
    await f.observe([{ condition: 'role', probability: .99 }], 'actor');
    f.director.providerEvent(String(f.sent.at(-1)?.event_id), false);
  }
  expect(f.sent).toHaveLength(6);
  expect(f.calls).toHaveLength(6);
  expect(f.director.canObserveActor).toBe(false);
  expect(f.director.records.every(row => row.source === 'director' && row.delivery?.status === 'rejected')).toBe(true);
});

test('both audiences can run while generation is pending, and none suppresses repeated reviews', async () => {
  const pending = deferred<ReturnType<typeof directorServices.generateDirector> extends Promise<infer T> ? T : never>();
  const f = fixture({ generateDirector: () => pending.promise });
  const coach = f.observe();
  const actor = f.observe([{ condition: 'role', probability: .99 }], 'actor');
  expect(f.director.summary().calls).toBe(2);
  pending.resolve({ ...result, action: 'none', text: null, evidenceIds: [] });
  await Promise.all([coach, actor]);
  expect(f.director.coaching()).toBeNull();
  expect(f.sent).toHaveLength(0);
  setSystemTime(epoch + 21_000);
  await f.observe();
  expect(f.director.summary().calls).toBe(2);
  expect(f.director.records.map(row => row.outcome)).toEqual(['none', 'none']);
});

test('new speech from either speaker revalidates a hint; a resolved question is discarded', async () => {
  for (const speaker of ['client', 'trainee'] as const) {
    const pending = deferred<typeof result>();
    let checked = 0;
    const f = fixture({ generateDirector: () => pending.promise, recheckDirector: async input => { checked++; expect(input.transcript.at(-1)?.speaker).toBe(speaker); expect(input.apiKey).toBe('typesafe-fixture'); return { probability: .05, usage: { inputTokens: 20, outputTokens: 2 } }; } });
    const work = f.observe();
    f.snapshot.transcript.push(passage('p3', speaker, 'Friday is just the funding planning meeting.'));
    f.snapshot.revision++;
    pending.resolve(result);
    await work;
    expect(checked).toBe(1);
    expect(f.director.coaching()).toBeNull();
    expect(f.director.records[0]?.outcome).toBe('stale');
  }
});

test('one successful recheck may publish, but another settled change discards without retrying', async () => {
  for (const changeAgain of [false, true]) {
    const generated = deferred<typeof result>();
    const checked = deferred<{ probability: number; usage: { inputTokens: number; outputTokens: number } }>();
    let started!: () => void;
    const rechecking = new Promise<void>(done => { started = done; });
    const f = fixture({ generateDirector: () => generated.promise, recheckDirector: () => { started(); return checked.promise; } });
    const work = f.observe();
    f.snapshot.transcript.push(passage('p3', 'client', 'Mm.'));
    generated.resolve(result);
    await rechecking;
    if (changeAgain) f.snapshot.transcript.push(passage('p4', 'trainee', 'What happens on Friday?'));
    checked.resolve({ probability: .99, usage: { inputTokens: 10, outputTokens: 1 } });
    await work;
    expect(!!f.director.coaching()).toBe(!changeAgain);
    expect(f.director.summary().rechecks).toBe(1);
  }
});

test('a slower director response can publish after twelve seconds when still relevant', async () => {
  for (const audience of ['trainee', 'actor'] as const) {
    const pending = deferred<typeof result>();
    const f = fixture({ generateDirector: () => pending.promise });
    const work = f.observe([{ condition: audience === 'trainee' ? 'stalled' : 'role', probability: .99 }], audience);
    setSystemTime(epoch + 12_000);
    pending.resolve(result);
    await work;
    expect(f.director.records[0]?.outcome).toBe(audience === 'trainee' ? 'published' : 'sent');
  }
});

test('a slower response still needs an applicability check against newer speech', async () => {
  const pending = deferred<typeof result>();
  let checks = 0;
  const f = fixture({ generateDirector: () => pending.promise, recheckDirector: async input => {
    checks++;
    expect(input.transcript.at(-1)?.text).toBe('What decision does Friday support?');
    return { probability: .05, usage: { inputTokens: 20, outputTokens: 2 } };
  } });
  const work = f.observe();
  setSystemTime(epoch + 12_000);
  f.snapshot.transcript.push(passage('p3', 'trainee', 'What decision does Friday support?'));
  pending.resolve(result);
  await work;
  expect(checks).toBe(1);
  expect(f.director.coaching()).toBeNull();
  expect(f.director.records[0]?.outcome).toBe('stale');
});

test('expired or obsolete gates never spend, and late generation cannot publish', async () => {
  const f = fixture();
  await f.observe(undefined, 'trainee', epoch - 17_001);
  expect(f.calls).toHaveLength(0);
  await f.director.observe({ audience: 'trainee', signals: [{ condition: 'stalled', probability: .99 }], transcript: [], revision: 0, capturedAt: epoch });
  expect(f.calls).toHaveLength(0);
  const pending = deferred<typeof result>();
  const late = fixture({ generateDirector: () => pending.promise });
  const work = late.observe();
  setSystemTime(epoch + 20_001);
  pending.resolve(result);
  await work;
  expect(late.director.coaching()).toBeNull();
  expect(late.director.records[0]?.outcome).toBe('timeout');
});

test('actor directions remain private and record provider rejection without changing public state', async () => {
  const f = fixture();
  await f.observe([{ condition: 'role', probability: .99 }], 'actor');
  expect(f.sent).toHaveLength(1);
  const event = f.sent[0]!;
  expect(event).toMatchObject({ type: 'session.thinking.append', delegation_id: null });
  expect(String(event.event_id)).toStartWith('cue-');
  expect(JSON.stringify(f.snapshot)).not.toContain('delivery recommendation');
  expect(f.director.records.find(row => row.source === 'director')?.delivery?.status).toBe('unknown');
  f.director.providerEvent(String(event.event_id), true);
  expect(f.director.records.find(row => row.source === 'director')?.delivery?.status).toBe('accepted');
  f.director.providerEvent(String(event.event_id), false);
  expect(f.director.records.find(row => row.source === 'director')?.delivery?.status).toBe('rejected');
  expect(f.snapshot.message).toBeNull();
});

test('closing aborts generation and freezes terminal records despite a late completion', async () => {
  const pending = deferred<typeof result>();
  let signal: AbortSignal | undefined;
  const f = fixture({ generateDirector: input => { signal = input.signal; return pending.promise; } });
  const work = f.observe();
  f.director.close();
  const closed = structuredClone(f.director.records);
  expect(signal?.aborted).toBe(true);
  pending.resolve(result);
  await work;
  expect(f.director.records).toEqual(closed);
  expect(f.director.records[0]?.outcome).toBe('aborted');
  expect(f.director.coaching()).toBeNull();
});


test('a pending objective hint uses current applicability, not a later choice, and never outlives achievement', async () => {
  for (const achieved of [false, true]) {
    const pending = deferred<typeof result>();
    let rechecks = 0;
    const f = fixture({ generateDirector: () => pending.promise, recheckDirector: async () => { rechecks++; return { probability: .99, usage: { inputTokens: 20, outputTokens: 2 } }; } });
    const work = f.observe();
    f.snapshot.transcript.push(passage('p3', 'client', 'Mm-hm.'));
    f.snapshot.revision++;
    f.snapshot.evaluation = { revision: 2, skills: emptySkills(), objectives: [{ id: 'decision', achieved, probability: achieved ? .99 : .1, evidence: null }], concern: null, model: 'fixture', durationMs: 1 };
    await f.observe([{ condition: 'objective:decision', selected: false }]);
    pending.resolve(result);
    await work;
    expect(rechecks).toBe(1);
    expect(f.director.coaching()?.text ?? null).toBe(achieved ? null : result.text);
    expect(f.director.records[0]?.outcome).toBe(achieved ? 'stale' : 'published');
  }
});


test('a failed applicability check publishes nothing and does not invent a measured duration', async () => {
  const pending = deferred<typeof result>();
  const f = fixture({ generateDirector: () => pending.promise, recheckDirector: async () => { throw new DOMException('Deadline', 'TimeoutError'); } });
  const work = f.observe();
  f.snapshot.transcript.push(passage('p3', 'client', 'We now have the answer.'));
  pending.resolve(result);
  await work;
  expect(f.director.coaching()).toBeNull();
  expect(f.director.records[0]).toMatchObject({ outcome: 'timeout', recheck: { probability: null, durationMs: null } });
});
