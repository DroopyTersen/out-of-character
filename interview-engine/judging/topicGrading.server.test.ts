import { expect, test } from 'bun:test';
import type { CoverageLevel, InterviewEvaluation } from '../shared/snapshot';
import type { Passage } from '../shared/transcript';
import { TopicGrading, type Evaluate, type TopicGradeInput } from './topicGrading.server';

const passage = (id: string, speaker: Passage['speaker'], text: string): Passage => ({ id, speaker, text, startMs: 0, endMs: 1000 });
const opening = passage('p1', 'interviewer', 'What did you build?');
const answer = passage('p2', 'participant', 'A claims portal for adjusters.');
const result = (revision: number, level: CoverageLevel = 'explored'): InterviewEvaluation => ({
  revision, model: 'fixture', durationMs: 12,
  objectives: [{ id: 'scope', level, achieved: level === 'explored', probability: .9, levels: null,
    evidence: level === 'not-yet' ? null : { entryId: answer.id, speaker: answer.speaker, text: answer.text } }],
});

/** Only the paid evaluator is substituted; the real module owns cadence, state, cancellation and coverage. */
function fixture(evaluate: Evaluate = async input => result(input.revision)) {
  let now = 5000;
  let current: TopicGradeInput = { transcript: [opening, answer], revision: 2 };
  const calls: (TopicGradeInput & { signal: AbortSignal })[] = [];
  const frozen = new Set<string>();
  const grading = new TopicGrading({
    now: () => now, current: () => current,
    freeze: passages => { for (const entry of passages) frozen.add(entry.id); },
    evaluate: input => { calls.push(input); return evaluate(input); },
  });
  return { grading, calls, frozen, at: (time: number) => { now = time; },
    input: () => current,
    append: (...passages: Passage[]) => { current = { transcript: [...current.transcript, ...passages], revision: current.revision + passages.length }; },
  };
}

test('grades participant evidence on cadence, including short answers and corrections', async () => {
  const f = fixture();
  await f.grading.tick();
  expect(f.calls).toHaveLength(1);
  expect(f.grading.snapshot().feedbackStatus).toBe('current');
  f.append(passage('p3', 'interviewer', 'Was it accepted?'), passage('p4', 'participant', 'Mm.'));
  f.at(10_000);
  expect(f.grading.tick()).toBeUndefined();
  expect(f.grading.snapshot().feedbackStatus).toBe('current');
  f.append(passage('p5', 'interviewer', 'Did the customer sign off?'), passage('p6', 'participant', 'Yes.'));
  await f.grading.tick();
  expect(f.calls).toHaveLength(2);
  expect(f.calls[1]!.transcript.at(-1)?.text).toBe('Yes.');
  f.append(passage('p7', 'participant', 'No, it was still a pilot.'));
  f.at(14_999);
  expect(f.grading.tick()).toBeUndefined();
  expect(f.grading.snapshot().feedbackStatus).toBe('delayed');
  f.at(15_000);
  await f.grading.tick();
  expect(f.calls).toHaveLength(3);
  expect(f.calls[2]!.transcript.at(-1)?.text).toBe('No, it was still a pilot.');
});

test('only one live call runs, and new evidence arriving between ticks makes its result delayed', async () => {
  const pending = Promise.withResolvers<InterviewEvaluation>();
  const f = fixture(() => pending.promise);
  const live = f.grading.tick();
  expect([...f.frozen]).toEqual(['p1', 'p2']);
  f.append(passage('p3', 'participant', 'The launch was delayed.'));
  f.at(10_000);
  expect(f.grading.tick()).toBeUndefined();
  expect(f.calls).toHaveLength(1);
  pending.resolve(result(2));
  await live;
  expect(f.grading.snapshot().feedbackStatus).toBe('delayed');
  expect(f.grading.snapshot().evaluation?.objectives[0]?.evidence?.text).toBe('A claims portal for adjusters.');
});

