import { NETWORK_SAMPLE_MS, readNetwork, type NetworkCounters, type NetworkSample } from '../shared/network';
import type { SubmitTextReply } from '../shared/protocol';
import type { SessionPause, SessionStatus } from '../shared/snapshot';
import { readAudio, silentLevels, type AudioLevels } from './audioLevels';
import { SessionRequestError, SessionUnanswered, type Attempt, type ProtocolAction, type ProtocolTransport } from './transport';

export type { Attempt } from './transport';
/** The part of the host's snapshot the connection reads: an InterviewSnapshot, or the practice simulator's snapshot. */
export type ConnectionSnapshot = {
  id: string;
  status: SessionStatus;
  warning: { kind: string; endsAt: number } | null;
  pause?: Pick<SessionPause, 'resumes' | 'maxResumes'> | null;
};

/** Browser media health once a conversation has started: unstable media reconnects in place; lost media pauses until resumed. */
export type LinkState = 'stable' | 'reconnecting' | 'paused' | 'resuming';
/**
 * `reach` reports whether the paused attempt's server answered its latest check, has not answered yet (a restart,
 * an error, or a slow reply), or this browser is offline. `reloaded` marks a pause this page inherited from before a reload.
 */
export type Reach = 'answered' | 'unanswered' | 'offline';
export type Link = { state: LinkState; reach: Reach; reloaded?: boolean };
export const stableLink: Link = { state: 'stable', reach: 'answered' };
/**
 * How the attempt closed for this page. `ended`: the server ended it or confirmed this page's end, or it never
 * reached the server. `unconfirmed`: this page's end went unanswered, so the server may still hold the attempt; the
 * host can reattach to reconcile it. `lost`: the server no longer has it. `reachedLive`: its conversation had started.
 */
export type Closure = { outcome: 'ended' | 'unconfirmed' | 'lost'; reachedLive: boolean };

export type Callbacks<S extends ConnectionSnapshot = ConnectionSnapshot> = {
  snapshot: (value: S) => void;
  levels: (value: AudioLevels) => void;
  error: (message: string) => void;
  link: (value: Link) => void;
  /** Once per connection, unless the page detached or disposed of it. */
  closed: (value: Closure) => void;
};
const offline = (reach: Reach): Reach => navigator.onLine ? reach : 'offline';
const lostStatuses = [401, 403, 404, 410];
const isLost = (error: unknown) => error instanceof SessionRequestError && lostStatuses.includes(error.status);
const terminal = (snapshot: ConnectionSnapshot) => snapshot.status === 'ended' || snapshot.status === 'interrupted';
/** WebRTC can recover from `disconnected` on its own; past this it pauses instead. */
const DISCONNECT_GRACE_MS = 15_000;
/** Continuous failed polls past this pause the conversation. */
const POLL_GRACE_MS = 10_000;
const HEARTBEAT_MS = 5000;
/** A pause younger than this reconnects by itself once, when the server answers again. */
const AUTO_RESUME_MS = 60_000;
/** A typed answer is retried under its one id for at most this long. */
const SUBMIT_GIVE_UP_MS = 30_000;
const SUBMIT_UNSENT = 'Your answer could not be sent. Check your connection and try again.';
const NOT_LIVE = 'The interview is not live.';

/** Browser media only. The server owns transcripts, judgments, actor context, and the paused hold. */
export class LiveConnection<S extends ConnectionSnapshot = ConnectionSnapshot> {
  private id: string = crypto.randomUUID();
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
  /** Rejoined after a reload: audio needs a click on this page, so the pause waits for the user. */
  private reloaded = false;
  /** Settles once the server has heard this pause, so a late report cannot pause the resumed connection. */
  private reported: Promise<void> = Promise.resolve();
  private activeSincePoll = false;
  private lastAudioAt = 0;
  private activitySequence = 0;
  /** The current media connection's last stats read; reports carry the change since. */
  private networkCounters: NetworkCounters | undefined;
  private muted = false;
  private autoMuted = false;
  /** The host has an unsent typed draft: the microphone is off and the server holds its silence nudges. */
  private composing = false;
  /** The single closure for end, failure, and disposal; every pending startup or poll step stops once it exists. */
  private ending: Promise<void> | undefined;

