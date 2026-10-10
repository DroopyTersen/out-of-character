import { afterEach, beforeEach, expect, jest, test } from 'bun:test';
import { BrowserMedia } from './browserMedia';
import { FakeAudio, FakeAudioContext, FakePeer, FakeStream, installMediaFixtures, resetMediaFixtures } from './browserMedia.fixture';

let restore: () => void;
beforeEach(() => { resetMediaFixtures(); restore = installMediaFixtures(); jest.useFakeTimers(); });
afterEach(() => { restore(); jest.useRealTimers(); });
async function flush() { for (let turn = 0; turn < 20; turn++) await Promise.resolve(); }
async function advance(ms: number) { jest.advanceTimersByTime(ms); await flush(); }
function fixture() {
  const states: RTCPeerConnectionState[] = [], errors: string[] = [], audible: boolean[] = [];
  const media = new BrowserMedia({ state: state => states.push(state), error: error => errors.push(error), levels: (_levels, sound) => audible.push(sound) });
  return { media, states, errors, audible };
}
const remoteTrack = (peer: FakePeer, remote = new FakeStream()) => {
  peer.dispatchEvent(Object.assign(new Event('track'), { streams: [remote], track: remote.tracks[0] }));
  return remote;
};

test('already-cancelled media opens no microphone and exchanges no offer', async () => {
  const { media } = fixture();
  let exchanges = 0;
  const controller = new AbortController();
  controller.abort();
  await expect(media.connect(async () => { exchanges++; return 'answer'; }, controller.signal)).rejects.toThrow('Aborted');
  expect(FakeStream.all).toHaveLength(0);
  expect(FakePeer.all).toHaveLength(0);
  expect(exchanges).toBe(0);
  media.dispose();
});

test.each(['microphone', 'offer', 'local description', 'ICE', 'exchange', 'remote description', 'connected'] as const)(
  'cancellation during %s releases resources and ignores the late completion', async stage => {
    const { media, states, audible } = fixture();
    const controller = new AbortController();
    const held = Promise.withResolvers<void>();
    const original = {
      microphone: navigator.mediaDevices.getUserMedia,
      offer: FakePeer.prototype.createOffer,
      local: FakePeer.prototype.setLocalDescription,
      remote: FakePeer.prototype.setRemoteDescription,
    };
    let exchanges = 0;
    if (stage === 'microphone') navigator.mediaDevices.getUserMedia = async () => { await held.promise; return new FakeStream(true) as unknown as MediaStream; };
    if (stage === 'offer') FakePeer.prototype.createOffer = async function () { await held.promise; return original.offer.call(this); };
    if (stage === 'local description' || stage === 'ICE') FakePeer.prototype.setLocalDescription = async function (description) {
      if (stage === 'local description') await held.promise;
      await original.local.call(this, description);
      if (stage === 'ICE') this.iceGatheringState = 'gathering';
    };
    if (stage === 'remote description' || stage === 'connected') FakePeer.prototype.setRemoteDescription = async function () {
      if (stage === 'remote description') { await held.promise; await original.remote.call(this); }
    };
    try {
      const outcome = media.connect(async () => { exchanges++; if (stage === 'exchange') await held.promise; return 'answer'; }, controller.signal)
        .then(() => 'connected', (error: Error) => error.name);
      await flush();
      controller.abort();
      media.close();
      held.resolve();
      await flush();
      for (const peer of FakePeer.all) {
        peer.iceGatheringState = 'complete';
        peer.dispatchEvent(new Event('icegatheringstatechange'));
        peer.dispatchEvent(new Event('connectionstatechange'));
        remoteTrack(peer);
      }
      expect(await outcome).toBe('AbortError');
      await advance(20_000);
      expect(states).not.toContain('connected');
      expect(exchanges).toBe(['exchange', 'remote description', 'connected'].includes(stage) ? 1 : 0);
      expect(FakeStream.all.filter(stream => stream.microphone).every(stream => stream.tracks[0]!.stopped)).toBe(true);
      expect(FakePeer.all.every(peer => peer.closed)).toBe(true);
      expect(audible).not.toContain(true);
      expect(FakeAudio.all[0]!.srcObject).toBeNull();
    } finally {
      held.resolve(); media.dispose();
      navigator.mediaDevices.getUserMedia = original.microphone;
      FakePeer.prototype.createOffer = original.offer;
      FakePeer.prototype.setLocalDescription = original.local;
      FakePeer.prototype.setRemoteDescription = original.remote;
    }
  }
);

test.each(['ICE', 'connected'] as const)('%s timeout releases the segment and reports its specific failure', async stage => {
  const { media } = fixture();
  const original = { local: FakePeer.prototype.setLocalDescription, remote: FakePeer.prototype.setRemoteDescription };
  if (stage === 'ICE') FakePeer.prototype.setLocalDescription = async function (description) { await original.local.call(this, description); this.iceGatheringState = 'gathering'; };
  else FakePeer.prototype.setRemoteDescription = async () => {};
  try {
    const outcome = media.connect(async () => 'answer', new AbortController().signal).then(() => '', (error: Error) => error.message);
    await flush();
    await advance(16_000);
    expect(await outcome).toBe(stage === 'ICE' ? 'Network negotiation timed out.' : 'The voice connection timed out.');
    expect(FakePeer.all[0]!.closed).toBe(true);
    expect(FakeStream.all[0]!.tracks[0]!.stopped).toBe(true);
  } finally { media.dispose(); FakePeer.prototype.setLocalDescription = original.local; FakePeer.prototype.setRemoteDescription = original.remote; }
});

