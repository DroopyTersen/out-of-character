import { expect, test } from 'bun:test';
import { fitRecords, gradeObjectives, type GradeRecord, type MapRecord, type ProducerLogRecord } from './interview-producer';
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

test('records over the row budget shed live grade objectives evenly, then Sol updates oldest first', () => {
  const grade = (index: number, final = false): GradeRecord => ({
    source: 'grade', id: `grade-${index}`, final, revision: index, capturedAt: index, completedAt: index, inputCount: 1, lastInputId: 'p1', outcome: 'graded', durationMs: 1,
    objectives: [{ id: 'a', shown: ['touched', 'p1'], graded: ['touched', 'p1'], levels: [.1, .6, .2, .1] }],
  });
  const map = (index: number): MapRecord => ({
    source: 'map', id: `map-${index}`, reasons: ['the participant spoke'], startedAt: index, completedAt: index, outcome: 'applied', inputCount: 1, lastInputId: 'p1', model: 'sol',
    update: { keep: [], drop: [], participant: { vantage: 'They led the routing work.', preferences: [] }, entities: [], edges: [], threads: [] },
    changes: { added: [], changed: [], dropped: [] }, research: null,
  });
  const size = (items: ProducerLogRecord[]) => new TextEncoder().encode(JSON.stringify(items)).byteLength;
  const graded = (items: ProducerLogRecord[]) => items.flatMap(item => item.source === 'grade' && item.objectives ? [item.id] : []);
  const updated = (items: ProducerLogRecord[]) => items.flatMap(item => item.source === 'map' && item.update ? [item.id] : []);
  const records = [map(1), ...Array.from({ length: 8 }, (_, index) => grade(index + 1)), grade(9, true), map(2)];
  const copy = structuredClone(records);

  expect(fitRecords(records, size(records))).toEqual(records);
  const thinned = fitRecords(records, size(records) - 1);
  expect(graded(thinned)).toEqual(['grade-1', 'grade-3', 'grade-5', 'grade-7', 'grade-9']);
  expect(updated(thinned)).toEqual(['map-1', 'map-2']);
  const bare = fitRecords(records, 0);
  expect(graded(bare)).toEqual(['grade-1', 'grade-9']);
  expect(updated(bare)).toEqual([]);
  expect(bare[1]).toEqual(grade(1));
  const { objectives: _, ...thin } = grade(2);
  expect(bare[2]).toEqual(thin);

  // Room for one update keeps the newest.
  const newest = bare.with(-1, map(2));
  expect(fitRecords(records, size(newest))).toEqual(newest);
  expect(records).toEqual(copy);
});
