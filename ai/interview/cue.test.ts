import { expect, test } from 'bun:test';
import { CUE_OUTCOMES, type InterviewCue } from '../../core/interview-producer';
import type { TranscriptEntry } from '../../core/simulator/types';
import { cueResponseIds, interviewerState, readCueFollowThrough, type InterviewAnswers } from './evaluate.server';
import { interviewerQuestions } from './rubric';

const cue: InterviewCue = { id: 'cue-1', text: 'Ask how the vendor handoff worked.', evidenceIds: ['p2'], afterPassageId: 'p3', endMs: 8000 };
const transcript: TranscriptEntry[] = [
  { id: 'p1', speaker: 'client', text: 'What worked well?', startMs: 0, endMs: 1000 },
  { id: 'p2', speaker: 'trainee', text: 'Our vendor handoff went smoothly.', startMs: 2000, endMs: 4000 },
  { id: 'p3', speaker: 'client', text: 'Great. What else?', startMs: 5000, endMs: 9000 },
  { id: 'p4', speaker: 'trainee', text: 'That was the highlight.', startMs: 10_000, endMs: 11_000 },
  { id: 'p5', speaker: 'client', text: 'What did you do to make the handoff work?', startMs: 12_000, endMs: 14_000 },
];
const answer = (outcome: typeof CUE_OUTCOMES[number]): InterviewAnswers => ({ 'cue:follow-through': { type: 'choice', choice: outcome,
  probabilities: Object.fromEntries(CUE_OUTCOMES.map(key => [key, key === outcome ? .96 : .01])) } });

test('only later substantive Sam passages can show follow-through, even when a pre-existing passage ends after receipt', () => {
  expect(cueResponseIds(transcript, cue)).toEqual(['p5']);
  expect(cueResponseIds(transcript, { ...cue, endMs: 13_000 })).toEqual([]);
  expect(cueResponseIds(transcript, { ...cue, afterPassageId: 'missing' })).toEqual([]);
  expect(cueResponseIds(transcript, { ...cue, evidenceIds: ['missing'] })).toEqual([]);
  expect(readCueFollowThrough(answer('missed'), cue, cueResponseIds(transcript.slice(0, 4), cue))).toBeUndefined();
  expect(readCueFollowThrough(answer('followed'), cue, cueResponseIds(transcript, cue))).toMatchObject({ cueId: 'cue-1', outcome: 'followed', responseIds: ['p5'] });
});

test('optional follow-through failure does not create a judgment and absent cues cost no question', () => {
  expect(interviewerQuestions()['cue:follow-through']).toBeUndefined();
  expect(interviewerQuestions(true)['cue:follow-through']?.type).toBe('choice');
  expect(readCueFollowThrough(answer('followed'))).toBeUndefined();
  expect(readCueFollowThrough({}, cue, ['p5'])).toBeUndefined();
  const invalid = answer('missed');
  invalid['cue:follow-through'] = { type: 'choice', choice: 'missed', probabilities: { missed: 1 } };
  expect(readCueFollowThrough(invalid, cue, ['p5'])).toBeUndefined();
});

test('a long conversation retains the direction source and delivery anchor in its bounded assessment', () => {
  const later: TranscriptEntry[] = Array.from({ length: 30 }, (_, index) => ({ id: `later-${index}`, speaker: 'trainee', text: 'Unrelated later detail. '.repeat(60), startMs: 20_000 + index * 2000, endMs: 21_000 + index * 2000 }));
  const state = interviewerState([...transcript, ...later], [], cue);
  expect(state.earlierDialogueOmitted).toBe(true);
  const ids = state.dialogue.map(row => row[0]);
  expect(ids).toContain('p2'); expect(ids).toContain('p3');
  expect(ids).toContain('later-29'); expect(ids).not.toContain('later-0');
  expect(state.producerDirection).toMatchObject({ id: 'cue-1', evidenceIds: ['p2'], afterPassageId: 'p3' });
});


test('a newly frozen fragment of an ongoing Sam utterance is not a fresh interviewing opportunity', () => {
  const fragment: TranscriptEntry = { id: 'p4-fragment', speaker: 'client', text: 'and thank you for your time.', startMs: 9000, endMs: 10_000 };
  const talking = [...transcript.slice(0, 3), fragment];
  expect(cueResponseIds(talking, cue)).toEqual([]);
  expect(readCueFollowThrough(answer('missed'), cue, cueResponseIds(talking, cue))).toBeUndefined();
  expect(cueResponseIds([...talking, ...transcript.slice(3)], cue)).toEqual(['p5']);
});

