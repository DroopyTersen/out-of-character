import { expect, test } from 'bun:test';
import { openControl } from './bunControl.server';

// A local Bun server exercises the real client handshake, headers and failed-handshake status probe.
test('the Bun opener sends provider headers and distinguishes ended sessions from failed handshakes', async () => {
  const keys: string[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request, server) {
      const path = new URL(request.url).pathname;
      if (path === '/open') {
        keys.push(request.headers.get('api-key') ?? '');
        return server.upgrade(request) ? undefined : new Response(null, { status: 500 });
      }
      return new Response(null, { status: path === '/gone' ? 410 : path === '/missing' ? 404 : 500 });
    },
    websocket: { message() {} },
  });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const signal = new AbortController().signal;
    const opened = await openControl({ url: `${base}/open`, headers: { 'api-key': 'fixture' }, signal });
    expect(opened.status).toBe('open');
    if (opened.status === 'open') {
      expect(opened.socket.readyState).toBe(1);
      opened.socket.close();
    }
    expect(keys).toEqual(['fixture']);
    for (const path of ['gone', 'missing']) expect(await openControl({ url: `${base}/${path}`, headers: {}, signal })).toEqual({ status: 'gone' });
    expect(await openControl({ url: `${base}/other`, headers: {}, signal })).toEqual({ status: 'failed' });
    const aborted = new AbortController();
    const opening = openControl({ url: `${base}/open`, headers: {}, signal: aborted.signal });
    aborted.abort();
    await expect(opening).rejects.toThrow();
  } finally { server.stop(true); }
});
