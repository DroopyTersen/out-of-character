import { z } from 'zod';
import { foundryUrl, type FoundryConfig } from './foundry.server';

// A copy of ai/simulator/sol.server.ts: the simulator keeps its own so it does not depend on the engine.
// The error class names are unchanged so diagnostics records read the same after the interview moves here.

/** What one structured response reported. The shape of the simulator's `DirectorUsage`. */
export type ModelUsage = { inputTokens: number | null; outputTokens: number | null; cachedTokens?: number | null; cacheWriteTokens?: number; reasoningTokens?: number };

/** `detail` names why a response stopped short, such as max_output_tokens; `usage` is what that response reported. */
export class DirectorOutputError extends Error {
  constructor(readonly detail?: string, readonly usage?: ModelUsage) {
    super(detail ? `Director output was incomplete: ${detail}.` : 'Director output was invalid.');
    this.name = 'DirectorOutputError';
  }
}

export class DirectorHttpError extends Error {
  constructor(readonly statusCode: number, readonly requestId: string | null) {
    super(`Director request failed (${statusCode}).`);
    this.name = 'DirectorHttpError';
  }
}

const responseSchema = z.object({
  status: z.string(), incomplete_details: z.object({ reason: z.string().optional() }).nullish(), model: z.string(),
  output: z.array(z.object({ type: z.string(), status: z.string().optional(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional() })),
  usage: z.object({
    input_tokens: z.number(), output_tokens: z.number(),
    input_tokens_details: z.object({ cached_tokens: z.number().optional(), cache_write_tokens: z.number().optional() }).optional(),
    output_tokens_details: z.object({ reasoning_tokens: z.number().optional() }).optional(),
  }).optional(),
});

/** An input message. `cache` ends a reusable prefix there with an explicit breakpoint; at most four may be written per request. */
export type SolMessage = { role: 'developer' | 'user'; text: string; cache?: boolean };
type SolContext = { context: unknown } | { messages: SolMessage[]; cacheKey: string | null };
type SolRequest = {
  signal: AbortSignal; instructions: string; name: string; schema: z.ZodType; effort?: 'low' | 'medium'; maxOutputTokens?: number;
  /** The JSON schema sent, when it should differ from `schema`'s, such as without string lengths. */
  jsonSchema?: Record<string, unknown>;
};
/** A structured call to the agent model with the resource and credentials already bound: what the Providers carry. */
export type StructuredInput = SolRequest & SolContext;
export type StructuredResult = { value: unknown; model: string; usage: ModelUsage };
export type StructuredRequest = (input: StructuredInput) => Promise<StructuredResult>;

/**
 * One strict-JSON Sol response. The caller validates the parsed value against the dialogue it supplied.
 * With messages and a cache key, only the marked prefixes are cached (explicit mode); a null key sends no cache options.
 */
export async function requestSol(input: { foundry: FoundryConfig } & StructuredInput, request: (url: string, options: RequestInit) => Promise<Response> = fetch): Promise<StructuredResult> {
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
      text: { format: { type: 'json_schema', name: input.name, strict: true, schema: input.jsonSchema ?? z.toJSONSchema(input.schema) } },
    }),
  });
  if (!response.ok) throw new DirectorHttpError(response.status, response.headers.get('apim-request-id') ?? response.headers.get('x-request-id'));
  const parsed = responseSchema.safeParse(await response.json());
  if (!parsed.success) throw new DirectorOutputError();
  const data = parsed.data;
  const usage = readUsage(data.usage);
  if (data.status !== 'completed') throw new DirectorOutputError(data.incomplete_details?.reason ?? data.status, usage);
  const messages = data.output.filter(item => item.type === 'message');
  if (messages.length !== 1 || messages[0]!.status !== 'completed' || messages[0]!.content?.length !== 1 || messages[0]!.content[0]!.type !== 'output_text') throw new DirectorOutputError(undefined, usage);
  let value: unknown;
  try { value = JSON.parse(messages[0]!.content[0]!.text ?? ''); } catch { throw new DirectorOutputError(undefined, usage); }
  input.signal.throwIfAborted();
  return { value, model: data.model, usage };
}

function readUsage(usage: z.infer<typeof responseSchema>['usage']): ModelUsage {
  return {
    inputTokens: usage?.input_tokens ?? null, outputTokens: usage?.output_tokens ?? null, cachedTokens: usage?.input_tokens_details?.cached_tokens ?? null,
    ...(usage?.input_tokens_details?.cache_write_tokens != null ? { cacheWriteTokens: usage.input_tokens_details.cache_write_tokens } : {}),
    ...(usage?.output_tokens_details?.reasoning_tokens != null ? { reasoningTokens: usage.output_tokens_details.reasoning_tokens } : {}),
  };
}

/** Binds the resource and its credentials once, so the callers carry no credentials of their own. */
export const structuredWith = (foundry: FoundryConfig, request: (url: string, options: RequestInit) => Promise<Response> = fetch): StructuredRequest =>
  input => requestSol({ foundry, ...input }, request);
