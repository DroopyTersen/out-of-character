import type { Evidence, ObjectiveReading, ScenarioSummary, SkillId, TraineeEvaluation, TranscriptEntry } from './types';
import { skills } from './types';

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

/** Evaluator input bound. A live session stops accepting speech beyond it so final grading stays valid. */
export const TRANSCRIPT_LIMIT = { entries: 240, characters: 80_000 };
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

type DebriefReading = { skill: SkillId; label: string; value: number; evidence: Evidence };
export type Takeaway = {
  kind: 'keep' | 'practice';
  labels: string[];
  suggestions: { skill: SkillId; text: string }[];
  evidence: Evidence;
};
export type Debrief = {
  outcome: string;
  takeaways: Takeaway[];
  completed: number;
  total: number;
};
const suggestions: Record<SkillId, string> = {
  credibility: 'Connect your recommendation to the actual problem and be candid about what still needs checking.',
  confidence: 'Offer a clear, bounded next step and explain why you recommend it.',
  listening: 'Check your understanding of the client’s concern, then use their answer in your response.',
  rapport: 'Notice how your approach is landing and make space for the client’s priorities.',
  clarity: 'Use a shorter explanation, with one recommendation and a concrete reason.',
  guidance: 'Make the next decision, its owner, and the follow-up action explicit.',
  adaptability: 'Adjust your proposal to the new constraint while keeping a useful path forward.',
};

function groupTakeaways(kind: Takeaway['kind'], readings: DebriefReading[]): Takeaway[] {
  const groups = new Map<string, Takeaway>();
  for (const reading of readings) {
    let group = groups.get(reading.evidence.entryId);
    if (!group) {
      group = { kind, labels: [], suggestions: [], evidence: reading.evidence };
      groups.set(reading.evidence.entryId, group);
    }
    group.labels.push(reading.label);
    if (kind === 'practice') group.suggestions.push({ skill: reading.skill, text: suggestions[reading.skill] });
  }
  return [...groups.values()];
}

export function buildDebrief(scenario: ScenarioSummary, evaluation: TraineeEvaluation | null): Debrief {
  const readings = skills.flatMap(skill => {
    const reading = evaluation?.skills[skill.id];
    return reading?.value != null && reading.evidence ? [{ skill: skill.id, label: skill.label, value: reading.value, evidence: reading.evidence }] : [];
  });
  const completed = evaluation?.objectives.filter(item => item.achieved).length ?? 0;
  const agreed = scenario.objectives.some(objective => objective.kind === 'outcome' && evaluation?.objectives.find(item => item.id === objective.id)?.achieved);
  return {
    outcome: !evaluation ? 'Feedback was unavailable for this attempt.' : agreed ? 'You earned an agreed next step.' : completed ? 'You made progress; an agreed next step is still open.' : 'No objectives were confirmed in this attempt.',
    takeaways: [
      ...groupTakeaways('keep', evaluation?.concern ? [] : readings.filter(item => item.value >= 2.5).sort((a, b) => b.value - a.value).slice(0, 2)),
      ...groupTakeaways('practice', readings.filter(item => item.value < 2.5).sort((a, b) => a.value - b.value).slice(0, 2)),
    ],
    completed, total: scenario.objectives.length,
  };
}

export type CueDecision = { id: string; probability: number; revision: number };
export type SentCue = { id: string; revision: number; sentAt: number };

/** Scores never modify character stats. A cue needs fresh evidence and a reason to intervene. */
export function canSendCue(candidate: CueDecision, last: SentCue | null, fresh: boolean, now: number): boolean {
  if (candidate.id === 'no_hint' || candidate.probability < .9 || candidate.probability > 1 || !Number.isFinite(candidate.probability)) return false;
  if (!fresh) return false;
  if (last && (now - last.sentAt < 20_000 || candidate.id === last.id)) return false;
  return true;
}