  constructor(private transport: ProtocolTransport, private callbacks: Callbacks<S>, existing?: Attempt) {
    this.audio.autoplay = true;
    if (existing) ({ id: this.id, capability: this.capability } = existing);
  }

  get attempt(): Attempt { return { id: this.id, capability: this.capability }; }
  private request(action: ProtocolAction, body?: unknown, { keepalive = false, signal = this.controller.signal }: { keepalive?: boolean; signal?: AbortSignal } = {}): Promise<unknown> {
    const timeoutMs = action === 'start' ? 40_000 : action === 'poll' || action === 'pause' ? 5000 : action === 'submitText' ? 10_000 : 30_000;
    return this.transport.request(action, body, { attempt: this.attempt, timeoutMs, keepalive, signal });
  }

  async start(planId: string, voiceId: string) {
    try {
      const connected = await this.connect(async sdp => {
        this.requested = true;
        const created = await this.request('start', { id: this.id, planId, voiceId, sdp }) as { sdp: string; snapshot: S };
        if (this.ending) return null;
        this.callbacks.snapshot(created.snapshot);
        return created.sdp;
      });
      if (!connected) return;
      this.listen();
      this.reachedLive = true;
      this.live();
    } catch (error) {
      if (this.ending) return;
      await this.fail(this.describe(error, 'The voice connection could not be established.'));
    }
  }

  /** Rejoins a started attempt after the page reloaded. It holds the attempt until the user resumes or ends it. */
  async reattach() {
    this.requested = this.reachedLive = this.reloaded = true;
    this.listen();
    // The previous page's media is gone; the server may not know yet.
    await this.pause();
  }

