import { afterAll, afterEach, beforeAll, beforeEach, expect, jest, test } from 'bun:test';
import type { Closure, ConnectionSnapshot, Link } from './liveConnection';
import { pollTransport } from './transport';

// Browser media and the session server are substituted; the connection's own pause, heartbeat, and resume logic is real.
class FakeTrack { enabled = true; stopped = false; stop() { this.stopped = true; } }
class FakeStream {
  constructor(readonly microphone = false) {}
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
  /** Whether every meter, the microphone and Sam's playback, picks up sound. */
  static loud = false;
  static inputLoud: boolean | undefined;
  state = 'running';
  sampleRate = 48_000;
  createAnalyser() {
    const meter = { microphone: false, fftSize: 1024, frequencyBinCount: 512, context: this,
      getByteTimeDomainData: (samples: Uint8Array) => samples.fill((meter.microphone ? FakeAudioContext.inputLoud ?? FakeAudioContext.loud : FakeAudioContext.loud) ? 140 : 128),
      getByteFrequencyData: (samples: Uint8Array) => samples.fill(0) };
    return meter;
  }
  createMediaStreamSource(stream: FakeStream) { return { connect(meter: { microphone: boolean }) { meter.microphone = stream.microphone; } }; }
  async resume() {}
  async close() { this.state = 'closed'; }
}
class FakeAudio { autoplay = false; paused = true; srcObject: unknown = null; async play() { this.paused = false; } pause() { this.paused = true; } }

type Reply = { status?: number; body: unknown };
const server = {
  status: 'connecting' as ConnectionSnapshot['status'],
  resumes: 0,
  offline: false,
  calls: [] as string[],
  polls: [] as unknown[],
  /** Every request's action and parsed body, in order. */
  requests: [] as { action: string; body: unknown }[],
  override: undefined as ((action: string) => Reply | undefined) | undefined,
  snapshot(): ConnectionSnapshot {
    const paused = this.status === 'paused' || (this.status === 'connecting' && this.resumes > 0);
    return { id: 'attempt', status: this.status, warning: null, message: null, transcript: [],
      pause: paused ? { reason: 'provider', pausedAt: 0, resumeBy: Date.now() + 15 * 60_000, resumes: this.resumes, maxResumes: 5 } : null } as unknown as ConnectionSnapshot;
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
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => new FakeStream(true) }, get onLine() { return browser.onLine; } } });
  Object.assign(globals, { window: new EventTarget(), document: Object.assign(new EventTarget(), { visibilityState: 'visible' }), RTCPeerConnection: FakePeer, AudioContext: FakeAudioContext, Audio: FakeAudio, MediaStream: FakeStream });
  globalThis.fetch = (async (url: string, options: RequestInit) => {
    const action = url === '/api/simulator/sessions' ? 'start' : url.split('/').at(-1)!;
    server.calls.push(action);
    const sent = options.body ? JSON.parse(String(options.body)) : null;
    server.requests.push({ action, body: sent });
    if (action === 'poll') server.polls.push(sent);
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
  FakeAudioContext.inputLoud = undefined;
  jest.useFakeTimers();
  Object.assign(server, { status: 'connecting', resumes: 0, offline: false, calls: [], polls: [], requests: [], override: undefined });
  browser.onLine = true;
  FakePeer.all = [];
  FakePeer.stats = undefined;
  FakeAudioContext.loud = false;
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
  const { LiveConnection } = await import('./liveConnection');
  const links: Link[] = [], errors: string[] = [], closures: Closure[] = [];
  const connection = new LiveConnection(pollTransport('/api/simulator/sessions'), { snapshot: () => {}, levels: () => {}, error: message => errors.push(message), link: link => links.push(link), closed: closure => closures.push(closure) });
  await connection.start('sharepoint', 'morgan');
  expect(server.status).toBe('live');
  return { connection, links, errors, closures, peer: () => FakePeer.all.at(-1)! };
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
  const { LiveConnection } = await import('./liveConnection');
  const links: Link[] = [], errors: string[] = [], snapshots: ConnectionSnapshot[] = [], closures: Closure[] = [];
  const connection = new LiveConnection(pollTransport('/api/simulator/sessions'), { snapshot: value => snapshots.push(value), levels: () => {}, error: message => errors.push(message), link: link => links.push(link), closed: closure => closures.push(closure) }, saved);
  return { connection, links, errors, snapshots, closures };
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
  const { connection, closures, peer } = await connected();
  const sent = server.calls.length;
  expect(connection.detach()).toBe(true);
  await advance(20_000);
  expect(server.calls.slice(sent)).toEqual(['pause']);
  expect(peer().connectionState).toBe('closed');
  expect(closures).toEqual([]);
});

