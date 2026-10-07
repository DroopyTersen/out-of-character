import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import type { InterviewArchiveRow } from '../../../interview-engine/interview/seams.server';
import { spec } from '../../../interviews/project-closeout/spec';
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
  const row = () => sqlite.query('SELECT * FROM interview_attempts WHERE id = ?').get('interview-1') as Record<string, any> | null;
  return { db, row };
}

const host = { model: 'gpt-live', workerId: 'worker-id', workerTag: 'tag' };
const connection = { segments: [{ epoch: 1, offsetMs: 0, startedAt: 1000, endedAt: null, closeReason: null, finalization: 'pending' as const, usageSeconds: null }], pauses: [] };

function archiveRow(state: 'partial' | 'final', capturedAt: number, summary: 'pending' | 'ready' = 'pending', narrative?: InterviewArchiveRow['provenance']['narrative']): InterviewArchiveRow {
  const transcript = [{ id: 'p1', speaker: 'trainee' as const, text: 'Jen helped us fix the access issue.', startMs: 100, endMs: 900 }];
  return {
    id: 'interview-1', specId: spec.id, specVersion: spec.version, voiceId: 'sam-cedar', state, capturedAt,
    snapshot: {
      id: 'interview-1', scenarioId: spec.id, clientId: 'sam-cedar', status: state === 'final' ? 'ended' : 'live', startedAt: 1000,
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
