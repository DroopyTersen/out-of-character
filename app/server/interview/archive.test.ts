import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import type { InterviewArchiveWrite } from './archive.server';
import { writeInterviewArchive } from './archive.server';

const migration = await Bun.file(new URL('../../../migrations/0002_interview_attempts.sql', import.meta.url)).text();
const simulatorMigration = await Bun.file(new URL('../../../migrations/0001_simulator_attempts.sql', import.meta.url)).text();

function fixture() {
  const sqlite = new Database(':memory:');
  sqlite.exec(simulatorMigration);
  sqlite.exec(migration);
  const d1 = {
    prepare: (sql: string) => ({ bind: (...values: (string | number | null)[]) => ({
      run: async () => { sqlite.prepare(sql).run(...values); return { success: true }; },
    }) }),
  } as unknown as D1Database;
  const row = () => sqlite.query('SELECT * FROM interview_attempts WHERE id = ?').get('interview-1') as Record<string, any> | null;
  return { sqlite, d1, row };
}

const base: InterviewArchiveWrite = {
  state: 'partial', capturedAt: 2000,
  snapshot: {
    id: 'interview-1', scenarioId: 'project-closeout', clientId: 'sam-cedar',
    status: 'live', startedAt: 1000, limitSeconds: 3600, warning: null, revision: 1,
    transcript: [{ id: 'p1', speaker: 'trainee', text: 'Jen helped us fix the access issue.', startMs: 100, endMs: 900 }],
    evaluation: null, coaching: null, feedbackStatus: 'current', message: null, finalization: 'pending', usageSeconds: null,
    interview: { evaluation: null, summary: { status: 'pending', text: null } },
  },
  provenance: {
    model: 'gpt-live', voice: 'cedar', rubricVersion: 'interview-r1', simulatorVersion: 'interview-v1',
    actorDigest: 'actor-digest', openingDigest: 'opening-digest', workerId: 'worker-id',
    workerTag: 'tag', contextualDirector: null,
  },
  cues: [],
};

function write(capturedAt: number, state: InterviewArchiveWrite['state'], status: 'pending' | 'ready' | 'unavailable', text: string | null = null): InterviewArchiveWrite {
  return {
    ...base, capturedAt, state,
    snapshot: {
      ...base.snapshot,
      status: state === 'final' ? 'ended' : 'live',
      finalization: state === 'final' ? 'confirmed' : 'pending',
      interview: { evaluation: null, summary: { status, text } },
    },
  };
}

test('interview transcript and summary stay in their own table; newer final summary wins', async () => {
  const f = fixture();
  try {
    await writeInterviewArchive(f.d1, write(2000, 'partial', 'pending'));
    await writeInterviewArchive(f.d1, write(3000, 'final', 'pending'));
    await writeInterviewArchive(f.d1, write(4000, 'final', 'ready', 'The participant credited Jen with resolving access.'));
    await writeInterviewArchive(f.d1, write(5000, 'final', 'pending'));
    await writeInterviewArchive(f.d1, write(6000, 'partial', 'pending'));
    const row = f.row()!;
    expect(row).toMatchObject({ archive_state: 'final', updated_at: 4000, ended_at: 3000, summary_status: 'ready' });
    expect(row.summary_text).toContain('credited Jen');
    expect(JSON.parse(row.transcript_json)[0].text).toBe('Jen helped us fix the access issue.');
    expect(f.sqlite.query('SELECT count(*) AS count FROM simulator_attempts').get()).toEqual({ count: 0 });
  } finally { f.sqlite.close(); }
});

test('a late partial cannot replace final transcript, and an unavailable summary remains explicit', async () => {
  const f = fixture();
  try {
    await writeInterviewArchive(f.d1, write(5000, 'partial', 'pending'));
    await writeInterviewArchive(f.d1, write(3000, 'final', 'unavailable'));
    await writeInterviewArchive(f.d1, write(6000, 'partial', 'pending'));
    expect(f.row()).toMatchObject({ archive_state: 'final', updated_at: 3000, summary_status: 'unavailable', summary_text: null });
  } finally { f.sqlite.close(); }
});

test('an unsuccessful D1 write is reported without transcript data in the error', async () => {
  const d1 = { prepare: () => ({ bind: () => ({ run: async () => ({ success: false }) }) }) } as unknown as D1Database;
  await expect(writeInterviewArchive(d1, base)).rejects.toThrow('Interview archive write failed.');
});