test('a denied microphone closes before the conversation without reaching the server', async () => {
  const { LiveConnection } = await import('./liveConnection');
  const errors: string[] = [], closures: Closure[] = [];
  const denied = navigator.mediaDevices.getUserMedia;
  navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); };
  try {
    const connection = new LiveConnection(pollTransport('/api/simulator/sessions'), { snapshot: () => {}, levels: () => {}, error: message => errors.push(message), link: () => {}, closed: closure => closures.push(closure) });
    await connection.start('sharepoint', 'morgan');
  } finally { navigator.mediaDevices.getUserMedia = denied; }
  expect(errors).toEqual(['Microphone access was denied. Allow access in your browser, then try again.']);
  expect(closures).toEqual([{ outcome: 'ended', reachedLive: false }]);
  expect(server.calls).toEqual([]);
});

test('an end the server confirms, or a poll that finds the attempt ended, closes it as ended', async () => {
  const ending = await connected();
  await ending.connection.end();
  expect(ending.closures).toEqual([{ outcome: 'ended', reachedLive: true }]);
  expect(server.status).toBe('ended');

  server.status = 'connecting';
  const polled = await connected();
  server.status = 'ended';
  await advance(1100);
  expect(polled.closures).toEqual([{ outcome: 'ended', reachedLive: true }]);
  await polled.connection.end();
  expect(server.calls.filter(call => call === 'end')).toHaveLength(1);
  expect(polled.closures).toHaveLength(1);
});

test('an end lost before delivery closes unconfirmed, and reattaching once back online holds the attempt to end or resume', async () => {
  const { connection, closures, errors } = await connected();
  browser.onLine = false;
  server.offline = true;
  await connection.end();
  expect(closures).toEqual([{ outcome: 'unconfirmed', reachedLive: true }]);
  expect(errors).toEqual([]);
  expect(server.status).toBe('live');

  const { LiveConnection } = await import('./liveConnection');
  const links: Link[] = [], reopened: Closure[] = [];
  const again = new LiveConnection(pollTransport('/api/simulator/sessions'), { snapshot: () => {}, levels: () => {}, error: () => {}, link: link => links.push(link), closed: closure => reopened.push(closure) }, connection.attempt);
  await again.reattach();
  expect(links).toEqual([{ state: 'paused', reach: 'offline', reloaded: true }]);
  browser.onLine = true;
  server.offline = false;
  window.dispatchEvent(new Event('online'));
  await advance(100);
  expect(links.at(-1)).toEqual({ state: 'paused', reach: 'answered', reloaded: true });
  expect(server.calls).not.toContain('resume');
  await again.end();
  expect(reopened).toEqual([{ outcome: 'ended', reachedLive: true }]);
  expect(server.status).toBe('ended');
});

test('an end whose reply was lost closes unconfirmed, and reattaching finds it ended', async () => {
  const { connection, closures } = await connected();
  server.override = action => {
    if (server.status === 'ended') return { body: server.snapshot() };
    if (action === 'end') { server.status = 'ended'; return { status: 504, body: { error: 'The gateway timed out.' } }; }
  };
  await connection.end();
  expect(closures).toEqual([{ outcome: 'unconfirmed', reachedLive: true }]);
  const { LiveConnection } = await import('./liveConnection');
  const reopened: Closure[] = [];
  const again = new LiveConnection(pollTransport('/api/simulator/sessions'), { snapshot: () => {}, levels: () => {}, error: () => {}, link: () => {}, closed: closure => reopened.push(closure) }, connection.attempt);
  await again.reattach();
  await advance(100);
  expect(reopened).toEqual([{ outcome: 'ended', reachedLive: true }]);
  expect(server.calls.filter(call => call === 'end')).toHaveLength(1);
});

