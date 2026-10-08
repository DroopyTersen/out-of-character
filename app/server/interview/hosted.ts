import type { summarizeInterview } from '../../../ai/interview/summary.server';
import { SUMMARY_VERSION } from '../../../ai/interview/summary.server';
import type { InterviewSummaryContent } from '../../../core/interview';
import { idleReport, type ReportState } from '../../../core/simulator/report';
import type { SessionActor } from '../../../interview-engine/interview/interview.server';
import { simulatorJson } from '../simulator/api';
import { SessionReport, within } from '../simulator/report';

type Transcript = NonNullable<ReturnType<SessionActor['snapshot']>>['transcript'];
/** Writes the closeout narrative for a finished transcript, as `summarizeInterview` does once given the resource. */
export type Summarize = (input: { transcript: Transcript; signal: AbortSignal }, finish: Parameters<typeof summarizeInterview>[1]) => ReadableStream<string>;

/**
 * One attempt as a host serves it: commands at `https://session/<action>` go to the actor, and the report route runs
 * the narrative once over the ended transcript. The reply shapes are the practice simulator's, so the browser is unchanged.
 */
export class HostedSession {
  private report: SessionReport<InterviewSummaryContent> | undefined;

  constructor(readonly actor: SessionActor, private readonly narrative: { summarize: Summarize; model: string }) {}

  async fetch(request: Request): Promise<Response> {
    const action = new URL(request.url).pathname.slice(1);
    const body = request.body ? await request.text() : undefined;
    const reply = await this.actor.handle({ action, capability: request.headers.get('Authorization') ?? '', ...(body != null ? { body } : {}) });
    if (reply.report) return this.startReport(request);
    if (reply.terminal) {
      // Terminal reads carry the narrative's state; a poll waits briefly for a running narrative to settle.
      const report = action === 'poll' && this.report ? await this.report.read() : this.reportState();
      return simulatorJson({ ...reply.body as object, report });
    }
    return simulatorJson(reply.body, reply.status);
  }

  private reportState(): ReportState<InterviewSummaryContent> {
    const snapshot = this.actor.snapshot();
    if (!snapshot?.transcript.some(item => item.speaker === 'trainee' && item.text.trim())) return { status: 'ineligible', starts: 0, report: null, failure: null };
    return this.report?.state ?? idleReport();
  }

  private async startReport(request: Request): Promise<Response> {
    const closing = this.actor.closing;
    if (closing) {
      try { await within(closing, 40_000); }
      catch { return simulatorJson({ error: 'The conversation is still closing.' }, 409); }
    }
    const snapshot = this.actor.snapshot();
    if (!snapshot || !['ended', 'interrupted'].includes(snapshot.status)) return simulatorJson({ error: 'End the conversation before requesting its report.' }, 409);
    if (this.reportState().status === 'ineligible') return simulatorJson({ error: 'There is not enough scored conversation to review.' }, 422);
    if (!this.report) {
      const transcript = structuredClone(snapshot.transcript);
      this.report = new SessionReport<InterviewSummaryContent>((signal, finish) => this.narrative.summarize({ transcript, signal }, finish), archive => {
        this.actor.settleNarrative(archive.report ? { status: 'ready', text: archive.report.text } : { status: 'unavailable', text: null },
          { model: this.narrative.model, version: SUMMARY_VERSION, attempts: archive.attempts });
      });
    }
    return this.report.start(request);
  }
}
