import type { Evidence, ObjectiveReading, ScenarioSummary, TranscriptEntry } from './types';

export type TranscriptDelta = { speaker: TranscriptEntry['speaker']; text: string; startMs: number; endMs: number };

/** Arrival order preserves overlapping speakers; timestamps describe approximate audio time. */
export function appendTranscript(entries: TranscriptEntry[], delta: TranscriptDelta, frozenIds?: ReadonlySet<string>): TranscriptEntry[] {
  if (!delta.text || !Number.isFinite(delta.startMs) || !Number.isFinite(delta.endMs) || delta.startMs < 0 || delta.endMs < delta.startMs) return entries;
  const last = entries.findLast(entry => entry.speaker === delta.speaker);
  const replied = last && entries.some(entry => entry.speaker !== delta.speaker && entry.startMs >= last.endMs);
  if (last && !frozenIds?.has(last.id) && !replied && delta.startMs - last.endMs <= 2000 && last.text.length + delta.text.length <= 1200) {
    return entries.map(entry => entry.id === last.id ? { ...last, text: last.text + delta.text, endMs: Math.max(last.endMs, delta.endMs) } : entry);
  }
  return [...entries, { id: `p${entries.length + 1}`, speaker: delta.speaker, text: delta.text, startMs: delta.startMs, endMs: delta.endMs }];
}

export { activeElapsed, type PauseSpan } from '../../interview-engine/shared/timing';

/** Evaluator input bound. A live session stops accepting speech beyond it so final grading stays valid. */
export const TRANSCRIPT_LIMIT = { entries: 800, characters: 80_000 };
export const transcriptCharacters = (entries: TranscriptEntry[]) => entries.reduce((sum, entry) => sum + entry.text.length, 0);

export function findEvidence(entries: TranscriptEntry[], id: string): Evidence | null {
  const entry = entries.find(item => item.id === id);
  return entry ? { entryId: entry.id, speaker: entry.speaker, text: entry.text } : null;
}

/** Each passage must stop growing; a backchannel cannot settle another speaker. */
export function settledTranscript(entries: TranscriptEntry[], updatedAt: ReadonlyMap<string, number>, now: number): TranscriptEntry[] {
  return entries.filter(entry => now - (updatedAt.get(entry.id) ?? now) >= 1200);
}

/** Discoveries and demonstrated behaviors persist; current agreements can be withdrawn. */
export function reconcileObjectives(scenario: ScenarioSummary, previous: ObjectiveReading[], current: ObjectiveReading[]): ObjectiveReading[] {
  return scenario.objectives.map(objective => {
    const next = current.find(item => item.id === objective.id);
    const prior = previous.find(item => item.id === objective.id);
    if (objective.kind !== 'outcome' && prior?.achieved) return prior;
    return next ?? prior ?? { id: objective.id, probability: null, achieved: false, evidence: null };
  });
}
