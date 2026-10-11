import { expect, test } from 'bun:test';
import { SessionTranscript } from './sessionTranscript';
import type { Passage } from '../shared/transcript';

const segment = { epoch: 1, offsetMs: 0 };
const speech = (id: string, speaker: Passage['speaker'], text: string, startMs: number, endMs: number) => ({ id, speaker, text, startMs, endMs });

test('overlapping speakers retain arrival order and settle independently as their words grow', () => {
  const transcript = new SessionTranscript();
  transcript.appendSpeech(speech('a', 'participant', 'We built', 0, 1000), segment, 1000);
  transcript.appendSpeech(speech('b', 'interviewer', 'Mm.', 500, 600), segment, 1200);
  transcript.appendSpeech(speech('c', 'participant', ' a map.', 1000, 1800), segment, 2000);
  expect(transcript.entries).toEqual([
    { id: 'p1', speaker: 'participant', text: 'We built a map.', startMs: 0, endMs: 1800 },
    { id: 'p2', speaker: 'interviewer', text: 'Mm.', startMs: 500, endMs: 600 },
  ]);
  expect(transcript.revision).toBe(3);
  expect(transcript.settled(2400).map(entry => entry.id)).toEqual(['p2']);
  expect(transcript.settledPrefix(2400)).toEqual([]);
  expect(transcript.settled(3199).map(entry => entry.id)).toEqual(['p2']);
  expect(transcript.settledPrefix(3200).map(entry => entry.id)).toEqual(['p1', 'p2']);
  expect(transcript.timings).toEqual([
    { passageId: 'p1', firstEpoch: 1, lastEpoch: 1, firstReceivedAt: 1000, lastReceivedAt: 2000 },
    { passageId: 'p2', firstEpoch: 1, lastEpoch: 1, firstReceivedAt: 1200, lastReceivedAt: 1200 },
  ]);
  const restored = new SessionTranscript();
  restored.restore(transcript.entries, transcript.revision, 9000, transcript.timings);
  expect(restored.timings).toEqual(transcript.timings);
});

test('a real reply or a grading freeze makes subsequent words a new passage', () => {
  const transcript = new SessionTranscript();
  transcript.appendSpeech(speech('a', 'participant', 'We built a map.', 0, 1000), segment, 1000);
  transcript.appendSpeech(speech('b', 'interviewer', 'Who used it?', 1000, 2000), segment, 2000);
  transcript.appendSpeech(speech('c', 'participant', 'Field teams.', 2100, 2500), segment, 2500);
  transcript.freeze(transcript.settled(3700));
  transcript.appendSpeech(speech('d', 'participant', 'Across the state.', 2600, 3000), segment, 4000);
  expect(transcript.entries.map(entry => [entry.id, entry.text])).toEqual([
    ['p1', 'We built a map.'], ['p2', 'Who used it?'], ['p3', 'Field teams.'], ['p4', 'Across the state.'],
  ]);
});

test('spoken event IDs deduplicate within a segment, but a resumed segment may reuse them', () => {
  const transcript = new SessionTranscript();
  const first = speech('same-id', 'participant', 'Before the drop.', 0, 1000);
  transcript.appendSpeech(first, segment, 1000);
  expect(transcript.appendSpeech(first, segment, 1100)).toBeNull();
  transcript.freeze();
  transcript.appendSpeech(speech('same-id', 'participant', 'After resume.', 0, 500), { epoch: 2, offsetMs: 3000 }, 4000);
  expect(transcript.entries.map(entry => [entry.text, entry.startMs, entry.endMs])).toEqual([
    ['Before the drop.', 0, 1000], ['After resume.', 3000, 3500],
  ]);
  expect(transcript.revision).toBe(2);
});

test('a typed answer follows the latest speech time and cannot be extended by later speech', () => {
  const transcript = new SessionTranscript();
  transcript.appendSpeech(speech('a', 'participant', 'Spoken.', 0, 2000), segment, 1500);
  transcript.appendTyped('typed-one', 'Typed.', 1500, 1600);
  transcript.appendSpeech(speech('b', 'participant', 'More speech.', 2100, 2500), segment, 2500);
  expect(transcript.entries.map(entry => [entry.id, entry.text, entry.startMs, entry.endMs])).toEqual([
    ['p1', 'Spoken.', 0, 2000], ['typed-one', 'Typed.', 2000, 2000], ['p3', 'More speech.', 2100, 2500],
  ]);
  expect(transcript.revision).toBe(3);
});

test('restoration retains revision and frozen passage identity, with a fresh settlement interval', () => {
  const transcript = new SessionTranscript();
  const saved: Passage[] = [{ id: 'p1', speaker: 'participant', text: 'Saved words.', startMs: 0, endMs: 500 }];
  transcript.restore(saved, 9, 5000);
  expect(transcript.timings).toEqual([]); // Historical arrival times are unavailable, not the restore time.
  expect(transcript.revision).toBe(9);
  expect(transcript.settled(6199)).toEqual([]);
  expect(transcript.settled(6200)).toEqual(saved);
  transcript.appendSpeech(speech('next', 'participant', 'New words.', 600, 900), segment, 6300);
  expect(transcript.entries.map(entry => entry.text)).toEqual(['Saved words.', 'New words.']);
  expect(transcript.revision).toBe(10);
  expect(saved).toHaveLength(1);
});

test.each(['entries', 'characters'] as const)('the %s bound rejects late speech and typed answers without changing the revision', bound => {
  const transcript = new SessionTranscript();
  const saved: Passage[] = Array.from({ length: bound === 'entries' ? 800 : 80 }, (_, i) => ({
    id: `p${i + 1}`, speaker: 'participant', text: bound === 'entries' ? 'A.' : 'a'.repeat(1000), startMs: i * 1000, endMs: (i + 1) * 1000,
  }));
  transcript.restore(saved, 12, 1000);
  expect(transcript.nearCapacity).toBe(true);
  expect(transcript.appendSpeech(speech('late', 'participant', 'Extra.', 900_000, 901_000), segment, 2000)).toBeNull();
  expect(transcript.appendTyped('typed-full', 'Extra.', 902_000, 3000)).toBeNull();
  expect(transcript.entries).toEqual(saved);
  expect(transcript.revision).toBe(12);
});

test('invalid deltas are ignored, and nearing capacity is distinct from reaching its bound', () => {
  const transcript = new SessionTranscript();
  for (const [start, end] of [[-1, 100], [100, 99], [NaN, 100], [0, Infinity]]) {
    expect(transcript.appendSpeech(speech('', 'participant', 'Invalid.', start!, end!), segment, 0)).toBeNull();
  }
  expect(transcript.revision).toBe(0);
  expect(transcript.entries).toEqual([]);
  transcript.restore([{ id: 'p1', speaker: 'participant', text: 'a'.repeat(71_999), startMs: 0, endMs: 100 }], 1, 1000);
  expect(transcript.nearCapacity).toBe(false);
  expect(transcript.appendTyped('typed-edge', 'b', 200, 2000)).not.toBeNull();
  expect(transcript.nearCapacity).toBe(true);
  expect(transcript.revision).toBe(2);
});