test('old track events and a late playback rejection cannot change the successor', async () => {
  const { media, states, errors } = fixture();
  const blocked = Promise.withResolvers<void>();
  const play = FakeAudio.prototype.play;
  FakeAudio.prototype.play = async function () { this.paused = false; await blocked.promise; };
  try {
    await media.connect(async () => 'first', new AbortController().signal);
    const old = FakePeer.all[0]!;
    remoteTrack(old);
    media.close();
    FakeAudio.prototype.play = play;
    await media.connect(async () => 'second', new AbortController().signal);
    const remote = remoteTrack(FakePeer.all[1]!);
    const before = [...states];
    remoteTrack(old);
    old.set('failed');
    blocked.reject(new Error('Old playback failed.'));
    await flush();
    expect(errors).toEqual([]);
    expect(states).toEqual(before);
    expect(FakeAudio.all[0]!.srcObject).toBe(remote);
    expect(media.connected).toBe(true);
    expect(FakeAudioContext.all).toHaveLength(1);
  } finally { FakeAudio.prototype.play = play; media.dispose(); }
  expect(FakeAudioContext.all[0]!.closes).toBe(1);
});

test('a superseded microphone request cannot replace or close the new connection', async () => {
  const { media } = fixture();
  const microphone = navigator.mediaDevices.getUserMedia;
  const oldPermission = Promise.withResolvers<MediaStream>();
  let requests = 0;
  navigator.mediaDevices.getUserMedia = () => ++requests === 1 ? oldPermission.promise : microphone.call(navigator.mediaDevices, { audio: true });
  try {
    const old = media.connect(async () => 'old answer', new AbortController().signal).then(() => '', (error: Error) => error.name);
    media.close();
    await media.connect(async () => 'new answer', new AbortController().signal);
    const current = FakeStream.all[0]!;
    const late = new FakeStream(true);
    oldPermission.resolve(late as unknown as MediaStream);
    expect(await old).toBe('AbortError');
    expect(late.tracks[0]!.stopped).toBe(true);
    expect(current.tracks[0]!.stopped).toBe(false);
    expect(media.connected).toBe(true);
    expect(FakePeer.all).toHaveLength(1);
  } finally { navigator.mediaDevices.getUserMedia = microphone; media.dispose(); }
});

test('late old stats cannot become the next segment baseline, and hanging stats are bounded', async () => {
  const { media } = fixture();
  const stats = FakePeer.prototype.getStats;
  const oldStats = Promise.withResolvers<Map<string, Record<string, unknown>>>();
  try {
    await media.connect(async () => 'first', new AbortController().signal);
    const first = FakePeer.all[0]!;
    FakePeer.prototype.getStats = function () { return this === first ? oldStats.promise : stats.call(this); };
    const oldSample = media.network();
    media.close();
    await media.connect(async () => 'second', new AbortController().signal);
    oldStats.resolve(new Map([['in', { type: 'inbound-rtp', kind: 'audio', packetsReceived: 9999, totalSamplesReceived: 9999 }]]));
    expect(await oldSample).toBeUndefined();
    let count = 100;
    FakePeer.stats = () => new Map([['in', { type: 'inbound-rtp', kind: 'audio', packetsReceived: count, totalSamplesReceived: count }]]);
    expect(await media.network()).toBeUndefined();
    count = 140;
    await advance(5000);
    expect(await media.network()).toMatchObject({ received: 40, ms: 5000 });
    FakePeer.prototype.getStats = () => new Promise(() => {});
    await advance(5000);
    const hanging = media.network();
    await advance(300);
    expect(await hanging).toBeUndefined();
  } finally { FakePeer.prototype.getStats = stats; media.dispose(); }
});

test('metering distinguishes playback from microphone noise and final silence closes its context before peer release', async () => {
  const { media, audible } = fixture();
  await media.connect(async () => 'answer', new AbortController().signal);
  FakeAudioContext.inputLoud = true;
  media.startMetering();
  await advance(160);
  expect(audible).not.toContain(true);
  remoteTrack(FakePeer.all[0]!);
  FakeAudioContext.loud = true;
  await advance(160);
  expect(audible.at(-1)).toBe(true);
  media.silence();
  expect(FakeStream.all[0]!.tracks[0]).toMatchObject({ enabled: false, stopped: false });
  expect(FakeAudioContext.all[0]!.state).toBe('closed');
  expect(media.connected).toBe(true);
  media.dispose(); media.dispose();
  const readings = audible.length;
  await advance(20_000);
  expect(audible).toHaveLength(readings);
  expect(FakePeer.all[0]!.closed).toBe(true);
  expect(FakeStream.all[0]!.tracks[0]!.stopped).toBe(true);
  expect(FakeAudioContext.all[0]!.closes).toBe(1);
});
