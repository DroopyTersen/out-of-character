import { createTextStreamResponse } from 'ai';
import type { Narrative, NarrativeFailure, NarrativeRun, NarrativeState, NarrativeUsage } from './narrative.server';

export type { Narrative, NarrativeFailure, NarrativeRun, NarrativeState, NarrativeUsage } from './narrative.server';

// The shell of the narrative runner: SessionReport's lifecycle (app/server/simulator/report.ts) over a NarrativeRun.
// The simulator keeps SessionReport, and so does the interview's report route while its replies must match the
// simulator's byte for byte; the narrative route adopts this one with independent reporting (Phase 6).

export const NARRATIVE_MAX_STARTS = 2;
export const NARRATIVE_DEADLINE_MS = 120_000;

export type NarrativeAttempt = { startedAt: number; endedAt: number; failure: NarrativeFailure | null; usage: NarrativeUsage | null };
export type SettledNarrative = { document: { text: string } | null; attempts: NarrativeAttempt[] };

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const idle = (): NarrativeState => ({ status: 'idle', starts: 0, document: null, failure: null });

/**
 * One bounded narrative run plus one explicit retry, for a host route. Holds no session resources.
 * A completed narrative is answered from memory; the host persists it from `onSettled`.
 */
// TODO(phase6): re-attach a reloaded page to a running stream instead of answering 409, as the API design describes.
export class NarrativeRunner {
  private current = idle();
  private settled = Promise.resolve();
  private attempts: NarrativeAttempt[] = [];

  constructor(
    private readonly start: (signal: AbortSignal) => NarrativeRun,
    private readonly options: { deadlineMs?: number; onSettled?: (narrative: SettledNarrative) => void } = {},
  ) {}

  state(): NarrativeState { return this.current; }

  /** The state once any running attempt has settled. */
  async read(): Promise<NarrativeState> {
    if (this.current.status === 'running') await this.settled;
    return this.current;
  }

  /** Starts an attempt and streams it, or answers with the stored text, a conflict, or a spent retry. Aborting `signal` cancels the attempt. */
  attach(signal: AbortSignal): Response {
    if (this.current.status === 'running') return json({ error: 'Your report is already being prepared.' }, 409);
    if (this.current.status === 'completed') return new Response(this.current.document.text, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
    if (this.current.starts >= NARRATIVE_MAX_STARTS) return json({ error: 'The report retry has already been used.' }, 409);
    if (signal.aborted) return json({ error: 'The report request was cancelled.' }, 400);
    const start = this.current.starts + 1, startedAt = Date.now();
    this.current = { status: 'running', starts: start, document: null, failure: null };
    let resolve!: () => void;
    this.settled = new Promise<void>(done => { resolve = done; });
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<string> | undefined;
    const finish = (result: Narrative) => {
      if (this.current.starts !== start || this.current.status !== 'running') return;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      this.current = result.failure === null
        ? { status: 'completed', starts: start, document: result.document, failure: null }
        : { status: 'failed', starts: start, document: null, failure: result.failure };
      this.attempts.push({ startedAt, endedAt: Date.now(), failure: result.failure, usage: result.usage });
      resolve(); // Storage cannot hold authoritative completion open.
      this.options.onSettled?.(structuredClone({ document: result.document, attempts: this.attempts }));
    };
    const abort = (failure: NarrativeFailure) => {
      finish({ document: null, failure, usage: null });
      controller.abort();
      void reader?.cancel().catch(() => {});
    };
    const cancel = () => abort('cancelled');
    const timer = setTimeout(() => abort('timeout'), this.options.deadlineMs ?? NARRATIVE_DEADLINE_MS);
    signal.addEventListener('abort', cancel, { once: true });
    let outcome: Promise<void>;
    try {
      const run = this.start(controller.signal);
      reader = run.stream.getReader();
      outcome = run.result.then(finish, () => finish({ document: null, failure: 'provider', usage: null }));
    } catch {
      finish({ document: null, failure: 'provider', usage: null });
      return json({ error: 'The report could not be started.' }, 502);
    }
    const settled = this.settled;
    const stream = new ReadableStream<string>({
      async pull(output) {
        try {
          const next = await reader!.read();
          if (next.done) {
            // The result settles alongside the stream; the deadline bounds a run whose result never comes.
            await Promise.race([outcome, settled]);
            finish({ document: null, failure: 'provider', usage: null });
            output.close();
          }
          else output.enqueue(next.value);
        } catch {
          finish({ document: null, failure: 'provider', usage: null });
          output.error(new Error('The report stream was interrupted.'));
        }
      },
      cancel,
    });
    return createTextStreamResponse({ stream, headers: { 'Cache-Control': 'no-store, no-transform', 'Content-Encoding': 'identity' } });
  }
}

/** Rejects when `promise` has not settled within `ms`. */
export async function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Operation timed out.')), ms); })]);
  } finally { clearTimeout(timer!); }
}
