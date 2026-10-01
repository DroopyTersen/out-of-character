import { afterAll, afterEach, beforeAll, beforeEach, expect, jest, test } from 'bun:test';
import type { SessionSnapshot } from '../../core/simulator/types';
import type { Link } from './live-connection';

// Browser media and the session server are substituted; the connection's own pause, heartbeat, and resume logic is real.
class FakeTrack { enabled = true; stopped = false; stop() { this.stopped = true; } }
class FakeStream {
  tracks = [new FakeTrack()];
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks; }
}
class FakePeer extends EventTarget {
  static all: FakePeer[] = [];
  connectionState: RTCPeerConnectionState = 'new';
  iceGatheringState = 'complete';
  localDescription: { sdp: string } | null = null;
  constructor() { super(); FakePeer.all.push(this); }
  addTrack() {}
  async createOffer() { return { type: 'offer', sdp: 'v=0\r\no=browser\r\n' }; }
  async setLocalDescription(description: { sdp: string }) { this.localDescription = description; }
  async setRemoteDescription() { queueMicrotask(() => this.set('connected')); }
  set(state: RTCPeerConnectionState) { this.connectionState = state; this.dispatchEvent(new Event('connectionstatechange')); }
  close() { this.connectionState = 'closed'; }
}
class FakeAudioContext {
  state = 'running';
  sampleRate = 48_000;
  createAnalyser() {
    return { fftSize: 1024, frequencyBinCount: 512, context: this, getByteTimeDomainData: (samples: Uint8Array) => samples.fill(128), getByteFrequencyData: (samples: Uint8Array) => samples.fill(0) };
  }
  createMediaStreamSource() { return { connect() {} }; }
  async resume() {}
  async close() { this.state = 'closed'; }
}
class FakeAudio { autoplay = false; paused = true; srcObject: unknown = null; async play() { this.paused = false; } pause() { this.paused = true; } }

type Reply = { status?: number; body: unknown };
const server = {
  status: 'connecting' as SessionSnapshot['status'],
  resumes: 0,
  offline: false,
  calls: [] as string[],
  override: undefined as ((action: string) => Reply | undefined) | undefined,
  snapshot(): SessionSnapshot {
    const paused = this.status === 'paused' || (this.status === 'connecting' && this.resumes > 0);
    return { id: 'attempt', status: this.status, warning: null, message: null, transcript: [],
      pause: paused ? { reason: 'provider', pausedAt: 0, resumeBy: Date.now() + 15 * 60_000, resumes: this.resumes, maxResumes: 5 } : null } as unknown as SessionSnapshot;
  },
  reply(action: string): Reply {
    const override = this.override?.(action);
    if (override) return override;
    if (action === 'start') return { body: { sdp: 'answer', snapshot: this.snapshot() } };
    if (action === 'ready') this.status = 'live';
    if (action === 'pause') this.status = 'paused';
    if (action === 'end') this.status = 'ended';
    if (action === 'resume') {
      this.resumes++;
      this.status = 'connecting';
      return { body: { sdp: 'answer', snapshot: this.snapshot() } };
    }
    return { body: this.snapshot() };
  },
};

const original = { fetch: globalThis.fetch, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator') };
const browser = { onLine: true };
const globals = globalThis as Record<string, unknown>;
beforeAll(() => {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => new FakeStream() }, get onLine() { return browser.onLine; } } });
  Object.assign(globals, { window: new EventTarget(), document: Object.assign(new EventTarget(), { visibilityState: 'visible' }), RTCPeerConnection: FakePeer, AudioContext: FakeAudioContext, Audio: FakeAudio, MediaStream: FakeStream });
  globalThis.fetch = (async (url: string) => {
    const action = url === '/api/simulator/sessions' ? 'start' : url.split('/').at(-1)!;
    server.calls.push(action);
    if (server.offline) throw new TypeError('Failed to fetch');
    const { status = 200, body } = server.reply(action);
    return { ok: status < 400, status, json: async () => body };
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = original.fetch;
  if (original.navigator) Object.defineProperty(globalThis, 'navigator', original.navigator);
  for (const name of ['window', 'document', 'RTCPeerConnection', 'AudioContext', 'Audio', 'MediaStream']) delete globals[name];
});
beforeEach(() => {
  jest.useFakeTimers();
  Object.assign(server, { status: 'connecting', resumes: 0, offline: false, calls: [], override: undefined });
  browser.onLine = true;
  FakePeer.all = [];
});
afterEach(() => { jest.useRealTimers(); });

