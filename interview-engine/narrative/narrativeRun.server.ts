import { createTextStreamResponse } from 'ai';
import type { Narrative, NarrativeFailure, NarrativeRun, NarrativeState } from './narrative.server';
import type { NarrativeAttempt } from '../shared/narrative';
import { within } from '../shared/timing';

export { within };

export type { Narrative, NarrativeFailure, NarrativeRun, NarrativeState, NarrativeUsage } from './narrative.server';
export type { NarrativeAttempt } from '../shared/narrative';

// SessionReport's lifecycle (app/server/simulator/report.ts) over a NarrativeRun, with the API design's rejoin: a
// request that arrives while a run is writing attaches to it instead of being refused.

export const NARRATIVE_MAX_STARTS = 2;
export const NARRATIVE_DEADLINE_MS = 120_000;

export type SettledNarrative = { document: { text: string } | null; attempts: NarrativeAttempt[] };
export type NarrativeRunnerOptions = {
  deadlineMs?: number;
  onSettled?: (narrative: SettledNarrative) => void;
  /** Keeps a run going after every request has detached, where the platform would otherwise stop it (Cloudflare: `waitUntil`). */
  track?: (work: Promise<unknown>) => void;
};

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const idle = (): NarrativeState => ({ status: 'idle', starts: 0, document: null, failure: null });

/** One run's text so far, shared by every request attached to it. */
type Written = { chunks: string[]; ended: 'closed' | 'errored' | null; changed: Promise<void>; notify: () => void };
const written = (): Written => {
  const value = { chunks: [], ended: null } as unknown as Written;
  const arm = () => { value.changed = new Promise(resolve => { value.notify = () => { arm(); resolve(); }; }); };
  arm();
  return value;
};

/**
 * One bounded narrative run plus one explicit retry, for a host route. Holds no session resources.
 * A request made while a run is writing rejoins it: it receives the text written so far, then the rest as it is written.
 * Dropping a request detaches it without stopping the run, so a reloaded page can rejoin; the deadline bounds the run,
 * and `cancel()` stops it. A completed narrative is answered from memory; the host persists it from `onSettled`.
 */
export class NarrativeRunner {
  private current = idle();
  private settled = Promise.resolve();
  private attempts: NarrativeAttempt[] = [];
  private text: Written | undefined;
  private stop: (() => void) | undefined;

  constructor(
    private readonly start: (signal: AbortSignal) => NarrativeRun,
    private readonly options: NarrativeRunnerOptions = {},
  ) {}

  state(): NarrativeState { return this.current; }

  /** The state once any running attempt has settled. */
  async read(): Promise<NarrativeState> {
    if (this.current.status === 'running') await this.settled;
    return this.current;
  }

  /** Stops a running attempt, which settles as cancelled. */
  cancel() { this.stop?.(); }

  /**
   * Streams the running attempt from its start, starts one, or answers with the stored document (as the JSON the
   * stream carries) or a spent retry.
   */
  attach(signal: AbortSignal): Response {
    if (this.current.status === 'running' && this.text) return this.listen(this.text);
    if (this.current.status === 'completed') return json(this.current.document);
    if (this.current.starts >= NARRATIVE_MAX_STARTS) return json({ error: 'The report retry has already been used.' }, 409);
    if (signal.aborted) return json({ error: 'The report request was cancelled.' }, 400);
    const text = this.begin();
    return text ? this.listen(text) : json({ error: 'The report could not be started.' }, 502);
  }

  /**
   * Runs an attempt with no request attached, for a host that persists the result itself, and resolves with the
   * settled state: the deadline, draining and failures are handled as for `attach`. Joins a running attempt; a
   * completed narrative or a spent retry is answered as it stands.
   */
  run(): Promise<NarrativeState> {
    if (this.current.status !== 'running' && this.current.status !== 'completed' && this.current.starts < NARRATIVE_MAX_STARTS) this.begin();
    return this.read();
  }

  /** Starts the next attempt and returns the text it writes, or null when it could not start (settled as failed). */
  private begin(): Written | null {
    const start = this.current.starts + 1, startedAt = Date.now();
    this.current = { status: 'running', starts: start, document: null, failure: null };
    let resolve!: () => void;
    this.settled = new Promise<void>(done => { resolve = done; });
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<string> | undefined;
    const finish = (result: Narrative) => {
      if (this.current.starts !== start || this.current.status !== 'running') return;
      clearTimeout(timer);
      this.stop = undefined;
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
    this.stop = () => abort('cancelled');
    const timer = setTimeout(() => abort('timeout'), this.options.deadlineMs ?? NARRATIVE_DEADLINE_MS);
    let outcome: Promise<void>;
    try {
      const run = this.start(controller.signal);
      reader = run.stream.getReader();
      outcome = run.result.then(finish, () => finish({ document: null, failure: 'provider', usage: null }));
    } catch {
      finish({ document: null, failure: 'provider', usage: null });
      return null;
    }
    const text = this.text = written();
    const settled = this.settled;
    const end = (how: 'closed' | 'errored') => { text.ended = how; text.notify(); if (this.text === text) this.text = undefined; };
    // The run is read once, whoever is listening; each attached request replays what this has collected.
    const pump = (async () => {
      try {
        for (;;) {
          const next = await reader!.read();
          if (next.done) break;
          text.chunks.push(next.value);
          text.notify();
        }
        // The result settles alongside the stream; the deadline bounds a run whose result never comes.
        await Promise.race([outcome, settled]);
        finish({ document: null, failure: 'provider', usage: null });
        end('closed');
      } catch {
        finish({ document: null, failure: 'provider', usage: null });
        end('errored');
      }
    })();
    this.options.track?.(pump);
    return text;
  }

  /** One request's view of a run: everything written so far, then each new chunk, until the run's stream ends. */
  private listen(text: Written): Response {
    let index = 0;
    const stream = new ReadableStream<string>({
      async pull(output) {
        for (;;) {
          if (index < text.chunks.length) { output.enqueue(text.chunks[index++]!); return; }
          if (text.ended === 'closed') { output.close(); return; }
          if (text.ended === 'errored') { output.error(new Error('The report stream was interrupted.')); return; }
          await text.changed;
        }
      },
    });
    return createTextStreamResponse({ stream, headers: { 'Cache-Control': 'no-store, no-transform', 'Content-Encoding': 'identity' } });
  }
}

