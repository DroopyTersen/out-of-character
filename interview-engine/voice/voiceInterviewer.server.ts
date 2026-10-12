import type { VoiceConnection, VoiceEvent, VoiceInput, VoiceProvider } from '../providers/voice.server';
import { NETWORK_SAMPLES, type NetworkRecord } from '../shared/network';
import type { Passage } from '../shared/transcript';
import { interviewerBrief, type BriefedSpec } from './interviewerBrief.server';
import { isTypedItem } from './voice.prompt';
import { VoiceRecovery, type SilenceJudgment } from './voiceRecovery.server';
import type { RecoveryOutput, VoiceConversation, VoiceSegment } from './voiceSession';

export type VoiceOutput =
  | { type: 'event'; segment: Readonly<VoiceSegment>; event: VoiceEvent }
  | { type: 'dropped'; segment: Readonly<VoiceSegment> }
  | RecoveryOutput;

type Options = {
  spec: BriefedSpec;
  provider: VoiceProvider;
  now: () => number;
  conversation: () => VoiceConversation | null;
  judgeSilence: SilenceJudgment;
  silenceContinue: number;
  /** Reject immediately before paid creation when the coordinator has ended or lost ownership. */
  admit: () => void;
  /** Required lease persistence after registration or closure; throws when ownership is lost. */
  persist: () => Promise<void>;
  output: (message: VoiceOutput) => void;
};

/** Voice sessions and recovery. The coordinator owns admission, durable ordering and acceptance of transcript evidence. */
export class VoiceInterviewer {
  private connection: VoiceConnection | undefined;
  private records: VoiceSegment[] = [];
  private sequence = 0;
  private detached = false;
  private readonly recovery: VoiceRecovery;

  constructor(private readonly options: Options) {
    this.recovery = new VoiceRecovery({
      now: options.now, judgeSilence: options.judgeSilence, silenceContinue: options.silenceContinue,
      current: () => {
        const conversation = options.conversation(), segment = this.records.at(-1);
        return !this.detached && conversation && segment ? { conversation, segment } : null;
      },
      segments: () => this.records, send: input => this.send(input), output: options.output,
    });
  }

  get current(): Readonly<VoiceSegment> | undefined { return this.records.at(-1); }
  get segments(): readonly Readonly<VoiceSegment>[] { return this.records; }
  get epoch(): number { return this.sequence; }
  get lastActivityAt(): number { return this.recovery.lastActivityAt; }

  voiceName(voiceId: string) { return this.options.spec.interviewer.voices.find(voice => voice.id === voiceId)!.voice; }

  async open(input: { voiceId: string; sdp: string; offsetMs?: number; context?: string }): Promise<{ sdp: string }> {
    this.options.admit();
    const instructions = [interviewerBrief(this.options.spec, input.voiceId), input.context].filter(Boolean).join('\n\n');
    const created = await this.options.provider.create({ sdp: input.sdp, voice: this.voiceName(input.voiceId), instructions });
    const segment: VoiceSegment = { epoch: ++this.sequence, providerId: created.id, offsetMs: input.offsetMs ?? 0,
      startedAt: this.options.now(), endedAt: null, closeReason: null, finalization: 'pending', usageSeconds: null };
    this.records.push(segment);
    try { await this.options.persist(); }
    catch (error) {
      // The new ID never reached its required lease; a successor cannot recover its closure.
      await this.options.provider.close(created.id).catch(() => {});
      throw error;
    }
    const connection = await this.options.provider.attach(created.id, this.handlers(segment));
    if (this.detached) { connection.detach(); throw new Error('Voice owner was detached.'); }
    this.connection = connection;
    return { sdp: created.sdp };
  }

  send(input: VoiceInput): boolean { return this.connection?.send(input) ?? false; }
  greet(id: string, content: string) { this.recovery.greet(id, content); }
  transcript(changed: Passage, now: number) { this.recovery.transcript(changed, now); }
  playback(now: number) { this.recovery.playback(now); }
  inputAudio(now: number) { this.recovery.inputAudio(now); }
  composing(value: boolean, now: number) { this.recovery.composing(value, now); }
  tick(now: number) { return this.recovery.tick(now); }
  checkSilence(now: number) { return this.recovery.checkSilence(now); }
  stopRecovery() { return this.recovery.stop(); }

