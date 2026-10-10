import { expect, test } from 'bun:test';
import { callFailure } from './diagnostics.server';
import { DirectorOutputError, requestSol } from './structured.server';
import { testFoundry } from './testFoundry.server';

const wire = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };

const completed = (text: string) => Response.json({
  status: 'completed', model: 'agent-deployment-2026',
  output: [{ type: 'reasoning' }, { type: 'message', status: 'completed', content: [{ type: 'output_text', text }] }],
  usage: { input_tokens: 120, output_tokens: 30, input_tokens_details: { cached_tokens: 100, cache_write_tokens: 20 }, output_tokens_details: { reasoning_tokens: 12 } },
});

test('a structured request sends strict JSON schema output with only the marked prefixes cached', async () => {
  let sent: { url: string; body: Record<string, unknown>; key: string | null } | undefined;
  const result = await requestSol({
    foundry: testFoundry, signal: new AbortController().signal, instructions: 'Keep the map.', name: 'map', jsonSchema: wire,
    messages: [{ role: 'developer', text: 'stable', cache: true }, { role: 'user', text: 'latest' }], cacheKey: 'attempt-1',
  }, async (url, options) => {
    sent = { url, body: JSON.parse(String(options.body)), key: new Headers(options.headers).get('api-key') };
    return completed('{"ok":true}');
  });
  expect(sent?.url).toBe('https://fixture-foundry.openai.azure.com/openai/v1/responses');
  expect(sent?.key).toBe('fixture-secret');
  expect(sent?.body).toMatchObject({
    model: 'agent-deployment', reasoning: { effort: 'low' }, store: false, max_output_tokens: 1800, instructions: 'Keep the map.',
    prompt_cache_options: { mode: 'explicit' }, prompt_cache_key: 'attempt-1',
    text: { format: { type: 'json_schema', name: 'map', strict: true, schema: wire } },
  });
  expect(sent?.body.input).toEqual([
    { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'stable', prompt_cache_breakpoint: { mode: 'explicit' } }] },
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'latest' }] },
  ]);
  expect(result).toEqual({ value: { ok: true }, model: 'agent-deployment-2026', usage: { inputTokens: 120, outputTokens: 30, cachedTokens: 100, cacheWriteTokens: 20, reasoningTokens: 12 } });
});

test('the adapter returns parsed JSON for the caller to validate locally', async () => {
  // Only the paid HTTP boundary is substituted; response parsing runs normally.
  const result = await requestSol({
    foundry: testFoundry, signal: new AbortController().signal, instructions: 'x', name: 'n', jsonSchema: wire,
    messages: [{ role: 'user', text: '{}' }], cacheKey: null,
  }, async () => completed('{"ok":"requires local validation"}'));
  expect(result.value).toEqual({ ok: 'requires local validation' });
});

test('an incomplete or unparsable response is an output error carrying the usage it reported', async () => {
  const plain = { foundry: testFoundry, signal: new AbortController().signal, instructions: 'x', name: 'n', jsonSchema: wire, messages: [{ role: 'user' as const, text: '{}' }], cacheKey: null };
  const incomplete = requestSol(plain,
    async () => Response.json({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, model: 'm', output: [], usage: { input_tokens: 1, output_tokens: 2 } }));
  await expect(incomplete).rejects.toMatchObject({ name: 'DirectorOutputError', detail: 'max_output_tokens', usage: { inputTokens: 1, outputTokens: 2, cachedTokens: null } });
  const unparsable = requestSol(plain, async () => completed('not json'));
  await expect(unparsable).rejects.toBeInstanceOf(DirectorOutputError);
});

// Ported from ai/interview/diagnostics.server.test.ts against the engine's copies.
test('a rejected provider request retains its status and support ID without its private payload', async () => {
  // Substitute only the paid HTTP boundary; exercise the real response handling and diagnostic projection.
  let failure: unknown;
  try {
    await requestSol({ foundry: testFoundry, signal: new AbortController().signal, instructions: 'PRIVATE PROMPT',
      messages: [{ role: 'user', text: 'PRIVATE TRANSCRIPT' }], cacheKey: null, name: 'result', jsonSchema: wire },
    async () => new Response('PRIVATE PROVIDER BODY', { status: 429, headers: { 'apim-request-id': 'support-request-123', Authorization: 'PRIVATE TOKEN' } }));
  } catch (error) { failure = error; }
  expect(callFailure(failure)).toEqual({ name: 'DirectorHttpError', status: 429, requestId: 'support-request-123' });
  expect(JSON.stringify(callFailure(failure))).not.toContain('PRIVATE');
});

test('SDK errors and incomplete responses retain only bounded metadata', () => {
  const sdkError = Object.assign(new Error('PRIVATE REQUEST DATA'), { name: 'AI_APICallError', statusCode: 503,
    responseHeaders: { 'x-request-id': 'request-abc', authorization: 'PRIVATE TOKEN' }, responseBody: 'PRIVATE RESPONSE' });
  expect(callFailure(sdkError)).toEqual({ name: 'AI_APICallError', status: 503, requestId: 'request-abc' });
  expect(callFailure(new DirectorOutputError('max_output_tokens'))).toEqual({ name: 'DirectorOutputError', detail: 'max_output_tokens' });
  expect(callFailure(Object.assign(new Error('PRIVATE'), { requestId: 'x'.repeat(101) }))).toEqual({ name: 'Error' });
  expect(callFailure('PRIVATE')).toEqual({ name: 'UnknownError' });
});
