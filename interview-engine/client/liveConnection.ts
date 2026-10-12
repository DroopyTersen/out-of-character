import { MediaActivityCapture } from './mediaActivity';
import type { Activity, SubmitTextInput, SubmitTextReply } from '../shared/protocol';
import type { SessionPause, SessionStatus } from '../shared/snapshot';
import type { AudioLevels } from './audioLevels';
import { BrowserMedia, type MediaCallbacks, type MediaConnection } from './browserMedia';
import { deliverTypedAnswer } from './typedAnswerDelivery';
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

/** Browser attempt commands and connection policy. BrowserMedia owns hardware; the server owns interview evidence and holds. */
export class LiveConnection<S extends ConnectionSnapshot = ConnectionSnapshot> {
  private id: string = crypto.randomUUID();
  private capability = [...crypto.getRandomValues(new Uint8Array(32))].map(value => value.toString(16).padStart(2, '0')).join('');
  private media: MediaConnection;
  private mediaCapture = new MediaActivityCapture();
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
  private lastInputAudioAt = 0;
  private activitySequence = 0;
  private muted = false;
  private autoMuted = false;
  /** The host has an unsent typed draft: the microphone is off and the server holds its silence nudges. */
  private composing = false;
  /** The single closure for end, failure, and disposal; every pending startup or poll step stops once it exists. */
  private ending: Promise<void> | undefined;

  constructor(private transport: ProtocolTransport, private callbacks: Callbacks<S>, existing?: Attempt,
    media: (callbacks: MediaCallbacks) => MediaConnection = callbacks => new BrowserMedia(callbacks)) {
    this.media = media({
      state: state => this.mediaChanged(state),
      levels: (levels, audible) => this.mediaLevels(levels, audible),
      error: message => this.callbacks.error(message),
    });
    if (existing) ({ id: this.id, capability: this.capability } = existing);
  }

  get attempt(): Attempt { return { id: this.id, capability: this.capability }; }
  private request(action: ProtocolAction, body?: unknown, { keepalive = false, signal = this.controller.signal }: { keepalive?: boolean; signal?: AbortSignal } = {}): Promise<unknown> {
    const timeoutMs = action === 'start' ? 40_000 : action === 'poll' || action === 'pause' ? 5000 : 30_000;
    const batch = (body as Activity | undefined)?.media;
    return this.transport.request(action, body, { attempt: this.attempt, timeoutMs, keepalive, signal,
      onServerTime: (sent, received, server) => this.mediaCapture.synchronize(sent, received, server),
    }).then(result => { if (batch) this.mediaCapture.acknowledge(batch); return result; });
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
    this.mediaCapture.connect();
    this.applyMute();
    const connected = await this.media.connect(exchange, segment.signal);
    if (!connected || this.ending) return false;
    if (segment.signal.aborted) throw new Error('The voice connection was interrupted.');
    // The server applies the current activity, including an open draft, before going live.
    const ready = await this.request('ready', this.activity(false)) as S;
    if (this.ending) return false;
    if (segment.signal.aborted) throw new Error('The voice connection was interrupted.');
    this.callbacks.snapshot(ready);
    return true;
  }

