import type { Evidence, ObjectiveReading, ScenarioSummary, SkillId, TraineeEvaluation, TranscriptEntry } from './types';
import { skills } from './types';

export type TranscriptDelta = { speaker: TranscriptEntry['speaker']; text: string; startMs: number; endMs: number };

/** Arrival order preserves overlapping speakers; timestamps describe approximate audio time. */
export function appendTranscript(entries: TranscriptEntry[], delta: TranscriptDelta): TranscriptEntry[] {
  if (!delta.text || !Number.isFinite(delta.startMs) || !Number.isFinite(delta.endMs) || delta.startMs < 0 || delta.endMs < delta.startMs) return entries;
  const last = entries.findLast(entry => entry.speaker === delta.speaker);
  if (last && delta.startMs - last.endMs <= 2000 && last.text.length + delta.text.length <= 1200) {
    return entries.map(entry => entry.id === last.id ? { ...last, text: last.text + delta.text, endMs: Math.max(last.endMs, delta.endMs) } : entry);
  }
  return [...entries, { id: `p${entries.length + 1}`, speaker: delta.speaker, text: delta.text, startMs: delta.startMs, endMs: delta.endMs }];
}

export function findEvidence(entries: TranscriptEntry[], id: string): Evidence | null {
  const entry = entries.find(item => item.id === id);
  return entry ? { entryId: entry.id, speaker: entry.speaker, text: entry.text } : null;
}

/** A speaker change closes the preceding passage; otherwise wait for a quiet gap. */
export function settledTranscript(entries: TranscriptEntry[], quietMs: number): TranscriptEntry[] {
  if (quietMs >= 1200) return entries;
  const latestEnd = Math.max(...entries.map(entry => entry.endMs));
  return entries.filter(entry => entry.endMs < latestEnd);
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

export type Debrief = {
  outcome: string;
  strengths: { skill: SkillId; label: string; value: number; evidence: Evidence }[];
  improvements: { skill: SkillId; label: string; value: number; evidence: Evidence; suggestion: string }[];
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

export function buildDebrief(scenario: ScenarioSummary, evaluation: TraineeEvaluation | null): Debrief {
  const readings = skills.flatMap(skill => {
    const reading = evaluation?.skills[skill.id];
    return reading?.value != null && reading.evidence ? [{ skill: skill.id, label: skill.label, value: reading.value, evidence: reading.evidence }] : [];
  });
  const completed = evaluation?.objectives.filter(item => item.achieved).length ?? 0;
  const agreed = scenario.objectives.some(objective => objective.kind === 'outcome' && evaluation?.objectives.find(item => item.id === objective.id)?.achieved);
  return {
    outcome: !evaluation ? 'Feedback was unavailable for this attempt.' : agreed ? 'You earned an agreed next step.' : completed ? 'You made progress; an agreed next step is still open.' : 'No objectives were confirmed in this attempt.',
    strengths: [...readings].filter(item => item.value >= 2.5).sort((a, b) => b.value - a.value).slice(0, 2),
    improvements: [...readings].filter(item => item.value < 2.5).sort((a, b) => a.value - b.value).slice(0, 2).map(item => ({ ...item, suggestion: suggestions[item.skill] })),
    completed, total: scenario.objectives.length,
  };
}

export type CueDecision = { id: string; probability: number; revision: number };
export type SentCue = { id: string; revision: number; sentAt: number };

/** Scores never modify character stats. A cue needs fresh evidence and a reason to intervene. */
export function canSendCue(candidate: CueDecision, last: SentCue | null, currentRevision: number, now: number): boolean {
  if (candidate.id === 'no_hint' || candidate.probability < .9 || candidate.probability > 1 || !Number.isFinite(candidate.probability)) return false;
  if (candidate.revision !== currentRevision) return false;
  if (last && (now - last.sentAt < 20_000 || candidate.id === last.id)) return false;
  return true;
}
