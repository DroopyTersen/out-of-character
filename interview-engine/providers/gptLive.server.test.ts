import { expect, test } from 'bun:test';
import { testFoundry } from './testFoundry.server';
import { attachGptLiveSocket, gptLiveProvider, LiveSessionGone } from './gptLive.server';
import type { ControlOpener, VoiceEvent, WebSocketLike } from './voice.server';

const foundry = testFoundry;
const answer = () => Response.json({ session: { id: 'session-fixture' }, transport: { type: 'webrtc', sdp: 'v=0\r\nanswer' } });

/** A control socket that confirms closure when asked, or never does. */
function controlSocket(confirms: boolean) {
  const listeners: ((event: { data: unknown }) => void)[] = [];
  const requested = Promise.withResolvers<void>();
  const socket = {
    readyState: 1, sent: [] as string[], closed: false, closingRequested: requested.promise,
    send(data: string) {
      socket.sent.push(data);
      if (JSON.parse(data).type === 'session.close') requested.resolve();
      if (confirms && JSON.parse(data).type === 'session.close') {
        queueMicrotask(() => { for (const listener of listeners) { listener({ data: new ArrayBuffer(1) }); listener({ data: 'not json' }); listener({ data: JSON.stringify({ type: 'session.closed' }) }); } });
      }
    },
    close() { socket.closed = true; socket.readyState = 3; },
    emit(data: unknown) { for (const listener of listeners) listener({ data }); },
    addEventListener(type: string, listener: (event: { data: unknown }) => void) { if (type === 'message') listeners.push(listener); },
  };
  return socket;
}
type Control = ReturnType<typeof controlSocket>;
const opens = <Socket extends WebSocketLike>(socket: Socket): ControlOpener<Socket> => async () => ({ status: 'open', socket });
const failed: ControlOpener = async () => ({ status: 'failed' });
const gone: ControlOpener = async () => ({ status: 'gone' });
/** Each attach opens the next of `sockets`, or reports the session gone. */
const openEach = (sockets: (Control | 'gone')[]): ControlOpener<Control> => async () => {
  const next = sockets.shift();
  if (!next) throw new Error('No more control sockets.');
  return next === 'gone' ? { status: 'gone' } : { status: 'open', socket: next };
};

test('create posts the SDP offer, voice and instructions to the configured Live deployment', async () => {
  let body: unknown;
  const provider = gptLiveProvider(foundry, {
    openControl: failed,
    fetch: (async (url: string | URL | Request, options?: RequestInit) => {
      expect(url).toBe('https://fixture-foundry.openai.azure.com/openai/v1/live/sessions');
      expect(options?.method).toBe('POST');
      expect(new Headers(options?.headers).get('api-key')).toBe('fixture-secret');
      expect(new Headers(options?.headers).has('Authorization')).toBe(false);
      body = JSON.parse(String(options?.body));
      return answer();
    }) as unknown as typeof fetch,
  });
  expect(await provider.create({ sdp: 'v=0\r\noffer', voice: 'cedar', instructions: 'Play the client.' })).toEqual({ id: 'session-fixture', sdp: 'v=0\r\nanswer' });
  expect(body).toEqual({
    session: { model: 'live-deployment', instructions: 'Play the client.', store: false, audio: { output: { voice: 'cedar' } } },
    transport: { type: 'webrtc', sdp: 'v=0\r\noffer' },
  });
});

test('create hides provider detail on failure and rejects a malformed answer', async () => {
  const failing = gptLiveProvider(foundry, { openControl: failed, fetch: (async () => new Response('private provider detail', { status: 429 })) as unknown as typeof fetch });
  await expect(failing.create({ sdp: 'v=0', voice: 'cedar', instructions: 'x' })).rejects.toThrow('Live creation failed (429).');
  const malformed = gptLiveProvider(foundry, { openControl: failed, fetch: (async () => Response.json({ session: {} })) as unknown as typeof fetch });
  await expect(malformed.create({ sdp: 'v=0', voice: 'cedar', instructions: 'x' })).rejects.toThrow();
});

test('attach opens the control socket with server-only authentication and a bounded handshake', async () => {
  const socket = controlSocket(true);
  let request: Parameters<ControlOpener>[0] | undefined;
  const provider = gptLiveProvider(foundry, {
    openControl: async opening => { request = opening; return { status: 'open', socket }; },
    fetch: (async () => { throw new Error('attach must not fetch'); }) as unknown as typeof fetch,
  });
  const connection = await provider.attach('session/id');
  expect(request?.url).toBe('https://fixture-foundry.openai.azure.com/openai/v1/live/sessions/session%2Fid/attach');
  expect(request?.headers).toEqual({ 'api-key': 'fixture-secret' });
  expect(request?.signal).toBeInstanceOf(AbortSignal);
  expect(request?.signal.aborted).toBe(false);
  expect(connection.connected).toBe(true);
  expect(connection.send({ kind: 'instruction', id: 'greeting', content: 'Hello' })).toBe(true);
  expect(socket.sent).toEqual([JSON.stringify({ type: 'session.instructions.append', event_id: 'greeting', delegation_id: null, content: 'Hello' })]);
});

test('attach reports an ended session and a failed control connection', async () => {
  await expect(gptLiveProvider(foundry, { openControl: gone }).attach('gone')).rejects.toBeInstanceOf(LiveSessionGone);
  await expect(gptLiveProvider(foundry, { openControl: failed }).attach('id')).rejects.toThrow('Live control connection is unavailable.');
});

test('close asks over the control socket, waits for confirmation and always closes the socket', async () => {
  const socket = controlSocket(true);
  const provider = gptLiveProvider<WebSocketLike>(foundry, { openControl: opens(socket) });
  await provider.close('session-fixture');
  expect(socket.sent).toEqual([JSON.stringify({ type: 'session.close' })]);
  expect(socket.closed).toBe(true);
});

