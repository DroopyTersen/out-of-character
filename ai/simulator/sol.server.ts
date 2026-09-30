import { z } from 'zod';
import { foundryUrl, type FoundryConfig } from '../foundry.server';
import type { DirectorUsage } from '../../core/simulator/director';

export class DirectorOutputError extends Error { constructor() { super('Director output was invalid.'); } }

const responseSchema = z.object({
  status: z.literal('completed'), model: z.string(),
  output: z.array(z.object({ type: z.string(), status: z.string().optional(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional() })),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number(), input_tokens_details: z.object({ cached_tokens: z.number() }).optional() }).optional(),
});

/** One strict-JSON Sol response. The caller validates the parsed value against the dialogue it supplied. */
export async function requestSol(input: {
  foundry: FoundryConfig; signal: AbortSignal; instructions: string; context: unknown; name: string; schema: z.ZodType; effort?: 'low' | 'medium';
}, request: (url: string, options: RequestInit) => Promise<Response> = fetch): Promise<{ value: unknown; model: string; usage: DirectorUsage }> {
  const effort = input.effort ?? 'low';
  const response = await request(foundryUrl(input.foundry, '/responses'), {
    method: 'POST', signal: input.signal,
    headers: { 'api-key': input.foundry.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: input.foundry.agentModel, reasoning: { effort }, store: false, max_output_tokens: 1800,
      instructions: input.instructions, input: JSON.stringify(input.context),
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
  return { value, model: data.model, usage: { inputTokens: data.usage?.input_tokens ?? null, outputTokens: data.usage?.output_tokens ?? null, cachedTokens: data.usage?.input_tokens_details?.cached_tokens ?? null } };
}
