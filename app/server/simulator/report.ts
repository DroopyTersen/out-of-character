import { createTextStreamResponse } from 'ai';
import { type REPORT_PROVENANCE, type ReportResult } from '../../../ai/simulator/report.server';
import { idleReport, REPORT_MAX_STARTS, REPORT_DEADLINE_MS, type CoachingReport, type ReportFailure, type ReportState } from '../../../core/simulator/report';
import { simulatorJson } from './api';

type Attempt = { startedAt: number; endedAt: number; failure: ReportFailure | null; usage: ReportResult['usage'] };
export type SettledReport<T> = { report: T | null; attempts: Attempt[] };
export type ReportArchive = typeof REPORT_PROVENANCE & SettledReport<CoachingReport>;

/** One bounded review, plus one explicit retry. No live-session resources are retained. */
export class SessionReport<T = CoachingReport> {
  state = idleReport<T>();
  private settled = Promise.resolve();
  private attempts: Attempt[] = [];

  constructor(
    private readonly generate: (signal: AbortSignal, finish: (result: ReportResult<T>) => void) => ReadableStream<string>,
    private readonly onSettled: (archive: SettledReport<T>) => void,
    private readonly deadlineMs = REPORT_DEADLINE_MS,
  ) {}

  async read(): Promise<ReportState<T>> {
    if (this.state.status === 'running') await this.settled;
    return this.state;
  }

  start(request: Request): Response {
    if (this.state.status === 'running') return simulatorJson({ error: 'Your report is already being prepared.' }, 409);
    if (this.state.status === 'completed') return simulatorJson(this.state.report);
    if (this.state.starts >= REPORT_MAX_STARTS) return simulatorJson({ error: 'The report retry has already been used.' }, 409);
    if (request.signal.aborted) return simulatorJson({ error: 'The report request was cancelled.' }, 400);
    const start = this.state.starts + 1, startedAt = Date.now();
    this.state = { status: 'running', starts: start, report: null, failure: null };
    let resolve!: () => void;
    this.settled = new Promise<void>(done => { resolve = done; });
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<string> | undefined;
    const finish = (result: ReportResult<T>) => {
      if (this.state.starts !== start || this.state.status !== 'running') return;
      clearTimeout(timer);
      request.signal.removeEventListener('abort', cancel);
      this.state = result.failure === null
        ? { status: 'completed', starts: start, report: result.report, failure: null }
        : { status: 'failed', starts: start, report: null, failure: result.failure };
      this.attempts.push({ startedAt, endedAt: Date.now(), failure: result.failure, usage: result.usage });
      resolve(); // Storage cannot hold authoritative completion open.
      this.onSettled(structuredClone({ report: result.report, attempts: this.attempts }));
    };
    const abort = (failure: ReportFailure) => {
      finish({ report: null, failure, usage: null });
      controller.abort();
      void reader?.cancel().catch(() => {});
    };
    const cancel = () => abort('cancelled');
    const timer = setTimeout(() => abort('timeout'), this.deadlineMs);
    request.signal.addEventListener('abort', cancel, { once: true });
    try {
      reader = this.generate(controller.signal, finish).getReader();
    } catch {
      finish({ report: null, failure: 'provider', usage: null });
      return simulatorJson({ error: 'The report could not be started.' }, 502);
    }
    const stream = new ReadableStream<string>({
      async pull(output) {
        try {
          const next = await reader!.read();
          if (next.done) { finish({ report: null, failure: 'provider', usage: null }); output.close(); }
          else output.enqueue(next.value);
        } catch {
          finish({ report: null, failure: 'provider', usage: null });
          output.error(new Error('The report stream was interrupted.'));
        }
      },
      cancel,
    });
    return createTextStreamResponse({ stream, headers: { 'Cache-Control': 'no-store, no-transform', 'Content-Encoding': 'identity' } });
  }
}

export async function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Operation timed out.')), ms); })]);
  } finally { clearTimeout(timer!); }
}
