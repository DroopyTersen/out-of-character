import { expect, test } from 'bun:test';
import { NarrativeRunner, within, type Narrative, type NarrativeRun, type SettledNarrative } from './narrativeRun.server';

// Ported from app/server/simulator/report.test.ts: the same lifecycle over a NarrativeRun instead of a finish callback.

const text = '## Project closeout\n\nThe team shipped the migration two weeks late.';
const usage = { inputTokens: 100, outputTokens: 50, reasoningTokens: 20, cachedTokens: 0 };
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const signal = (aborted = false) => { const controller = new AbortController(); if (aborted) controller.abort(); return controller.signal; };

test('idle reads are immediate, concurrent starts conflict, success is kept and settles before archive work', async () => {
  const saved: SettledNarrative[] = [];
  let calls = 0, stream!: ReadableStreamDefaultController<string>;
  const result = deferred<Narrative>();
  const runner = new NarrativeRunner(() => { calls++; return { stream: new ReadableStream({ start(controller) { stream = controller; } }), result: result.promise }; }, { onSettled: value => { saved.push(value); } });
  expect((await runner.read()).status).toBe('idle');
  expect(runner.state().starts).toBe(0);
  const response = runner.attach(signal());
  expect(response.headers.get('Content-Encoding')).toBe('identity');
  expect(runner.attach(signal()).status).toBe(409);
  const output = response.text();
  let readReturned = false;
  const reading = runner.read().then(value => { readReturned = true; return value; });
  await Promise.resolve(); expect(readReturned).toBe(false);
  stream.enqueue(text);
  stream.close();
  result.resolve({ document: { text }, failure: null, usage });
  expect(await output).toBe(text);
  expect(await reading).toEqual({ status: 'completed', starts: 1, document: { text }, failure: null });
  // A reloaded page gets the stored text without a second run.
  expect(await runner.attach(signal()).text()).toBe(text);
  expect(calls).toBe(1);
  expect(saved).toHaveLength(1);
  expect(saved[0]!.attempts[0]!.usage?.reasoningTokens).toBe(20);
});

test('one explicit retry is allowed and a late result cannot replace its outcome', async () => {
  const results: ReturnType<typeof deferred<Narrative>>[] = [];
  const saved: SettledNarrative[] = [];
  const runner = new NarrativeRunner((): NarrativeRun => {
    const result = deferred<Narrative>();
    results.push(result);
    return { stream: new ReadableStream({ pull(controller) { controller.error(new Error('provider dropped')); } }), result: result.promise };
  }, { onSettled: value => { saved.push(value); } });
  await runner.attach(signal()).text().catch(() => {});
  expect(runner.state()).toMatchObject({ status: 'failed', starts: 1, document: null });
  const retry = runner.attach(signal());
  results[0]!.resolve({ document: { text }, failure: null, usage });
  await Promise.resolve();
  expect(runner.state().status).toBe('running');
  await retry.text().catch(() => {});
  expect(runner.state()).toMatchObject({ status: 'failed', starts: 2 });
  expect(runner.attach(signal()).status).toBe(409);
  expect(saved[1]!.attempts).toHaveLength(2);
});

test('response cancellation and request abort stop the provider and record cancellation once', async () => {
  for (const byRequest of [false, true]) {
    const controller = new AbortController();
    let providerSignal: AbortSignal | undefined;
    const saved: SettledNarrative[] = [];
    const runner = new NarrativeRunner(runSignal => {
      providerSignal = runSignal;
      return { stream: new ReadableStream({ start(stream) { stream.enqueue('#'); } }), result: new Promise<Narrative>(() => {}) };
    }, { onSettled: value => { saved.push(value); } });
    const reader = runner.attach(controller.signal).body!.getReader();
    await reader.read();
    if (byRequest) controller.abort(); else await reader.cancel();
    expect((await runner.read()).failure).toBe('cancelled');
    expect(providerSignal!.aborted).toBe(true);
    expect(saved).toHaveLength(1);
  }
});

test('an independent deadline settles a provider that never answers and releases status readers', async () => {
  let runSignal: AbortSignal | undefined;
  const runner = new NarrativeRunner(value => { runSignal = value; return { stream: new ReadableStream(), result: new Promise<Narrative>(() => {}) }; }, { deadlineMs: 20 });
  const response = runner.attach(signal());
  expect((await runner.read()).failure).toBe('timeout');
  expect(runSignal!.aborted).toBe(true);
  expect(await response.text()).toBe('');
});

test('a valid-looking body followed by failure stays failed, and an already-aborted request spends nothing', async () => {
  const runner = new NarrativeRunner(() => ({
    stream: new ReadableStream({ start(controller) { controller.enqueue(text); controller.close(); } }),
    result: Promise.resolve({ document: null, failure: 'provider', usage: null }),
  }));
  expect(runner.attach(signal(true)).status).toBe(400);
  expect(runner.state().starts).toBe(0);
  await runner.attach(signal()).text();
  expect((await runner.read()).document).toBeNull();
  expect(runner.state().status).toBe('failed');
});

test('a run that cannot start, or whose result rejects, is a provider failure', async () => {
  const throwing = new NarrativeRunner(() => { throw new Error('no model'); });
  expect(throwing.attach(signal()).status).toBe(502);
  expect(throwing.state()).toMatchObject({ status: 'failed', failure: 'provider', starts: 1 });
  const rejecting = new NarrativeRunner(() => ({ stream: new ReadableStream({ start(controller) { controller.close(); } }), result: Promise.reject(new Error('provider')) }));
  await rejecting.attach(signal()).text();
  expect(rejecting.state()).toMatchObject({ status: 'failed', failure: 'provider' });
});

test('within bounds a promise', async () => {
  expect(await within(Promise.resolve(1), 50)).toBe(1);
  await expect(within(new Promise(() => {}), 5)).rejects.toThrow('Operation timed out.');
});
