import { expect, test } from 'bun:test';
import type { CoverageLevel, InterviewObjectiveReading } from '../../shared/snapshot';
import { coverageConfidence, emptyReadings, mergeCoverage } from './coverage';

const reading = (id: string, level: CoverageLevel, levels: Partial<Record<CoverageLevel, number>> | null, entryId: string | null = 'p2'): InterviewObjectiveReading => ({
  id, level, achieved: level === 'explored', probability: levels?.explored ?? null,
  levels: levels ? { 'not-yet': 0, touched: 0, explored: 0, 'set-aside': 0, ...levels } : null,
  evidence: entryId ? { entryId, speaker: 'participant', text: `Passage ${entryId}.` } : null,
});

test('live coverage holds an earlier band while the new reading still gives it even odds', () => {
  const previous = [reading('a', 'touched', { touched: .9 }), reading('b', 'explored', { explored: .9 }), reading('c', 'touched', { touched: .9 }), reading('d', 'not-yet', null, null)];
  const merged = mergeCoverage(previous, [
    reading('a', 'not-yet', { 'not-yet': .45, touched: .55 }, null), reading('b', 'touched', { touched: .4, explored: .6 }, 'p4'),
    reading('c', 'not-yet', { 'not-yet': .6, touched: .4 }, null), reading('d', 'set-aside', { 'set-aside': .9 }, 'p6'),
  ]);
  expect(merged.map(item => [item.id, item.level, item.achieved, item.evidence?.entryId ?? null])).toEqual([
    ['a', 'touched', false, 'p2'], ['b', 'explored', true, 'p2'], ['c', 'not-yet', false, null], ['d', 'set-aside', false, 'p6'],
  ]);
  expect(merged[0]!.levels).toMatchObject({ touched: .55 });
  expect(mergeCoverage([reading('a', 'explored', { explored: .9 })], [reading('a', 'set-aside', { 'set-aside': .9 }, 'p8')])[0]).toMatchObject({ level: 'set-aside', evidence: { entryId: 'p8' } });
});

test('touched coverage holds while the topic still came up, even as mass moves toward explored', () => {
  const previous = [reading('a', 'touched', { touched: .9 }, 'p2'), reading('b', 'explored', { explored: .9 }, 'p2')];
  const [held, demoted] = mergeCoverage(previous, [
    reading('a', 'not-yet', { 'not-yet': .1, touched: .3, explored: .6 }, null),
    reading('b', 'touched', { 'not-yet': .1, touched: .5, explored: .4 }, 'p4'),
  ]);
  expect(held).toMatchObject({ level: 'touched', achieved: false, evidence: { entryId: 'p2' } });
  // Only a touched prior uses P(raised); an explored prior still needs even odds for explored itself.
  expect(demoted).toMatchObject({ level: 'touched', achieved: false, evidence: { entryId: 'p4' } });
});

test('a declined topic stays closed through later uncertainty, until a supported answer reopens it', () => {
  const prior = [reading('a', 'set-aside', { 'set-aside': .9 }, 'p6')];
  expect(mergeCoverage(prior, [reading('a', 'touched', { touched: .4, 'set-aside': .6 }, 'p8')])[0]).toMatchObject({ level: 'set-aside', achieved: false, evidence: { entryId: 'p6' } });
  expect(mergeCoverage(prior, [reading('a', 'touched', { touched: .6, 'set-aside': .4 }, 'p8')])[0]).toMatchObject({ level: 'set-aside', evidence: { entryId: 'p6' } });
  expect(mergeCoverage(prior, [reading('a', 'not-yet', null, null)])[0]).toEqual(prior[0]);
  expect(mergeCoverage(prior, [reading('a', 'touched', { touched: .99, 'set-aside': .01 }, 'p8')])[0]?.levels?.['set-aside']).toBe(.9);
  expect(mergeCoverage(prior, [reading('a', 'explored', { explored: .9 }, 'p8')])[0]).toMatchObject({ level: 'explored', evidence: { entryId: 'p8' } });
  expect(mergeCoverage([reading('a', 'touched', { touched: .9 })], [reading('a', 'set-aside', { 'set-aside': .9 }, 'p8')])[0]).toMatchObject({ level: 'set-aside', evidence: { entryId: 'p8' } });
});

test('confidence describes exploration, setting aside, or whether a provisional topic came up', () => {
  expect(coverageConfidence(reading('project-role', 'explored', { explored: .91, touched: .07, 'not-yet': .02 }))).toBe(.91);
  expect(coverageConfidence(reading('project-role', 'touched', { explored: .7, touched: .2, 'not-yet': .1 }))).toBeCloseTo(.9);
  expect(coverageConfidence(reading('project-role', 'set-aside', { 'set-aside': .88, 'not-yet': .12 }))).toBe(.88);
  expect(coverageConfidence(reading('project-role', 'not-yet', { 'not-yet': .96 }, null))).toBeNull();
  expect(coverageConfidence(reading('project-role', 'touched', null))).toBeNull();
  expect(coverageConfidence(undefined)).toBeNull();
});

test('empty readings name every reading of the spec, unread', () => {
  expect(emptyReadings([{ id: 'engagement', label: 'Engagement', description: 'd' }, { id: 'specificity', label: 'Specificity', description: 'd' }]))
    .toEqual({ engagement: { value: null, distribution: null, evidence: null }, specificity: { value: null, distribution: null, evidence: null } });
});
