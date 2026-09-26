import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const code = readFileSync(new URL('../../public/audio-worklet.js', import.meta.url), 'utf8');
function createWorklet(rate: number) {
  const messages: { ready?: boolean; pcm?: ArrayBuffer; level?: number }[] = [];
  let Constructor: new () => { port: { onmessage: (event: { data: string }) => void }; process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean };
  runInNewContext(code, {
    sampleRate: rate,
    AudioWorkletProcessor: class { port = { onmessage: null, postMessage: (message: typeof messages[number]) => messages.push(message) }; },
    registerProcessor: (_name: string, implementation: typeof Constructor) => { Constructor = implementation; },
  });
  const processor = new Constructor!();
  processor.port.onmessage({ data: 'start' });
  return { processor, messages };
}

function resample(rate: number, channels: Float32Array[]) {
  const { processor, messages } = createWorklet(rate);
  for (let offset = 0; offset < channels[0]!.length; offset += 128) {
    const output = new Float32Array(128).fill(1);
    expect(processor.process([channels.map(channel => channel.subarray(offset, offset + 128))], [[output]])).toBe(true);
    expect(output.every(sample => sample === 0)).toBe(true);
  }
  const frames = messages.filter(message => message.pcm);
  const samples = frames.flatMap(frame => {
    const data = new DataView(frame.pcm!);
    expect(data.byteLength).toBe(3200);
    return Array.from({ length: 1600 }, (_, index) => data.getInt16(index * 2, true) / 32768);
  });
  return { frames, samples, messages, processor };
}

for (const rate of [44100, 48000]) {
  test(`actual worklet resamples ${rate}Hz to sixteen thousand samples per second without echo`, () => {
    const input = Float32Array.from({ length: rate }, (_, index) => .5 * Math.sin(2 * Math.PI * 440 * index / rate));
    const { frames, samples } = resample(rate, [input]);
    expect(frames).toHaveLength(10);
    expect(samples).toHaveLength(16000);
    const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
    expect(rms).toBeGreaterThan(.35);
    expect(rms).toBeLessThan(.355);
    expect(Math.max(...samples)).toBeGreaterThan(.495);
    expect(Math.min(...samples)).toBeLessThan(-.495);
    const rising = samples.filter((sample, index) => index > 0 && samples[index - 1]! <= 0 && sample > 0).length;
    expect(rising).toBeGreaterThanOrEqual(439);
    expect(rising).toBeLessThanOrEqual(440);
  });
}

test('actual worklet averages stereo, clips safely, encodes little endian, and stops sending after cancellation', () => {
  const a = new Float32Array(48000).fill(1.5);
  const b = new Float32Array(48000).fill(-.5);
  const result = resample(48000, [a, b]);
  expect(result.samples.every(sample => Math.abs(sample - .5) < .0001)).toBe(true);
  expect(result.frames.every(frame => Math.abs(frame.level! - .5) < .0001)).toBe(true);
  const before = result.messages.length;
  result.processor.port.onmessage({ data: 'stop' });
  result.processor.process([[a]], [[new Float32Array(128)]]);
  expect(result.messages).toHaveLength(before);
  const positive = resample(48000, [new Float32Array(4800).fill(2)]);
  expect(positive.samples.every(sample => sample === 32767 / 32768)).toBe(true);
  const negative = resample(48000, [new Float32Array(4800).fill(-2)]);
  expect(negative.samples.every(sample => sample === -1)).toBe(true);
});

for (const rate of [44100, 48000]) {
  test(`absent input at ${rate}Hz emits silence before speech so stream time stays aligned`, () => {
    const { processor, messages } = createWorklet(rate);
    const missingSamples = rate * 4;
    for (let offset = 0; offset < missingSamples; offset += 128) {
      const length = Math.min(128, missingSamples - offset);
      processor.process([[]], [[new Float32Array(length)]]);
    }
    const silent = messages.filter(message => message.pcm);
    expect(silent).toHaveLength(40);
    expect(silent.every(message => message.level === 0)).toBe(true);
    expect(silent.every(message => new Uint8Array(message.pcm!).every(byte => byte === 0))).toBe(true);
    const input = Float32Array.from({ length: rate }, (_, index) => .5 * Math.sin(2 * Math.PI * 440 * index / rate));
    for (let offset = 0; offset < input.length; offset += 128) {
      processor.process([[input.subarray(offset, offset + 128)]], [[new Float32Array(Math.min(128, input.length - offset))]]);
    }
    const frames = messages.filter(message => message.pcm);
    expect(frames).toHaveLength(50);
    expect(frames.slice(40).every(frame => frame.level! > .34)).toBe(true);
    const before = messages.length;
    processor.port.onmessage({ data: 'stop' });
    processor.process([[]], [[new Float32Array(128)]]);
    expect(messages).toHaveLength(before);
  });
}
