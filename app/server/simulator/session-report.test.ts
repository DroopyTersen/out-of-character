import { afterEach, expect, setSystemTime, test } from 'bun:test';
import { reportSchema } from '../../../core/simulator/report';
import { SESSION_LIMIT_SECONDS, skills } from '../../../core/simulator/types';
import { parseArchive } from '../../../scripts/simulator-transcripts';
import { attempt, capability, request, activityPoll, fixture } from './session-fixture';

// The paid report boundary is substituted; session ownership, closure, final
// grading, storage and public state use the real implementation.
afterEach(() => setSystemTime());
function reportProvider() {
  let finish: ((result: import('../../../ai/simulator/report.server').ReportResult) => void) | undefined;
  let output: ReadableStreamDefaultController<string> | undefined;
  let input: import('../../../ai/simulator/report.server').ReportInput | undefined;
  let calls = 0;
  return {
    generateReport: ((value, done) => {
      calls++; input = value; finish = done;
      return new ReadableStream<string>({ start(controller) { output = controller; } });
    }) satisfies typeof import('../../../ai/simulator/report.server').generateReport,
    calls: () => calls,
    input: () => input,
    succeed: () => {
      const report = reportSchema.parse({ evaluation: { skills: Object.fromEntries(skills.map(({ id }) => [id, { score: null, evidenceIds: [] }])), objectives: {} }, overview: 'The conversation was brief.', strengths: [], improvements: [], nextPractice: 'Continue exploring the problem.' });
      output!.enqueue(JSON.stringify(report)); finish!({ report, failure: null, usage: null }); output!.close();
    },
    fail: () => { finish!({ report: null, failure: 'provider', usage: null }); output!.close(); },
  };
}
async function spokenSession(provider: ReturnType<typeof reportProvider>) {
  const f = await fixture({ overrides: { generateReport: provider.generateReport } });
  await f.session.fetch(request('start')); await f.session.fetch(request('ready'));
  f.socket.emit({ type: 'session.input_transcript.delta', delta: 'Who owns this process?', start_ms: 0, end_ms: 1000 });
  return f;
}

test('report is owned, requires a scored ended conversation, and terminal reads do not mutate the lease', async () => {
  const provider = reportProvider();
  const f = await spokenSession(provider);
  expect((await f.session.fetch(request('report', `Bearer ${'b'.repeat(64)}`))).status).toBe(403);
  expect((await f.session.fetch(request('report'))).status).toBe(409);
  await f.session.fetch(request('end'));
  const lease = structuredClone(f.values.get('lease')), alarm = f.alarm();
  const poll = await (await f.session.fetch(activityPoll(true, true))).json() as Record<string, any>;
  expect(poll.report).toMatchObject({ status: 'idle', starts: 0 });
  expect(f.values.get('lease')).toEqual(lease); expect(f.alarm()).toBe(alarm);
  expect(provider.calls()).toBe(0);
  for (const scenarioId of ['sharepoint', 'happy-hour']) {
    const silent = await fixture({ overrides: { generateReport: provider.generateReport } });
    await silent.session.fetch(new Request('https://session/start', { method: 'POST', headers: { Authorization: capability }, body: JSON.stringify({ ...attempt, scenarioId }) }));
    await silent.session.fetch(request('ready'));
    if (scenarioId === 'happy-hour') silent.socket.emit({ type: 'session.input_transcript.delta', delta: 'Hello there.', start_ms: 0, end_ms: 1000 });
    await silent.session.fetch(request('end'));
    expect((await silent.session.fetch(request('report'))).status).toBe(422);
    expect(await (await silent.session.fetch(request('poll'))).json()).toMatchObject({ report: { status: 'ineligible' } });
  }
  expect(provider.calls()).toBe(0);
}, 10_000);

test('report waits for closing, uses final transcript and Jev, and claims one generation', async () => {
  const provider = reportProvider();
  const f = await spokenSession(provider);
  const ending = f.session.fetch(request('end'));
  const response = await f.session.fetch(request('report'));
  await ending;
  expect(response.status).toBe(200);
  expect(provider.input()!.snapshot).toMatchObject({ status: 'ended', feedbackStatus: 'current', transcript: [{ text: 'Who owns this process?' }] });
  expect(provider.input()!.snapshot.evaluation).not.toBeNull();
  expect((await f.session.fetch(request('report'))).status).toBe(409);
  expect(provider.calls()).toBe(1);
  let readFinished = false;
  const poll = f.session.fetch(request('poll')).then(value => { readFinished = true; return value; });
  await Promise.resolve(); expect(readFinished).toBe(false);
  // Normal voice cleanup does not interrupt report completion.
  await f.session.alarm();
  provider.fail(); await response.text();
  const result = await (await poll).json() as Record<string, any>;
  expect(result.report).toMatchObject({ status: 'failed', starts: 1, failure: 'provider' });
  expect(JSON.stringify(result)).not.toContain('private');
  await Promise.all(f.pending);
  expect(parseArchive(f.row()!).report).toMatchObject({ model: 'gpt-6.1-sol', effort: 'medium', report: null, attempts: [{ failure: 'provider' }] });
}, 10_000);

test('interrupted report settles before held final storage and archives after the final row exists', async () => {
  const provider = reportProvider();
  const active = await spokenSession(provider);
  // A lost connection pauses, and so does a lost owner with time left; a lost owner near the limit interrupts.
  await active.session.alarm();
  await Promise.all(active.pending);
  setSystemTime(Date.now() + SESSION_LIMIT_SECONDS * 1000 - 40_000);
  const f = await fixture({ values: active.values, archive: active.archive, overrides: { generateReport: provider.generateReport } });
  const held = f.archive.holdNext();
  await f.session.fetch(request('poll'));
  await held.started;
  const response = await f.session.fetch(request('report'));
  expect(provider.input()!.snapshot.status).toBe('interrupted');
  provider.fail(); await response.text();
  expect(await (await f.session.fetch(request('poll'))).json()).toMatchObject({ report: { status: 'failed', starts: 1 } });
  expect(f.row()?.report_json ?? null).toBeNull();
  held.release(); await Promise.all(f.pending);
  expect(parseArchive(f.row()!).report.attempts).toHaveLength(1);
  expect(f.row()!.archive_state).toBe('final');
  await active.session.fetch(request('end')); // Stop the original owner's timer.
}, 10_000);

test('a report archive failure cannot turn validated coaching into a failed report', async () => {
  const provider = reportProvider();
  const f = await spokenSession(provider);
  await f.session.fetch(request('end'));
  await Promise.all(f.pending);
  const transcript = f.row()!.transcript_json;
  f.archive.failNext();
  const response = await f.session.fetch(request('report'));
  provider.succeed(); await response.text();
  await Promise.all(f.pending);
  expect(await (await f.session.fetch(request('poll'))).json()).toMatchObject({ report: { status: 'completed', report: { overview: 'The conversation was brief.' } } });
  expect(f.row()!.report_json).toBeNull();
  expect(f.row()!.transcript_json).toBe(transcript);
}, 10_000);
