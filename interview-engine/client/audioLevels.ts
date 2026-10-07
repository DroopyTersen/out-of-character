export const SPECTRUM_BANDS = 24;
export type AudioLevels = { input: number; output: number; inputBands: readonly number[]; outputBands: readonly number[] };
export const silentLevels: AudioLevels = { input: 0, output: 0, inputBands: [], outputBands: [] };

/** Voice-range frequency bins, independent of the browser's sample rate. */
export function readAudio(meter?: AnalyserNode) {
  if (!meter) return { level: 0, bands: [] };
  const samples = new Uint8Array(meter.fftSize);
  meter.getByteTimeDomainData(samples);
  const level = Math.min(1, Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length) * 5);
  const frequencies = new Uint8Array(meter.frequencyBinCount);
  meter.getByteFrequencyData(frequencies);
  const binHz = meter.context.sampleRate / meter.fftSize;
  const bands = Array.from({ length: SPECTRUM_BANDS }, (_, i) => {
    const low = Math.floor(90 * (6000 / 90) ** (i / SPECTRUM_BANDS) / binHz);
    const high = Math.max(low + 1, Math.ceil(90 * (6000 / 90) ** ((i + 1) / SPECTRUM_BANDS) / binHz));
    let peak = 0;
    for (let bin = low; bin < Math.min(high, frequencies.length); bin++) peak = Math.max(peak, frequencies[bin]! / 255);
    return level > .03 ? peak : 0;
  });
  return { level, bands };
}
