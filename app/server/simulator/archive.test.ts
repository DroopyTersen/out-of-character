import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { emptySkills, type SessionSnapshot } from '../../../core/simulator/types';
import { writeArchive, type ArchiveProvenance, type ArchiveWrite } from './archive.server';

const migration = await Bun.file(new URL('../../../migrations/0001_simulator_attempts.sql', import.meta.url)).text();
const interventionsMigration = await Bun.file(new URL('../../../migrations/0002_simulator_interventions.sql', import.meta.url)).text();

function fixture(migrated = true) {
  const sqlite = new Database(':memory:');
  sqlite.exec(migration);
  if (migrated) sqlite.exec(interventionsMigration);
  // Only the D1 prepare/bind/run boundary is adapted; migration and writes run in SQLite.
  const d1 = {
    prepare: (sql: string) => ({
      bind: (...args: (string | number | null)[]) => ({
        run: async () => { sqlite.prepare(sql).run(...args); return { success: true }; },
      }),
    }),
  } as unknown as D1Database;
  const row = (id = snapshot.id) => sqlite.prepare('SELECT * FROM simulator_attempts WHERE id = ?').get(id) as Record<string, any> | null;
  return { sqlite, d1, row };
}

const snapshot: SessionSnapshot = {
  id: 'attempt-1', scenarioId: 'sharepoint', clientId: 'morgan', status: 'live',
  startedAt: 1000, limitSeconds: 3600, warning: null, revision: 1,
  transcript: [{ id: 'p1', speaker: 'trainee', text: 'Can we start with your main concern?', startMs: 100, endMs: 2000 }],
  evaluation: null, coaching: null, feedbackStatus: 'waiting', message: null, finalization: 'pending', usageSeconds: null,
};
const provenance: ArchiveProvenance = {
  model: 'gpt-live', voice: 'cedar', rubricVersion: 'r1', simulatorVersion: 's1',
  actorDigest: 'actor-digest', openingDigest: 'opening-digest', workerId: 'worker-id',
  workerTag: 'release-tag', contextualDirector: { model: 'gpt-6-sol', effort: 'none', version: 'contextual-director-v1', observations: 0, staleGates: 0, skipped: 0, calls: 0, rechecks: 0, notes: 0 },
};
const partial = (capturedAt: number, changes: Partial<SessionSnapshot> = {}): ArchiveWrite => ({
  state: 'partial', capturedAt, snapshot: { ...snapshot, ...changes }, provenance,
  interventions: [],
});
const final = (capturedAt: number, changes: Partial<SessionSnapshot> = {}): ArchiveWrite => ({
  ...partial(capturedAt, { status: 'ended', finalization: 'confirmed', feedbackStatus: 'current', ...changes }),
  state: 'final',
});

test('migration and partial upsert keep the newest checkpoint', async () => {
  const f = fixture();
  try {
    await writeArchive(f.d1, partial(3000, { message: 'newer' }));
    await writeArchive(f.d1, partial(2000, { message: 'older' }));
    expect(f.row()).toMatchObject({
      scenario_id: 'sharepoint', client_id: 'morgan', started_at: 1000,
      archive_state: 'partial', session_status: 'live', updated_at: 3000, ended_at: null,
      feedback_status: 'waiting', message: 'newer',
    });
    await writeArchive(f.d1, partial(3000, { message: 'same time' }));
    expect(f.row()?.message).toBe('same time');
  } finally { f.sqlite.close(); }
});

test('a final snapshot supersedes partial and rejects delayed partials; repeat final is idempotent', async () => {
  const f = fixture();
  try {
    await writeArchive(f.d1, partial(3000));
    const completed = final(4000, {
      usageSeconds: 52,
      transcript: [...snapshot.transcript, { id: 'p2', speaker: 'client', text: 'Agreed.', startMs: 2100, endMs: 2800 }],
      evaluation: { revision: 2, skills: emptySkills(), objectives: [], concern: null, model: 'judge', durationMs: 40 },
    });
    await writeArchive(f.d1, completed);
    const first = f.row();
    await writeArchive(f.d1, partial(5000, { message: 'late checkpoint' }));
    expect(f.row()).toEqual(first);
    await writeArchive(f.d1, completed);
    expect(f.row()).toEqual(first);
    expect(f.row()).toMatchObject({ archive_state: 'final', ended_at: 4000, feedback_status: 'current', usage_seconds: 52 });
    expect(JSON.parse(f.row()!.transcript_json)).toHaveLength(2);
    expect(JSON.parse(f.row()!.evaluation_json).revision).toBe(2);
  } finally { f.sqlite.close(); }
});

