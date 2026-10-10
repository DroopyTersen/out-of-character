import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import type { InterviewArchiveRow } from '../../../interview-engine/interview/seams.server';
import { spec } from '../../../interviews/project-closeout/spec';
import { spec as sales } from '../../../interviews/sales-win-loss/spec';
import { archiveProvenance, d1Archive } from './archiveD1.server';

const migrations = await Promise.all(['0001_simulator_attempts', '0002_interview_attempts', '0003_interview_interventions', '0004_interview_attempts_spec']
  .map(name => Bun.file(new URL(`../../../migrations/${name}.sql`, import.meta.url)).text()));

function fixture() {
  const sqlite = new Database(':memory:');
  for (const sql of migrations) sqlite.exec(sql);
  const db = {
    prepare: (sql: string) => ({ bind: (...values: (string | number | null)[]) => ({
      run: async () => { sqlite.prepare(sql).run(...values); return { success: true }; },
    }) }),
  } as unknown as D1Database;
  const row = (id = 'interview-1') => sqlite.query('SELECT * FROM interview_attempts WHERE id = ?').get(id) as Record<string, any> | null;
  return { db, row };
}

const host = { model: 'gpt-live', workerId: 'worker-id', workerTag: 'tag' };
const connection = { segments: [{ epoch: 1, offsetMs: 0, startedAt: 1000, endedAt: null, closeReason: null, finalization: 'pending' as const, usageSeconds: null }], pauses: [] };

type RowSpec = { id: string; version: string; voiceId: string; attemptId: string };
const closeoutRow: RowSpec = { id: spec.id, version: spec.version, voiceId: 'sam-cedar', attemptId: 'interview-1' };
function archiveRow(state: 'partial' | 'final', capturedAt: number, under: RowSpec = closeoutRow): InterviewArchiveRow {
  const transcript = [{ id: 'p1', speaker: 'participant' as const, text: 'Jen helped us fix the access issue.', startMs: 100, endMs: 900 }];
  return {
    id: under.attemptId, specId: under.id, specVersion: under.version, voiceId: under.voiceId, state, capturedAt,
    snapshot: {
      id: under.attemptId, planId: under.id, voiceId: under.voiceId, status: state === 'final' ? 'ended' : 'live', startedAt: 1000,
      limitSeconds: 3600, warning: null, revision: 1, transcript, evaluation: null, pause: null, background: [], feedbackStatus: 'current',
      message: null, finalization: state === 'final' ? 'confirmed' : 'pending', usageSeconds: null,
    },
    transcript: [{ id: 'p1', speaker: 'participant', text: 'Jen helped us fix the access issue.', startMs: 100, endMs: 900 }],
    producerLog: [],
    provenance: { voice: 'cedar', rubricVersion: 'interview-r1', actorDigest: 'actor-digest', openingDigest: 'opening-digest', producer: null, connection },
  } as InterviewArchiveRow;
}

test('engine provenance contains interview evidence and host identity, without report state', () => {
  const value = archiveProvenance(archiveRow('final', 3000), host);
  expect(value).toMatchObject({ model: 'gpt-live', simulatorVersion: 'simulator-v1', workerId: 'worker-id', connection });
  expect(value).not.toHaveProperty('interviewSummary');
});

test('rows land in interview_attempts with the archive upsert rules', async () => {
  const f = fixture();
  const archive = d1Archive(f.db, host);
  await archive.write(archiveRow('partial', 2000));
  expect(f.row()).toMatchObject({ archive_state: 'partial', spec_id: spec.id, spec_version: spec.version, summary_status: 'pending', interviewer_id: 'sam-cedar' });
  expect(JSON.parse(f.row()!.transcript_json)[0].speaker).toBe('participant');
  await archive.write(archiveRow('final', 3000));
  await archive.writeReport('interview-1', { status: 'ready', text: 'Summary.' }, { model: 'agent', version: 'report-v1', attempts: [] });
  await archive.write(archiveRow('partial', 4000));
  await archive.write(archiveRow('final', 5000));
  expect(f.row()).toMatchObject({ archive_state: 'final', updated_at: 5000, ended_at: 3000, summary_status: 'ready', summary_text: 'Summary.' });
  expect(JSON.parse(f.row()!.provenance_json).model).toBe('gpt-live');
});