test('a reloaded page whose attempt is gone reports it once and ends nothing', async () => {
  server.override = () => ({ status: 410, body: { error: 'This interview session was interrupted. Start a new attempt.' } });
  const { connection, errors, closures } = await reattached();
  await connection.reattach();
  await advance(20_000);
  expect(errors).toEqual(['This attempt is no longer available.']);
  expect(closures).toEqual([{ outcome: 'lost', reachedLive: true }]);
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

test("Sam's playback reports activity promptly and stays recent for a short silence", async () => {
  const { connection, peer } = await connected();
  await advance(3000);
  expect(server.polls.at(-1)).toMatchObject({ active: false, audio: false });
  peer().dispatchEvent(Object.assign(new Event('track'), { streams: [new FakeStream()], track: new FakeTrack() }));
  const seen = server.polls.length;
  FakeAudioContext.loud = true;
  await advance(100);
  expect(server.polls.slice(seen)).toEqual([expect.objectContaining({ active: true, audio: true })]);
  FakeAudioContext.loud = false;
  await advance(1000);
  expect(server.polls.at(-1)).toMatchObject({ audio: true });
  await advance(2000);
  expect(server.polls.at(-1)).toMatchObject({ active: false, audio: false });
  await connection.end();
});

test("a loud microphone alone is not activity; Sam's playback is", async () => {
  const { connection, peer } = await connected();
  const reported = () => server.polls.map(poll => { const { active, audio } = poll as { active: boolean; audio: boolean }; return [active, audio]; });
  FakeAudioContext.loud = true;
  await advance(3000);
  expect(reported().length).toBeGreaterThan(1);
  expect(new Set(reported().map(String))).toEqual(new Set(['false,false']));
  const seen = server.polls.length;
  peer().dispatchEvent(Object.assign(new Event('track'), { streams: [new FakeStream()], track: new FakeTrack() }));
  await advance(2000);
  expect(reported().slice(seen)).toContainEqual([true, true]);
  await connection.end();
});

test('microphone noise sends no extra activity reports and never reports Sam as audible', async () => {
  const { connection, peer } = await connected();
  peer().dispatchEvent(Object.assign(new Event('track'), { streams: [new FakeStream()], track: new FakeTrack() }));
  await advance(6000);
  const seen = server.polls.length;
  FakeAudioContext.inputLoud = true;
  await advance(100);
  expect(server.polls.length).toBe(seen);
  await advance(1500);
  expect(server.polls.at(-1)).toMatchObject({ active: false, audio: false });
  connection.mute(true);
  await advance(1500);
  expect(server.polls.at(-1)).toMatchObject({ active: false, audio: false });
  await connection.end();
});

type Report = { active: boolean; audio: boolean; sequence?: number; composing?: boolean };
const sequenced = () => (server.polls as Report[]).filter(poll => poll.sequence != null);

test('composing mutes the microphone and reports at once; ending it restores the manual preference', async () => {
  const tracks: FakeTrack[] = [];
  const getUserMedia = navigator.mediaDevices.getUserMedia;
  navigator.mediaDevices.getUserMedia = (async () => { const stream = new FakeStream(true); tracks.push(...stream.tracks); return stream; }) as never;
  try {
    const { connection } = await connected();
    const mic = tracks.at(-1)!;
    expect(mic.enabled).toBe(true);
    const seen = server.polls.length;
    connection.setComposing(true);
    expect(mic.enabled).toBe(false);
    await flush();
    const reports = server.polls.slice(seen) as Report[];
    expect(reports.map(report => [report.composing, typeof report.sequence])).toEqual([[true, 'number']]);
    // An unchanged value sends nothing.
    connection.setComposing(true);
    await flush();
    expect(server.polls.length).toBe(seen + 1);
    connection.setComposing(false);
    expect(mic.enabled).toBe(true);
    await flush();
    expect(server.polls.at(-1)).toMatchObject({ composing: false });
    // A manual mute outlasts the draft.
    connection.mute(true);
    connection.setComposing(true);
    connection.setComposing(false);
    expect(mic.enabled).toBe(false);
    connection.mute(false);
    expect(mic.enabled).toBe(true);
    // Regular polls repeat the state.
    connection.setComposing(true);
    await advance(2100);
    expect(server.polls.at(-1)).toMatchObject({ composing: true });
    await connection.end();
  } finally {
    navigator.mediaDevices.getUserMedia = getUserMedia;
  }
});

test('activity sequences rise past the clock; heartbeats carry neither sequence nor composing', async () => {
  const before = Date.now();
  const { connection, peer } = await connected();
  connection.setComposing(true);
  await advance(3100);
  const numbers = sequenced().map(poll => poll.sequence!);
  expect(numbers.length).toBeGreaterThan(2);
  expect(numbers[0]).toBeGreaterThanOrEqual(before);
  for (let index = 1; index < numbers.length; index++) expect(numbers[index]).toBeGreaterThan(numbers[index - 1]!);
  server.override = action => action === 'resume' ? { status: 503, body: { error: 'Unavailable.' } } : undefined;
  peer().set('failed');
  await advance(100);
  const seen = server.polls.length;
  await advance(6000);
  const heartbeats = server.polls.slice(seen);
  expect(heartbeats.length).toBeGreaterThan(0);
  for (const poll of heartbeats) expect(poll).toEqual({ active: false, audio: false });
  await connection.end();
});

test('ready carries the current activity, including an open draft', async () => {
  const { connection, peer } = await connected();
  const readies = () => server.requests.filter(request => request.action === 'ready').map(request => request.body as Report);
  const [first] = readies();
  expect([first!.active, first!.composing, typeof first!.sequence]).toEqual([false, false, 'number']);
  connection.setComposing(true);
  await flush();
  peer().set('failed');
  await advance(300);
  // The draft survives the pause and the resumed connection reports it before going live.
  const [, second] = readies();
  expect(readies()).toHaveLength(2);
  expect(second!.composing).toBe(true);
  expect(second!.sequence!).toBeGreaterThan(first!.sequence!);
  await connection.end();
});

const accepted = (id: string) => ({ acceptedId: id, snapshot: { ...server.snapshot(), transcript: [{ id: `typed-${id}`, speaker: 'participant', text: 'Typed.', startMs: 0, endMs: 0 }] } });
const submitted = () => server.requests.filter(request => request.action === 'submitText').map(request => request.body as { id: string; text: string });

test('an accepted typed answer resolves with its receipt and shows its snapshot', async () => {
  const { LiveConnection } = await import('./liveConnection');
  const snapshots: ConnectionSnapshot[] = [];
  const connection = new LiveConnection(pollTransport('/api/simulator/sessions'), { snapshot: value => snapshots.push(value), levels: () => {}, error: () => {}, link: () => {}, closed: () => {} });
  await connection.start('sharepoint', 'morgan');
  server.override = action => action === 'submitText' ? { body: accepted(submitted().at(-1)!.id) } : undefined;
  const reply = await connection.submitText('Typed.');
  const [sent] = submitted();
  expect(sent).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), text: 'Typed.' });
  expect(reply.acceptedId).toBe(sent!.id);
  expect(snapshots.at(-1)).toBe(reply.snapshot as unknown as ConnectionSnapshot);
  await connection.end();
});

