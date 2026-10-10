import { expect, test } from 'bun:test';
import { NarrativeRunner, within, type Narrative, type NarrativeRun, type SettledNarrative } from './narrativeRun.server';

// Ported from app/server/simulator/report.test.ts: the same lifecycle over a NarrativeRun instead of a finish callback,
// with a second request during a run rejoining it rather than conflicting.

const text = '## Project closeout\n\nThe team shipped the migration two weeks late.';
const usage = { inputTokens: 100, outputTokens: 50, reasoningTokens: 20, cachedTokens: 0 };
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const signal = (aborted = false) => { const controller = new AbortController(); if (aborted) controller.abort(); return controller.signal; };

test('idle reads are immediate, a concurrent request rejoins without a second run, success is kept and settles before archive work', async () => {
  const saved: SettledNarrative[] = [];
  let calls = 0, stream!: ReadableStreamDefaultController<string>;
  const result = deferred<Narrative>();
  const runner = new NarrativeRunner(() => { calls++; return { stream: new ReadableStream({ start(controller) { stream = controller; } }), result: result.promise }; }, { onSettled: value => { saved.push(value); } });
  expect((await runner.read()).status).toBe('idle');
  expect(runner.state().starts).toBe(0);
  const response = runner.attach(signal());
  expect(response.headers.get('Content-Encoding')).toBe('identity');
  const second = runner.attach(signal());
  expect(second.status).toBe(200);
  const output = response.text(), rejoined = second.text();
  let readReturned = false;
  const reading = runner.read().then(value => { readReturned = true; return value; });
  await Promise.resolve(); expect(readReturned).toBe(false);
  stream.enqueue(text);
  stream.close();
  result.resolve({ document: { text }, failure: null, usage });
  expect(await output).toBe(text);
  expect(await rejoined).toBe(text);
  expect(await reading).toEqual({ status: 'completed', starts: 1, document: { text }, failure: null });
  // A reloaded page gets the stored document, as the JSON the stream carried, without a second run.
  const stored = runner.attach(signal());
  expect(stored.headers.get('Cache-Control')).toBe('no-store');
  expect(await stored.json() as unknown).toEqual({ text });
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

test('a request that rejoins mid-stream gets what was written, then the rest live', async () => {
  let stream!: ReadableStreamDefaultController<string>;
  const result = deferred<Narrative>();
  const document = JSON.stringify({ text });
  const runner = new NarrativeRunner(() => ({ stream: new ReadableStream({ start(controller) { stream = controller; } }), result: result.promise }));
  const first = runner.attach(signal()).body!.pipeThrough(new TextDecoderStream()).getReader();
  stream.enqueue(document.slice(0, 10));
  stream.enqueue(document.slice(10, 20));
  expect((await first.read()).value).toBe(document.slice(0, 10));
  // The first page reloads: its request goes, and the run carries on for the next one.
  await first.cancel();
  expect(runner.state().status).toBe('running');
  const rejoined = runner.attach(signal()).body!.pipeThrough(new TextDecoderStream()).getReader();
  let seen = '';
  while (seen.length < 20) seen += (await rejoined.read()).value;
  expect(seen).toBe(document.slice(0, 20));
  stream.enqueue(document.slice(20));
  stream.close();
  result.resolve({ document: { text }, failure: null, usage });
  for (;;) { const next = await rejoined.read(); if (next.done) break; seen += next.value; }
  expect(JSON.parse(seen)).toEqual({ text });
  expect(runner.state()).toMatchObject({ status: 'completed', starts: 1 });
});

test('dropping requests detaches without stopping the run; cancel stops the provider and records cancellation once', async () => {
  const controller = new AbortController();
  let providerSignal: AbortSignal | undefined;
  const saved: SettledNarrative[] = [], tracked: Promise<unknown>[] = [];
  const runner = new NarrativeRunner(runSignal => {
    providerSignal = runSignal;
    return { stream: new ReadableStream({ start(stream) { stream.enqueue('#'); } }), result: new Promise<Narrative>(() => {}) };
  }, { onSettled: value => { saved.push(value); }, track: work => { tracked.push(work); } });
  const reader = runner.attach(controller.signal).body!.getReader();
  await reader.read();
  controller.abort();
  await reader.cancel();
  await Promise.resolve();
  expect(runner.state().status).toBe('running');
  expect(providerSignal!.aborted).toBe(false);
  runner.cancel();
  expect((await runner.read()).failure).toBe('cancelled');
  expect(providerSignal!.aborted).toBe(true);
  runner.cancel();
  expect(saved).toHaveLength(1);
  expect(tracked).toHaveLength(1);
  await tracked[0];
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

test('a headless run drains the stream, settles with the document, and is joined rather than repeated', async () => {
  let calls = 0, pulled = 0;
  const saved: SettledNarrative[] = [];
  const runner = new NarrativeRunner(() => {
    calls++;
    // A pull stream writes nothing unless it is read, so a completed run proves it was drained.
    const stream = new ReadableStream<string>({ pull(controller) { if (pulled++ < 3) controller.enqueue('#'); else controller.close(); } });
    return { stream, result: (async () => { while (pulled < 4) await Bun.sleep(1); return { document: { text }, failure: null, usage }; })() };
  }, { onSettled: value => { saved.push(value); } });
  const [first, joined] = await Promise.all([runner.run(), runner.run()]);
  expect(first).toEqual({ status: 'completed', starts: 1, document: { text }, failure: null });
  expect(joined).toEqual(first);
  expect(await runner.run()).toEqual(first);
  expect(calls).toBe(1);
  expect(saved).toHaveLength(1);
});

test('a headless run settles a silent provider at the deadline, and a run that cannot start as a provider failure', async () => {
  let runSignal: AbortSignal | undefined;
  const silent = new NarrativeRunner(value => { runSignal = value; return { stream: new ReadableStream(), result: new Promise<Narrative>(() => {}) }; }, { deadlineMs: 20 });
  expect(await silent.run()).toMatchObject({ status: 'failed', failure: 'timeout', starts: 1 });
  expect(runSignal!.aborted).toBe(true);
  const throwing = new NarrativeRunner(() => { throw new Error('no model'); });
  expect(await throwing.run()).toMatchObject({ status: 'failed', failure: 'provider', starts: 1 });
});
