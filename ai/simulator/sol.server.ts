import { z } from 'zod';
import { foundryUrl, type FoundryConfig } from '../foundry.server';
import type { DirectorUsage } from '../../core/simulator/director';

export class DirectorOutputError extends Error { constructor() { super('Director output was invalid.'); } }

const responseSchema = z.object({
  status: z.literal('completed'), model: z.string(),
  output: z.array(z.object({ type: z.string(), status: z.string().optional(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional() })),
  usage: z.object({
    input_tokens: z.number(), output_tokens: z.number(),
    input_tokens_details: z.object({ cached_tokens: z.number(), cache_write_tokens: z.number().optional() }).optional(),
    output_tokens_details: z.object({ reasoning_tokens: z.number() }).optional(),
  }).optional(),
});

/** An input message. `cache` ends a reusable prefix there with an explicit breakpoint; at most four may be written per request. */
export type SolMessage = { role: 'developer' | 'user'; text: string; cache?: boolean };
type SolContext = { context: unknown } | { messages: SolMessage[]; cacheKey: string | null };

/**
 * One strict-JSON Sol response. The caller validates the parsed value against the dialogue it supplied.
 * With messages and a cache key, only the marked prefixes are cached (explicit mode); a null key sends no cache options.
 */
export async function requestSol(input: {
  foundry: FoundryConfig; signal: AbortSignal; instructions: string; name: string; schema: z.ZodType; effort?: 'low' | 'medium'; maxOutputTokens?: number;
} & SolContext, request: (url: string, options: RequestInit) => Promise<Response> = fetch): Promise<{ value: unknown; model: string; usage: DirectorUsage }> {
  const effort = input.effort ?? 'low';
  const cache = 'messages' in input && input.cacheKey != null;
  const body = 'messages' in input ? {
    input: input.messages.map(item => ({ type: 'message', role: item.role, content: [{
      type: 'input_text', text: item.text, ...(cache && item.cache ? { prompt_cache_breakpoint: { mode: 'explicit' } } : {}),
    }] })),
    ...(cache ? { prompt_cache_options: { mode: 'explicit' }, prompt_cache_key: input.cacheKey } : {}),
  } : { input: JSON.stringify(input.context) };
  const response = await request(foundryUrl(input.foundry, '/responses'), {
    method: 'POST', signal: input.signal,
    headers: { 'api-key': input.foundry.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: input.foundry.agentModel, reasoning: { effort }, store: false, max_output_tokens: input.maxOutputTokens ?? 1800,
      instructions: input.instructions, ...body,
      text: { format: { type: 'json_schema', name: input.name, strict: true, schema: z.toJSONSchema(input.schema) } },
    }),
  });
  if (!response.ok) throw new Error(`Director request failed (${response.status}).`);
  const parsed = responseSchema.safeParse(await response.json());
  if (!parsed.success) throw new DirectorOutputError();
  const data = parsed.data;
  const messages = data.output.filter(item => item.type === 'message');
  if (messages.length !== 1 || messages[0]!.status !== 'completed' || messages[0]!.content?.length !== 1 || messages[0]!.content[0]!.type !== 'output_text') throw new DirectorOutputError();
  let value: unknown;
  try { value = JSON.parse(messages[0]!.content[0]!.text ?? ''); } catch { throw new DirectorOutputError(); }
  input.signal.throwIfAborted();
  const usage = data.usage;
  return { value, model: data.model, usage: {
    inputTokens: usage?.input_tokens ?? null, outputTokens: usage?.output_tokens ?? null, cachedTokens: usage?.input_tokens_details?.cached_tokens ?? null,
    ...(usage?.input_tokens_details?.cache_write_tokens != null ? { cacheWriteTokens: usage.input_tokens_details.cache_write_tokens } : {}),
    ...(usage?.output_tokens_details ? { reasoningTokens: usage.output_tokens_details.reasoning_tokens } : {}),
  } };
}