test('bound arbitrary transcript text is stored literally', async () => {
  const f = fixture();
  try {
    const text = "'; DELETE FROM simulator_attempts; --";
    await writeArchive(f.d1, final(4000, {
      transcript: [{ ...snapshot.transcript[0]!, text }],
    }));
    const row = f.row()!;
    expect(JSON.parse(row.transcript_json)[0].text).toBe(text);
    expect(f.sqlite.query('SELECT count(*) AS count FROM simulator_attempts').get()).toEqual({ count: 1 });
  } finally { f.sqlite.close(); }
});

test('the largest accepted transcript fits below the conservative D1 row budget', async () => {
  const f = fixture();
  try {
    const transcript = Array.from({ length: 240 }, (_, index) => ({
      id: `p${index + 1}`, speaker: (index % 2 ? 'client' : 'trainee') as 'client' | 'trainee',
      text: 'x'.repeat(index < 80 ? 334 : 333), startMs: index * 1000, endMs: index * 1000 + 800,
    }));
    expect(transcript.reduce((sum, entry) => sum + entry.text.length, 0)).toBe(80_000);
    await writeArchive(f.d1, final(5000, { transcript }));
    const row = f.row()!;
    expect(JSON.parse(row.transcript_json)).toHaveLength(240);
    expect(Buffer.byteLength(JSON.stringify(row))).toBeLessThan(2_000_000);
  } finally { f.sqlite.close(); }
});

test('an unsuccessful D1 result is reported as a failed archive write', async () => {
  const failed = { prepare: () => ({ bind: () => ({ run: async () => ({ success: false }) }) }) } as unknown as D1Database;
  await expect(writeArchive(failed, partial(3000))).rejects.toThrow('Simulator archive write failed.');
});

test('additive migration preserves existing rows and stores generated directions separately', async () => {
  const f = fixture(false);
  try {
    f.sqlite.exec(`INSERT INTO simulator_attempts (
      id, scenario_id, client_id, started_at, updated_at, archive_state,
      session_status, finalization, feedback_status, transcript_json, provenance_json, cues_json
    ) VALUES ('attempt-1', 'sharepoint', 'morgan', 1000, 1500, 'partial', 'live', 'pending', 'waiting', '[]', '{}', '[]')`);
    const legacy = f.row();
    f.sqlite.exec(interventionsMigration);
    expect(f.row()).toEqual({ ...legacy, interventions_json: '[]' });
    await writeArchive(f.d1, partial(2000));
    expect(JSON.parse(f.row()!.interventions_json)).toEqual([]);
    await writeArchive(f.d1, { ...final(3000), interventions: [{
      source: 'director', id: 'cue-test', issueId: 'actor:role:1', audience: 'actor', signal: { condition: 'role', probability: .99 },
      revision: 1, inputIds: ['p1'], snapshotAt: 1000, gateAt: 1500, readyAt: 1900, deliveredAt: 2000,
      model: 'gpt-6-sol', effort: 'none', result: { action: 'intervene', text: 'Private actor direction', evidenceIds: ['p1'] }, outcome: 'sent', delivery: { eventId: 'cue-test', status: 'accepted' },
    }] });
    expect(JSON.parse(f.row()!.interventions_json)[0]).toMatchObject({ audience: 'actor', result: { text: 'Private actor direction' }, delivery: { status: 'accepted' } });
    expect(f.row()!.evaluation_json).toBeNull();
    expect(f.row()!.transcript_json).not.toContain('Private actor direction');
    expect(JSON.parse(f.row()!.cues_json)).toEqual([]);
  } finally { f.sqlite.close(); }
});
