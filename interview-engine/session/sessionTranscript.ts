import { TRANSCRIPT_LIMIT, transcriptCharacters, type Passage } from '../shared/transcript';

export type TranscriptDelta = { speaker: Passage['speaker']; text: string; startMs: number; endMs: number };
export type PassageTiming = { passageId: string; firstEpoch: number | null; lastEpoch: number | null; firstReceivedAt: number; lastReceivedAt: number };
const fits = (entries: Passage[]) => entries.length <= TRANSCRIPT_LIMIT.entries && transcriptCharacters(entries) <= TRANSCRIPT_LIMIT.characters;

/** Canonical dialogue: arrival order, passage identity, settlement and revision move together. */
export class SessionTranscript {
  private passages: Passage[] = [];
  private version = 0;
  private arrivals = new Map<string, PassageTiming>();
  private updatedAt = new Map<string, number>();
  private frozen = new Set<string>();
  private seenEvents = new Set<string>();

  get entries(): Passage[] { return this.passages; }
  get timings(): PassageTiming[] { return [...this.arrivals.values()]; }
  get revision(): number { return this.version; }
  get nearCapacity(): boolean {
    return this.passages.length >= TRANSCRIPT_LIMIT.entries * .9 || transcriptCharacters(this.passages) >= TRANSCRIPT_LIMIT.characters * .9;
  }

  /** Event IDs belong to a provider segment; a resumed segment may reuse them. */
  appendSpeech(delta: TranscriptDelta & { id?: string }, segment: { epoch: number; offsetMs: number }, now: number): Passage | null {
    const key = delta.id && `${segment.epoch}:${delta.id}`;
    if (key && this.seenEvents.has(key)) return null;
    if (key) this.seenEvents.add(key);
    const next = appendTranscript(this.passages, {
      speaker: delta.speaker, text: delta.text, startMs: delta.startMs + segment.offsetMs, endMs: delta.endMs + segment.offsetMs,
    }, this.frozen);
    const changed = next.find(entry => !this.passages.includes(entry));
    return changed && fits(next) ? this.commit(next, changed, now, segment.epoch) : null;
  }

  /** The caller admits and deduplicates the command before appending its typed passage. */
  appendTyped(id: string, text: string, at: number, now: number): Passage | null {
    const time = Math.max(at, ...this.passages.map(entry => entry.endMs), 0);
    const passage: Passage = { id, speaker: 'participant', text, startMs: time, endMs: time };
    const next = [...this.passages, passage];
    if (!fits(next)) return null;
    this.frozen.add(id);
    return this.commit(next, passage, now, null);
  }

  freeze(passages: readonly Passage[] = this.passages) { for (const passage of passages) this.frozen.add(passage.id); }

  /** Each passage must stop growing; a backchannel cannot settle another speaker. */
  settled(now: number): Passage[] { return this.passages.filter(entry => this.isSettled(entry, now)); }

  /** An append-only map log must wait at the first passage still growing. */
  settledPrefix(now: number): Passage[] {
    const index = this.passages.findIndex(entry => !this.isSettled(entry, now));
    return index < 0 ? this.passages : this.passages.slice(0, index);
  }

  restore(entries: Passage[], revision: number, savedAt: number, timings: PassageTiming[] = []) {
    this.passages = entries;
    this.version = revision;
    this.arrivals = new Map(timings.map(timing => [timing.passageId, timing]));
    this.updatedAt = new Map(entries.map(entry => [entry.id, savedAt]));
    this.frozen = new Set(entries.map(entry => entry.id));
    this.seenEvents.clear();
  }

  private isSettled(entry: Passage, now: number) { return now - (this.updatedAt.get(entry.id) ?? now) >= 1200; }
  private commit(next: Passage[], changed: Passage, now: number, epoch: number | null): Passage {
    const previous = this.arrivals.get(changed.id);
    this.arrivals.set(changed.id, { passageId: changed.id, firstEpoch: previous?.firstEpoch ?? epoch, lastEpoch: epoch, firstReceivedAt: previous?.firstReceivedAt ?? now, lastReceivedAt: now });
    this.passages = next;
    this.version++;
    this.updatedAt.set(changed.id, now);
    return changed;
  }
}

/** Arrival order preserves overlapping speakers; timestamps describe approximate audio time. */
function appendTranscript(entries: Passage[], delta: TranscriptDelta, frozenIds: ReadonlySet<string>): Passage[] {
  if (!delta.text || !Number.isFinite(delta.startMs) || !Number.isFinite(delta.endMs) || delta.startMs < 0 || delta.endMs < delta.startMs) return entries;
  const last = entries.findLast(entry => entry.speaker === delta.speaker);
  const replied = last && entries.some(entry => entry.speaker !== delta.speaker && entry.startMs >= last.endMs);
  if (last && !frozenIds.has(last.id) && !replied && delta.startMs - last.endMs <= 2000 && last.text.length + delta.text.length <= 1200) {
    return entries.map(entry => entry.id === last.id ? { ...last, text: last.text + delta.text, endMs: Math.max(last.endMs, delta.endMs) } : entry);
  }
  return [...entries, { id: `p${entries.length + 1}`, speaker: delta.speaker, text: delta.text, startMs: delta.startMs, endMs: delta.endMs }];
}
