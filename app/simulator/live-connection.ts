import type { SessionSnapshot } from '../../core/simulator/types';
import { readAudio, silentLevels, type AudioLevels } from './audio-levels';

/** Browser media health once a conversation has started: unstable media reconnects in place; lost media pauses until resumed. */
export type LinkState = 'stable' | 'reconnecting' | 'paused' | 'resuming';
/** `reachable` reports whether the paused attempt's server answered its latest heartbeat. */
export type Link = { state: LinkState; reachable: boolean };
export const stableLink: Link = { state: 'stable', reachable: true };

type Callbacks = {
  snapshot: (value: SessionSnapshot) => void;
  levels: (value: AudioLevels) => void;
  error: (message: string, fatal?: boolean) => void;
  link: (value: Link) => void;
};
class SessionRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
const lostStatuses = [401, 403, 404, 410];
const isLost = (error: unknown) => error instanceof SessionRequestError && lostStatuses.includes(error.status);
const terminal = (snapshot: SessionSnapshot) => snapshot.status === 'ended' || snapshot.status === 'interrupted';
/** WebRTC can recover from `disconnected` on its own; past this it pauses instead. */
const DISCONNECT_GRACE_MS = 15_000;
/** Continuous failed polls past this pause the conversation. */
const POLL_GRACE_MS = 10_000;
const HEARTBEAT_MS = 5000;
/** A pause younger than this reconnects by itself once, when the server answers again. */
const AUTO_RESUME_MS = 60_000;

