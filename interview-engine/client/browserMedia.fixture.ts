/** Browser hardware fixtures. Production negotiation and resource ownership remain real in these tests. */
export class FakeTrack { enabled = true; stopped = false; stop() { this.stopped = true; } }
export class FakeStream {
  static all: FakeStream[] = [];
  constructor(readonly microphone = false) { FakeStream.all.push(this); }
  tracks = [new FakeTrack()];
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks; }
}
export class FakePeer extends EventTarget {
  static all: FakePeer[] = [];
  static stats: (() => Map<string, Record<string, unknown>>) | undefined;
  connectionState: RTCPeerConnectionState = 'new';
  closed = false;
  iceGatheringState = 'complete';
  localDescription: { sdp: string } | null = null;
  constructor() { super(); FakePeer.all.push(this); }
  addTrack() {}
  async createOffer() { return { type: 'offer', sdp: 'v=0\r\no=browser\r\n' }; }
  async setLocalDescription(description: { sdp: string }) { this.localDescription = description; }
  async setRemoteDescription() { queueMicrotask(() => { if (!this.closed) this.set('connected'); }); }
  set(state: RTCPeerConnectionState) { this.connectionState = state; this.dispatchEvent(new Event('connectionstatechange')); }
  close() { this.closed = true; this.connectionState = 'closed'; }
  async getStats() { if (!FakePeer.stats) throw new Error('No stats.'); return FakePeer.stats(); }
}
export class FakeAudioContext {
  static all: FakeAudioContext[] = [];
  closes = 0;
  constructor() { FakeAudioContext.all.push(this); }
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
  async close() { this.closes++; this.state = 'closed'; }
}
export class FakeAudio {
  static all: FakeAudio[] = [];
  autoplay = false; paused = true; srcObject: unknown = null;
  constructor() { FakeAudio.all.push(this); }
  async play() { this.paused = false; }
  pause() { this.paused = true; }
}


export function resetMediaFixtures() {
  FakeAudioContext.inputLoud = undefined;
  FakePeer.all = [];
  FakeStream.all = [];
  FakeAudioContext.all = [];
  FakePeer.stats = undefined;
  FakeAudioContext.loud = false;
  FakeAudio.all = [];
}

export function installMediaFixtures(browser = { onLine: true }) {
  const values = {
    navigator: { mediaDevices: { getUserMedia: async () => new FakeStream(true) }, get onLine() { return browser.onLine; } },
    RTCPeerConnection: FakePeer, AudioContext: FakeAudioContext, Audio: FakeAudio, MediaStream: FakeStream,
  };
  const original = new Map(Object.keys(values).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries(values)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  return () => {
    for (const [name, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  };
}
