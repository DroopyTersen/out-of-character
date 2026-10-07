import { expect, test } from 'bun:test';
import type { FoundryConfig } from './foundry.server';
import { gptLiveProvider, LiveSessionGone } from './gptLive.server';
import type { WebSocketLike } from './voice.server';

const foundry: FoundryConfig = { resourceName: 'fixture-foundry', apiKey: 'fixture-secret', agentModel: 'agent', fastModel: 'fast', liveModel: 'live-deployment' };
const answer = () => Response.json({ session: { id: 'session-fixture' }, transport: { type: 'webrtc', sdp: 'v=0\r\nanswer' } });

/** A control socket that confirms closure when asked, or never does. */
function controlSocket(confirms: boolean) {
  const listeners: ((event: { data: unknown }) => void)[] = [];
  const socket = {
    readyState: 1, sent: [] as string[], closed: false,
    send(data: string) {
      socket.sent.push(data);
      if (confirms && JSON.parse(data).type === 'session.close') {
        queueMicrotask(() => { for (const listener of listeners) { listener({ data: new ArrayBuffer(1) }); listener({ data: 'not json' }); listener({ data: JSON.stringify({ type: 'session.closed' }) }); } });
      }
    },
    close() { socket.closed = true; },
    addEventListener(type: string, listener: (event: { data: unknown }) => void) { if (type === 'message') listeners.push(listener); },
  };
  return socket;
}

test('create posts the SDP offer, voice and instructions to the configured Live deployment', async () => {
  let body: unknown;
  const provider = gptLiveProvider(foundry, {
    socket: () => null,
    fetch: (async (url, options) => {
      expect(url).toBe('https://fixture-foundry.openai.azure.com/openai/v1/live/sessions');
      expect(options?.method).toBe('POST');
      expect(new Headers(options?.headers).get('api-key')).toBe('fixture-secret');
      expect(new Headers(options?.headers).has('Authorization')).toBe(false);
      body = JSON.parse(String(options?.body));
      return answer();
    }) as typeof fetch,
  });
  expect(await provider.create({ sdp: 'v=0\r\noffer', voice: 'cedar', instructions: 'Play the client.' })).toEqual({ id: 'session-fixture', sdp: 'v=0\r\nanswer' });
  expect(body).toEqual({
    session: { model: 'live-deployment', instructions: 'Play the client.', store: false, audio: { output: { voice: 'cedar' } } },
    transport: { type: 'webrtc', sdp: 'v=0\r\noffer' },
  });
});

test('create hides provider detail on failure and rejects a malformed answer', async () => {
  const failing = gptLiveProvider(foundry, { socket: () => null, fetch: (async () => new Response('private provider detail', { status: 429 })) as unknown as typeof fetch });
  await expect(failing.create({ sdp: 'v=0', voice: 'cedar', instructions: 'x' })).rejects.toThrow('Live creation failed (429).');
  const malformed = gptLiveProvider(foundry, { socket: () => null, fetch: (async () => Response.json({ session: {} })) as unknown as typeof fetch });
  await expect(malformed.create({ sdp: 'v=0', voice: 'cedar', instructions: 'x' })).rejects.toThrow();
});

test('attach upgrades with server-only authentication and opens the socket from the response', async () => {
  const socket = controlSocket(true);
  const upgrade = { status: 101 } as Response;
  let opened: Response | undefined;
  const provider = gptLiveProvider(foundry, {
    socket: response => { opened = response; return socket; },
    fetch: (async (url, options) => {
      expect(url).toBe('https://fixture-foundry.openai.azure.com/openai/v1/live/sessions/session%2Fid/attach');
      expect(new Headers(options?.headers).get('api-key')).toBe('fixture-secret');
      expect(new Headers(options?.headers).get('Upgrade')).toBe('websocket');
      return upgrade;
    }) as typeof fetch,
  });
  expect(await provider.attach('session/id')).toBe(socket);
  expect(opened).toBe(upgrade);
});

test('attach reports an ended session and a missing socket', async () => {
  for (const status of [404, 410]) {
    const provider = gptLiveProvider(foundry, { socket: () => controlSocket(true), fetch: (async () => new Response(null, { status })) as unknown as typeof fetch });
    await expect(provider.attach('gone')).rejects.toBeInstanceOf(LiveSessionGone);
  }
  const provider = gptLiveProvider(foundry, { socket: () => null, fetch: (async () => ({ status: 101 }) as Response) as unknown as typeof fetch });
  await expect(provider.attach('id')).rejects.toThrow('Live control connection is unavailable.');
});

test('close asks over the control socket, waits for confirmation and always closes the socket', async () => {
  const socket = controlSocket(true);
  const provider = gptLiveProvider<WebSocketLike>(foundry, { socket: () => socket, fetch: (async () => ({ status: 101 }) as Response) as unknown as typeof fetch });
  await provider.close('session-fixture');
  expect(socket.sent).toEqual([JSON.stringify({ type: 'session.close' })]);
  expect(socket.closed).toBe(true);
});

test('close treats an ended session as closed and propagates other failures', async () => {
  const gone = gptLiveProvider(foundry, { socket: () => null, fetch: (async () => new Response(null, { status: 410 })) as unknown as typeof fetch });
  await gone.close('gone');
  const unavailable = gptLiveProvider(foundry, { socket: () => null, fetch: (async () => ({ status: 101 }) as Response) as unknown as typeof fetch });
  await expect(unavailable.close('id')).rejects.toThrow('Live control connection is unavailable.');
});