test('a busy server is retried with the same id; a refusal is final', async () => {
  const { connection, links } = await connected();
  let busy = true;
  server.override = action => {
    if (action !== 'submitText') return;
    if (busy) { busy = false; return { status: 503, body: { error: 'Saving is slow.' } }; }
    return { body: accepted(submitted().at(-1)!.id) };
  };
  const pending = connection.submitText('Once.');
  await advance(1100);
  const reply = await pending;
  const [first, second] = submitted();
  expect(submitted()).toHaveLength(2);
  expect(second).toEqual(first);
  expect(reply.acceptedId).toBe(first!.id);

  server.override = action => action === 'submitText' ? { status: 409, body: { error: 'This answer conflicts with one already sent.' } } : undefined;
  const refused = connection.submitText('Twice.');
  const outcome = refused.then(() => 'resolved', (error: Error) => error.message);
  await advance(5000);
  expect(await outcome).toBe('This answer conflicts with one already sent.');
  expect(submitted()).toHaveLength(3);
  expect(states(links)).not.toContain('paused');
  await connection.end();
});

test('an unreachable server gives up with a readable message, and a closed attempt rejects', async () => {
  const { connection } = await connected();
  server.override = action => action === 'submitText' ? { status: 503, body: { error: 'Unavailable.' } } : undefined;
  const outcome = connection.submitText('Lost.').then(() => 'resolved', (error: Error) => error.message);
  await advance(40_000);
  expect(await outcome).toBe('Your answer could not be sent. Check your connection and try again.');
  expect(new Set(submitted().map(body => body.id)).size).toBe(1);
  await connection.end();
  await expect(connection.submitText('Late.')).rejects.toThrow('The interview is not live.');
});