test('an unanswered partial remains pending, and a later answer stays eligible for a report', async () => {
  const f = fixture();
  const archive = d1Archive(f.db, host);
  const partial = archiveRow('partial', 2000);
  partial.transcript = [{ id: 'greeting', speaker: 'interviewer', text: 'Tell me about the project.', startMs: 0, endMs: 500 }];
  partial.snapshot.transcript = partial.transcript;
  await archive.write(partial);
  expect(f.row()).toMatchObject({ archive_state: 'partial', summary_status: 'pending' });
  await archive.write(archiveRow('partial', 2500));
  expect(f.row()).toMatchObject({ archive_state: 'partial', summary_status: 'pending' });
  await archive.write(archiveRow('final', 3000));
  expect(f.row()).toMatchObject({ archive_state: 'final', summary_status: 'pending' });
});

test('an unanswered final interview has no report available', async () => {
  const f = fixture();
  const archive = d1Archive(f.db, host);
  const final = archiveRow('final', 3000);
  final.transcript = [];
  final.snapshot.transcript = [];
  await archive.write(final);
  expect(f.row()).toMatchObject({ archive_state: 'final', summary_status: 'unavailable', summary_text: null });
});

test('a recovered narrative retains the failed attempt and successful token usage in D1', async () => {
  const f = fixture();
  const archive = d1Archive(f.db, host);
  await archive.write(archiveRow('final', 5000));
  await archive.writeReport('interview-1', { status: 'ready', text: 'Summary.' }, {
    model: 'agent', version: 'summary-v2', attempts: [
      { startedAt: 3000, endedAt: 3500, failure: 'timeout', usage: null },
      { startedAt: 3600, endedAt: 4900, failure: null, usage: { inputTokens: 120, outputTokens: 45, reasoningTokens: 20, cachedTokens: 80 } },
    ],
  });
  // A later owner can retry the interview archive without regressing report text or provenance.
  await d1Archive(f.db, host).write(archiveRow('final', 6000));
  expect(f.row()).toMatchObject({ summary_status: 'ready', summary_text: 'Summary.', updated_at: 6000 });
  const stored = JSON.parse(f.row()!.provenance_json).interviewSummary;
  expect(stored.model).toBe('agent');
  expect(stored.version).toBe('summary-v2');
  expect(stored.attempts).toEqual([
    { startedAt: 3000, endedAt: 3500, failure: 'timeout', usage: null },
    { startedAt: 3600, endedAt: 4900, failure: null, usage: { inputTokens: 120, outputTokens: 45, reasoningTokens: 20, cachedTokens: 80 } },
  ]);
});

test('archive retries retain explicit null provenance alongside the saved report provenance', async () => {
  const f = fixture();
  const archive = d1Archive(f.db, { ...host, workerId: null, workerTag: null });
  await archive.write(archiveRow('final', 3000));
  await archive.writeReport('interview-1', { status: 'ready', text: 'Summary.' }, { model: 'agent', version: 'report-v1', attempts: [] });
  await archive.write(archiveRow('final', 4000));
  const provenance = JSON.parse(f.row()!.provenance_json);
  expect(provenance).toHaveProperty('workerId', null);
  expect(provenance).toHaveProperty('workerTag', null);
  expect(provenance).toHaveProperty('contextualDirector', null);
  expect(provenance.interviewSummary).toEqual({ model: 'agent', version: 'report-v1', attempts: [] });
});

test('each row carries its own spec identity, so attempts under different specs archive side by side', async () => {
  const f = fixture();
  const archive = d1Archive(f.db, host);
  const salesRow: RowSpec = { id: sales.id, version: sales.version, voiceId: 'sam-meridian', attemptId: 'interview-2' };
  await archive.write(archiveRow('partial', 2000));
  await archive.write(archiveRow('final', 3000, salesRow));
  expect(f.row('interview-1')).toMatchObject({ scenario_id: spec.id, spec_id: spec.id, spec_version: spec.version, interviewer_id: 'sam-cedar' });
  expect(f.row('interview-2')).toMatchObject({ scenario_id: sales.id, spec_id: sales.id, spec_version: sales.version, interviewer_id: 'sam-meridian', archive_state: 'final' });
  // An ad hoc debrief's approved version is stored as written, not as any template's.
  await archive.write(archiveRow('final', 4000, { id: 'quarterly-vendor-review', version: 'quarterly-vendor-review-3f9a1c2b', voiceId: 'sam-cedar', attemptId: 'interview-3' }));
  expect(f.row('interview-3')).toMatchObject({ spec_id: 'quarterly-vendor-review', spec_version: 'quarterly-vendor-review-3f9a1c2b' });
});