  /** Before the conversation starts, lost media fails the attempt; after, it reconnects in place or pauses. */
  private mediaChanged(state: RTCPeerConnectionState) {
    if (this.ending || this.segment.signal.aborted) return;
    clearTimeout(this.disconnectTimer);
    if (this.link.state === 'resuming') {
      if (state === 'failed') this.segment.abort();
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

  private describe(error: unknown, fallback: string) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') return 'Microphone access was denied. Allow access in your browser, then try again.';
    if (error instanceof DOMException && error.name === 'AbortError') return fallback;
    return error instanceof Error ? error.message : fallback;
  }

  private activity(active: boolean) {
    const now = Date.now();
    // Time-based, so a reloaded page never repeats a number the server already saw.
    this.activitySequence = Math.max(this.activitySequence + 1, now);
    return { active, audio: now - this.lastAudioAt < 1500, inputAudio: !this.muted && !this.autoMuted && !this.composing && now - this.lastInputAudioAt < 1500, sequence: this.activitySequence, composing: this.composing, media: this.mediaCapture.batch() };
  }

  /** Starts the live loops for the current media connection. */
  private live() {
    this.reloaded = false;
    this.mediaUnstable = false;
    this.pollFailingSince = undefined;
    this.setLink(stableLink);
    this.poll(this.segment);
    this.media.startMetering();
  }

  private mediaLevels(levels: AudioLevels, audible: boolean) {
    const now = Date.now();
    const inputAudio = !this.muted && !this.autoMuted && !this.composing && levels.input > .03;
    if (inputAudio) this.lastInputAudioAt = now;
    this.mediaCapture.observe(inputAudio, audible, performance.now());
    // Only the interviewer's playback extends the idle lease; microphone noise does not.
    const outputStarted = audible && now - this.lastAudioAt >= 1500;
    if (audible) { this.keepActive(); this.lastAudioAt = now; }
    if (outputStarted && !this.ending) void this.request('poll', this.activity(this.activeSincePoll)).catch(() => {});
    this.callbacks.levels(levels);
  }

  private poll(segment: AbortController) {
    if (this.ending || segment.signal.aborted) return;
    this.pollTimer = setTimeout(async () => {
      try {
        const network = await this.media.network();
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
    this.reported = report ? this.request('pause', this.activity(false)).then(() => {}, () => {}) : Promise.resolve();
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
    this.setLink({ state: 'resuming', reach: 'answered' });
    await this.reported;
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
      this.reported = accepted ? this.request('pause', this.activity(false)).then(() => {}, () => {}) : Promise.resolve();
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
  private applyMute() { this.media.mute(this.muted || this.composing || this.autoMuted); }

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
   * Sends one typed answer under its ID, retried unchanged while the server is unreachable or busy,
   * so a lost reply never creates a second turn. Resolves once the server saved it. The caller keeps the ID
   * for a later manual retry of the same answer.
   */
  async submitText(answer: SubmitTextInput): Promise<SubmitTextReply> {
    const reply = await deliverTypedAnswer({ answer, transport: this.transport, attempt: this.attempt, signal: this.controller.signal });
    // Saved even if the attempt is closing; only a live page shows the snapshot.
    if (!this.ending) this.callbacks.snapshot(reply.snapshot as unknown as S);
    return reply;
  }

  async playAudio() { await this.media.playAudio(); }

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
    const drain = this.link.state !== 'paused' && this.media.connected;
    this.ending = (async () => {
      let outcome: Closure['outcome'] = 'ended';
      // Silence lets the server finish the last utterance during its short grace.
      // A stalled HTTP response must not retain local resources indefinitely.
      this.silence();
      if (!drain) this.release();
      const closeDeadline = setTimeout(() => this.release(), 3000);
      try {
        if (this.requested) {
          const ended = await this.request('end', this.activity(false), { keepalive: true }) as S;
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
    void this.request('pause', this.activity(false), { keepalive: true }).catch(() => {});
    this.settle();
    return true;
  }

  /** Stops the current media connection and its loops; the attempt itself continues. */
  private teardown() {
    this.stopSegment();
    this.media.close();
    this.mediaUnstable = false;
    this.pollFailingSince = undefined;
    this.autoMuted = false;
    this.applyMute();
  }

  /** Stops one connection's polls, negotiation and disconnect timers. Media release is ordered by the caller. */
  private stopSegment() {
    this.segment.abort();
    clearTimeout(this.pollTimer);
    clearTimeout(this.disconnectTimer);
  }

  private release() {
    this.silence();
    this.media.dispose();
  }

  private silence() {
    // The draft itself lives in the host; a closed attempt has nothing to protect.
    this.composing = false;
    this.mute(true);
    this.controller.abort();
    this.stopSegment();
    this.media.silence();
    clearTimeout(this.heartbeatTimer);
    window.removeEventListener('pointerdown', this.keepActive);
    window.removeEventListener('keydown', this.keepActive);
    window.removeEventListener('offline', this.offline);
    window.removeEventListener('online', this.retry);
    document.removeEventListener('visibilitychange', this.retry);
  }
}
