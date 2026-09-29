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
  expect(readCueFollowThrough(answer('missed'), transcript.slice(0, 4), cue)).toBeUndefined();
  expect(readCueFollowThrough(answer('followed'), transcript, cue)).toMatchObject({ cueId: 'cue-1', outcome: 'followed', responseIds: ['p5'] });
});

test('optional follow-through failure does not create a judgment and absent cues cost no question', () => {
  expect(interviewerQuestions()['cue:follow-through']).toBeUndefined();
  expect(interviewerQuestions(true)['cue:follow-through']?.type).toBe('choice');
  expect(readCueFollowThrough(answer('followed'), transcript)).toBeUndefined();
  expect(readCueFollowThrough({}, transcript, cue)).toBeUndefined();
  const invalid = answer('missed');
  invalid['cue:follow-through'] = { type: 'choice', choice: 'missed', probabilities: { missed: 1 } };
  expect(readCueFollowThrough(invalid, transcript, cue)).toBeUndefined();
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
