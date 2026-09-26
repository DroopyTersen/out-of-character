/* Box integration resamples the actual AudioContext rate to mono PCM16LE/16k.
 * Fractional input weights persist across render blocks and 100ms frames. */
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = false;
    this.ready = false;
    this.ratio = sampleRate / 16000;
    this.remaining = this.ratio;
    this.sum = 0;
    this.frame = new ArrayBuffer(3200);
    this.view = new DataView(this.frame);
    this.count = 0;
    this.squareSum = 0;
    this.port.onmessage = event => { this.active = event.data === 'start'; };
  }
  process(inputs, outputs) {
    // A connected silent output keeps processing alive without microphone echo.
    for (const output of outputs) for (const channel of output) channel.fill(0);
    if (!this.active) return true;
    if (!this.ready) { this.ready = true; this.port.postMessage({ ready: true }); }
    const channels = inputs[0] ?? [];
    // Missing device input is silence, not missing stream time.
    const length = channels[0]?.length ?? outputs[0]?.[0]?.length ?? 128;
    for (let index = 0; index < length; index++) {
      let sample = 0;
      for (const channel of channels) sample += channel[index] / channels.length;
      let weight = 1;
      while (weight > 1e-9) {
        const used = Math.min(weight, this.remaining);
        this.sum += sample * used;
        this.remaining -= used;
        weight -= used;
        if (this.remaining > 1e-9) continue;
        const value = Math.max(-1, Math.min(1, this.sum / this.ratio));
        this.view.setInt16(this.count * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
        this.squareSum += value * value;
        this.count++;
        this.remaining = this.ratio;
        this.sum = 0;
        if (this.count === 1600) {
          this.port.postMessage({ pcm: this.frame, level: Math.sqrt(this.squareSum / 1600) }, [this.frame]);
          this.frame = new ArrayBuffer(3200);
          this.view = new DataView(this.frame);
          this.count = 0;
          this.squareSum = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
