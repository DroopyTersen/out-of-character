import { expect, test } from 'bun:test';
import { parseArchive, parseArgs, parseRows } from './simulator-transcripts';

const id = '123e4567-e89b-42d3-a456-426614174000';

test('CLI accepts only list or one UUID export, with an optional local switch', () => {
  expect(parseArgs(['list'])).toEqual({ action: 'list', local: false });
  expect(parseArgs(['export', id.toUpperCase(), '--local'])).toEqual({ action: 'export', id, local: true });
  for (const args of [[], ['export'], ['export', `${id}'; DROP TABLE simulator_attempts; --`], ['list', id], ['export', id, '--remote']]) {
    expect(() => parseArgs(args)).toThrow('Usage:');
  }
});

test('Wrangler JSON must contain one successful statement', () => {
  expect(parseRows(JSON.stringify([{ success: true, results: [{ id }] }]))).toEqual([{ id }]);
  expect(() => parseRows(JSON.stringify([{ success: false, results: [] }]))).toThrow();
  expect(() => parseRows(JSON.stringify([]))).toThrow();
  expect(() => parseRows(JSON.stringify([{ success: true, results: [] }, { success: true, results: [] }]))).toThrow();
});

test('export parses archive fields and excludes unexpected columns', () => {
  const archive = parseArchive({
    id, scenario_id: 'sharepoint', client_id: 'morgan', started_at: 1000,
    updated_at: 2000, ended_at: null, archive_state: 'partial', session_status: 'live',
    finalization: 'pending', feedback_status: 'waiting', usage_seconds: null, message: null,
    transcript_json: '[{"speaker":"trainee","text":"Hello"}]', evaluation_json: null,
    provenance_json: '{"workerTag":"release"}', cues_json: '[]', interventions_json: '[]',
    provider_id: 'must-not-export',
  });
  expect(archive.transcript).toEqual([{ speaker: 'trainee', text: 'Hello' }]);
  expect(archive.evaluation).toBeNull();
  expect(archive.provenance).toEqual({ workerTag: 'release' });
  expect(archive.interventions).toEqual([]);
  expect(JSON.stringify(archive)).not.toContain('must-not-export');
});

test('new archive exports preserve private intervention history for the local reviewer', () => {
  const record = { audience: 'actor', outcome: 'sent', result: { action: 'intervene', text: 'Private direction', evidenceIds: ['p1'] }, delivery: { eventId: 'cue-test', status: 'accepted' } };
  const archived = parseArchive({ id, transcript_json: '[]', provenance_json: '{}', cues_json: '[]', interventions_json: JSON.stringify([record]) });
  expect(archived.interventions).toEqual([record]);
});