async function flush() { for (let turn = 0; turn < 40; turn++) await Promise.resolve(); }
async function advance(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 100) {
    jest.advanceTimersByTime(Math.min(100, ms - elapsed));
    await flush();
  }
}
async function connected() {
  const { LiveConnection } = await import('./live-connection');
  const links: Link[] = [], errors: string[] = [];
  const connection = new LiveConnection({ snapshot: () => {}, levels: () => {}, error: message => errors.push(message), link: link => links.push(link) });
  await connection.start('sharepoint', 'morgan');
  expect(server.status).toBe('live');
  return { connection, links, errors, peer: () => FakePeer.all.at(-1)! };
}
const states = (links: Link[]) => links.map(link => link.state);

test('failed media after the conversation starts pauses, reports it, and resumes once the server answers', async () => {
  const { connection, links, peer } = await connected();
  const first = peer();
  first.set('failed');
  await flush();
  expect(states(links)).toEqual(['paused']);
  expect(server.calls).toContain('pause');
  expect(first.connectionState).toBe('closed');
  await advance(100);
  expect(server.calls.filter(call => call === 'resume')).toHaveLength(1);
  expect(FakePeer.all).toHaveLength(2);
  expect(states(links)).toEqual(['paused', 'resuming', 'stable']);
  expect(server.status).toBe('live');
  await connection.end();
});

test('brief disconnections reconnect in place; a long one pauses', async () => {
  const { connection, links, peer } = await connected();
  peer().set('disconnected');
  await advance(5000);
  peer().set('connected');
  expect(states(links)).toEqual(['reconnecting', 'stable']);
  peer().set('disconnected');
  server.override = action => action === 'poll' ? { status: 503, body: { error: 'Unavailable.' } } : undefined;
  await advance(15_000);
  expect(states(links)).toContain('paused');
  expect(server.calls).toContain('pause');
  await connection.end();
});

test('failing polls show reconnecting, pause after their grace, and a late return waits for the user', async () => {
  const { connection, links } = await connected();
  server.offline = true;
  await advance(1100);
  expect(states(links)).toEqual(['reconnecting']);
  await advance(10_000);
  expect(links.at(-1)).toEqual({ state: 'paused', reachable: false });
  await advance(60_000);
  server.offline = false;
  await advance(5000);
  expect(links.at(-1)).toEqual({ state: 'paused', reachable: true });
  expect(server.calls).not.toContain('resume');
  await connection.resume();
  expect(links.at(-1)!.state).toBe('stable');
  expect(server.status).toBe('live');
  await connection.end();
});

test('the browser going offline pauses at once, and coming back online checks in', async () => {
  const { connection, links } = await connected();
  browser.onLine = false;
  server.offline = true;
  (globals.window as EventTarget).dispatchEvent(new Event('offline'));
  await flush();
  expect(links.at(-1)).toEqual({ state: 'paused', reachable: false });
  browser.onLine = true;
  server.offline = false;
  (globals.window as EventTarget).dispatchEvent(new Event('online'));
  await advance(100);
  expect(states(links).at(-1)).toBe('stable');
  await connection.end();
});

test('a refused resume returns to the pause with its reason and is not retried automatically', async () => {
  const { connection, links, errors } = await connected();
  server.override = action => action === 'resume' ? { status: 409, body: { error: 'This attempt has reconnected too many times. End it to keep what was captured.' } } : undefined;
  server.status = 'paused';
  await advance(1100);
  expect(errors).toEqual(['This attempt has reconnected too many times. End it to keep what was captured.']);
  expect(links.at(-1)).toEqual({ state: 'paused', reachable: true });
  // The server already held the attempt; the browser does not report it again.
  expect(server.calls).not.toContain('pause');
  await advance(20_000);
  expect(server.calls.filter(call => call === 'resume')).toHaveLength(1);
  await connection.end();
  expect(server.calls.at(-1)).toBe('end');
});

test('a reconnect that fails after the server accepted it holds the attempt again', async () => {
  const { connection, links, peer } = await connected();
  peer().set('failed');
  // The resumed media never connects.
  FakePeer.prototype.setRemoteDescription = async function () {};
  try {
    await advance(16_000);
  } finally {
    FakePeer.prototype.setRemoteDescription = async function (this: FakePeer) { queueMicrotask(() => this.set('connected')); };
  }
  expect(states(links)).toEqual(['paused', 'resuming', 'paused']);
  expect(server.calls.filter(call => call === 'pause')).toHaveLength(2);
  expect(server.status).toBe('paused');
  await connection.resume();
  expect(states(links).at(-1)).toBe('stable');
  await connection.end();
});
