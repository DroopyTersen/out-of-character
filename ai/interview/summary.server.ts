import { foundryProvider, type FoundryConfig } from '../foundry.server';
import type { InterviewSummaryContent } from '../../core/interview';
import type { TranscriptEntry } from '../../core/simulator/types';
import type { ReportResult } from '../simulator/report.server';
import { spec } from '../../interviews/project-closeout/spec';
import { writeNarrative } from '../../interview-engine/narrative/write.server';

export type SummaryInput = { transcript: TranscriptEntry[]; foundry: FoundryConfig; signal: AbortSignal };
export type SummaryResult = ReportResult<InterviewSummaryContent>;
export const SUMMARY_VERSION = spec.narrative.version;

/** The closeout narrative, written by the engine from the spec. Only summary text crosses the stream; model reasoning stays private. */
export function summarizeInterview(input: SummaryInput, finish: (result: SummaryResult) => void, request: typeof fetch = fetch): ReadableStream<string> {
  const agent = foundryProvider(input.foundry, request).responses(input.foundry.agentModel);
  const passages = input.transcript.map(({ id, speaker, text, startMs, endMs }) => ({ id, speaker: speaker === 'trainee' ? 'participant' as const : 'interviewer' as const, text, startMs, endMs }));
  const run = writeNarrative({ template: spec.narrative, passages }, { language: { agent, fast: agent } }, input.signal);
  void run.result.then(({ document, failure, usage }) => finish(failure === null ? { report: document, failure, usage } : { report: null, failure, usage }));
  return run.stream;
}
