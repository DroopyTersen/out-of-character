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
function archiveRow(state: 'partial' | 'final', capturedAt: number, summary: 'pending' | 'ready' = 'pending', narrative?: InterviewArchiveRow['provenance']['narrative'], under: RowSpec = closeoutRow): InterviewArchiveRow {
  const transcript = [{ id: 'p1', speaker: 'trainee' as const, text: 'Jen helped us fix the access issue.', startMs: 100, endMs: 900 }];
  return {
    id: under.attemptId, specId: under.id, specVersion: under.version, voiceId: under.voiceId, state, capturedAt,
    snapshot: {
      id: under.attemptId, scenarioId: under.id, clientId: under.voiceId, status: state === 'final' ? 'ended' : 'live', startedAt: 1000,
      limitSeconds: 3600, warning: null, revision: 1, transcript, evaluation: null, coaching: null, feedbackStatus: 'current',
      message: null, finalization: state === 'final' ? 'confirmed' : 'pending', usageSeconds: null,
      interview: { evaluation: null, summary: { status: summary, text: summary === 'ready' ? 'Summary.' : null }, background: [] },
    },
    transcript: [{ id: 'p1', speaker: 'participant', text: 'Jen helped us fix the access issue.', startMs: 100, endMs: 900 }],
    producerLog: [],
    provenance: { voice: 'cedar', rubricVersion: 'interview-r1', actorDigest: 'actor-digest', openingDigest: 'opening-digest', producer: null, connection, ...(narrative ? { narrative } : {}) },
  } as InterviewArchiveRow;
}

test('provenance keeps the practice simulator key order, with the host fields filled in', () => {
  const narrative = { model: 'agent', version: 'interview-summary-v1', attempts: [] };
  const value = archiveProvenance(archiveRow('final', 3000, 'ready', narrative), host);
  expect(Object.keys(value)).toEqual(['model', 'voice', 'rubricVersion', 'simulatorVersion', 'actorDigest', 'openingDigest', 'workerId', 'workerTag', 'contextualDirector', 'connection', 'interviewSummary']);
  expect(value).toMatchObject({ model: 'gpt-live', simulatorVersion: 'simulator-v1', workerId: 'worker-id', interviewSummary: narrative, connection });
  expect('interviewSummary' in archiveProvenance(archiveRow('partial', 2000), host)).toBe(false);
});

test('rows land in interview_attempts with the archive upsert rules', async () => {
  const f = fixture();
  const archive = d1Archive(f.db, host);
  await archive.write(archiveRow('partial', 2000));
  expect(f.row()).toMatchObject({ archive_state: 'partial', spec_id: spec.id, spec_version: spec.version, summary_status: 'pending', interviewer_id: 'sam-cedar' });
  expect(JSON.parse(f.row()!.transcript_json)[0].speaker).toBe('trainee');
  await archive.write(archiveRow('final', 3000, 'ready'));
  await archive.write(archiveRow('partial', 4000));
  await archive.write(archiveRow('final', 5000, 'pending'));
  expect(f.row()).toMatchObject({ archive_state: 'final', updated_at: 3000, ended_at: 3000, summary_status: 'ready', summary_text: 'Summary.' });
  expect(JSON.parse(f.row()!.provenance_json).model).toBe('gpt-live');
});

test('each row carries its own spec identity, so attempts under different specs archive side by side', async () => {
  const f = fixture();
  const archive = d1Archive(f.db, host);
  const salesRow: RowSpec = { id: sales.id, version: sales.version, voiceId: 'sam-meridian', attemptId: 'interview-2' };
  await archive.write(archiveRow('partial', 2000));
  await archive.write(archiveRow('final', 3000, 'ready', undefined, salesRow));
  expect(f.row('interview-1')).toMatchObject({ scenario_id: spec.id, spec_id: spec.id, spec_version: spec.version, interviewer_id: 'sam-cedar' });
  expect(f.row('interview-2')).toMatchObject({ scenario_id: sales.id, spec_id: sales.id, spec_version: sales.version, interviewer_id: 'sam-meridian', archive_state: 'final' });
  // An ad hoc debrief's approved version is stored as written, not as any template's.
  await archive.write(archiveRow('final', 4000, 'ready', undefined, { id: 'quarterly-vendor-review', version: 'quarterly-vendor-review-3f9a1c2b', voiceId: 'sam-cedar', attemptId: 'interview-3' }));
  expect(f.row('interview-3')).toMatchObject({ spec_id: 'quarterly-vendor-review', spec_version: 'quarterly-vendor-review-3f9a1c2b' });
});
