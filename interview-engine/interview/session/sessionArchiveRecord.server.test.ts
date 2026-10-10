import { expect, test } from 'bun:test';
import type { InterviewSnapshot } from '../../shared/snapshot';
import { resolveInterview } from '../definition.server';
import { captureArchiveRecord } from './sessionArchiveRecord.server';

function fixture(): Parameters<typeof captureArchiveRecord>[0] {
  const spec = resolveInterview({
    id: 'closeout', version: 'v1', title: 'Recent project', goals: 'Learn what was built.',
    topics: [{ id: 'scope', label: 'Scope', learn: 'Names what was built.' }],
  }, { interviewer: { name: 'Riley', persona: 'Curious.', voices: [{ id: 'riley', voice: 'cedar', label: 'Cedar', presentation: 'Male', image: '/riley.png' }] } });
  const snapshot: InterviewSnapshot = {
    id: 'attempt', planId: spec.id, voiceId: 'riley', status: 'live', startedAt: 1000, limitSeconds: 3600,
    usageSeconds: null, warning: null, pause: null,
    transcript: [{ id: 'p1', speaker: 'participant', text: 'We built a claims portal.', startMs: 0, endMs: 1000 }],
    evaluation: null, feedbackStatus: 'waiting', background: [], message: null, revision: 1, finalization: 'pending',
  };
  return {
    spec, snapshot, state: 'partial', capturedAt: 10_000,
    producerLog: [
      { source: 'delegation', id: 'd1', createdAt: 2000, target: 'client', replied: true },
      { source: 'grade', id: 'g1', final: true, revision: 1, capturedAt: 5000, completedAt: 6000, inputCount: 1, lastInputId: 'p1', outcome: 'graded' },
    ],
    producer: { model: 'model', effort: 'none', version: 'producer', mapPrompt: 'map', rankingRubric: 'rank', maps: 1, applied: 1, turns: 1, notes: 0, research: 0, latency: { sol: { count: 1, p50: 25, p90: 25 }, jevTurn: null, lookup: null, noteToSam: null } },
    segments: [{ epoch: 1, providerId: 'private-provider', offsetMs: 0, startedAt: 1000, endedAt: null, closeReason: null, finalization: 'pending', usageSeconds: 12, typedErrors: [{ id: 'typed-one', at: 7000 }] }],
    pauses: [
      { epoch: 1, reason: 'browser', pausedAt: 2000, resumedAt: 3000, endedAt: null },
      { epoch: 2, reason: 'provider', pausedAt: 4000, resumedAt: null, endedAt: 6000 },
      { epoch: 3, reason: 'restart', pausedAt: 7000, resumedAt: null, endedAt: null },
    ],
  };
}

test('capture isolates transcript, diagnostics and provenance before asynchronous hashing', async () => {
  const input = fixture();
  const pending = captureArchiveRecord(input);
  input.snapshot.transcript[0]!.text = 'A later correction.';
  input.snapshot.revision = 2;
  input.segments[0]!.typedErrors![0]!.at = 99_000;
  input.producer!.latency.sol!.p50 = 999;
  input.producerLog[0]!.id = 'changed';
  input.pauses[2]!.resumedAt = 99_000;
  const row = await pending;
  expect(row.transcript[0]!.text).toBe('We built a claims portal.');
  expect(row.snapshot.revision).toBe(1);
  expect(row.producerLog.map(record => [record.source, record.id])).toEqual([['delegation', 'd1'], ['grade', 'g1']]);
  expect(row.provenance.producer!.latency.sol!.p50).toBe(25);
  expect(row.provenance.connection.segments[0]!.typedErrors).toEqual([{ id: 'typed-one', at: 7000 }]);
  expect(row.provenance.connection.pauses.map(pause => pause.durationMs)).toEqual([1000, 2000, 3000]);
  expect(row.provenance.connection.pauses[2]!.resumedAt).toBeNull();
  expect(row.provenance.connection.segments[0]).not.toHaveProperty('providerId');
  expect(row.provenance.connection.segments[0]!.usageSeconds).toBe(12);
  expect(row.transcript).toEqual(row.snapshot.transcript);
  expect(row.capturedAt).toBe(10_000);
});

test('prompt fingerprints are stable across captures and change with the accepted instructions', async () => {
  const input = fixture();
  const first = await captureArchiveRecord(input);
  input.state = 'final';
  input.snapshot.status = 'ended';
  const last = await captureArchiveRecord(input);
  expect(last.state).toBe('final');
  expect(last.snapshot.status).toBe('ended');
  expect(last.provenance.actorDigest).toMatch(/^[0-9a-f]{12}$/);
  expect(last.provenance.actorDigest).toBe(first.provenance.actorDigest);
  expect(last.provenance.openingDigest).toBe(first.provenance.openingDigest);
  input.spec.interviewer.persona = 'Keep each question short and direct.';
  const changed = await captureArchiveRecord(input);
  expect(changed.provenance.actorDigest).not.toBe(first.provenance.actorDigest);
});

test('overlapping captures preserve each revision without sharing live or returned records', async () => {
  const input = fixture();
  const pending = Array.from({ length: 40 }, (_, index) => {
    input.snapshot.transcript[0]!.text = `Observation ${index}`;
    input.snapshot.revision = index;
    input.capturedAt = 10_000 + index;
    return captureArchiveRecord(input);
  });
  const rows = await Promise.all(pending);
  for (const [index, row] of rows.entries()) {
    expect(row.transcript[0]!.text).toBe(`Observation ${index}`);
    expect(row.snapshot.revision).toBe(index);
    expect(row.capturedAt).toBe(10_000 + index);
    expect(row.provenance.connection.pauses[2]!.durationMs).toBe(3000 + index);
  }
  rows[0]!.transcript[0]!.text = 'Changed saved copy.';
  expect(rows[1]!.transcript[0]!.text).toBe('Observation 1');
  expect(input.snapshot.transcript[0]!.text).toBe('Observation 39');
});
