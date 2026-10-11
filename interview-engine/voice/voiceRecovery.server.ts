import { callFailure } from '../providers/diagnostics.server';
import type { VoiceEvent, VoiceInput } from '../providers/voice.server';
import type { Passage } from '../shared/transcript';
import { MAX_SILENCE_CHECKS, SILENCE_MS, SILENCE_VERSION, type SilenceRecord, type judgeConversationSilence } from '../judging/judgeConversationSilence.server';
import { CONTINUE_INTERVIEW } from './voice.prompt';
import type { RecoveryOutput, VoiceConversation, VoiceSegment } from './voiceSession';

const GREETING_RETRY_MS = 10_000;
const GREETING_REPLACE_MS = 25_000;
export const UNRESPONSIVE = 'The voice service is not responding. You can end this attempt and try again.';
export type SilenceJudgment = (input: { transcript: Passage[]; signal: AbortSignal }) => ReturnType<typeof judgeConversationSilence>;

type Options = {
  now: () => number;
  current: () => { segment: VoiceSegment; conversation: VoiceConversation } | null;
  segments: () => readonly VoiceSegment[];
  judgeSilence: SilenceJudgment;
  silenceContinue: number;
  send: (input: VoiceInput) => boolean;
  output: (message: RecoveryOutput) => void;
};

/** Greeting and transcript-silence recovery. Attempt lifecycle and durable writes belong to the coordinator. */
export class VoiceRecovery {
  private greeting: { eventId: string; content: string } | undefined;
  private lastSpeech = 0;
  private lastAudio: number;
  private checkedRevision = -1;
  private running: Promise<void> | undefined;
  private abort: AbortController | undefined;
  private replacedSilent = false;

  constructor(private readonly options: Options) { this.lastAudio = options.now(); }

  get lastActivityAt() { return Math.max(this.lastAudio, this.lastSpeech); }

  playback(now: number) { this.lastAudio = now; }

  composing(value: boolean, now: number) {
    if (value) {
      if (this.running) this.checkedRevision = -1;
      this.abort?.abort();
    } else this.lastSpeech = now;
  }

  transcript(changed: Passage, now: number) {
    this.lastSpeech = now;
    this.abort?.abort();
    const current = this.options.current();
    if (!current) return;
    const { segment } = current;
    const reminder = segment.silence?.findLast(item => item.outcome === 'sent' && !item.nextSpeech);
    if (reminder) reminder.nextSpeech = { at: now, passageId: changed.id, speaker: changed.speaker };
    if (changed.speaker === 'interviewer' && segment.greeting && segment.greeting.repliedAt == null) {
      segment.greeting.repliedAt = now;
      this.options.output({ type: 'responded' });
    }
  }

  /** Returns true only for a silence-reminder rejection, which should not become a generic provider error. */
  providerEvent(segment: VoiceSegment, event: VoiceEvent): boolean {
    if (event.type === 'acknowledged') {
      if (segment.greeting && this.greeting && [this.greeting.eventId, `${this.greeting.eventId}-again`].includes(event.id)) segment.greeting.acknowledgedAt ??= this.options.now();
      const reminder = segment.silence?.find(item => item.id === event.id && item.outcome === 'sent');
      if (reminder) reminder.acknowledgedAt ??= this.options.now();
    }
    if (event.type === 'error') {
      const reminder = segment.silence?.find(item => item.id === event.id);
      if (reminder) { reminder.outcome = 'rejected'; return true; }
    }
    return false;
  }

  greet(eventId: string, content: string) {
    const current = this.options.current();
    if (!current) return;
    this.greeting = { eventId, content };
    current.segment.greeting = { sentAt: this.options.now(), acknowledgedAt: null, retriedAt: null, repliedAt: null, abandonedAt: null };
    this.options.send({ kind: 'instruction', id: eventId, content });
  }

  tick(now: number): Promise<void> | undefined {
    this.unanswered(now);
    return this.checkSilence(now);
  }

  private unanswered(now: number) {
    const current = this.options.current();
    if (!current || current.conversation.status !== 'live') return;
    const { segment } = current;
    const greeting = segment.greeting;
    if (!greeting || !this.greeting || greeting.repliedAt != null || greeting.abandonedAt != null) return;
    const quiet = now - Math.max(greeting.sentAt, this.lastSpeech, this.lastAudio);
    if (quiet >= GREETING_REPLACE_MS) {
      greeting.abandonedAt = now;
      if (this.replacedSilent) this.options.output({ type: 'unresponsive' });
      else {
        this.replacedSilent = true;
        this.options.output({ type: 'replace' });
      }
    } else if (quiet >= GREETING_RETRY_MS && greeting.retriedAt == null) {
      greeting.retriedAt = now;
      this.options.send({ kind: 'instruction', id: `${this.greeting.eventId}-again`, content: this.greeting.content });
    }
  }

  /** Transcript inactivity drives this check; playback affects only the greeting watchdog above. */
  checkSilence(now: number): Promise<void> | undefined {
    const current = this.options.current();
    if (!current) return;
    const { segment, conversation } = current;
    if (conversation.status !== 'live' || conversation.composing || this.running || segment.greeting?.repliedAt == null || this.checkedRevision === conversation.revision || now - this.lastSpeech < SILENCE_MS) return;
    if (!conversation.transcript.some(entry => entry.speaker === 'participant') || this.options.segments().reduce((n, item) => n + (item.silence?.length ?? 0), 0) >= MAX_SILENCE_CHECKS) return;
    const transcript = conversation.transcript.slice(-8);
    const record: SilenceRecord = { id: `silence-${crypto.randomUUID()}`, version: SILENCE_VERSION, revision: conversation.revision,
      passageIds: transcript.map(entry => entry.id), startedAt: now, quietMs: now - this.lastSpeech, outcome: 'pending' };
    (segment.silence ??= []).push(record);
    this.checkedRevision = conversation.revision;
    const abort = this.abort = new AbortController();
    return this.running = this.judge(transcript, segment, record, abort).finally(() => {
      this.running = undefined;
      this.abort = undefined;
    });
  }

  /** Cancel immediately. Pause and End choose when their required ordering permits awaiting settlement. */
  stop(): Promise<void> { this.abort?.abort(); return this.running ?? Promise.resolve(); }

  private async judge(transcript: Passage[], segment: VoiceSegment, record: SilenceRecord, abort: AbortController) {
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(3000)]);
    try {
      const result = await this.options.judgeSilence({ transcript, signal });
      Object.assign(record, result);
      signal.throwIfAborted();
      const current = this.options.current();
      if (!current || current.conversation.composing || current.conversation.status !== 'live' || current.segment !== segment || current.conversation.revision !== record.revision) record.outcome = 'stale';
      else if (result.probability < this.options.silenceContinue) record.outcome = 'wait';
      else {
        record.outcome = 'sent';
        if (!this.options.send({ kind: 'instruction', id: record.id, content: CONTINUE_INTERVIEW })) record.outcome = 'error';
      }
    } catch (error) {
      record.outcome = abort.signal.aborted ? 'aborted' : error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'error';
      record.failure = callFailure(error);
    } finally { record.completedAt = this.options.now(); }
  }
}
