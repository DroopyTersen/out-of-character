import { expect, test } from 'bun:test';
import { serveBriefingAudio } from './briefing-audio';

// Only the Cloudflare asset binding is substituted; response/range handling is real.
const assets = { fetch: async () => new Response('0123456789', { headers: { 'Content-Type': 'audio/mpeg', ETag: '"clip-v1"' } }) };
const url = 'https://example.com/simulator/briefings/scope.mp3';

test('full recordings advertise native seeking and HEAD has no body', async () => {
  const response = await serveBriefingAudio(new Request(url), assets);
  expect(response.status).toBe(200);
  expect(response.headers.get('Accept-Ranges')).toBe('bytes');
  expect(response.headers.get('Content-Length')).toBe('10');
  expect(await response.text()).toBe('0123456789');
  const head = await serveBriefingAudio(new Request(url, { method: 'HEAD', headers: { Range: 'bytes=2-4' } }), assets);
  expect(head.status).toBe(200);
  expect(head.headers.get('Content-Length')).toBe('10');
  expect(await head.text()).toBe('');
});

test.each([
  ['bytes=2-4', '234', 'bytes 2-4/10'],
  ['bytes=7-', '789', 'bytes 7-9/10'],
  ['bytes=-3', '789', 'bytes 7-9/10'],
  ['bytes=8-100', '89', 'bytes 8-9/10'],
  ['bytes=-100', '0123456789', 'bytes 0-9/10'],
])('native player range %s returns the requested bytes', async (range, body, contentRange) => {
  const response = await serveBriefingAudio(new Request(url, { headers: { Range: range } }), assets);
  expect(response.status).toBe(206);
  expect(response.headers.get('Content-Range')).toBe(contentRange);
  expect(response.headers.get('Content-Length')).toBe(String(body.length));
  expect(response.headers.get('Content-Type')).toBe('audio/mpeg');
  expect(await response.text()).toBe(body);
});

test.each(['bytes=10-', 'bytes=5-2', 'bytes=-0'])('unavailable range %s returns 416', async range => {
  const response = await serveBriefingAudio(new Request(url, { headers: { Range: range } }), assets);
  expect(response.status).toBe(416);
  expect(response.headers.get('Content-Range')).toBe('bytes */10');
  expect(await response.text()).toBe('');
});

test('unsupported ranges and stale validators receive the full recording', async () => {
  const requests: HeadersInit[] = [{ Range: 'bytes=0-1,4-5' }, { Range: 'seconds=2-4' }, { Range: 'bytes=2-4', 'If-Range': '"old-clip"' }];
  for (const headers of requests) {
    const response = await serveBriefingAudio(new Request(url, { headers }), assets);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('0123456789');
  }
  const unchanged = await serveBriefingAudio(new Request(url, { headers: { Range: 'bytes=2-4', 'If-Range': '"clip-v1"' } }), assets);
  expect(unchanged.status).toBe(206);
  expect(await unchanged.text()).toBe('234');
});

test('missing recordings preserve the asset failure', async () => {
  const response = await serveBriefingAudio(new Request(url), { fetch: async () => new Response('Missing', { status: 404 }) });
  expect(response.status).toBe(404);
  expect(await response.text()).toBe('Missing');
});
