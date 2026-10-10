import { NARRATIVE_VERSION } from '../../app/reports/report.types';
import { foundryProvider, type FoundryConfig } from '../foundry.server';
import type { InterviewSummaryContent } from '../../core/interview';
import type { Passage } from '../../interview-engine/shared/transcript';
import type { ReportResult } from '../simulator/report.server';
import { spec } from '../../interviews/project-closeout/spec';
import { writeNarrative } from '../../app/reports/writeNarrative.server';

export type SummaryInput = { transcript: Passage[]; foundry: FoundryConfig; signal: AbortSignal };
export type SummaryResult = ReportResult<InterviewSummaryContent>;
export const SUMMARY_VERSION = NARRATIVE_VERSION;

/** The closeout narrative, written from the approved report format. Only summary text crosses the stream; model reasoning stays private. */
export function summarizeInterview(input: SummaryInput, finish: (result: SummaryResult) => void, request: typeof fetch = fetch): ReadableStream<string> {
  const agent = foundryProvider(input.foundry, request).responses(input.foundry.agentModel);
  const run = writeNarrative({ transcript: input.transcript, format: spec.report }, agent, { signal: input.signal });
  void run.result.then(({ document, failure, usage }) => finish(failure === null ? { report: document, failure, usage } : { report: null, failure, usage }));
  return run.stream;
}