  network(record: NetworkRecord) {
    const segment = this.records.at(-1);
    if (segment && (segment.network?.length ?? 0) < NETWORK_SAMPLES) (segment.network ??= []).push(record);
  }

  private handlers(segment: VoiceSegment) {
    return {
      event: (event: VoiceEvent) => this.onEvent(event, segment),
      dropped: () => { if (!this.detached) this.options.output({ type: 'dropped', segment }); },
    };
  }

  private onEvent(event: VoiceEvent, segment: VoiceSegment) {
    const conversation = this.options.conversation();
    if (this.detached || !conversation) return;
    if (event.type === 'closed') {
      segment.finalization = 'confirmed';
      segment.endedAt ??= this.options.now();
      segment.closeReason = event.reason;
      if (event.usageSeconds != null) segment.usageSeconds = event.usageSeconds;
    } else {
      if (segment !== this.current) return;
      if (event.type !== 'transcript' && (conversation.status === 'ending' || conversation.status === 'paused')) return;
      if (this.recovery.providerEvent(segment, event)) return;
      if (event.type === 'error' && event.id && isTypedItem(event.id)) (segment.typedErrors ??= []).push({ id: event.id, at: this.options.now() });
    }
    this.options.output({ type: 'event', segment, event });
  }

  /** Provider closure still delivers the participant's last transcript before this required lease write. */
  async closeCurrent() {
    const segment = this.records.at(-1);
    if (!segment) return;
    for (const previous of this.records) if (previous !== segment && previous.finalization === 'pending') previous.finalization = 'unconfirmed';
    if (segment.finalization === 'pending') {
      try {
        if (this.connection) await this.connection.close();
        else await this.options.provider.close(segment.providerId, this.handlers(segment));
        segment.finalization = 'confirmed';
      } catch { segment.finalization = 'unconfirmed'; }
    }
    segment.endedAt ??= this.options.now();
    this.connection?.detach();
    this.connection = undefined;
    await this.options.persist();
  }

  /** Relinquish this owner's connection without ending a provider session now owned by its successor. */
  detach() {
    this.detached = true;
    void this.recovery.stop();
    this.connection?.detach();
    this.connection = undefined;
  }

  outstanding(): string[] { return this.records.filter(segment => segment.finalization !== 'confirmed').map(segment => segment.providerId); }
  usageSeconds(): number | null {
    const known = this.records.filter(segment => segment.usageSeconds != null);
    return known.length ? known.reduce((total, segment) => total + segment.usageSeconds!, 0) : null;
  }

  restore(input: { segments: VoiceSegment[]; epoch: number; providerIds: string[]; savedAt: number }) {
    this.records = input.segments;
    this.sequence = input.epoch;
    const known = new Set(this.records.map(segment => segment.providerId));
    for (const providerId of input.providerIds) if (!known.has(providerId)) {
      this.records.push({ epoch: ++this.sequence, providerId, offsetMs: 0, startedAt: input.savedAt,
        endedAt: null, closeReason: null, finalization: 'pending', usageSeconds: null });
    }
  }

  /** A restored live attempt has lost its control sockets; their unconfirmed leases need closing. */
  disconnected(now: number) {
    for (const segment of this.records) if (segment.finalization === 'pending') {
      segment.finalization = 'unconfirmed';
      segment.endedAt ??= now;
    }
  }

  closeOrphan(id: string) { return this.options.provider.close(id); }

  async retryClosures() {
    const open = this.records.filter(segment => segment.finalization === 'unconfirmed');
    if (!open.length) return;
    for (const segment of open) {
      try { await this.options.provider.close(segment.providerId); segment.finalization = 'confirmed'; } catch { /* Its lease remains for the next wake. */ }
    }
    await this.options.persist();
  }
}
