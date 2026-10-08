import { expect, test } from 'bun:test';
import { parseArgs, readTranscript } from './interview-narrative';

const passages = [
  { id: 'p1', speaker: 'interviewer', text: 'What did you deliver?', startMs: 0, endMs: 900 },
  { id: 'p2', speaker: 'participant', text: 'A permit intake portal.', startMs: 1000, endMs: 2500 },
];
const wire = passages.map(item => ({ ...item, speaker: item.speaker === 'participant' ? 'trainee' : 'client' }));

test('the CLI takes one transcript file, an optional spec and an optional output file', () => {
  expect(parseArgs(['t.json'])).toEqual({ file: 't.json', specId: undefined, out: undefined });
  expect(parseArgs(['--spec', 'sales-win-loss', 't.json', '--out', 'r.json'])).toEqual({ file: 't.json', specId: 'sales-win-loss', out: 'r.json' });
  for (const args of [[], ['--spec'], ['t.json', 'u.json'], ['t.json', '--out', '--spec'], ['t.json', '--paid']]) expect(() => parseArgs(args)).toThrow('Usage:');
});

test('passages, a request body, an archive row and a D1 row all read as the same transcript', () => {
  expect(readTranscript(passages)).toMatchObject({ spec: { id: 'project-closeout' }, passages });
  expect(readTranscript(wire).passages).toEqual(passages);
  expect(readTranscript({ specId: 'sales-win-loss', passages }).spec.id).toBe('sales-win-loss');
  expect(readTranscript(passages, 'sales-win-loss').spec.id).toBe('sales-win-loss');
  expect(readTranscript({ id: 'a', specId: 'project-closeout', state: 'final', transcript: passages }).passages).toEqual(passages);
  expect(readTranscript({ scenario_id: 'project-closeout', transcript_json: JSON.stringify(wire) }).passages).toEqual(passages);
  expect(() => readTranscript({ specId: 'missing', passages })).toThrow('Unknown interview');
  expect(() => readTranscript({ transcript_json: '[]' })).toThrow('not a transcript');
  expect(() => readTranscript([{ ...passages[0], speaker: 'narrator' }])).toThrow('not a transcript');
});
