import { NETWORK_SAMPLE_MS, readNetwork, type NetworkCounters, type NetworkSample } from '../shared/network';
import { readAudio, silentLevels, type AudioLevels } from './audioLevels';

export type MediaCallbacks = {
  state: (state: RTCPeerConnectionState) => void;
  levels: (levels: AudioLevels, audible: boolean) => void;
  error: (message: string) => void;
};
/** The resource operations the attempt uses; a test adapter needs no WebRTC or audio globals. */
export type MediaConnection = Pick<BrowserMedia, 'connect' | 'connected' | 'startMetering' | 'mute' | 'network' | 'playAudio' | 'close' | 'silence' | 'dispose'>;

/** Owns browser resources across voice segments. Reports observations; never pauses, resumes or ends an attempt. */
export class BrowserMedia {
  private pc: RTCPeerConnection | undefined;
  private stream: MediaStream | undefined;
  private audio = new Audio();
  private context: AudioContext | undefined;
  private inputMeter: AnalyserNode | undefined;
  private outputMeter: AnalyserNode | undefined;
  private meterTimer: ReturnType<typeof setInterval> | undefined;
  private networkCounters: NetworkCounters | undefined;
  private segment = new AbortController();
  private muted = false;
  private disposed = false;

  constructor(private callbacks: MediaCallbacks) { this.audio.autoplay = true; }

  get connected() { return this.pc?.connectionState === 'connected'; }

  /** Connects one microphone/peer pair. The audio context survives a pause because automatic resume has no user gesture. */
  async connect(exchange: (sdp: string) => Promise<string | null>, signal: AbortSignal): Promise<boolean> {
    if (this.disposed || signal.aborted) throw new DOMException('Aborted', 'AbortError');
    this.close();
    const segment = this.segment = new AbortController();
    const cancelled = AbortSignal.any([signal, segment.signal]);
    const current = () => !cancelled.aborted && this.segment === segment;
    const check = () => { if (!current()) throw new DOMException('Aborted', 'AbortError'); };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!current()) { stream.getTracks().forEach(track => track.stop()); check(); }
      this.stream = stream;
      this.mute(this.muted);
      const pc = this.pc = new RTCPeerConnection();
      for (const track of stream.getTracks()) pc.addTrack(track, stream);
      this.context ??= new AudioContext();
      this.inputMeter = this.meter(stream);
      pc.addEventListener('track', event => {
        if (!current()) return;
        const remote = event.streams[0] ?? new MediaStream([event.track]);
        this.audio.srcObject = remote;
        void this.audio.play().catch(() => {
          if (current()) this.callbacks.error('Audio playback was blocked. Use Enable audio to listen.');
        });
        this.outputMeter = this.meter(remote);
      }, { signal: cancelled });
      pc.addEventListener('connectionstatechange', () => {
        if (current()) this.callbacks.state(pc.connectionState);
      }, { signal: cancelled });
      const offer = await pc.createOffer();
      check();
      await pc.setLocalDescription(offer);
      check();
      await this.until(pc, 'icegatheringstatechange', () => pc.iceGatheringState === 'complete', 8000, 'Network negotiation timed out.', cancelled);
      check();
      const answer = await exchange(pc.localDescription!.sdp);
      check();
      if (answer == null) { this.close(); return false; }
      await pc.setRemoteDescription({ type: 'answer', sdp: answer });
      check();
      await this.until(pc, 'connectionstatechange', () => pc.connectionState === 'connected', 15_000, 'The voice connection timed out.', cancelled);
      check();
      return true;
    } catch (error) {
      // An older negotiation may settle after its successor has acquired different resources.
      if (this.segment === segment) this.close();
      throw error;
    }
  }

  private async until(target: EventTarget, event: string, ready: () => boolean, ms: number, message: string, signal: AbortSignal) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (ready()) return;
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        target.removeEventListener(event, changed);
        signal.removeEventListener('abort', abort);
        if (error) reject(error); else resolve();
      };
      const changed = () => { if (ready()) finish(); };
      const abort = () => finish(new DOMException('Aborted', 'AbortError'));
      const timeout = setTimeout(() => finish(new Error(message)), ms);
      target.addEventListener(event, changed);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  }

  private meter(stream: MediaStream) {
    const meter = this.context!.createAnalyser();
    meter.fftSize = 1024;
    meter.smoothingTimeConstant = .65;
    this.context!.createMediaStreamSource(stream).connect(meter);
    return meter;
  }

  /** Metering begins only after the attempt has acknowledged readiness. */
  startMetering() {
    clearInterval(this.meterTimer);
    if (this.disposed || this.segment.signal.aborted || !this.pc) return;
    this.meterTimer = setInterval(() => {
      const input = readAudio(this.inputMeter), output = readAudio(this.outputMeter);
      const audible = this.context?.state === 'running' && output.level > .03 && !this.audio.paused;
      this.callbacks.levels({ input: input.level, output: output.level, inputBands: input.bands, outputBands: output.bands }, audible);
    }, 80);
  }

  mute(value: boolean) {
    this.muted = value;
    this.stream?.getAudioTracks().forEach(track => { track.enabled = !value; });
  }

  async playAudio() { await this.context?.resume(); await this.audio.play(); }

  /** A slow stats read is bounded and can never become the baseline for a successor connection. */
  async network(): Promise<NetworkSample | undefined> {
    const pc = this.pc;
    if (!pc || !this.connected || Date.now() - (this.networkCounters?.at ?? 0) < NETWORK_SAMPLE_MS) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const report = await Promise.race([pc.getStats(), new Promise<undefined>(resolve => { timeout = setTimeout(() => resolve(undefined), 300); })]);
      if (!report || pc !== this.pc || this.segment.signal.aborted) return;
      const { counters, sample } = readNetwork(report.values(), this.networkCounters, Date.now());
      this.networkCounters = counters;
      return sample;
    } catch { return; }
    finally { clearTimeout(timeout); }
  }

  /** Stops negotiation, playback and meters while leaving the microphone/peer available for a bounded silent drain. */
  private stop() {
    this.segment.abort();
    clearInterval(this.meterTimer);
    this.meterTimer = undefined;
    this.audio.pause();
    this.audio.srcObject = null;
    this.inputMeter = this.outputMeter = undefined;
    this.callbacks.levels(silentLevels, false);
  }

  /** Releases this segment. The audio context and mute preference survive a pause. */
  close() {
    this.stop();
    this.stream?.getTracks().forEach(track => track.stop());
    this.pc?.close();
    this.stream = undefined;
    this.pc = undefined;
    this.networkCounters = undefined;
  }

  /** End silences immediately, including its audio context, while the peer can drain before final release. */
  silence() {
    this.disposed = true;
    this.mute(true);
    this.stop();
    void this.context?.close().catch(() => {});
    this.context = undefined;
  }

  /** Final page cleanup also releases the microphone and peer. */
  dispose() { this.silence(); this.close(); }
}
