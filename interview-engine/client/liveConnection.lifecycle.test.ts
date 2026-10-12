import { afterEach, beforeEach, expect, jest, test } from 'bun:test';
import type { MediaCallbacks, MediaConnection } from './browserMedia';
import { LiveConnection, type Closure, type ConnectionSnapshot, type Link } from './liveConnection';
import type { ProtocolAction, ProtocolTransport } from './transport';
import { silentLevels } from './audioLevels';

// Attempt policy uses a small media adapter. No microphone, audio context, stream or WebRTC globals are installed.
class MediaFixture implements MediaConnection {
  connected = false;
  muted = false;
  openings = 0;
  metering = 0;
  constructor(readonly callbacks: MediaCallbacks) {}
  async connect(exchange: (sdp: string) => Promise<string | null>, signal: AbortSignal) {
    signal.throwIfAborted();
    this.openings++;
    const answer = await exchange('offer');
    signal.throwIfAborted();
    this.connected = answer !== null;
    return this.connected;
  }
  startMetering() { this.metering++; }
  mute(value: boolean) { this.muted = value; }
  async network() { return undefined; }
  async playAudio() {}
  close() { this.connected = false; }
  silence() { this.muted = true; this.callbacks.levels(silentLevels, false); }
  dispose() { this.silence(); this.close(); }
}

let restore: () => void;
beforeEach(() => {
  const values = { window: new EventTarget(), document: Object.assign(new EventTarget(), { visibilityState: 'visible' }), navigator: { onLine: true } };
  const original = new Map(Object.keys(values).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries(values)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  restore = () => { for (const [name, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } };
  jest.useFakeTimers();
});
afterEach(() => { restore(); jest.useRealTimers(); });
async function flush() { for (let turn = 0; turn < 20; turn++) await Promise.resolve(); }

function fixture(intercept?: (...args: Parameters<ProtocolTransport['request']>) => Promise<unknown> | undefined) {
  let status: ConnectionSnapshot['status'] = 'connecting';
  const requests: ProtocolAction[] = [], snapshots: ConnectionSnapshot[] = [], closures: Closure[] = [];
  const links: Link[] = [], errors: string[] = [];
  const snapshot = (): ConnectionSnapshot => ({ id: 'attempt', status, warning: null });
  const transport: ProtocolTransport = { async request(action, body, options) {
    requests.push(action);
    const overridden = intercept?.(action, body, options);
    if (overridden !== undefined) return overridden;
    if (action === 'start' || action === 'resume') { status = 'connecting'; return { sdp: 'answer', snapshot: snapshot() }; }
    if (action === 'ready') status = 'live';
    if (action === 'end') status = 'ended';
    if (action === 'pause') status = 'paused';
    return snapshot();
  } };
  let media!: MediaFixture;
  const connection = new LiveConnection(transport, {
    snapshot: value => snapshots.push(value), closed: value => closures.push(value), levels: () => {}, error: value => errors.push(value), link: value => links.push(value),
  }, { id: 'attempt', capability: 'capability' }, callbacks => media = new MediaFixture(callbacks));
  return { connection, media, requests, snapshots, closures, links, errors };
}

test('End while ready is pending cannot publish a late live state or start media loops', async () => {
  const ready = Promise.withResolvers<ConnectionSnapshot>();
  const f = fixture((action) => action === 'ready' ? ready.promise : undefined);
  const starting = f.connection.start('plan', 'voice');
  await flush();
  expect(f.requests).toContain('ready');
  await f.connection.end();
  const afterEnd = [...f.snapshots];
  ready.resolve({ id: 'attempt', status: 'live', warning: null });
  await starting;
  jest.advanceTimersByTime(20_000);
  await flush();
  expect(f.snapshots).toEqual(afterEnd);
  expect(f.snapshots.at(-1)!.status).toBe('ended');
  expect(f.media.metering).toBe(0);
  expect(f.requests.filter(action => action === 'end')).toHaveLength(1);
  expect(f.requests).not.toContain('poll');
  expect(f.closures).toEqual([{ outcome: 'ended', reachedLive: false }]);
  f.connection.dispose();
});

test('a typed receipt already received before End cannot publish a snapshot to the closed page', async () => {
  let submitted: { id: string; text: string } | undefined;
  const f = fixture((action, body, { signal }) => {
    if (action !== 'submitText') return undefined;
    signal!.throwIfAborted();
    submitted = body as typeof submitted;
    return Promise.resolve({ acceptedId: submitted!.id, snapshot: { id: 'attempt', status: 'live', warning: null } });
  });
  await f.connection.start('plan', 'voice');
  const sending = f.connection.submitText({ id: crypto.randomUUID(), text: 'Saved before closing.' });
  await f.connection.end();
  const afterEnd = [...f.snapshots];
  expect((await sending).acceptedId).toBe(submitted!.id);
  expect(f.snapshots).toEqual(afterEnd);
  expect(f.closures).toEqual([{ outcome: 'ended', reachedLive: true }]);
  f.connection.dispose();
});

test('a held pause serializes competing resume requests without starting duplicate media', async () => {
  const paused = Promise.withResolvers<ConnectionSnapshot>();
  const f = fixture(action => action === 'pause' ? paused.promise : undefined);
  await f.connection.start('plan', 'voice');
  f.media.callbacks.state('failed');
  await flush();
  const first = f.connection.resume();
  const second = f.connection.resume();
  await flush();
  expect(f.media.openings).toBe(1);
  paused.resolve({ id: 'attempt', status: 'paused', warning: null });
  await Promise.all([first, second]);
  expect(f.media.openings).toBe(2);
  expect(f.requests.filter(action => action === 'resume')).toHaveLength(1);
  await f.connection.end();
});

test('media failure during resume readiness returns to a recoverable pause and releases media', async () => {
  const ready = Promise.withResolvers<ConnectionSnapshot>();
  let hold = false;
  const f = fixture(action => action === 'ready' && hold ? ready.promise : undefined);
  await f.connection.start('plan', 'voice');
  f.media.callbacks.state('failed');
  await flush();
  hold = true;
  const resuming = f.connection.resume();
  await flush();
  expect(f.links.at(-1)?.state).toBe('resuming');
  expect(f.media.connected).toBe(true);
  f.media.callbacks.state('failed');
  ready.resolve({ id: 'attempt', status: 'live', warning: null });
  await resuming;
  expect(f.links.at(-1)?.state).toBe('paused');
  expect(f.media.connected).toBe(false);
  expect(f.errors).toEqual(['The voice connection was interrupted.']);
  expect(f.requests.filter(action => action === 'pause')).toHaveLength(2);
  hold = false;
  await f.connection.resume();
  expect(f.links.at(-1)?.state).toBe('stable');
  expect(f.media.connected).toBe(true);
  await f.connection.end();
});