test('interviewer-only additions do not make an in-flight grade stale', async () => {
  const pending = Promise.withResolvers<InterviewEvaluation>();
  const f = fixture(() => pending.promise);
  const live = f.grading.tick();
  f.append(passage('p3', 'interviewer', 'And your role?'));
  pending.resolve(result(2));
  await live;
  expect(f.grading.snapshot().feedbackStatus).toBe('current');
});

test('a failed input gets one cadence-limited retry; only participant evidence renews eligibility', async () => {
  const f = fixture(async () => { throw new Error('Private provider response'); });
  await f.grading.tick();
  expect(f.grading.snapshot().feedbackStatus).toBe('unavailable');
  f.at(9999);
  expect(f.grading.tick()).toBeUndefined();
  f.at(10_000);
  await f.grading.tick();
  f.append(passage('p3', 'interviewer', 'Was it accepted?'));
  f.at(15_000);
  expect(f.grading.tick()).toBeUndefined();
  expect(f.calls).toHaveLength(2);
  f.append(passage('p4', 'participant', 'No.'));
  await f.grading.tick();
  expect(f.calls).toHaveLength(3);
  expect(f.grading.snapshot().grades.every(grade => grade.outcome === 'evaluation_error')).toBe(true);
  expect(JSON.stringify(f.grading.snapshot().grades)).not.toContain('Private provider response');
});

test('live coverage holds supported credit, while the final grade can withdraw it', async () => {
  let calls = 0;
  const f = fixture(async input => {
    if (++calls === 1) return result(input.revision);
    const reading = result(input.revision, 'touched');
    reading.objectives[0]!.levels = { 'not-yet': .05, touched: .35, explored: .6, 'set-aside': 0 };
    return reading;
  });
  await f.grading.tick();
  f.append(passage('p3', 'participant', 'I helped the adjusters test it.'));
  f.at(10_000);
  await f.grading.tick();
  expect(f.grading.snapshot().evaluation?.objectives[0]?.level).toBe('explored');
  f.append(passage('p4', 'interviewer', 'Thanks for your time.'));
  await f.grading.final(f.input());
  expect(f.grading.snapshot().evaluation?.objectives[0]?.level).toBe('touched');
  expect(f.calls[2]?.transcript.at(-1)?.text).toBe('Thanks for your time.');
  expect(f.grading.snapshot().grades.at(-1)?.final).toBe(true);
});

test('stop immediately aborts and ignores a late live result without changing feedback', async () => {
  const pending = Promise.withResolvers<InterviewEvaluation>();
  const f = fixture(() => pending.promise);
  const live = f.grading.tick();
  const stopped = f.grading.stop();
  expect(f.calls[0]?.signal.aborted).toBe(true);
  pending.resolve(result(2));
  await Promise.all([live, stopped]);
  expect(f.grading.snapshot().evaluation).toBeNull();
  expect(f.grading.snapshot().feedbackStatus).toBe('waiting');
  expect(f.grading.snapshot().grades[0]?.outcome).toBe('aborted');
  expect(f.grading.snapshot().gradeCalls).toBe(1);
});

test('stop during final waiting prevents final dispatch when cancelled live work eventually resolves', async () => {
  const pending = Promise.withResolvers<InterviewEvaluation>();
  const f = fixture(() => pending.promise);
  const live = f.grading.tick();
  const final = f.grading.final(f.input());
  const stopped = f.grading.stop();
  pending.resolve(result(2));
  await Promise.all([live, final, stopped]);
  expect(f.calls).toHaveLength(1);
  expect(f.grading.snapshot().gradeCalls).toBe(1);
  expect(f.grading.snapshot().evaluation).toBeNull();
  expect(f.grading.snapshot().feedbackStatus).toBe('waiting');
});