test('a direction received during the participant answer can be followed by the next Sam question', () => {
  const duringAnswer = { ...cue, endMs: 10_500 };
  expect(cueResponseIds(transcript, duringAnswer)).toEqual(['p5']);
  expect(readCueFollowThrough(answer('followed'), duringAnswer, cueResponseIds(transcript, duringAnswer))?.outcome).toBe('followed');
});

test('late-arriving overlap 1.5s before the reply ends is not a new response, while a normal turn handoff counts', () => {
  const overlap = { id: 'late-fragment', speaker: 'client' as const, text: 'and anything else?', startMs: 8500, endMs: 9500 };
  const reply = { ...transcript[3]!, startMs: 9000, endMs: 10_000 };
  const next = { ...transcript[4]!, startMs: 9800 };
  expect(cueResponseIds([...transcript.slice(0, 3), reply, overlap], cue)).toEqual([]);
  expect(cueResponseIds([...transcript.slice(0, 3), reply, overlap, next], cue)).toEqual(['p5']);
});

test('a trailing participant word cannot make an ongoing Sam answer eligible', () => {
  const reply = { ...transcript[3]!, endMs: 11_900 };
  const talking: TranscriptEntry[] = [...transcript.slice(0, 3), reply,
    { id: 'p5', speaker: 'client', text: 'That', startMs: 11_800, endMs: 12_000 },
    { id: 'p6', speaker: 'trainee', text: 'day.', startMs: 12_000, endMs: 12_200 },
    { id: 'p7', speaker: 'client', text: 'sounds good. Anything else?', startMs: 12_200, endMs: 15_000 },
  ];
  const arrivedDuringSpeech = { ...cue, afterPassageId: 'p4', endMs: 11_950 };
  expect(cueResponseIds(talking, arrivedDuringSpeech)).toEqual([]);
  expect(cueResponseIds([...talking,
    { id: 'p8', speaker: 'trainee', text: 'That was the highlight.', startMs: 16_000, endMs: 18_000 },
    { id: 'p9', speaker: 'client', text: 'How did the handoff work?', startMs: 18_000, endMs: 20_000 },
  ], arrivedDuringSpeech)).toEqual(['p9']);
});

test('observed 400-600ms Live handoff overlap counts as a response opportunity', () => {
  const early = { ...cue, endMs: 224_600 };
  const reply: TranscriptEntry = { id: 'p4', speaker: 'trainee', text: 'The client had never run a software project, so we explained each release step.', startMs: 215_000, endMs: 242_800 };
  for (const startMs of [242_200, 242_400]) {
    const next: TranscriptEntry = { id: 'p5', speaker: 'client', text: 'Who on their side signed off each release?', startMs, endMs: 248_000 };
    expect(cueResponseIds([...transcript.slice(0, 3), reply, next], early)).toEqual(['p5']);
  }
});

test('a short reply cannot make a remainder that started with it eligible', () => {
  const reply: TranscriptEntry = { id: 'p4', speaker: 'trainee', text: 'Twice, yes.', startMs: 10_000, endMs: 10_800 };
  const remainder: TranscriptEntry = { id: 'p5', speaker: 'client', text: 'and what else changed?', startMs: 10_000, endMs: 11_000 };
  const next: TranscriptEntry = { id: 'p6', speaker: 'client', text: 'What prompted the second one?', startMs: 10_400, endMs: 12_000 };
  expect(cueResponseIds([...transcript.slice(0, 3), reply, remainder], cue)).toEqual([]);
  expect(cueResponseIds([...transcript.slice(0, 3), reply, remainder, next], cue)).toEqual(['p6']);
});

test('backchannels and a direction received between turns do not manufacture a response', () => {
  const nod: TranscriptEntry = { id: 'p5', speaker: 'client', text: 'Mm-hmm.', startMs: 10_900, endMs: 11_200 };
  // Live transcription truncates and varies acknowledgments.
  for (const text of ['Mm-hmm.', 'Mm-h', 'mm.', 'Ah.', 'Oh.', "'Kay.", '’Kay.']) expect(cueResponseIds([...transcript.slice(0, 4), { ...nod, text }], cue)).toEqual([]);
  expect(cueResponseIds([...transcript.slice(0, 4), { ...nod, text: 'Ah, what changed then?' }], cue)).toEqual(['p5']);
  // After the reply ended, Sam's next question may answer the participant rather than the direction.
  expect(cueResponseIds(transcript, { ...cue, endMs: 11_500 })).toEqual([]);
});
