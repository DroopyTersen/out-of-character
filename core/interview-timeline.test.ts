import { expect, test } from 'bun:test';
import { formatTimelineRows, producerTimeline } from './interview-timeline';
import type { ProducerLogRecord } from './interview-producer';

const startedAt = 1_800_000_000_000;
const transcript = [
  { id: 's1', speaker: 'client' as const, text: 'What did the team deliver?', startMs: 1000, endMs: 3000 },
  { id: 'u1', speaker: 'trainee' as const, text: 'A routing layer on OpenStreetMap.', startMs: 4000, endMs: 9000 },
];
const records: ProducerLogRecord[] = [
  { source: 'assessment', id: 'a1', snapshotAt: startedAt + 10_000, completedAt: startedAt + 12_400, model: 'jev-1.13.0', inputCount: 2, lastInputId: 'u1',
    signals: [{ condition: 'missed-thread', probability: .7 }, { condition: 'leading', probability: .1 }, { condition: 'objective:project-role', selected: true }], researchProbability: .8, outcome: 'observed', concerns: [] },
  { source: 'producer', id: 'c1', triggers: [{ kind: 'check-in' }, { kind: 'signal', condition: 'missed-thread', probability: .7 }], queued: false, model: 'gpt-6-sol', effort: 'none',
    inputCount: 2, lastInputId: 'u1', triggeredAt: startedAt + 12_500, startedAt: startedAt + 12_500, generatedAt: startedAt + 14_100, checkedAt: startedAt + 14_900,
    sentAt: startedAt + 15_000, nextSamTurnAt: startedAt + 18_000, completedAt: startedAt + 15_000, outcome: 'sent',
    result: { cue: 'Ask who used the routing layer first.', evidenceIds: ['u1'], research: { kind: 'product', name: 'OpenStreetMap', clue: null, passageIds: ['u1'] } },
    check: { probability: .81, inputCount: 2, lastInputId: 'u1' } },
  { source: 'research', id: 'r1', consultationId: 'c1', request: { kind: 'product', name: 'OpenStreetMap', clue: null, passageIds: ['u1'] }, model: 'gpt-6-luna',
    requestedAt: startedAt + 14_100, lookupAt: startedAt + 40_100, checkedAt: startedAt + 41_000, completedAt: startedAt + 41_000, outcome: 'withheld', reason: 'The conversation moved on.',
    facts: [{ text: 'OpenStreetMap is an openly licensed world map.', url: 'https://www.openstreetmap.org/about', title: 'About' }], check: { probability: .3, inputCount: 4, lastInputId: 'u2' } },
  { source: 'rundown', id: 'd1', sentAt: startedAt + 20_000, reason: 'change', elapsedMinutes: 0, levels: { 'project-delivery': 'explored', 'project-role': 'touched' }, outcome: 'sent',
    delivery: { eventId: 'e1', afterPassageId: 'u1', status: 'accepted' } },
];

test('the debug timeline interleaves dialogue and producer work with each step’s latency', () => {
  const rows = producerTimeline({ startedAt, transcript, records });
  expect(rows.map(row => `${row.lane}:${row.atMs}`)).toEqual(['dialogue:1000', 'dialogue:4000', 'assessment:10000', 'producer:12500', 'research:14100', 'rundown:20000']);
  expect(rows[2]).toMatchObject({ detail: 'missed-thread 0.70, research 0.80', latencyMs: 2400, outcome: 'observed' });
  expect(rows[3]).toMatchObject({
    title: 'Sol · check-in, missed-thread 0.70', outcome: 'sent · check 0.81', latencyMs: 2500,
    detail: '“Ask who used the routing layer first.” (u1) · Research product “OpenStreetMap”',
    parts: [{ label: 'wait', ms: 0 }, { label: 'Sol', ms: 1600 }, { label: 'check', ms: 800 }, { label: 'to Sam', ms: 3000 }],
  });
  expect(rows[4]).toMatchObject({ outcome: 'withheld · check 0.30', latencyMs: 26_900, parts: [{ label: 'lookup', ms: 26_000 }, { label: 'check', ms: 900 }] });
  expect(rows[4]!.detail).toContain('The conversation moved on.');
  expect(rows[5]).toMatchObject({ detail: 'Touched on: Your role · Explored: Deliverables & scope', outcome: 'sent · accepted' });
  const text = formatTimelineRows(rows);
  expect(text).toContain('0:12  producer    Sol · check-in, missed-thread 0.70  [sent · check 0.81]  2500 ms');
  expect(text).not.toContain('https://');
});