test('live completion cannot erase final cancellation ownership; a late final result is ignored', async () => {
  const liveResult = Promise.withResolvers<InterviewEvaluation>();
  const finalResult = Promise.withResolvers<InterviewEvaluation>();
  let calls = 0;
  const f = fixture(() => ++calls === 1 ? liveResult.promise : finalResult.promise);
  const live = f.grading.tick();
  const final = f.grading.final(f.input());
  liveResult.resolve(result(2));
  await live;
  expect(f.calls).toHaveLength(2);
  const stopped = f.grading.stop();
  expect(f.calls[1]?.signal.aborted).toBe(true);
  finalResult.resolve(result(2));
  await Promise.all([final, stopped]);
  expect(f.grading.snapshot().evaluation).toBeNull();
  expect(f.grading.snapshot().feedbackStatus).toBe('waiting');
  expect(f.grading.snapshot().grades.map(grade => grade.outcome)).toEqual(['aborted', 'aborted']);
});

test('restored budget and history survive, and final grading remains available after the live cap', async () => {
  const f = fixture(async () => { throw new Error('Unavailable'); });
  const evaluation = result(1);
  f.grading.restore({ evaluation, feedbackStatus: 'current', gradeCalls: 718, grades: [{
    source: 'grade', id: 'grade-718', final: false, revision: 1, capturedAt: 1, completedAt: 2,
    inputCount: 2, lastInputId: 'p2', outcome: 'graded',
  }] });
  expect(f.calls).toHaveLength(0);
  expect(f.grading.snapshot().evaluation?.revision).toBe(1);
  await f.grading.tick();
  f.at(10_000);
  expect(f.grading.tick()).toBeUndefined();
  expect(f.calls).toHaveLength(1);
  expect(f.grading.snapshot().gradeCalls).toBe(719);
  expect(f.grading.snapshot().grades[0]?.id).toBe('grade-718');
  expect(f.grading.snapshot().feedbackStatus).toBe('delayed');
  await f.grading.final(f.input());
  expect(f.calls).toHaveLength(2);
  expect(f.grading.snapshot().gradeCalls).toBe(720);
  expect(f.grading.snapshot().evaluation?.revision).toBe(1);
});

test('an interviewer-only transcript starts no live or final call and leaves feedback alone', async () => {
  let calls = 0;
  const grading = new TopicGrading({ evaluate: async () => { calls++; return result(1); }, now: () => 5000,
    current: () => ({ transcript: [opening], revision: 1 }), freeze: () => {} });
  expect(grading.tick()).toBeUndefined();
  await grading.final({ transcript: [opening], revision: 1 });
  expect(calls).toBe(0);
  expect(grading.snapshot()).toEqual({ evaluation: null, feedbackStatus: 'waiting', grades: [], gradeCalls: 0 });
});

test.each([false, true])('the real deadline aborts an unresponsive evaluator (final: %s)', async final => {
  const f = fixture(input => new Promise((_, reject) => {
    input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true });
  }));
  if (final) await f.grading.final(f.input()); else await f.grading.tick();
  expect(f.calls[0]?.signal.aborted).toBe(true);
  expect(f.grading.snapshot().grades[0]?.outcome).toBe('evaluation_timeout');
  expect(f.grading.snapshot().feedbackStatus).toBe('unavailable');
}, 10_000);


test('a permanent rejection is not retried for unchanged evidence; new evidence can be graded', async () => {
  const f = fixture(async () => { throw Object.assign(new Error('Private provider response'), { statusCode: 422, isRetryable: false }); });
  await f.grading.tick();
  f.at(10_000); await f.grading.tick();
  expect(f.calls).toHaveLength(1);
  expect(f.grading.snapshot().grades[0]!.failure).toEqual({ name: 'Error', status: 422, detail: 'request_validation' });
  f.append(passage('p3', 'participant', 'I also built the payment form.'));
  f.at(15_000); await f.grading.tick();
  expect(f.calls).toHaveLength(2);
  expect(f.grading.snapshot().evaluation).toBeNull();
  expect(f.grading.snapshot().feedbackStatus).toBe('unavailable');
});
