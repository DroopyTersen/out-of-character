import { describe, expect, test } from 'bun:test';
import type { Experimental_EvaluationQuestion } from 'ai';
import { interviewTopics, type CoverageLevel } from '../../core/interview';
import { interviewFixtures } from './fixtures';
import recordings from './recordings.json';
import { readInterviewAnswers, type InterviewAnswers } from './evaluate.server';
import { INTERVIEW_RUBRIC_VERSION, interviewQuestions } from './rubric';
import { interviewerBrief, interviewOpening, interviewers } from './scenario.server';

function answersFor(questions: Record<string, Experimental_EvaluationQuestion>): InterviewAnswers {
  return Object.fromEntries(Object.entries(questions).map(([id, question]) => {
    return [id, { type: 'choice', choice: /^objective:[^:]+$/.test(id) ? 'not-yet' : 'none' }];
  })) as InterviewAnswers;
}
function cover(answers: InterviewAnswers, id: string, level: CoverageLevel, probability: number, passage: string) {
  answers[`objective:${id}`] = { type: 'choice', choice: level, probabilities: { [level]: probability } };
  answers[`objective:${id}:evidence`] = { type: 'choice', choice: passage, probabilities: { [passage]: .9 } };
}


describe('project closeout interview contracts', () => {
  test('the Workshop has exactly one recording for every selectable fixture', () => {
    expect(recordings.rows.map(row => row.fixtureId).sort()).toEqual(interviewFixtures.map(fixture => fixture.id).sort());
    expect(recordings.rubricVersion).toBe('interview-rubric-v8'); // Historical recordings retain the rubric that produced them.
    for (const row of recordings.rows) {
      expect(row.participant.objectives).toHaveLength(14);
      for (const item of row.participant.objectives) expect(item).toMatchObject({ level: expect.any(String), levels: expect.any(Object) });
    }
  });
  test('one authored Sam serves both voices and the 20 closeout objectives', () => {
    expect(interviewTopics.flatMap(topic => topic.objectives.map(item => item.id))).toHaveLength(20);
    expect(interviewers.map(item => item.voice)).toEqual(['cedar', 'gleam']);
    expect(interviewers[0]!.behavior).toBe(interviewers[1]!.behavior);
    for (const interviewer of interviewers) {
      expect(interviewerBrief(interviewer.id)).toContain('You are Sam');
      expect(interviewOpening(interviewer.id)).toContain('Sam');
    }
  });

  test('Sam never sees the closeout topics, and the brief describes the notes Sam actually gets', () => {
    const brief = interviewerBrief(interviewers[0]!.id);
    for (const topic of interviewTopics) {
      expect(brief).not.toContain(topic.label);
      for (const item of topic.objectives) expect(brief).not.toContain(item.label);
    }
    expect(brief).not.toMatch(/producer|rundown|topic map/i);
    expect(brief).toContain('thread note');
    expect(brief).toContain('map note');
    expect(brief.match(/^\d+\. /gm)).toHaveLength(13);
  });

  test('the brief puts turn-taking before techniques, never fills a pause, and leaves the ending to the participant', () => {
    const brief = interviewerBrief(interviewers[0]!.id);
    const paragraphs = brief.split('\n\n');
    const guide = paragraphs.find(item => item.startsWith('Technique guide'))!;
    const ending = paragraphs.find(item => item.startsWith('The participant decides when the interview ends'))!;
    expect(brief.indexOf('Turn-taking:')).toBeLessThan(brief.indexOf('Technique guide'));
    expect(brief.indexOf(ending)).toBeLessThan(brief.indexOf('Technique guide'));
    // GPT-Live repeats example lines, so no example may fill a pause or trail off on “or”.
    expect(guide).not.toMatch(/\bgo (?:ahead|on)\b|take your time|^\d+\. Finish their sentence|or…\?|or\.\.\.\?/im);
    // Only the ending policy names the interview-level closers, to ban them.
    for (const item of paragraphs.filter(paragraph => paragraph !== ending)) expect(item).not.toMatch(/anything else|did we miss/i);
    expect(ending).toMatch(/no interview-level “anything else\?” or “did we miss anything\?”/);
    expect(brief).not.toMatch(/wrapping up is premature|ground is still unexplored|ask whether anything important was missed/i);
  });

  test('only participant passages are candidate evidence, even when Sam supplies the details', () => {
    const fixture = interviewFixtures.find(item => item.id === 'leading-and-mm')!;
    const questions = interviewQuestions(fixture.transcript);
    expect(questions['objective:client-access']).toMatchObject({ type: 'choice', criteria: { 'not-yet': expect.any(String), touched: expect.any(String), explored: expect.any(String), 'set-aside': expect.any(String) } });
    const evidence = questions['objective:client-access:evidence'];
    expect(evidence?.type).toBe('choice');
    if (evidence?.type === 'choice') expect(Object.keys(evidence.criteria ?? {})).toEqual(['none', 'p2']);

    const answers = answersFor(questions);
    cover(answers, 'client-access', 'explored', .99, 'p2');
    const result = readInterviewAnswers(fixture.transcript, answers);
    expect(result.objectives.find(item => item.id === 'client-access')).toMatchObject({ level: 'not-yet', achieved: false, evidence: null });
  });

  test('a terse project fact is credited to its actual source passage', () => {
    const fixture = interviewFixtures.find(item => item.id === 'terse-expert')!;
    const answers = answersFor(interviewQuestions(fixture.transcript));
    cover(answers, 'project-delivery', 'explored', .97, 'p2');
    cover(answers, 'project-role', 'explored', .96, 'p2');
    const result = readInterviewAnswers(fixture.transcript, answers);
    expect(result.objectives.filter(item => item.achieved).map(item => item.id)).toEqual(['project-delivery', 'project-role']);
    expect(result.objectives.find(item => item.id === 'project-delivery')).toMatchObject({ level: 'explored', probability: .97, evidence: { entryId: 'p2', speaker: 'participant', text: fixture.transcript[1]!.text } });
    expect(result.objectives.find(item => item.id === 'project-reflection')).toMatchObject({ level: 'not-yet', achieved: false, evidence: null });
  });

  test('contextual two-word facts count while a vague yes does not', () => {
    const duration = interviewFixtures.find(item => item.id === 'terse-three-weeks')!;
    const durationAnswers = answersFor(interviewQuestions(duration.transcript));
    cover(durationAnswers, 'client-access', 'explored', .98, 'p2');
    expect(readInterviewAnswers(duration.transcript, durationAnswers).objectives.find(item => item.id === 'client-access')?.evidence?.text).toBe('Three weeks.');

    const agreement = interviewFixtures.find(item => item.id === 'vague-yes')!;
    const agreementAnswers = answersFor(interviewQuestions(agreement.transcript));
    cover(agreementAnswers, 'client-decisions', 'explored', .98, 'p2');
    expect(readInterviewAnswers(agreement.transcript, agreementAnswers).objectives.find(item => item.id === 'client-decisions')).toMatchObject({ level: 'not-yet', achieved: false });
  });

  test('credit needs high confidence, boundaries need even odds, and both need participant evidence', () => {
    const fixture = interviewFixtures.find(item => item.id === 'vague-rant')!;
    const answers = answersFor(interviewQuestions(fixture.transcript));
    const read = () => readInterviewAnswers(fixture.transcript, answers).objectives.find(item => item.id === 'process-communication')!;
    for (const [level, probability, expected] of [['explored', .84, 'touched'], ['explored', .85, 'explored'], ['set-aside', .49, 'touched'], ['set-aside', .5, 'set-aside'], ['set-aside', .9, 'set-aside'], ['touched', .3, 'touched']] as const) {
      cover(answers, 'process-communication', level, probability, 'p2');
      expect(read()).toMatchObject({ level: expected, achieved: expected === 'explored', evidence: { entryId: 'p2' } });
    }
    expect(read().levels).toEqual({ 'not-yet': 0, touched: .3, explored: 0, 'set-aside': 0 });
    answers['objective:process-communication:evidence'] = { type: 'choice', choice: 'none' };
    expect(read()).toMatchObject({ level: 'not-yet', evidence: null });
    answers['objective:process-communication'] = { type: 'choice', choice: 'explored' };
    answers['objective:process-communication:evidence'] = { type: 'choice', choice: 'p2' };
    expect(read()).toMatchObject({ level: 'touched', levels: null, probability: null });
    answers['objective:process-communication:evidence'] = { type: 'choice', choice: 'p1' };
    expect(() => readInterviewAnswers(fixture.transcript, answers)).toThrow('Invalid interview selection');
    answers['objective:process-communication'] = { type: 'choice', choice: 'heard' };
    expect(() => readInterviewAnswers(fixture.transcript, answers)).toThrow('Invalid interview selection');
  });
});
