import { expect, test } from 'bun:test';
import { startCapture } from './capture';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

class FakeAudioContext {
  state = 'suspended';
  onstatechange = null;
  pendingResume = deferred<void>();
  resumed!: Promise<void>;
  resume() {
    this.resumed = this.pendingResume.promise.then(() => { this.state = 'running'; });
    return this.resumed;
  }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

// The browser-only boundary is controlled to reproduce WebKit's observed late
// resume after permission denial. Real WebKit denial acceptance covers it too.
async function withAudioBoundary(media: Promise<MediaStream>, run: (context: () => FakeAudioContext) => Promise<void>) {
  const descriptors = ['navigator', 'AudioContext'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  let instance!: FakeAudioContext;
  class AudioContextBoundary extends FakeAudioContext { constructor() { super(); instance = this; } }
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: AudioContextBoundary });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: () => media } } });
  try { await run(() => instance); }
  finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

test('permission denial returns without awaiting resume, and a late WebKit resume closes again', async () => {
  const media = Promise.reject(new DOMException('Denied', 'NotAllowedError'));
  await withAudioBoundary(media, async getContext => {
    await expect(startCapture({ source: 'microphone', onTranscript: () => {}, onError: () => {} })).rejects.toThrow(/permission was denied/);
    const context = getContext();
    expect(context.state).toBe('closed');
    context.pendingResume.resolve();
    await context.resumed;
    expect(context.state).toBe('closed');
  });
});

test('cancel disposes late permission tracks and cannot leave a late-resumed context running', async () => {
  const media = deferred<MediaStream>();
  let live = true;
  const track = { stop: () => { live = false; }, onended: null };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  await withAudioBoundary(media.promise, async getContext => {
    const controller = new AbortController();
    const capture = startCapture({ source: 'microphone', signal: controller.signal, onTranscript: () => {}, onError: () => {} });
    controller.abort();
    const context = getContext();
    expect(context.state).toBe('closed');
    media.resolve(stream);
    await expect(capture).rejects.toThrow(/canceled/);
    expect(live).toBe(false);
    context.pendingResume.resolve();
    await context.resumed;
    expect(context.state).toBe('closed');
  });
});
