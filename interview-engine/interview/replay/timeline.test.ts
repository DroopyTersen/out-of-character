import { expect, test } from 'bun:test';
import type { GradeObjective, GradeRecord, ProducerLogRecord } from '../conversation/records';
import { testSpec } from '../conversation/testSpec';
import * as timeline from './timeline';
import { formatTimelineRows, interviewTurnGaps, parseTimelineExport } from './timeline';

const producerTimeline = (input: Omit<Parameters<typeof timeline.producerTimeline>[0], 'topics'>) => timeline.producerTimeline({ ...input, topics: testSpec.topics });

const startedAt = 1_800_000_000_000;

test('provider-clock gaps include question waits without calling them interviewer failures', () => {
  const passages = [
    { id: 's1', speaker: 'interviewer' as const, text: 'What changed?', startMs: 0, endMs: 1000 },
    { id: 's2', speaker: 'interviewer' as const, text: ' Take your time.', startMs: 1200, endMs: 2000 },
    { id: 'u1', speaker: 'participant' as const, text: 'Let me think.', startMs: 23_000, endMs: 24_000 },
    { id: 'u2', speaker: 'participant' as const, text: 'We updated the guide.', startMs: 34_000, endMs: 35_000 },
    { id: 's3', speaker: 'interviewer' as const, text: 'That helped.', startMs: 35_000, endMs: 36_000 },
    { id: 'u3', speaker: 'participant' as const, text: 'Hello?', startMs: 44_000, endMs: 45_000 },
    { id: 's4', speaker: 'interviewer' as const, text: 'What else?', startMs: 44_800, endMs: 46_000 },
    { id: 'u4', speaker: 'participant' as const, text: 'Nothing else.', startMs: 45_800, endMs: 47_000 },
  ];
  expect(interviewTurnGaps(passages)).toEqual([
    { afterPassageId: 's2', beforePassageId: 'u1', gapMs: 21_000, sam: 'What changed? Take your time.', questionMark: true },
    { afterPassageId: 's3', beforePassageId: 'u3', gapMs: 8000, sam: 'That helped.', questionMark: false },
  ]);
});

test('an older archive parses; records from earlier producer versions are skipped, not misread', () => {
  const old = parseTimelineExport({ started_at: startedAt, transcript_json: JSON.stringify([
    { id: 'u1', speaker: 'participant', text: 'We updated the guide.', startMs: 1000, endMs: 2000 },
  ]), interventions_json: JSON.stringify([
    { source: 'continuity', id: 'old-rescue', participantId: 'u1', afterPassageId: 's1', sentAt: startedAt + 5000, quietMs: 5000, outcome: 'unanswered' },
    { source: 'producer', id: 'old-cue', triggers: [{ kind: 'check-in' }], triggeredAt: startedAt + 6000, outcome: 'sent' },
    { source: 'delegation', id: 'd1', createdAt: startedAt + 7000, target: 'Pat', replied: true },
  ]) });
  expect(old.skipped).toBe(2);
  const rows = producerTimeline(old);
  expect(rows.map(row => [row.lane, row.atMs])).toEqual([['dialogue', 1000], ['delegation', 7000]]);
});

test('gap measurement uses speech times across late fragments and overlapping backchannels', () => {
  expect(interviewTurnGaps([
    { id: 'u1', speaker: 'participant', text: 'We shipped it.', startMs: 0, endMs: 1000 },
    { id: 's1', speaker: 'interviewer', text: 'That helped.', startMs: 1200, endMs: 2000 },
    { id: 'tail', speaker: 'participant', text: ' Last week.', startMs: 1000, endMs: 1100 },
    { id: 'u2', speaker: 'participant', text: 'Hello?', startMs: 14_000, endMs: 15_000 },
  ])).toEqual([{ afterPassageId: 's1', beforePassageId: 'u2', gapMs: 12_000, sam: 'That helped.', questionMark: false }]);
  expect(interviewTurnGaps([
    { id: 'u1', speaker: 'participant', text: 'A long answer.', startMs: 0, endMs: 20_000 },
    { id: 's1', speaker: 'interviewer', text: 'Mm.', startMs: 5000, endMs: 6000 },
    { id: 'u2', speaker: 'participant', text: 'And another point.', startMs: 21_000, endMs: 23_000 },
  ])).toEqual([]);
  expect(interviewTurnGaps([
    { id: 's1', speaker: 'interviewer', text: 'What changed during the handoff?', startMs: 0, endMs: 14_000 },
    { id: 'u1', speaker: 'participant', text: 'Mm.', startMs: 5000, endMs: 6000 },
    { id: 'u2', speaker: 'participant', text: 'The guide.', startMs: 24_000, endMs: 25_000 },
  ])).toEqual([{ afterPassageId: 's1', beforePassageId: 'u2', gapMs: 10_000, sam: 'What changed during the handoff?', questionMark: true }]);
});