test('close treats an ended session as closed and propagates other failures', async () => {
  await gptLiveProvider(foundry, { openControl: gone }).close('gone');
  const unavailable = gptLiveProvider(foundry, { openControl: failed });
  await expect(unavailable.close('id')).rejects.toThrow('Live control connection is unavailable.');
});


test('only valid wire events reach the consumer, normalized to engine speakers and acknowledgements', async () => {
  const socket = controlSocket(true);
  const events: VoiceEvent[] = [];
  const provider = gptLiveProvider(foundry, { openControl: opens(socket) });
  await provider.attach('id', { event: event => events.push(event), dropped() {} });
  for (const invalid of [new ArrayBuffer(1), 'bad json', 'null', '5', JSON.stringify({ type: 'session.input_transcript.delta', delta: 'bad time', start_ms: 8, end_ms: 2 })]) socket.emit(invalid);
  expect(events).toEqual([]);
  socket.emit(JSON.stringify({ type: 'session.input_transcript.delta', event_id: 'speech', delta: 'A portal.', start_ms: 2, end_ms: 8 }));
  socket.emit(JSON.stringify({ type: 'session.thinking.appended', client_event_id: 'note', start_ms: 9, end_ms: 10 }));
  socket.emit(JSON.stringify({ type: 'error', error: { client_event_id: 'typed-answer' } }));
  expect(events).toEqual([
    { type: 'transcript', id: 'speech', speaker: 'participant', text: 'A portal.', startMs: 2, endMs: 8 },
    { type: 'acknowledged', id: 'note', startMs: 9, endMs: 10 },
    { type: 'error', id: 'typed-answer' },
  ]);
});

test('a consumer exception propagates rather than disappearing as malformed protocol', async () => {
  const socket = controlSocket(true);
  const provider = gptLiveProvider(foundry, { openControl: opens(socket) });
  await provider.attach('id', { event() { throw new Error('consumer failed'); }, dropped() {} });
  expect(() => socket.emit('not json')).not.toThrow();
  expect(() => socket.emit(JSON.stringify({ type: 'session.closed' }))).toThrow('consumer failed');
});

test('live and lease-only closure share confirmation and deliver the final participant transcript before settling', async () => {
  for (const live of [true, false]) {
    const socket = controlSocket(false);
    const events: VoiceEvent[] = [];
    const provider = gptLiveProvider(foundry, { openControl: opens(socket) });
    let settled = false;
    const connection = live ? await provider.attach('id', { event: event => events.push(event), dropped() {} }) : undefined;
    const closing = (connection ? connection.close() : provider.close('id')).then(() => { settled = true; });
    await socket.closingRequested;
    expect(settled).toBe(false);
    expect(socket.closed).toBe(false);
    socket.emit(JSON.stringify({ type: 'session.input_transcript.delta', delta: 'The last answer.', start_ms: 1, end_ms: 2 }));
    if (live) expect(events).toContainEqual({ type: 'transcript', id: undefined, speaker: 'participant', text: 'The last answer.', startMs: 1, endMs: 2 });
    socket.emit(JSON.stringify({ type: 'session.closed', reason: 'close_requested', usage: { seconds: 12 } }));
    await closing;
    expect(settled).toBe(true);
    expect(socket.closed).toBe(true);
    if (live) expect(events.at(-1)).toEqual({ type: 'closed', reason: 'close_requested', usageSeconds: 12 });
  }
});

test('a dropped control connection reopens for closure and an already-gone session is confirmed', async () => {
  for (const gone of [true, false]) {
    const first = controlSocket(false), replacement = controlSocket(true);
    const remaining = [first, gone ? 'gone' as const : replacement];
    const provider = gptLiveProvider(foundry, { openControl: openEach(remaining) });
    const connection = await provider.attach('id');
    first.close();
    await connection.close();
    expect(remaining).toEqual([]);
    if (!gone) expect(replacement.closed).toBe(true);
  }
});

test('an unconfirmed close times out, drops the control socket, and leaves retry responsibility with the caller', async () => {
  const socket = controlSocket(false);
  const provider = gptLiveProvider(foundry, { openControl: opens(socket) });
  await expect(provider.close('id')).rejects.toThrow('Closure not confirmed.');
  expect(socket.closed).toBe(true);
}, 15_000);

test('the separate simulator can open the same authenticated upgrade as a raw socket', async () => {
  const socket = controlSocket(true);
  expect(await attachGptLiveSocket('id', foundry, { openControl: opens(socket) })).toBe(socket);
});


test('old and detached connections cannot deliver late provider events', async () => {
  const first = controlSocket(false), replacement = controlSocket(false);
  const events: VoiceEvent[] = [];
  const provider = gptLiveProvider(foundry, { openControl: openEach([first, replacement]) });
  const connection = await provider.attach('id', { event: event => events.push(event), dropped() {} });
  first.close();
  let settled = false;
  const closing = connection.close().then(() => { settled = true; });
  await replacement.closingRequested;
  first.emit(JSON.stringify({ type: 'session.closed', reason: 'old socket' }));
  await Promise.resolve();
  expect(events).toEqual([]);
  expect(settled).toBe(false);
  replacement.emit(JSON.stringify({ type: 'session.closed', reason: 'close_requested' }));
  await closing;
  expect(events).toEqual([{ type: 'closed', reason: 'close_requested', usageSeconds: null }]);
  replacement.emit(JSON.stringify({ type: 'session.closed', reason: 'late' }));
  expect(events).toHaveLength(1);
});
