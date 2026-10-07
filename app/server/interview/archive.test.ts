import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { interviewTopics } from '../../../core/interview';
import type { MapEntity, MapThread } from '../../../core/interview-map';
import type { GradeObjective, GradeRecord, MapRecord, NoteRecord, ProducerLogRecord, ResearchRecord, TraitRecord, TurnRecord } from '../../../core/interview-producer';
import type { InterviewArchiveWrite } from './archive.server';
import { writeInterviewArchive } from './archive.server';

const migration = await Bun.file(new URL('../../../migrations/0002_interview_attempts.sql', import.meta.url)).text();
const interventionsMigration = await Bun.file(new URL('../../../migrations/0003_interview_interventions.sql', import.meta.url)).text();
const specMigration = await Bun.file(new URL('../../../migrations/0004_interview_attempts_spec.sql', import.meta.url)).text();
const simulatorMigration = await Bun.file(new URL('../../../migrations/0001_simulator_attempts.sql', import.meta.url)).text();

function fixture() {
  const sqlite = new Database(':memory:');
  sqlite.exec(simulatorMigration);
  sqlite.exec(migration);
  sqlite.exec(interventionsMigration);
  sqlite.exec(specMigration);
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
  interventions: [],
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
    const markdown = '## Client experience\n\n- The participant credited Jen with resolving access.\n\n| Person | Contribution |\n| --- | --- |\n| Jen | Access |\n\n```mermaid\nflowchart TD\n A["Blocked"] --> B["Access restored"]\n```';
    await writeInterviewArchive(f.d1, write(2000, 'partial', 'pending'));
    await writeInterviewArchive(f.d1, write(3000, 'final', 'pending'));
    await writeInterviewArchive(f.d1, write(4000, 'final', 'ready', markdown));
    await writeInterviewArchive(f.d1, write(5000, 'final', 'pending'));
    await writeInterviewArchive(f.d1, write(6000, 'partial', 'pending'));
    const row = f.row()!;
    expect(row).toMatchObject({ archive_state: 'final', updated_at: 4000, ended_at: 3000, summary_status: 'ready', spec_id: 'project-closeout', spec_version: 'project-closeout-v1' });
    expect(row.summary_text).toBe(markdown);
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

test('the migration preserves historical cues and adds an empty intervention history', () => {
  const sqlite = new Database(':memory:');
  try {
    sqlite.exec(migration);
    sqlite.prepare(`INSERT INTO interview_attempts
      (id, scenario_id, interviewer_id, started_at, updated_at, archive_state, session_status,
       finalization, feedback_status, transcript_json, summary_status, provenance_json, cues_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('old', 'project-closeout', 'sam-cedar', 1, 2, 'final', 'ended', 'confirmed', 'current', '[]', 'ready', '{}', '[{"id":"follow-thread"}]');
    sqlite.exec(interventionsMigration);
    expect(sqlite.query('SELECT cues_json, interventions_json FROM interview_attempts').get()).toEqual({
      cues_json: '[{"id":"follow-thread"}]', interventions_json: '[]',
    });
  } finally { sqlite.close(); }
});

test('the spec migration leaves earlier rows without a spec', () => {
  const sqlite = new Database(':memory:');
  try {
    sqlite.exec(migration);
    sqlite.exec(interventionsMigration);
    sqlite.prepare(`INSERT INTO interview_attempts
      (id, scenario_id, interviewer_id, started_at, updated_at, archive_state, session_status,
       finalization, feedback_status, transcript_json, summary_status, provenance_json, cues_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('old', 'project-closeout', 'sam-cedar', 1, 2, 'final', 'ended', 'confirmed', 'current', '[]', 'ready', '{}', '[]');
    sqlite.exec(specMigration);
    expect(sqlite.query('SELECT spec_id, spec_version FROM interview_attempts').get()).toEqual({ spec_id: null, spec_version: null });
    const columns = sqlite.query('PRAGMA table_info(interview_attempts)').all() as { name: string; type: string; notnull: number }[];
    expect(columns.filter(column => column.name.startsWith('spec_'))).toMatchObject([
      { name: 'spec_id', type: 'TEXT', notnull: 0 }, { name: 'spec_version', type: 'TEXT', notnull: 0 },
    ]);
  } finally { sqlite.close(); }
});

/** An hour at the producer's caps: 720 live grades, 90 Sol calls, 300 Jev turns over 15 open threads, 100 notes (60 of them full map notes), 120 trait reads, 3 lookups. */
function hour(updateEntities: number): ProducerLogRecord[] {
  const text = (length: number) => 'The participant’s team worked with the field crews on routing. '.repeat(Math.ceil(length / 64)).slice(0, length);
  const ids = (count: number, prefix: string) => Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);
  const at = 1_800_000_000_000;
  const usage = { inputTokens: 14_000, outputTokens: 900, cachedTokens: 12_000, reasoningTokens: 0 };
  const objectives = interviewTopics.flatMap(topic => topic.objectives.map(item => ({ id: item.id, shown: ['set-aside', 'p299'], graded: ['explored', 'p300'], levels: [.12, .23, .34, .31] }) satisfies GradeObjective));
  const threads = ids(4, 't').map(id => ({ id, label: text(80), anchors: ['e1'], unknown: text(200), guess: text(200), related: [], topics: [], status: 'open', reason: null }) satisfies MapThread);
  const entities = ids(updateEntities, 'e').map(id => ({ id, kind: 'product', label: text(80), detail: text(240), source: 'participant', passageId: 'p300' }) satisfies MapEntity);
  const open = ids(15, 't');
  const note = (kind: 'list' | 'map', index: number): NoteRecord => ({
    source: 'note', id: `note-${index}`, kind, text: text(kind === 'map' ? 4400 : 700), mapId: 'map-90', turnId: 'turn-300', sentAt: at, outcome: 'sent',
    delivery: { eventId: `note-${index}`, afterPassageId: 'p300', status: 'accepted', acknowledgedAt: at, startMs: 3_000_000, endMs: 3_001_000 },
    researchIds: ['research-1'], nextSamTurnAt: at, nextSamTurnAfterId: 'p300',
  });
  return [
    ...Array.from({ length: 90 }, (_, index): MapRecord => ({
      source: 'map', id: `map-${index + 1}`, reasons: ['the participant spoke', 'a minute passed'], startedAt: at, completedAt: at, outcome: 'applied', inputCount: 300, lastInputId: 'p300', model: 'sol', usage,
      update: { vantage: text(600), preferences: ids(4, 'p').map(passageId => ({ text: text(200), passageId })), entities, edges: [], threads, revise: [], close: [], drop: [] },
      changes: { added: ids(3, 't'), changed: ids(3, 'e'), dropped: [] }, research: null,
    })),
    ...Array.from({ length: 300 }, (_, index): TurnRecord => ({
      source: 'turn', id: `turn-${index + 1}`, passageId: 'p300', mapId: 'map-90', startedAt: at, completedAt: at, outcome: 'read', durationMs: 1000, usage,
      reading: { atMs: 3_000_000, focus: 't12', novel: .43, natural: Object.fromEntries(open.map(id => [id, .37])), states: Object.fromEntries(open.map(id => [id, 'open'])) },
      pick: { current: 't12', action: 'keep', lead: 't12', nearby: ['t13', 't14'], ranked: open.map(id => [id, .43, 'elsewhere']) },
    })),
    ...Array.from({ length: 120 }, (_, index): TraitRecord => ({
      source: 'traits', id: `traits-${index + 1}`, mapId: 'map-90', threadIds: ids(3, 't'), startedAt: at, completedAt: at, outcome: 'read', durationMs: 900, usage,
      traits: Object.fromEntries(ids(3, 't').map(id => [id, [.35, .9]])),
    })),
    ...Array.from({ length: 100 }, (_, index) => note(index < 60 ? 'map' : 'list', index + 1)),
    ...Array.from({ length: 3 }, (_, index): ResearchRecord => ({
      source: 'research', id: `research-${index + 1}`, mapId: 'map-90', request: { kind: 'organization', name: text(80), clue: text(120), passageIds: ['p300'] }, model: 'luna',
      requestedAt: at, lookupAt: at, completedAt: at, loggedAt: at, retrievedAt: at, queries: [text(80), text(80)], outcome: 'found',
      facts: Array.from({ length: 5 }, () => ({ text: text(300), url: 'https://example.com/a/long/path/to/the/source', title: text(80) })),
    })),
    ...Array.from({ length: 720 }, (_, index): GradeRecord => ({
      source: 'grade', id: `grade-${index + 1}`, final: index === 719, revision: index, capturedAt: at, completedAt: at, inputCount: 300, lastInputId: 'p300', outcome: 'graded', durationMs: 3000, objectives,
    })),
  ];
}

test('an hour at every producer cap still fits a D1 row: live grades thin first, and Sol updates go only if they must', async () => {
  const transcript = Array.from({ length: 300 }, (_, index) => ({ id: `p${index + 1}`, speaker: index % 2 ? 'trainee' as const : 'client' as const, text: 'The field crew’s routing work. '.repeat(9).slice(0, 266), startMs: index * 12_000, endMs: index * 12_000 + 10_000 }));
  const final = { ...write(3000, 'final', 'ready', 'Summary. '.repeat(3000)), interventions: [] };
  final.snapshot = { ...final.snapshot, transcript };
  const bytes = (row: Record<string, unknown>) => Object.values(row).reduce<number>((sum, value) => sum + (typeof value === 'string' ? new TextEncoder().encode(value).byteLength : 8), 0);
  for (const [entities, sheds] of [[0, false], [70, true]] as const) {
    const f = fixture();
    try {
      await writeInterviewArchive(f.d1, { ...final, interventions: hour(entities) });
      const row = f.row()!;
      const records: ProducerLogRecord[] = JSON.parse(row.interventions_json);
      expect(bytes(row)).toBeLessThan(2_000_000);
      expect(records).toHaveLength(1333);
      const grades = records.filter(item => item.source === 'grade');
      const maps = records.filter(item => item.source === 'map');
      expect(grades.at(-1)!.objectives).toBeDefined();
      expect(grades.filter(item => item.objectives).length).toBeLessThan(720);
      expect(maps.at(-1)!.update).toBeDefined();
      expect(maps.every(item => item.update)).toBe(!sheds);
    } finally { f.sqlite.close(); }
  }
});

test('an unsuccessful D1 write is reported without transcript data in the error', async () => {
  const d1 = { prepare: () => ({ bind: () => ({ run: async () => ({ success: false }) }) }) } as unknown as D1Database;
  await expect(writeInterviewArchive(d1, base)).rejects.toThrow('Interview archive write failed.');
});