/** Browser media only. The server owns transcripts, judgments, actor context, and the paused hold. */
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
  private heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  private controller = new AbortController();
  /** One media connection: the start, or one resume. Aborting it stops that connection's waits and polls. */
  private segment = new AbortController();
  private requested = false;
  private reachedLive = false;
  private disposed = false;
  private link: Link = stableLink;
  private mediaUnstable = false;
  private pollFailingSince: number | undefined;
  private pausedAt = 0;
  private autoResumed = false;
  /** Settles once the server has heard this pause, so a late report cannot pause the resumed connection. */
  private reported: Promise<void> = Promise.resolve();
  private activeSincePoll = false;
  private lastAudioAt = 0;
  private outputQuietSince: number | undefined;
  private meterUpdatedAt = 0;
  private activitySequence = 0;
  private muted = false;
  private autoMuted = false;
  /** The single closure for end, failure, and disposal; every pending startup or poll step stops once it exists. */
  private ending: Promise<void> | undefined;

  constructor(private callbacks: Callbacks) { this.audio.autoplay = true; }

  get reportTarget() { return { id: this.id, url: `/api/simulator/sessions/${this.id}`, headers: { Authorization: `Bearer ${this.capability}` } }; }

  private async request(action: string, body?: unknown, { keepalive = false, signal = this.controller.signal }: { keepalive?: boolean; signal?: AbortSignal } = {}): Promise<unknown> {
    const timeout = action === 'start' ? 40_000 : action === 'poll' || action === 'pause' ? 5000 : 30_000;
    const response = await fetch(action === 'start' ? '/api/simulator/sessions' : `/api/simulator/sessions/${this.id}/${action}`, {
      method: 'POST', headers: { Authorization: `Bearer ${this.capability}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), keepalive,
      signal: keepalive ? AbortSignal.timeout(timeout) : AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
    });
    const result = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok || !result) throw new SessionRequestError(result?.error || 'The simulator connection is unavailable.', response.status);
    return result;
  }

  async start(scenarioId: string, clientId: string) {
    try {
      const connected = await this.connect(async sdp => {
        this.requested = true;
        const created = await this.request('start', { id: this.id, scenarioId, clientId, sdp }) as { sdp: string; snapshot: SessionSnapshot };
        if (this.ending) return null;
        this.callbacks.snapshot(created.snapshot);
        return created.sdp;
      });
      if (!connected) return;
      window.addEventListener('pointerdown', this.keepActive, { passive: true });
      window.addEventListener('keydown', this.keepActive);
      window.addEventListener('offline', this.offline);
      window.addEventListener('online', this.retry);
      document.addEventListener('visibilitychange', this.retry);
      this.reachedLive = true;
      this.live();
    } catch (error) {
      if (this.ending) return;
      await this.fail(this.describe(error, 'The voice connection could not be established.'));
    }
  }

  /**
   * Opens one media connection: microphone, peer connection, the server's answer, and the server's live state.
   * Returns false once the attempt is ending; throws when this connection fails.
   */
  private async connect(exchange: (sdp: string) => Promise<string | null>): Promise<boolean> {
    const segment = this.segment = new AbortController();
    const stopped = () => {
      if (this.ending) return true;
      if (segment.signal.aborted) throw new Error('The voice connection was interrupted.');
      return false;
    };
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (this.ending || segment.signal.aborted) { stream.getTracks().forEach(track => track.stop()); stopped(); return false; }
    this.stream = stream;
    this.applyMute();
    const pc = this.pc = new RTCPeerConnection();
    for (const track of stream.getTracks()) pc.addTrack(track, stream);
    // The audio context survives pauses: a resume may not have a user gesture to start a new one.
    this.context ??= new AudioContext();
    this.inputMeter = this.meter(stream);
    pc.addEventListener('track', event => {
      if (this.ending || pc !== this.pc) return;
      const remote = event.streams[0] ?? new MediaStream([event.track]);
      this.audio.srcObject = remote;
      void this.audio.play().catch(() => this.callbacks.error('Audio playback was blocked. Use Enable audio to listen.'));
      this.outputMeter = this.meter(remote);
    });
    pc.addEventListener('connectionstatechange', () => this.mediaChanged(pc, segment));
    // Audio only: session events and private actor context stay on the server's sideband.
    await pc.setLocalDescription(await pc.createOffer());
    await this.until(pc, 'icegatheringstatechange', () => pc.iceGatheringState === 'complete', 8000, 'Network negotiation timed out.', segment.signal);
    if (stopped()) return false;
    const answer = await exchange(pc.localDescription!.sdp);
    if (answer == null || stopped()) return false;
    await pc.setRemoteDescription({ type: 'answer', sdp: answer });
    await this.until(pc, 'connectionstatechange', () => pc.connectionState === 'connected', 15_000, 'The voice connection timed out.', segment.signal);
    if (stopped()) return false;
    const ready = await this.request('ready') as SessionSnapshot;
    if (stopped()) return false;
    this.callbacks.snapshot(ready);
    return true;
  }

  /** Before the conversation starts, lost media fails the attempt; after, it reconnects in place or pauses. */
  private mediaChanged(pc: RTCPeerConnection, segment: AbortController) {
    if (this.ending || pc !== this.pc || segment.signal.aborted) return;
    clearTimeout(this.disconnectTimer);
    const state = pc.connectionState;
    if (this.link.state === 'resuming') {
      if (state === 'failed') segment.abort();
      return;
    }
    if (!this.reachedLive) {
      if (state === 'failed') void this.fail('The voice connection was interrupted.');
      if (state === 'disconnected') this.disconnectTimer = setTimeout(() => { void this.fail('The voice connection was lost.'); }, 5000);
      return;
    }
    if (this.link.state === 'paused') return;
    if (state === 'failed') { void this.pause(); return; }
    this.mediaUnstable = state === 'disconnected';
    if (this.mediaUnstable) this.disconnectTimer = setTimeout(() => { void this.pause(); }, DISCONNECT_GRACE_MS);
    this.updateLink();
  }

  /** Waits for a negotiation event, rejecting on its timeout or once its connection is closing. */
  private async until(target: EventTarget, event: string, ready: () => boolean, ms: number, message: string, signal: AbortSignal) {
    if (ready()) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(message)), ms);
      target.addEventListener(event, () => { if (ready()) { clearTimeout(timeout); resolve(); } });
      const abort = () => { clearTimeout(timeout); reject(new DOMException('Aborted', 'AbortError')); };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  }

  private describe(error: unknown, fallback: string) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') return 'Microphone access was denied. Allow access in your browser, then try again.';
    if (error instanceof DOMException && error.name === 'AbortError') return fallback;
    return error instanceof Error ? error.message : fallback;
  }

  private meter(stream: MediaStream) {
    const meter = this.context!.createAnalyser();
    meter.fftSize = 1024;
    meter.smoothingTimeConstant = .65;
    this.context!.createMediaStreamSource(stream).connect(meter);
    return meter;
  }

  private canMeasureOutput() {
    return !!this.outputMeter && this.context?.state === 'running' && !this.audio.paused && this.pc?.connectionState === 'connected';
  }

  private activity(active: boolean) {
    const now = Date.now();
    const fresh = now - this.meterUpdatedAt < 250;
    return { active, audio: now - this.lastAudioAt < 1500, sequence: ++this.activitySequence,
      outputQuietMs: fresh && this.canMeasureOutput() && this.outputQuietSince != null ? Math.min(60_000, now - this.outputQuietSince) : null };
  }

  /** Starts the live loops for the current media connection. */
  private live() {
    this.mediaUnstable = false;
    this.pollFailingSince = undefined;
    this.setLink(stableLink);
    this.poll(this.segment);
    clearInterval(this.meterTimer);
    this.meterTimer = setInterval(() => {
      const input = readAudio(this.inputMeter), output = readAudio(this.outputMeter);
      const now = Date.now();
      const previousQuiet = this.outputQuietSince;
      const running = this.context?.state === 'running';
      const inputEnabled = !this.muted && !this.autoMuted;
      const outputAudible = output.level > .03 && !this.audio.paused;
      const heard = running && ((inputEnabled && input.level > .08) || outputAudible);
      this.meterUpdatedAt = now;
      this.outputQuietSince = this.canMeasureOutput() && output.level <= .03 ? this.outputQuietSince ?? now : undefined;
      if (heard) {
        this.keepActive();
        this.lastAudioAt = now;
      }
      // Sam starting to speak closes the cue opening. Ignore any older periodic report on the server.
      if (previousQuiet != null && now - previousQuiet >= 600 && this.outputQuietSince == null && !this.ending) {
        void this.request('poll', this.activity(this.activeSincePoll)).catch(() => {});
      }
      this.callbacks.levels({ input: input.level, output: output.level, inputBands: input.bands, outputBands: output.bands });
    }, 80);
  }

  private poll(segment: AbortController) {
    if (this.ending || segment.signal.aborted) return;
    this.pollTimer = setTimeout(async () => {
      try {
        const active = this.activeSincePoll;
        this.activeSincePoll = false;
        const snapshot = await this.request('poll', this.activity(active), { signal: segment.signal }) as SessionSnapshot;
        if (this.ending || segment.signal.aborted) return;
        this.pollFailingSince = undefined;
        this.updateLink();
        this.autoMuted = snapshot.status === 'ending' || (!!snapshot.warning && snapshot.warning.kind !== 'idle' && Date.now() >= snapshot.warning.endsAt);
        this.applyMute();
        this.callbacks.snapshot(snapshot);
        if (terminal(snapshot)) { this.settle(); return; }
        // The server paused first, for example after losing its provider session.
        if (snapshot.status === 'paused') { void this.pause(false); return; }
        this.poll(segment);
      } catch (error) {
        if (this.ending || segment.signal.aborted) return;
        if (isLost(error)) { await this.fail('Live feedback lost its connection. This attempt has ended.'); return; }
        this.pollFailingSince ??= Date.now();
        this.updateLink();
        if (Date.now() - this.pollFailingSince >= POLL_GRACE_MS) void this.pause();
        else this.poll(segment);
      }
    }, 1000);
  }

  /** Releases this connection's media and holds the attempt; the server keeps the transcript until it is resumed or ended. */
  private async pause(report = true) {
    if (this.ending || this.link.state === 'paused') return;
    this.teardown();
    this.pausedAt = Date.now();
    this.autoResumed = false;
    this.setLink({ state: 'paused', reachable: navigator.onLine });
    this.reported = report ? this.request('pause').then(() => {}, () => {}) : Promise.resolve();
    await this.reported;
    this.heartbeat(0);
  }

  /** While paused, checks on the server: it reports the hold's countdown, the end of the hold, and when resuming can work. */
  private heartbeat(delay = HEARTBEAT_MS) {
    clearTimeout(this.heartbeatTimer);
    if (this.ending || this.link.state !== 'paused') return;
    this.heartbeatTimer = setTimeout(async () => {
      try {
        const snapshot = await this.request('poll') as SessionSnapshot;
        if (this.ending || this.link.state !== 'paused') return;
        this.setLink({ state: 'paused', reachable: true });
        this.callbacks.snapshot(snapshot);
        if (terminal(snapshot)) { this.settle(); return; }
        const budget = !snapshot.pause || snapshot.pause.resumes < snapshot.pause.maxResumes;
        if (budget && !this.autoResumed && Date.now() - this.pausedAt < AUTO_RESUME_MS && document.visibilityState === 'visible' && navigator.onLine) {
          void this.resume(true);
          return;
        }
        this.heartbeat();
      } catch (error) {
        if (this.ending || this.link.state !== 'paused') return;
        if (isLost(error)) { await this.fail('This attempt is no longer available.'); return; }
        this.setLink({ state: 'paused', reachable: false });
        this.heartbeat();
      }
    }, delay);
  }

  /** Reconnects a paused attempt with new media; a failure returns to the pause with its reason. */
  async resume(automatic = false) {
    if (this.ending || this.link.state !== 'paused') return;
    clearTimeout(this.heartbeatTimer);
    if (automatic) this.autoResumed = true;
    await this.reported;
    this.setLink({ state: 'resuming', reachable: true });
    let accepted = false;
    try {
      const connected = await this.connect(async sdp => {
        const resumed = await this.request('resume', { sdp }) as { sdp: string; snapshot: SessionSnapshot };
        accepted = true;
        if (this.ending) return null;
        this.callbacks.snapshot(resumed.snapshot);
        return resumed.sdp;
      });
      if (!connected) return;
      this.live();
    } catch (error) {
      if (this.ending) return;
      this.teardown();
      this.setLink({ state: 'paused', reachable: !(error instanceof TypeError) && navigator.onLine });
      if (isLost(error)) { await this.fail('This attempt is no longer available.'); return; }
      if (error instanceof SessionRequestError && error.status === 409) this.autoResumed = true;
      this.callbacks.error(this.describe(error, 'The voice connection could not be re-established. Try again.'));
      // The server began reconnecting; hold it again rather than waiting out its connecting timeout.
      this.reported = accepted ? this.request('pause').then(() => {}, () => {}) : Promise.resolve();
      await this.reported;
      this.heartbeat(accepted ? 0 : HEARTBEAT_MS);
    }
  }

  private offline = () => { if (this.reachedLive && this.link.state !== 'paused' && this.link.state !== 'resuming') void this.pause(); };
  private retry = () => { if (this.link.state === 'paused' && document.visibilityState === 'visible') this.heartbeat(0); };

  private setLink(link: Link) {
    if (link.state === this.link.state && link.reachable === this.link.reachable) return;
    this.link = link;
    if (!this.disposed) this.callbacks.link(link);
  }

  private updateLink() {
    if (this.link.state === 'paused' || this.link.state === 'resuming') return;
    this.setLink(this.mediaUnstable || this.pollFailingSince != null ? { state: 'reconnecting', reachable: true } : stableLink);
  }

  keepActive = () => { this.activeSincePoll = true; };
  mute(muted: boolean) { this.muted = muted; this.applyMute(); }
  private applyMute() { this.stream?.getAudioTracks().forEach(track => { track.enabled = !this.muted && !this.autoMuted; }); }
  async playAudio() { await this.context?.resume(); await this.audio.play(); }

  private async fail(message: string) {
    if (this.ending) return;
    const closing = this.end();
    this.callbacks.error(message, true);
    await closing;
  }

  /** The server ended the attempt; nothing remains to close. */
  private settle() {
    this.ending = Promise.resolve();
    this.release();
  }

  end(): Promise<void> {
    if (this.ending) return this.ending;
    const drain = this.link.state !== 'paused' && this.pc?.connectionState === 'connected';
    this.ending = (async () => {
      let ended: SessionSnapshot | undefined;
      // Silence lets the server finish the last utterance during its short grace.
      // A stalled HTTP response must not retain local resources indefinitely.
      this.silence();
      if (!drain) this.release();
      const closeDeadline = setTimeout(() => this.release(), 3000);
      try {
        if (this.requested) {
          ended = await this.request('end', undefined, { keepalive: true }) as SessionSnapshot;
          if (!this.disposed && ended.id) this.callbacks.snapshot(ended);
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

  /** Stops the current media connection and its loops; the attempt itself continues. */
  private teardown() {
    this.segment.abort();
    clearInterval(this.meterTimer);
    clearTimeout(this.pollTimer);
    clearTimeout(this.disconnectTimer);
    this.mediaUnstable = false;
    this.pollFailingSince = undefined;
    this.autoMuted = false;
    this.audio.pause();
    this.audio.srcObject = null;
    this.stream?.getTracks().forEach(track => track.stop());
    this.pc?.close();
    this.stream = undefined;
    this.pc = undefined;
    this.inputMeter = this.outputMeter = undefined;
    this.outputQuietSince = undefined;
    this.callbacks.levels(silentLevels);
  }

  private release() {
    this.silence();
    this.stream?.getTracks().forEach(track => track.stop());
    this.pc?.close();
  }

  private silence() {
    this.mute(true);
    this.controller.abort();
    this.segment.abort();
    clearInterval(this.meterTimer);
    clearTimeout(this.pollTimer);
    clearTimeout(this.disconnectTimer);
    clearTimeout(this.heartbeatTimer);
    window.removeEventListener('pointerdown', this.keepActive);
    window.removeEventListener('keydown', this.keepActive);
    window.removeEventListener('offline', this.offline);
    window.removeEventListener('online', this.retry);
    document.removeEventListener('visibilitychange', this.retry);
    this.audio.pause();
    this.audio.srcObject = null;
    void this.context?.close().catch(() => {});
    this.callbacks.levels(silentLevels);
  }
}