  private listen() {
    window.addEventListener('pointerdown', this.keepActive, { passive: true });
    window.addEventListener('keydown', this.keepActive);
    window.addEventListener('offline', this.offline);
    window.addEventListener('online', this.retry);
    document.addEventListener('visibilitychange', this.retry);
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
    this.networkCounters = undefined;
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
    // The server applies the current activity, including an open draft, before going live.
    const ready = await this.request('ready', this.activity(false)) as S;
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

  private activity(active: boolean) {
    const now = Date.now();
    // Time-based, so a reloaded page never repeats a number the server already saw.
    this.activitySequence = Math.max(this.activitySequence + 1, now);
    return { active, audio: now - this.lastAudioAt < 1500, sequence: this.activitySequence, composing: this.composing };
  }

  /** Media quality since the last read, at most every few seconds. A slow or failed read is skipped, never waited on. */
  private async network(): Promise<NetworkSample | undefined> {
    const pc = this.pc;
    if (!pc || pc.connectionState !== 'connected' || Date.now() - (this.networkCounters?.at ?? 0) < NETWORK_SAMPLE_MS) return;
    try {
      const report = await Promise.race([pc.getStats(), new Promise<undefined>(resolve => setTimeout(resolve, 300))]);
      if (!report || pc !== this.pc) return;
      const { counters, sample } = readNetwork(report.values(), this.networkCounters, Date.now());
      this.networkCounters = counters;
      return sample;
    } catch { return; }
  }

  /** Starts the live loops for the current media connection. */
  private live() {
    this.reloaded = false;
    this.mediaUnstable = false;
    this.pollFailingSince = undefined;
    this.setLink(stableLink);
    this.poll(this.segment);
    clearInterval(this.meterTimer);
    this.meterTimer = setInterval(() => {
      const input = readAudio(this.inputMeter), output = readAudio(this.outputMeter);
      const now = Date.now();
      const running = this.context?.state === 'running';
      // Only Sam's playback extends the session's idle lease; microphone noise does not.
      const samAudible = running && output.level > .03 && !this.audio.paused;
      const outputStarted = samAudible && now - this.lastAudioAt >= 1500;
      if (samAudible) {
        this.keepActive();
        this.lastAudioAt = now;
      }
      // Report new playback promptly so it extends the server's idle and ending grace.
      // An older periodic report is ignored on the server.
      if (outputStarted && !this.ending) {
        void this.request('poll', this.activity(this.activeSincePoll)).catch(() => {});
      }
      this.callbacks.levels({ input: input.level, output: output.level, inputBands: input.bands, outputBands: output.bands });
    }, 80);
  }

  private poll(segment: AbortController) {
    if (this.ending || segment.signal.aborted) return;
    this.pollTimer = setTimeout(async () => {
      try {
        const network = await this.network();
        if (this.ending || segment.signal.aborted) return;
        const active = this.activeSincePoll;
        this.activeSincePoll = false;
        const snapshot = await this.request('poll', { ...this.activity(active), ...(network ? { network } : {}) }, { signal: segment.signal }) as S;
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
        if (isLost(error)) { this.lost('Live feedback lost its connection. This attempt has ended.'); return; }
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
    this.setLink({ state: 'paused', reach: offline('answered') });
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
        const snapshot = await this.request('poll', { active: false, audio: false }) as S;
        if (this.ending || this.link.state !== 'paused') return;
        this.setLink({ state: 'paused', reach: 'answered' });
        this.callbacks.snapshot(snapshot);
        if (terminal(snapshot)) { this.settle(); return; }
        const budget = !snapshot.pause || snapshot.pause.resumes < snapshot.pause.maxResumes;
        if (budget && !this.autoResumed && !this.reloaded && Date.now() - this.pausedAt < AUTO_RESUME_MS && document.visibilityState === 'visible' && navigator.onLine) {
          void this.resume(true);
          return;
        }
        this.heartbeat();
      } catch (error) {
        if (this.ending || this.link.state !== 'paused') return;
        if (isLost(error)) { this.lost('This attempt is no longer available.'); return; }
        // A restarting or overloaded server is still worth resuming; only an offline browser cannot.
        this.setLink({ state: 'paused', reach: offline('unanswered') });
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
    this.setLink({ state: 'resuming', reach: 'answered' });
    let accepted = false;
    try {
      const connected = await this.connect(async sdp => {
        const resumed = await this.request('resume', { sdp }) as { sdp: string; snapshot: S };
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
      this.setLink({ state: 'paused', reach: offline(error instanceof SessionUnanswered ? 'unanswered' : 'answered') });
      if (isLost(error)) { this.lost('This attempt is no longer available.'); return; }
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

  private setLink(next: Link) {
    const link = this.reloaded && next.state === 'paused' ? { ...next, reloaded: true } : next;
    if (link.state === this.link.state && link.reach === this.link.reach && link.reloaded === this.link.reloaded) return;
    this.link = link;
    if (!this.disposed) this.callbacks.link(link);
  }

  private updateLink() {
    if (this.link.state === 'paused' || this.link.state === 'resuming') return;
    this.setLink(this.mediaUnstable || this.pollFailingSince != null ? { state: 'reconnecting', reach: 'answered' } : stableLink);
  }

  keepActive = () => { this.activeSincePoll = true; };
  mute(muted: boolean) { this.muted = muted; this.applyMute(); }
  private applyMute() { this.stream?.getAudioTracks().forEach(track => { track.enabled = !this.muted && !this.composing && !this.autoMuted; }); }

  /** Whether polls run for the current media connection; otherwise the next `ready` carries the state. */
  private polling() {
    return this.reachedLive && !this.ending && !this.segment.signal.aborted && (this.link.state === 'stable' || this.link.state === 'reconnecting');
  }

  /** A nonempty typed draft mutes the microphone and tells the server at once; regular polls repeat it. */
  setComposing(value: boolean) {
    if (value === this.composing) return;
    this.composing = value;
    this.applyMute();
    if (!this.polling()) return;
    void this.request('poll', this.activity(this.activeSincePoll), { signal: this.segment.signal }).catch(() => {});
  }

  /**
   * Sends one typed answer. Its id is minted here and retried unchanged while the server is unreachable or busy,
   * so a lost reply never creates a second turn. Resolves once the server saved it.
   */
  async submitText(text: string): Promise<SubmitTextReply> {
    const id = crypto.randomUUID();
    const giveUpAt = Date.now() + SUBMIT_GIVE_UP_MS;
    let delay = 1000;
    for (;;) {
      if (this.ending) throw new Error(NOT_LIVE);
      try {
        const reply = await this.request('submitText', { id, text }) as SubmitTextReply;
        // Saved even if the attempt is closing; only a live page shows the snapshot.
        if (!this.ending) this.callbacks.snapshot(reply.snapshot as unknown as S);
        return reply;
      } catch (error) {
        if (this.ending) throw new Error(NOT_LIVE);
        const retryable = error instanceof SessionUnanswered || (error instanceof SessionRequestError && error.status === 503);
        if (!retryable) throw new Error(error instanceof SessionRequestError ? error.message : SUBMIT_UNSENT);
        if (Date.now() + delay >= giveUpAt) throw new Error(SUBMIT_UNSENT);
        await this.wait(delay);
        delay = Math.min(delay * 2, 5000);
      }
    }
  }

  /** Waits, rejecting once the attempt closes. */
  private wait(ms: number) {
    const signal = this.controller.signal;
    return new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new Error(NOT_LIVE)); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  async playAudio() { await this.context?.resume(); await this.audio.play(); }

  private async fail(message: string) {
    if (this.ending) return;
    this.callbacks.error(message);
    await this.end();
  }

  /** The server no longer has this attempt, so there is nothing to end. */
  private lost(message: string) {
    if (this.ending) return;
    this.callbacks.error(message);
    this.settle('lost');
  }

  /** The attempt is over for this page and nothing remains to close: the server ended it, lost it, or the page left. */
  private settle(outcome: Closure['outcome'] = 'ended') {
    this.ending = Promise.resolve();
    this.release();
    this.closed(outcome);
  }

  private closed(outcome: Closure['outcome']) {
    if (!this.disposed) this.callbacks.closed({ outcome, reachedLive: this.reachedLive });
  }

  /** Ends the attempt. `closed` then says whether the server confirmed it; an unanswered end can be reconciled by reattaching. */
  end(): Promise<void> {
    if (this.ending) return this.ending;
    const drain = this.link.state !== 'paused' && this.pc?.connectionState === 'connected';
    this.ending = (async () => {
      let outcome: Closure['outcome'] = 'ended';
      // Silence lets the server finish the last utterance during its short grace.
      // A stalled HTTP response must not retain local resources indefinitely.
      this.silence();
      if (!drain) this.release();
      const closeDeadline = setTimeout(() => this.release(), 3000);
      try {
        if (this.requested) {
          const ended = await this.request('end', undefined, { keepalive: true }) as S;
          if (!this.disposed && ended.id) this.callbacks.snapshot(ended);
        }
      } catch (error) {
        outcome = isLost(error) ? 'lost' : 'unconfirmed';
      } finally {
        clearTimeout(closeDeadline);
        this.release();
      }
      this.closed(outcome);
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

  /** The page is leaving mid-conversation, perhaps to reload: hold the attempt for it rather than ending it. Returns whether it is held. */
  detach(): boolean {
    if (this.disposed) return false;
    if (!this.reachedLive || this.ending) { this.dispose(); return false; }
    this.disposed = true;
    void this.request('pause', undefined, { keepalive: true }).catch(() => {});
    this.settle();
    return true;
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
    this.callbacks.levels(silentLevels);
  }

  private release() {
    this.silence();
    this.stream?.getTracks().forEach(track => track.stop());
    this.pc?.close();
  }

  private silence() {
    // The draft itself lives in the host; a closed attempt has nothing to protect.
    this.composing = false;
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
