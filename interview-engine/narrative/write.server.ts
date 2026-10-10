import { Output, streamText, toTextStream } from 'ai';
import type { Providers } from '../providers/providers.server';
import type { Narrative, NarrativeInput, NarrativeRun } from './narrative.server';
import { narrativeRequestSchema } from '../shared/protocol';
import { narrativeDocumentSchema } from '../shared/narrative';
import { narrativeInstructions } from './narrative.prompt';

/**
 * Writes Markdown with the agent model from the independent report input.
 * Only narrative text crosses the stream; model reasoning stays private. `result` settles once and never rejects.
 * Throws before any request when the participant said nothing.
 */
export function writeNarrative(input: NarrativeInput, providers: Pick<Providers, 'language' | 'telemetry'>, signal?: AbortSignal): NarrativeRun {
  const approved = narrativeRequestSchema.parse(input);
  const context = approved.context && { background: approved.context.background, participant: approved.context.participant };
  if (!approved.transcript.some(passage => passage.speaker === 'participant' && passage.text.trim())) throw new Error('Interview summary unavailable.');
  let settle!: (narrative: Narrative) => void;
  const result = new Promise<Narrative>(resolve => { settle = resolve; });
  const output = streamText({
    model: providers.language.agent,
    providerOptions: { openai: { reasoningEffort: 'medium', forceReasoning: true, store: false } },
    output: Output.object({ schema: narrativeDocumentSchema }),
    system: narrativeInstructions,
    prompt: JSON.stringify({ ...approved, context }),
    maxOutputTokens: 12_000, maxRetries: 0, abortSignal: signal,
    ...(providers.telemetry ? { telemetry: providers.telemetry } : {}),
    onError: () => { settle({ document: null, failure: 'provider', usage: null }); },
    onAbort: () => { settle({ document: null, failure: 'cancelled', usage: null }); },
    onEnd: event => {
      const usage = { inputTokens: event.totalUsage.inputTokens ?? null, outputTokens: event.totalUsage.outputTokens ?? null,
        reasoningTokens: event.totalUsage.outputTokenDetails.reasoningTokens ?? null, cachedTokens: event.totalUsage.inputTokenDetails.cacheReadTokens ?? null };
      const parsed = narrativeDocumentSchema.safeParse(event.output);
      settle(event.finishReason === 'stop' && parsed.success
        ? { document: parsed.data, failure: null, usage }
        : { document: null, failure: 'invalid', usage });
    },
  });
  return { stream: toTextStream({ stream: output.stream }), result };
}
