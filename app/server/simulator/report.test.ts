import { expect, test } from 'bun:test';
import { SessionReport, type SettledReport } from './report';
import { skills } from '../../../core/simulator/types';
import { reportSchema, type CoachingReport } from '../../../core/simulator/report';
import type { ReportResult } from '../../../ai/simulator/report.server';

const report: CoachingReport = reportSchema.parse({ evaluation: { skills: Object.fromEntries(skills.map(({ id }) => [id, { score: null, evidenceIds: [] }])), objectives: {} }, overview: 'Too little conversation to judge.', strengths: [], improvements: [], nextPractice: 'Continue the discovery.' });
const request = (signal?: AbortSignal) => new Request('https://session/report', { method: 'POST', signal });

test('idle reads are immediate, concurrent starts conflict, success is cached and settles before archive work', async () => {
  const saved: SettledReport<CoachingReport>[] = [];
  let calls = 0, finish!: (value: ReportResult) => void, stream!: ReadableStreamDefaultController<string>;
  const session = new SessionReport<CoachingReport>((_signal, done) => { calls++; finish = done; return new ReadableStream({ start(controller) { stream = controller; } }); }, value => { saved.push(value); });
  expect((await session.read()).status).toBe('idle');
  expect(session.state.starts).toBe(0);
  const response = session.start(request());
  expect(response.headers.get('Content-Encoding')).toBe('identity');
  expect(session.start(request()).status).toBe(409);
  const output = response.text();
  let readReturned = false;
  const reading = session.read().then(value => { readReturned = true; return value; });
  await Promise.resolve(); expect(readReturned).toBe(false);
  stream.enqueue(JSON.stringify(report));
  finish({ report, failure: null, usage: { inputTokens: 100, outputTokens: 50, reasoningTokens: 20, cachedTokens: 0 } });
  stream.close();
  expect(await output).toBe(JSON.stringify(report));
  expect((await reading).status).toBe('completed');
  expect(await session.start(request()).json() as CoachingReport).toEqual(report);
  expect(calls).toBe(1);
  expect(saved).toHaveLength(1);
  expect(saved[0]!.attempts[0]!.usage?.reasoningTokens).toBe(20);
});

test('one explicit retry is allowed and late callbacks cannot replace its result', async () => {
  const finishes: ((value: ReportResult) => void)[] = [];
  const saved: SettledReport<CoachingReport>[] = [];
  const session = new SessionReport<CoachingReport>((_signal, done) => { finishes.push(done); return new ReadableStream({ start(controller) { controller.close(); } }); }, value => { saved.push(value); });
  await session.start(request()).text();
  expect(session.state).toMatchObject({ status: 'failed', starts: 1, report: null });
  const retry = session.start(request());
  finishes[0]!({ report, failure: null, usage: null });
  expect(session.state.status).toBe('running');
  await retry.text();
  expect(session.state).toMatchObject({ status: 'failed', starts: 2 });
  expect(session.start(request()).status).toBe(409);
  expect(saved[1]!.attempts).toHaveLength(2);
});

test('response cancellation and request abort stop the provider and record cancellation once', async () => {
  for (const byRequest of [false, true]) {
    const controller = new AbortController();
    let providerSignal: AbortSignal | undefined;
    const saved: SettledReport<CoachingReport>[] = [];
    const session = new SessionReport<CoachingReport>((signal, _done) => {
      providerSignal = signal;
      return new ReadableStream({ start(stream) { stream.enqueue('{'); } });
    }, value => { saved.push(value); });
    const reader = session.start(request(controller.signal)).body!.getReader();
    await reader.read();
    if (byRequest) controller.abort(); else await reader.cancel();
    expect((await session.read()).failure).toBe('cancelled');
    expect(providerSignal!.aborted).toBe(true);
    expect(saved).toHaveLength(1);
  }
});

test('an independent deadline settles a provider that never calls back and releases status readers', async () => {
  let signal: AbortSignal | undefined;
  const session = new SessionReport(signalValue => { signal = signalValue; return new ReadableStream(); }, () => {}, 20);
  const response = session.start(request());
  expect((await session.read()).failure).toBe('timeout');
  expect(signal!.aborted).toBe(true);
  expect(await response.text()).toBe('');
});

test('a valid-looking body followed by failure stays failed, and an already-aborted request spends nothing', async () => {
  const session = new SessionReport<CoachingReport>((_signal, done) => new ReadableStream({ start(controller) {
    controller.enqueue(JSON.stringify(report)); done({ report: null, failure: 'provider', usage: null }); controller.close();
  } }), () => {});
  const controller = new AbortController(); controller.abort();
  expect(session.start(request(controller.signal)).status).toBe(400);
  expect(session.state.starts).toBe(0);
  await session.start(request()).text();
  expect((await session.read()).report).toBeNull();
  expect(session.state.status).toBe('failed');
});
