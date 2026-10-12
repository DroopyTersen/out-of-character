import { expect, test } from 'bun:test';
import { callFailure } from './diagnostics.server';

test.each([
  [422, 'unknown', 'request_validation'],
  [422, 'context_length_exceeded', 'input_too_large'],
  [413, 'unknown', 'input_too_large'],
  [400, 'unknown', 'invalid_request'],
])('request rejection %s retains only a safe category', (statusCode, code, detail) => {
  const failure = callFailure(Object.assign(new Error('Private participant text in provider message'), {
    statusCode, responseHeaders: { 'apim-request-id': 'support-id' },
    responseBody: JSON.stringify({ error: { code, message: 'Private transcript', input: 'Private input' } }),
  }));
  expect(failure).toEqual({ name: 'Error', status: statusCode, requestId: 'support-id', detail });
});

test('malformed or unrecognized provider content is discarded without guessing a size cause', () => {
  expect(callFailure(Object.assign(new Error('Private'), { statusCode: 422, responseBody: '{private' })))
    .toEqual({ name: 'Error', status: 422, detail: 'request_validation' });
  expect(callFailure(Object.assign(new Error('Private'), { statusCode: 503, responseBody: 'Private' })))
    .toEqual({ name: 'Error', status: 503 });
});
