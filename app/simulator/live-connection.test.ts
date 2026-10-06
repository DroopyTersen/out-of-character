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
  static stats: (() => Map<string, Record<string, unknown>>) | undefined;
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
  async getStats() { if (!FakePeer.stats) throw new Error('No stats.'); return FakePeer.stats(); }
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
  polls: [] as unknown[],
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
  globalThis.fetch = (async (url: string, options: RequestInit) => {
    const action = url === '/api/simulator/sessions' ? 'start' : url.split('/').at(-1)!;
    server.calls.push(action);
    if (action === 'poll') server.polls.push(options.body ? JSON.parse(String(options.body)) : null);
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
  Object.assign(server, { status: 'connecting', resumes: 0, offline: false, calls: [], polls: [], override: undefined });
  browser.onLine = true;
  FakePeer.all = [];
  FakePeer.stats = undefined;
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
  // The browser is online, so a silent server leaves Resume available.
  expect(links.at(-1)).toEqual({ state: 'paused', reach: 'unanswered' });
  await advance(60_000);
  server.offline = false;
  await advance(5000);
  expect(links.at(-1)).toEqual({ state: 'paused', reach: 'answered' });
  expect(server.calls).not.toContain('resume');
  await connection.resume();
  expect(links.at(-1)!.state).toBe('stable');
  expect(server.status).toBe('live');
  await connection.end();
});

test('a server answering with errors leaves a paused attempt resumable', async () => {
  const { connection, links } = await connected();
  server.override = action => action === 'poll' ? { status: 503, body: { error: 'Unavailable.' } } : undefined;
  await advance(12_000);
  expect(links.at(-1)).toEqual({ state: 'paused', reach: 'unanswered' });
  expect(server.calls).not.toContain('resume');
  await connection.resume();
  expect(links.at(-1)).toEqual({ state: 'stable', reach: 'answered' });
  expect(server.status).toBe('live');
  await connection.end();
});

test('the browser going offline pauses at once, and coming back online checks in', async () => {
  const { connection, links } = await connected();
  browser.onLine = false;
  server.offline = true;
  (globals.window as EventTarget).dispatchEvent(new Event('offline'));
  await flush();
  expect(links.at(-1)).toEqual({ state: 'paused', reach: 'offline' });
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
  expect(links.at(-1)).toEqual({ state: 'paused', reach: 'answered' });
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

const saved = { id: '00000000-0000-4000-8000-000000000000', capability: 'a'.repeat(64) };
async function reattached() {
  const { LiveConnection } = await import('./live-connection');
  const links: Link[] = [], errors: [string, boolean | undefined][] = [], snapshots: SessionSnapshot[] = [];
  const connection = new LiveConnection({ snapshot: value => snapshots.push(value), levels: () => {}, error: (message, fatal) => errors.push([message, fatal]), link: link => links.push(link) }, saved);
  return { connection, links, errors, snapshots };
}

test('a reloaded page rejoins its attempt paused and waits for the user to resume', async () => {
  server.status = 'live';
  const { connection, links, snapshots } = await reattached();
  expect(connection.attempt).toEqual(saved);
  await connection.reattach();
  await advance(100);
  expect(server.calls).toEqual(['pause', 'poll']);
  expect(server.polls).toEqual([{ active: false, audio: false }]);
  expect(snapshots.at(-1)!.status).toBe('paused');
  expect(links).toEqual([{ state: 'paused', reach: 'answered', reloaded: true }]);
  // Audio needs a click on the new page, so the heartbeat never resumes on its own.
  await advance(20_000);
  expect(server.calls).not.toContain('resume');
  await connection.resume();
  expect(links).toEqual([{ state: 'paused', reach: 'answered', reloaded: true }, { state: 'resuming', reach: 'answered' }, { state: 'stable', reach: 'answered' }]);
  expect(server.status).toBe('live');
  await connection.end();
});

test('leaving mid-conversation holds the attempt instead of ending it', async () => {
  const { connection, peer } = await connected();
  const sent = server.calls.length;
  expect(connection.detach()).toBe(true);
  await advance(20_000);
  expect(server.calls.slice(sent)).toEqual(['pause']);
  expect(peer().connectionState).toBe('closed');
});

test('a reloaded page whose attempt is gone reports it once and ends nothing', async () => {
  server.override = () => ({ status: 410, body: { error: 'This practice session was interrupted. Start a new attempt.' } });
  const { connection, errors } = await reattached();
  await connection.reattach();
  await advance(20_000);
  expect(errors).toEqual([['This attempt is no longer available.', true]]);
  expect(server.calls).toEqual(['pause', 'poll']);
  await connection.end();
  expect(server.calls).toEqual(['pause', 'poll']);
});

test('polls carry media quality every few seconds, and a failing stats read never holds a poll', async () => {
  let reads = 0;
  FakePeer.stats = () => { reads++; return new Map([
    ['in', { type: 'inbound-rtp', kind: 'audio', packetsReceived: reads * 250, packetsLost: reads * 2, concealedSamples: reads * 2400, totalSamplesReceived: reads * 240_000, jitter: .01 }],
    ['out', { type: 'remote-inbound-rtp', kind: 'audio', packetsLost: reads, roundTripTime: .07 }],
  ]); };
  const { connection } = await connected();
  await advance(12_500);
  const reports = server.polls.filter((poll): poll is { network: Record<string, unknown> } => !!poll && typeof poll === 'object' && 'network' in poll).map(poll => poll.network);
  expect(reads).toBe(3);
  expect(reports).toHaveLength(2);
  expect(reports[0]).toEqual({ ms: expect.any(Number), received: 250, lost: 2, concealed: .01, jitterMs: 10, sentLost: 1, rttMs: 70 });
  expect(server.polls.length).toBeGreaterThanOrEqual(10);
  FakePeer.stats = () => { throw new Error('Stats unavailable.'); };
  const before = server.polls.length;
  await advance(6000);
  expect(server.polls.length).toBeGreaterThan(before + 3);
  await connection.end();
});
