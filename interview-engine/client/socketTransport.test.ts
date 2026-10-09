import { expect, test } from 'bun:test';
import type { SocketRequest } from '../shared/protocol';
import { socketTransport, socketUrl } from './socketTransport';
import { socketPair, type TestSocket } from './testSocket';
import { SessionRequestError, SessionUnanswered } from './transport';

const attempt = { id: '123e4567-e89b-42d3-a456-426614174000', capability: 'c'.repeat(64) };
const options = { attempt, timeoutMs: 1_000 };

/** A transport whose sockets are test pairs; `serve` answers each command the server end receives. */
function harness(serve: (request: SocketRequest, server: TestSocket) => void, accept = true) {
  const opened: { url: string; server: TestSocket; accept(): void }[] = [];
  const transport = socketTransport('https://app.test/api/interview/sessions', { open: url => {
    const pair = socketPair();
    pair.server.addEventListener('message', event => serve(JSON.parse(String(event.data)), pair.server));
    opened.push({ url, server: pair.server, accept: pair.accept });
    if (accept) pair.accept();
    return pair.browser;
  } });
  return { transport, opened };
}
const answer = (server: TestSocket, id: number, status: number, body: unknown) => server.send(JSON.stringify({ id, status, body }));

test('the socket URL sits beside the poll routes, over wss for https', () => {
  expect(socketUrl('https://app.test/api/interview/sessions', attempt)).toBe(`wss://app.test/api/interview/sessions/${attempt.id}/socket`);
  expect(socketUrl('http://localhost:8788/api/interview/sessions', attempt)).toBe(`ws://localhost:8788/api/interview/sessions/${attempt.id}/socket`);
});

test('commands share one socket, carry the capability, and are correlated by id whatever order replies arrive in', async () => {
  const received: SocketRequest[] = [];
  const { transport, opened } = harness((request, server) => {
    received.push(request);
    // The poll's reply overtakes the ready's.
    if (request.action === 'poll') { answer(server, request.id, 200, { status: 'live' }); answer(server, received[0]!.id, 200, { status: 'ready' }); }
  });
  const ready = transport.request('ready', undefined, options);
  const poll = transport.request('poll', { active: true, audio: false }, options);
  expect(await poll).toEqual({ status: 'live' });
  expect(await ready).toEqual({ status: 'ready' });
  expect(opened).toHaveLength(1);
  expect(opened[0]!.url).toBe(`wss://app.test/api/interview/sessions/${attempt.id}/socket`);
  expect(received).toEqual([
    { id: 0, action: 'ready', capability: attempt.capability },
    { id: 1, action: 'poll', capability: attempt.capability, body: { active: true, audio: false } },
  ]);
});

test('an HTTP error reply is a SessionRequestError with its status, as on the poll transport', async () => {
  const { transport } = harness((request, server) => answer(server, request.id, request.action === 'end' ? 403 : 409, request.action === 'end' ? { error: 'Session capability is invalid.' } : null));
  const ended = await transport.request('end', undefined, options).catch((error: Error) => error);
  expect(ended).toBeInstanceOf(SessionRequestError);
  expect(ended).toMatchObject({ message: 'Session capability is invalid.', status: 403 });
  expect(await transport.request('pause', undefined, options).catch((error: Error) => error)).toMatchObject({ message: 'The interview connection is unavailable.', status: 409 });
});

test('no reply in time, or a socket that never opens, is SessionUnanswered', async () => {
  const silent = harness(() => {});
  const late = await silent.transport.request('poll', undefined, { ...options, timeoutMs: 10 }).catch((error: Error) => error);
  expect(late).toBeInstanceOf(SessionUnanswered);
  expect((late as Error).message).toBe('The server took too long to answer.');
  const refused = harness(() => {}, false);
  const pending = refused.transport.request('poll', undefined, options).catch((error: Error) => error);
  refused.opened[0]!.server.close();
  expect(await pending).toBeInstanceOf(SessionUnanswered);
});

test('a dropped socket fails what was waiting, and the next request reconnects for the same attempt', async () => {
  let drop = true;
  const { transport, opened } = harness((request, server) => {
    if (drop) { drop = false; server.close(); return; }
    answer(server, request.id, 200, { status: 'live' });
  });
  const lost = await transport.request('poll', undefined, options).catch((error: Error) => error);
  expect(lost).toBeInstanceOf(SessionUnanswered);
  expect((lost as Error).message).toBe('The server could not be reached.');
  expect(await transport.request('poll', undefined, options)).toEqual({ status: 'live' });
  expect(opened.map(item => item.url)).toEqual([opened[0]!.url, opened[0]!.url]);
});

test('an aborted request rejects with its reason, and a keepalive request goes over HTTP', async () => {
  const { transport } = harness(() => {});
  const controller = new AbortController();
  const waiting = transport.request('poll', undefined, { ...options, signal: controller.signal }).catch((error: Error) => error);
  controller.abort(new Error('left the page'));
  expect(((await waiting) as Error).message).toBe('left the page');
  const original = globalThis.fetch;
  const posted: string[] = [];
  globalThis.fetch = (async (url: string) => { posted.push(String(url)); return Response.json({ status: 'ended' }); }) as unknown as typeof fetch;
  try {
    expect(await transport.request('end', undefined, { ...options, keepalive: true })).toEqual({ status: 'ended' });
  } finally { globalThis.fetch = original; }
  expect(posted).toEqual([`https://app.test/api/interview/sessions/${attempt.id}/end`]);
});
