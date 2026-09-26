import type { SessionSnapshot } from '../../core/simulator/types';
import { readAudio, silentLevels, type AudioLevels } from './audio-levels';

type Callbacks = {
  snapshot: (value: SessionSnapshot) => void;
  levels: (value: AudioLevels) => void;
  error: (message: string, fatal?: boolean) => void;
};
class SessionRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** Browser media only. The server owns transcripts, judgments, and actor context. */
export class LiveConnection {
  private id = crypto.randomUUID();
  private capability = [...crypto.getRandomValues(new Uint8Array(32))].map(value => value.toString(16).padStart(2, '0')).join('');
  private pc: RTCPeerConnection | undefined;
  private stream: MediaStream | undefined;
  private audio = new Audio();
  private context: AudioContext | undefined;
  private inputMeter: AnalyserNode | undefined;
  private outputMeter: AnalyserNode | undefined;
  private meterTimer: ReturnType<typeof setInterval> | undefined;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private disconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private controller = new AbortController();
  private requested = false;
  private disposed = false;
  /** The single closure for end, failure, and disposal; every pending startup or poll step stops once it exists. */
  private ending: Promise<void> | undefined;

  constructor(private callbacks: Callbacks) { this.audio.autoplay = true; }

  private async request(action: string, body?: unknown, keepalive = false): Promise<unknown> {
    const timeout = action === 'start' ? 40_000 : action === 'poll' ? 5000 : 30_000;
    const response = await fetch(action === 'start' ? '/api/simulator/sessions' : `/api/simulator/sessions/${this.id}/${action}`, {
      method: 'POST', headers: { Authorization: `Bearer ${this.capability}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), keepalive,
      signal: keepalive ? AbortSignal.timeout(timeout) : AbortSignal.any([this.controller.signal, AbortSignal.timeout(timeout)]),
    });
    const result = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok || !result) throw new SessionRequestError(result?.error || 'The simulator connection is unavailable.', response.status);
    return result;
  }

  async start(scenarioId: string, clientId: string) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (this.ending) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      this.pc = new RTCPeerConnection();
      const pc = this.pc;
      for (const track of stream.getTracks()) pc.addTrack(track, stream);
      this.context = new AudioContext();
      this.inputMeter = this.meter(stream);
      pc.addEventListener('track', event => {
        if (this.ending) return;
        const remote = event.streams[0] ?? new MediaStream([event.track]);
        this.audio.srcObject = remote;
        void this.audio.play().catch(() => this.callbacks.error('Audio playback was blocked. Use Enable audio to listen.'));
        this.outputMeter = this.meter(remote);
      });
      pc.addEventListener('connectionstatechange', () => {
        clearTimeout(this.disconnectTimer);
        if (pc.connectionState === 'failed') void this.fail('The voice connection was interrupted.');
        if (pc.connectionState === 'disconnected') this.disconnectTimer = setTimeout(() => { void this.fail('The voice connection was lost.'); }, 5000);
      });
      const channel = pc.createDataChannel('oai-events');
      await pc.setLocalDescription(await pc.createOffer());
      await this.until(pc, 'icegatheringstatechange', () => pc.iceGatheringState === 'complete', 8000, 'Network negotiation timed out.');
      if (this.ending) return;
      this.requested = true;
      const created = await this.request('start', { id: this.id, scenarioId, clientId, sdp: pc.localDescription!.sdp }) as { sdp: string; snapshot: SessionSnapshot };
      if (this.ending) return;
      this.callbacks.snapshot(created.snapshot);
      await pc.setRemoteDescription({ type: 'answer', sdp: created.sdp });
      await this.until(channel, 'open', () => channel.readyState === 'open', 15_000, 'The voice connection timed out.');
      if (this.ending) return;
      this.callbacks.snapshot(await this.request('ready') as SessionSnapshot);
      this.poll();
      this.meterTimer = setInterval(() => {
        const input = readAudio(this.inputMeter), output = readAudio(this.outputMeter);
        this.callbacks.levels({ input: input.level, output: output.level, inputBands: input.bands, outputBands: output.bands });
      }, 80);
    } catch (error) {
      if (this.ending) return;
      const message = error instanceof DOMException && error.name === 'NotAllowedError' ? 'Microphone access was denied. Allow access in your browser, then try again.' : error instanceof Error ? error.message : 'The voice connection could not be established.';
      await this.fail(message);
    }
  }

  /** Waits for a negotiation event, rejecting on its timeout or once this attempt is closing. */
  private async until(target: EventTarget, event: string, ready: () => boolean, ms: number, message: string) {
    if (ready()) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(message)), ms);
      target.addEventListener(event, () => { if (ready()) { clearTimeout(timeout); resolve(); } });
      const abort = () => { clearTimeout(timeout); reject(new DOMException('Aborted', 'AbortError')); };
      this.controller.signal.addEventListener('abort', abort, { once: true });
      if (this.controller.signal.aborted) abort();
    });
  }

  private meter(stream: MediaStream) {
    const meter = this.context!.createAnalyser();
    meter.fftSize = 1024;
    meter.smoothingTimeConstant = .65;
    this.context!.createMediaStreamSource(stream).connect(meter);
    return meter;
  }

  private poll(failures = 0) {
    if (this.ending) return;
    this.pollTimer = setTimeout(async () => {
      try {
        const snapshot = await this.request('poll') as SessionSnapshot;
        if (this.ending) return;
        this.callbacks.snapshot(snapshot);
        if (snapshot.status === 'ended' || snapshot.status === 'interrupted') { this.release(); return; }
        this.poll();
      } catch (error) {
        if (this.ending) return;
        const lostSession = error instanceof SessionRequestError && [401, 403, 404, 410].includes(error.status);
        if (lostSession || failures + 1 >= 3) await this.fail('Live feedback lost its connection. This attempt has ended.');
        else this.poll(failures + 1);
      }
    }, 1000);
  }

  mute(muted: boolean) { this.stream?.getAudioTracks().forEach(track => { track.enabled = !muted; }); }
  async playAudio() { await this.context?.resume(); await this.audio.play(); }

  private async fail(message: string) {
    if (this.ending) return;
    const closing = this.end();
    this.callbacks.error(message, true);
    await closing;
  }

  end(): Promise<void> {
    if (this.ending) return this.ending;
    const drain = this.pc?.connectionState === 'connected';
    this.ending = (async () => {
      // Silence lets the server finish the last utterance during its short grace.
      // A stalled HTTP response must not retain local resources indefinitely.
      this.silence();
      if (!drain) this.release();
      const closeDeadline = setTimeout(() => this.release(), 3000);
      try {
        if (this.requested) {
          const snapshot = await this.request('end', undefined, true) as SessionSnapshot;
          if (!this.disposed && snapshot.id) this.callbacks.snapshot(snapshot);
        }
      } catch {
        if (!this.disposed) this.callbacks.error('The session ended locally; server finalization could not be confirmed.', true);
      } finally {
        clearTimeout(closeDeadline);
        this.release();
      }
    })();
    return this.ending;
  }

  /** Page departure shares end's one closure request but cannot wait to drain; the server lease remains responsible. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    void this.end();
    this.release();
  }

  private release() {
    this.silence();
    this.stream?.getTracks().forEach(track => track.stop());
    this.pc?.close();
  }

  private silence() {
    this.mute(true);
    this.controller.abort();
    clearInterval(this.meterTimer);
    clearTimeout(this.pollTimer);
    clearTimeout(this.disconnectTimer);
    this.audio.pause();
    this.audio.srcObject = null;
    void this.context?.close().catch(() => {});
    this.callbacks.levels(silentLevels);
  }
}