const transcript = [
  { id: 's1', speaker: 'interviewer' as const, text: 'What did the team deliver?', startMs: 1000, endMs: 3000 },
  { id: 'u1', speaker: 'participant' as const, text: 'A routing layer on OpenStreetMap.', startMs: 4000, endMs: 9000 },
];
const records: ProducerLogRecord[] = [
  { source: 'map', id: 'm1', reasons: ['the participant spoke'], startedAt: startedAt + 10_000, completedAt: startedAt + 14_100, outcome: 'applied',
    inputCount: 2, lastInputId: 'u1', model: 'gpt-6.1-sol', changes: { added: ['e1', 't1'], changed: [], dropped: [] },
    research: { kind: 'product', name: 'OpenStreetMap', clue: null } },
  { source: 'traits', id: 'x1', mapId: 'm1', threadIds: ['t1'], startedAt: startedAt + 14_100, completedAt: startedAt + 15_000, outcome: 'read', durationMs: 900, traits: { t1: [.8, .3] } },
  { source: 'note', id: 'n1', kind: 'list', text: 'Threads to pull\n- Who used the routing layer first?', mapId: 'm1', sentAt: startedAt + 15_000, outcome: 'sent',
    delivery: { eventId: 'note-1', afterPassageId: 'u1', status: 'accepted' }, nextSamTurnAt: startedAt + 18_000, nextSamTurnAfterId: 'u1' },
  { source: 'research', id: 'r1', mapId: 'm1', request: { kind: 'product', name: 'OpenStreetMap', clue: null }, passageIds: ['u1'], model: 'gpt-6-luna',
    requestedAt: startedAt + 14_100, lookupAt: startedAt + 40_100, completedAt: startedAt + 40_100, loggedAt: startedAt + 45_000, outcome: 'found',
    facts: [{ text: 'OpenStreetMap is an openly licensed world map.', url: 'https://www.openstreetmap.org/about', title: 'About' }], retrievedAt: startedAt + 40_100 },
  { source: 'turn', id: 'j1', passageId: 'u2', mapId: 'm1', startedAt: startedAt + 20_000, completedAt: startedAt + 21_200, outcome: 'read', durationMs: 1200,
    reading: { atMs: 20_000, focus: 't1', novel: .91, natural: { t1: .7 }, states: { t1: 'answered', t2: 'open' } },
    pick: { current: 't1', action: 'tug', lead: 't2', nearby: ['t3'], ranked: [['t2', .9, 'nearby']] } },
  { source: 'map', id: 'm2', reasons: ['a minute has passed since your last call'], startedAt: startedAt + 30_000, completedAt: startedAt + 33_000, outcome: 'invalid',
    inputCount: 4, lastInputId: 'u2', model: 'gpt-6.1-sol', defects: [{ kind: 'dangling', id: 'r2' }] },
];

test('the debug timeline interleaves dialogue and producer work with each step’s latency', () => {
  const rows = producerTimeline({ startedAt, transcript, records });
  expect(rows.map(row => `${row.lane}:${row.atMs}`)).toEqual(['dialogue:1000', 'dialogue:4000', 'map:10000', 'traits:14100', 'research:14100', 'note:15000', 'turn:20000', 'map:30000']);
  expect(rows[2]).toMatchObject({ title: 'Sol map · through u1', outcome: 'applied', latencyMs: 4100, detail: 'the participant spoke · added e1, t1 · research product “OpenStreetMap”' });
  expect(rows[3]).toMatchObject({ detail: 't1 spicy 0.80 grounding 0.30', latencyMs: 900 });
  expect(rows[4]).toMatchObject({ outcome: 'found', latencyMs: 30_900, parts: [{ label: 'lookup', ms: 26_000 }, { label: 'to Sol', ms: 4900 }] });
  expect(rows[5]).toMatchObject({ outcome: 'sent · accepted', latencyMs: 3000, detail: 'Threads to pull / - Who used the routing layer first? · Next observed Sam passage after u1' });
  expect(rows[6]).toMatchObject({ detail: 'focus t1 · novel 0.91 · t1 answered · tug t2 · nearby t3', latencyMs: 1200 });
  expect(rows[7]).toMatchObject({ outcome: 'invalid', detail: 'a minute has passed since your last call · defects dangling r2' });
  const text = formatTimelineRows(rows);
  expect(text).toContain('0:10  map         Sol map · through u1  [applied]  4100 ms');
  expect(text).not.toContain('https://');
});

test('grade rows expose probability drift and separate retained evidence', () => {
  const grade = (id: string, atMs: number, objectives: GradeObjective[] | undefined, extra: Partial<GradeRecord> = {}): GradeRecord => ({
    source: 'grade', id, final: false, revision: 1, capturedAt: startedAt + atMs, completedAt: startedAt + atMs + 900,
    inputCount: 2, lastInputId: 'u1', outcome: 'graded', durationMs: 800, objectives, ...extra,
  });
  const first: GradeObjective = { id: 'project-delivery', shown: ['touched', 'u1'], graded: ['touched', 'u1'], levels: [.1, .7, .2, 0] };
  const rows = producerTimeline({ startedAt, transcript: [], records: [
    grade('g1', 5000, [first]),
    grade('g2', 10_000, [{ ...first, levels: [.1, .5, .4, 0] }]),
    grade('g3', 15_000, [{ ...first, graded: ['not-yet', null], levels: [.4, .6, 0, 0] }]),
    grade('g4', 20_000, undefined, { outcome: 'evaluation_timeout', durationMs: undefined }),
    grade('g5', 30_000, [{ ...first, shown: ['explored', 'u3'], graded: ['explored', 'u3'], levels: [0, .05, .95, 0] }], { final: true, lastInputId: 'u3' }),
  ] });
  expect(rows).toHaveLength(5);
  expect(rows[0]!.detail).toContain('touched on · u1');
  expect(rows[1]!.detail).toContain('t 0.50 e 0.40');
  expect(rows[2]!.detail).toContain('touched on · u1; graded not yet · no evidence');
  expect(rows[3]).toMatchObject({ outcome: 'evaluation_timeout', latencyMs: 900 });
  expect(rows[4]).toMatchObject({ title: 'Grade · final · through u3', outcome: 'graded' });
  expect(rows[4]!.detail).toContain('touched on → explored · u3');
});
