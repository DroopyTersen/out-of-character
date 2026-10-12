import type { SubmitTextInput, SubmitTextReply } from '../shared/protocol';
import { SessionRequestError, SessionUnanswered, type Attempt, type ProtocolTransport } from './transport';

const NOT_LIVE = 'The interview is not live.';
const UNSENT = 'Your answer could not be sent. Check your connection and try again.';

/** One answer keeps its ID through unanswered requests. Cancellation abandons pending delivery; the server may still save it. An already received receipt remains valid. */
export async function deliverTypedAnswer({ answer, transport, attempt, signal }: {
  answer: SubmitTextInput; transport: ProtocolTransport; attempt: Attempt; signal: AbortSignal;
}): Promise<SubmitTextReply> {
  const giveUpAt = Date.now() + 30_000;
  let delay = 1000;
  for (;;) {
    if (signal.aborted) throw new Error(NOT_LIVE);
    try {
      return await transport.request('submitText', answer, { attempt, timeoutMs: 10_000, signal }) as SubmitTextReply;
    } catch (error) {
      if (signal.aborted) throw new Error(NOT_LIVE);
      const retryable = error instanceof SessionUnanswered || (error instanceof SessionRequestError && error.status === 503);
      if (!retryable) throw new Error(error instanceof SessionRequestError ? error.message : UNSENT);
      if (Date.now() + delay >= giveUpAt) throw new Error(UNSENT);
      await wait(delay, signal);
      delay = Math.min(delay * 2, 5000);
    }
  }
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new Error(NOT_LIVE)); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
