import type { InterviewSummaryContent } from '../../../core/interview';
import type { ReportState } from '../../../core/simulator/report';
import type { SessionActor } from '../../../interview-engine/interview/interview.server';
import type { NarrativeInput, NarrativeState } from '../../../interview-engine/narrative/narrative.server';
import { NarrativeRunner, within } from '../../../interview-engine/narrative/narrativeRun.server';
import { simulatorJson } from '../simulator/api';
import { narrativeRunner, participantSpoke, type Narrate } from './narrative';
import { NARRATIVE_VERSION } from '../../../interview-engine/shared/narrative';

export type HostedNarrative = {
  narrate: Narrate;
  /** The agent model recorded with the narrative. */
  model: string;
  /** Keeps a narrative running after its request has gone, so a reloaded page can rejoin it. */
  track?: (work: Promise<unknown>) => void;
};

/** The narrative's state under the names the browser's report reads. */
const reportState = ({ status, starts, document, failure }: NarrativeState) => ({ status, starts, report: document, failure }) as ReportState<InterviewSummaryContent>;

/**
 * One attempt as a host serves it: commands at `https://session/<action>` go to the actor, and the report route runs
 * the narrative over the ended transcript with the same runner as an imported transcript's narrative. The reply
 * shapes are the practice simulator's, so the browser is unchanged.
 */
export class HostedSession {
  private narrative: NarrativeRunner | undefined;

  private readonly format: NarrativeInput['format'];
  private readonly context: NarrativeInput['context'];

  constructor(readonly actor: SessionActor, private readonly options: HostedNarrative) {
    const definition = actor.definition;
    this.format = definition.plan.report;
    this.context = definition.context;
  }

  async fetch(request: Request): Promise<Response> {
    const action = new URL(request.url).pathname.slice(1);
    const body = request.body ? await request.text() : undefined;
    const reply = await this.actor.handle({ action, capability: request.headers.get('Authorization') ?? '', ...(body != null ? { body } : {}) });
    if (reply.report) return this.startReport(request);
    if (reply.terminal) {
      // Terminal reads carry the narrative's state; a poll waits briefly for a running narrative to settle.
      const report = action === 'poll' && this.narrative ? reportState(await this.narrative.read()) : this.reportState();
      return simulatorJson({ ...reply.body as object, report });
    }
    return simulatorJson(reply.body, reply.status);
  }

  private reportState(): ReportState<InterviewSummaryContent> {
    const snapshot = this.actor.snapshot();
    if (!snapshot || !participantSpoke(snapshot.transcript)) return { status: 'ineligible', starts: 0, report: null, failure: null };
    return this.narrative ? reportState(this.narrative.state()) : { status: 'idle', starts: 0, report: null, failure: null };
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
    if (!this.narrative) {
      const { narrate, model, track } = this.options;
      const input = { transcript: snapshot.transcript, format: this.format, ...(this.context ? { context: this.context } : {}) };
      this.narrative = narrativeRunner(input, narrate, ({ document, attempts }) => {
        this.actor.settleNarrative(document ? { status: 'ready', text: document.text } : { status: 'unavailable', text: null },
          { model, version: NARRATIVE_VERSION, attempts });
      }, track);
    }
    return this.narrative.attach(request.signal);
  }
}
