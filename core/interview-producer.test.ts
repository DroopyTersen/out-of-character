import { expect, test } from 'bun:test';
import { gradeObjectives } from './interview-producer';
import { interviewTopics, type CoverageLevel, type InterviewObjectiveReading } from './interview';

const reading = (id: string, level: CoverageLevel, entryId: string | null, levels: Partial<Record<CoverageLevel, number>> | null = null): InterviewObjectiveReading => ({
  id, level, achieved: level === 'explored', probability: levels?.explored ?? null,
  levels: levels ? { 'not-yet': 0, touched: 0, explored: 0, 'set-aside': 0, ...levels } : null,
  evidence: entryId ? { entryId, speaker: 'trainee', text: `Private passage ${entryId}.` } : null,
});

test('grade diagnostics distinguish a retained judgment from the new grade and preserve its odds without passage text', () => {
  const objectives = gradeObjectives([reading('a', 'not-yet', null, { 'not-yet': .4444, touched: .5556 })], [reading('a', 'touched', 'p2')]);
  expect(objectives).toEqual([{ id: 'a', shown: ['touched', 'p2'], graded: ['not-yet', null], levels: [.44, .56, 0, 0] }]);
  expect(JSON.stringify(objectives)).not.toContain('Private passage');
  expect(gradeObjectives([reading('a', 'explored', 'p4')], [])).toEqual([
    { id: 'a', shown: ['not-yet', null], graded: ['explored', 'p4'], levels: null },
  ]);
});

test('a full hour of compact grades leaves room for dialogue and producer records inside the D1 row limit', () => {
  const shown = interviewTopics.flatMap(topic => topic.objectives.map(item => reading(item.id, 'set-aside', 'p799')));
  const graded = shown.map(item => reading(item.id, 'explored', 'p800', { 'not-yet': .12, touched: .23, explored: .34, 'set-aside': .31 }));
  const records = Array.from({ length: 720 }, (_, index) => ({
    source: 'grade', id: `grade-${index + 1}`, final: index === 719, revision: 10_000, capturedAt: 1_800_000_000_000,
    completedAt: 1_800_000_003_000, inputCount: 800, lastInputId: 'p800', outcome: 'graded', durationMs: 3000,
    objectives: gradeObjectives(graded, shown),
  }));
  // Leave 600 KB for the bounded transcript, summary, producer and provenance fields.
  expect(new TextEncoder().encode(JSON.stringify(records)).byteLength).toBeLessThan(1_400_000);
});
