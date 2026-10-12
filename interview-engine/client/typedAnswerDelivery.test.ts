import { afterEach, beforeEach, expect, jest, test } from 'bun:test';
import type { SubmitTextInput, SubmitTextReply } from '../shared/protocol';
import type { InterviewSnapshot } from '../shared/snapshot';
import { deliverTypedAnswer } from './typedAnswerDelivery';
import { SessionRequestError, SessionUnanswered, type ProtocolTransport } from './transport';

// Only the remote session is substituted. No browser, microphone or voice-provider fixture is needed.
const attempt = { id: 'attempt', capability: 'capability' };
const snapshot: InterviewSnapshot = {
  id: attempt.id, planId: 'plan', voiceId: 'voice', status: 'live', startedAt: 0, limitSeconds: 3600,
  usageSeconds: null, warning: null, pause: null, transcript: [], evaluation: null, feedbackStatus: 'waiting',
  background: [], message: null, revision: 0, finalization: 'pending',
};
const receipt = (id: string): SubmitTextReply => ({ acceptedId: id, snapshot });
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
async function flush() { for (let turn = 0; turn < 10; turn++) await Promise.resolve(); }
async function advance(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 100) { jest.advanceTimersByTime(100); await flush(); }
}
function delivery(request: ProtocolTransport['request'], signal = new AbortController().signal, text = '  Five days to one.  ') {
  return deliverTypedAnswer({ answer: { id: crypto.randomUUID(), text }, transport: { request }, attempt, signal });
}

test('mixed unanswered and busy replies retain the answer identity it was given', async () => {
  const sent: SubmitTextInput[] = [];
  const request: ProtocolTransport['request'] = async (action, body, options) => {
    expect(action).toBe('submitText');
    expect(options.attempt).toEqual(attempt);
    const answer = body as SubmitTextInput;
    sent.push(answer);
    if (sent.length === 1) throw new SessionUnanswered('Reply lost.');
    if (sent.length === 2) throw new SessionRequestError('Save failed.', 503);
    return receipt(answer.id);
  };
  const pending = delivery(request);
  await advance(5000);
  const accepted = await pending;
  expect(sent).toHaveLength(3);
  expect(new Set(sent.map(answer => answer.id)).size).toBe(1);
  expect(sent.every(answer => answer.text === '  Five days to one.  ')).toBe(true);
  expect(accepted.acceptedId).toBe(sent[0]!.id);
});

test.each([400, 401, 403, 409, 413])('a %i refusal is final and preserves the server explanation', async status => {
  let sends = 0;
  const result = delivery(async () => { sends++; throw new SessionRequestError('Answer refused.', status); });
  await expect(result).rejects.toThrow('Answer refused.');
  await advance(40_000);
  expect(sends).toBe(1);
});

test('an unavailable session gives up within its retry window and starts no later requests', async () => {
  const sent: SubmitTextInput[] = [];
  const outcome = delivery(async (_action, body) => { sent.push(body as SubmitTextInput); throw new SessionUnanswered('Offline.'); })
    .then(() => '', (error: Error) => error.message);
  await advance(30_000);
  expect(await outcome).toBe('Your answer could not be sent. Check your connection and try again.');
  expect(sent.length).toBeGreaterThan(1);
  expect(new Set(sent.map(answer => answer.id)).size).toBe(1);
  const count = sent.length;
  await advance(30_000);
  expect(sent).toHaveLength(count);
});

test.each(['before send', 'during backoff'] as const)('cancellation %s prevents further delivery', async when => {
  const controller = new AbortController();
  let sends = 0;
  if (when === 'before send') controller.abort();
  const outcome = delivery(async () => { sends++; throw new SessionRequestError('Busy.', 503); }, controller.signal)
    .then(() => '', (error: Error) => error.message);
  await flush();
  controller.abort();
  expect(await outcome).toBe('The interview is not live.');
  await advance(40_000);
  expect(sends).toBe(when === 'before send' ? 0 : 1);
});

test('cancellation reaches an in-flight request and does not retry its rejection', async () => {
  const controller = new AbortController();
  let sends = 0;
  let cancelled = false;
  const outcome = delivery((_action, _body, { signal }) => {
    sends++;
    return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => {
      cancelled = true;
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true }));
  }, controller.signal).then(() => '', (error: Error) => error.message);
  controller.abort();
  expect(await outcome).toBe('The interview is not live.');
  expect(cancelled).toBe(true);
  await advance(40_000);
  expect(sends).toBe(1);
});

test('a receipt already received when cancellation occurs remains an acceptance receipt', async () => {
  const controller = new AbortController();
  let answerId = '';
  const pending = delivery(async (_action, body, { signal }) => {
    signal!.throwIfAborted();
    answerId = (body as SubmitTextInput).id;
    return receipt(answerId);
  }, controller.signal);
  controller.abort();
  expect((await pending).acceptedId).toBe(answerId);
});

test('concurrent answers keep their own identities through independent retries', async () => {
  const sent = new Map<string, SubmitTextInput[]>();
  const request: ProtocolTransport['request'] = async (_action, body) => {
    const answer = body as SubmitTextInput;
    const attempts = sent.get(answer.text) ?? [];
    attempts.push(answer);
    sent.set(answer.text, attempts);
    if (attempts.length === 1) throw new SessionUnanswered('Lost reply.');
    return receipt(answer.id);
  };
  const pending = Array.from({ length: 20 }, (_, index) => delivery(request, undefined, `Answer ${index}`));
  await advance(5000);
  const accepted = await Promise.all(pending);
  expect(new Set(accepted.map(reply => reply.acceptedId)).size).toBe(20);
  for (const attempts of sent.values()) {
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
  }
});
