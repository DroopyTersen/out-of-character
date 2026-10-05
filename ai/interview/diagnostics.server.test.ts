import { expect, test } from 'bun:test';
import { z } from 'zod';
import { fixtureFoundry } from '../foundry-fixture';
import { requestSol, DirectorOutputError } from '../simulator/sol.server';
import { callFailure } from './diagnostics.server';

test('a rejected provider request retains its status and support ID without its private payload', async () => {
  // Substitute only the paid HTTP boundary; exercise the real response handling and diagnostic projection.
  let failure: unknown;
  try {
    await requestSol({ foundry: fixtureFoundry, signal: new AbortController().signal, instructions: 'PRIVATE PROMPT',
      context: { transcript: 'PRIVATE TRANSCRIPT' }, name: 'result', schema: z.object({ text: z.string() }) },
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
