import { foundryProvider, type FoundryConfig } from '../foundry.server';
import { Output, streamText, toTextStream } from 'ai';
import { interviewSummarySchema, type InterviewSummaryContent } from '../../core/interview';
import type { TranscriptEntry } from '../../core/simulator/types';
import type { ReportResult } from '../simulator/report.server';
import { spec } from '../../interviews/project-closeout/spec';

export type SummaryInput = { transcript: TranscriptEntry[]; foundry: FoundryConfig; signal: AbortSignal };
export type SummaryResult = ReportResult<InterviewSummaryContent>;
export const SUMMARY_VERSION = spec.narrative.version;

/** Only summary text crosses the stream; model reasoning stays private. */
export function summarizeInterview(input: SummaryInput, finish: (result: SummaryResult) => void, request: typeof fetch = fetch): ReadableStream<string> {
  if (!input.transcript.some(entry => entry.speaker === 'trainee' && entry.text.trim())) throw new Error('Interview summary unavailable.');
  const provider = foundryProvider(input.foundry, request);
  const result = streamText({
    model: provider.responses(input.foundry.agentModel),
    providerOptions: { openai: { reasoningEffort: 'medium', forceReasoning: true, store: false } },
    output: Output.object({ schema: interviewSummarySchema }),
    system: spec.narrative.system,
    prompt: JSON.stringify({ transcript: input.transcript.map(({ speaker, text }) => ({ speaker: speaker === 'trainee' ? 'PARTICIPANT' : 'INTERVIEWER', text })) }),
    maxOutputTokens: 12_000, maxRetries: 0, abortSignal: input.signal,
    onError: () => { finish({ report: null, failure: 'provider', usage: null }); },
    onAbort: () => { finish({ report: null, failure: 'cancelled', usage: null }); },
    onEnd: event => {
      const usage = { inputTokens: event.totalUsage.inputTokens ?? null, outputTokens: event.totalUsage.outputTokens ?? null,
        reasoningTokens: event.totalUsage.outputTokenDetails.reasoningTokens ?? null, cachedTokens: event.totalUsage.inputTokenDetails.cacheReadTokens ?? null };
      const parsed = interviewSummarySchema.safeParse(event.output);
      finish(event.finishReason === 'stop' && parsed.success
        ? { report: parsed.data, failure: null, usage }
        : { report: null, failure: 'invalid', usage });
    },
  });
  return toTextStream({ stream: result.stream });
}
