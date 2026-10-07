import type { WireEntry } from '../wire';

export type TranscriptDelta = { speaker: WireEntry['speaker']; text: string; startMs: number; endMs: number };

/** Arrival order preserves overlapping speakers; timestamps describe approximate audio time. */
export function appendTranscript(entries: WireEntry[], delta: TranscriptDelta, frozenIds?: ReadonlySet<string>): WireEntry[] {
  if (!delta.text || !Number.isFinite(delta.startMs) || !Number.isFinite(delta.endMs) || delta.startMs < 0 || delta.endMs < delta.startMs) return entries;
  const last = entries.findLast(entry => entry.speaker === delta.speaker);
  const replied = last && entries.some(entry => entry.speaker !== delta.speaker && entry.startMs >= last.endMs);
  if (last && !frozenIds?.has(last.id) && !replied && delta.startMs - last.endMs <= 2000 && last.text.length + delta.text.length <= 1200) {
    return entries.map(entry => entry.id === last.id ? { ...last, text: last.text + delta.text, endMs: Math.max(last.endMs, delta.endMs) } : entry);
  }
  return [...entries, { id: `p${entries.length + 1}`, speaker: delta.speaker, text: delta.text, startMs: delta.startMs, endMs: delta.endMs }];
}

/** Each passage must stop growing; a backchannel cannot settle another speaker. */
export function settledTranscript(entries: WireEntry[], updatedAt: ReadonlyMap<string, number>, now: number): WireEntry[] {
  return entries.filter(entry => now - (updatedAt.get(entry.id) ?? now) >= 1200);
}
