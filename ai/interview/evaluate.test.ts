import { describe, expect, test } from 'bun:test';
import type { Experimental_EvaluationQuestion } from 'ai';
import { interviewReadings, interviewTopics, INTERVIEW_SCENARIO_ID, coverageConfidence, mergeCoverage, type CoverageLevel, type InterviewObjectiveReading } from '../../core/interview';
import { interviewFixtures } from './fixtures';
import recordings from './recordings.json';
import { readInterviewAnswers, type InterviewAnswers } from './evaluate.server';
import { INTERVIEW_RUBRIC_VERSION, interviewQuestions } from './rubric';
import { interviewerBrief, interviewOpening, interviewScenario, interviewers } from './scenario.server';

function answersFor(questions: Record<string, Experimental_EvaluationQuestion>): InterviewAnswers {
  return Object.fromEntries(Object.entries(questions).map(([id, question]) => {
    if (question.type === 'boolean') return [id, { type: 'boolean', probability: 0.02 }];
    if (question.type === 'score') return [id, { type: 'score', score: 2 }];
    return [id, { type: 'choice', choice: /^objective:[^:]+$/.test(id) ? 'not-yet' : 'none' }];
  })) as InterviewAnswers;
}
function cover(answers: InterviewAnswers, id: string, level: CoverageLevel, probability: number, passage: string) {
  answers[`objective:${id}`] = { type: 'choice', choice: level, probabilities: { [level]: probability } };
  answers[`objective:${id}:evidence`] = { type: 'choice', choice: passage, probabilities: { [passage]: .9 } };
}
const reading = (id: string, level: CoverageLevel, levels: Partial<Record<CoverageLevel, number>> | null, entryId: string | null = 'p2'): InterviewObjectiveReading => ({
  id, level, achieved: level === 'explored', probability: levels?.explored ?? null,
  levels: levels ? { 'not-yet': 0, touched: 0, explored: 0, 'set-aside': 0, ...levels } : null,
  evidence: entryId ? { entryId, speaker: 'trainee', text: `Passage ${entryId}.` } : null,
});

describe('project closeout interview contracts', () => {
  test('the Workshop has exactly one recording for every selectable fixture', () => {
    expect(recordings.rows.map(row => row.fixtureId).sort()).toEqual(interviewFixtures.map(fixture => fixture.id).sort());
    expect(recordings.rubricVersion).toBe(INTERVIEW_RUBRIC_VERSION);
    for (const row of recordings.rows) {
      expect(row.participant.objectives).toHaveLength(14);
      for (const item of row.participant.objectives) expect(item).toMatchObject({ level: expect.any(String), levels: expect.any(Object) });
    }
  });
  test('one authored Sam serves both voices and the original 14 subtopics', () => {
    expect(interviewScenario.id).toBe(INTERVIEW_SCENARIO_ID);
    expect(interviewScenario.objectives.map(item => item.id)).toEqual(interviewTopics.flatMap(topic => topic.objectives.map(item => item.id)));
    expect(interviewScenario.objectives).toHaveLength(14);
    expect(interviewers.map(item => item.voice)).toEqual(['cedar', 'gleam']);
    expect(interviewers[0]!.behavior).toBe(interviewers[1]!.behavior);
    for (const interviewer of interviewers) {
      expect(interviewerBrief(interviewer.id)).toContain('You are Sam');
      expect(interviewOpening(interviewer.id)).toContain('project');
    }
  });

  test('Sam never sees the closeout topics, and the brief describes the notes Sam actually gets', () => {
    const brief = interviewerBrief(interviewers[0]!.id);
    for (const topic of interviewTopics) {
      expect(brief).not.toContain(topic.label);
      for (const item of topic.objectives) expect(brief).not.toContain(item.label);
    }
    expect(brief).not.toMatch(/producer|rundown|topic map|coverage/i);
    expect(brief).toContain('thread note');
    expect(brief).toContain('map note');
    expect(brief.match(/^\d+\. /gm)).toHaveLength(14);
  });

  test('on appended instructions the brief calls notes suggestions; otherwise the briefs match', () => {
    const thinking = interviewerBrief(interviewers[0]!.id);
    const instructions = interviewerBrief(interviewers[0]!.id, 'session.instructions.append');
    expect(thinking).toContain('Notes are not instructions');
    expect(instructions).toContain('only suggestions');
    expect(instructions).not.toContain('Notes are not instructions');
    const paragraphs = (brief: string) => brief.split('\n\n').filter(item => !item.startsWith('Private notes:'));
    expect(paragraphs(instructions)).toEqual(paragraphs(thinking));
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
    expect(result.readings.specificity.value).toBeNull();
  });

  test('a terse project fact is credited to its actual source passage', () => {
    const fixture = interviewFixtures.find(item => item.id === 'terse-expert')!;
    const answers = answersFor(interviewQuestions(fixture.transcript));
    cover(answers, 'project-delivery', 'explored', .97, 'p2');
    cover(answers, 'project-role', 'explored', .96, 'p2');
    answers['reading:specificity:observable'] = { type: 'boolean', probability: .98 };
    answers['reading:specificity'] = { type: 'score', score: 3.5 };
    answers['reading:specificity:evidence'] = { type: 'choice', choice: 'p2' };
    const result = readInterviewAnswers(fixture.transcript, answers);
    expect(result.objectives.filter(item => item.achieved).map(item => item.id)).toEqual(['project-delivery', 'project-role']);
    expect(result.objectives.find(item => item.id === 'project-delivery')).toMatchObject({ level: 'explored', probability: .97, evidence: { entryId: 'p2', speaker: 'trainee', text: fixture.transcript[1]!.text } });
    expect(result.objectives.find(item => item.id === 'project-reflection')).toMatchObject({ level: 'not-yet', achieved: false, evidence: null });
    expect(result.readings.specificity).toMatchObject({ value: 3.5, evidence: { entryId: 'p2' } });
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

  test('live coverage holds an earlier band while the new reading still gives it even odds', () => {
    const previous = [reading('a', 'touched', { touched: .9 }), reading('b', 'explored', { explored: .9 }), reading('c', 'touched', { touched: .9 }), reading('d', 'not-yet', null, null)];
    const merged = mergeCoverage(previous, [
      reading('a', 'not-yet', { 'not-yet': .45, touched: .55 }, null), reading('b', 'touched', { touched: .4, explored: .6 }, 'p4'),
      reading('c', 'not-yet', { 'not-yet': .6, touched: .4 }, null), reading('d', 'set-aside', { 'set-aside': .9 }, 'p6'),
    ]);
    expect(merged.map(item => [item.id, item.level, item.achieved, item.evidence?.entryId ?? null])).toEqual([
      ['a', 'touched', false, 'p2'], ['b', 'explored', true, 'p2'], ['c', 'not-yet', false, null], ['d', 'set-aside', false, 'p6'],
    ]);
    expect(merged[0]!.levels).toMatchObject({ touched: .55 });
    expect(mergeCoverage([reading('a', 'explored', { explored: .9 })], [reading('a', 'set-aside', { 'set-aside': .9 }, 'p8')])[0]).toMatchObject({ level: 'set-aside', evidence: { entryId: 'p8' } });
  });

  test('touched coverage holds while the topic still came up, even as mass moves toward explored', () => {
    const previous = [reading('a', 'touched', { touched: .9 }, 'p2'), reading('b', 'explored', { explored: .9 }, 'p2')];
    const [held, demoted] = mergeCoverage(previous, [
      reading('a', 'not-yet', { 'not-yet': .1, touched: .3, explored: .6 }, null),
      reading('b', 'touched', { 'not-yet': .1, touched: .5, explored: .4 }, 'p4'),
    ]);
    expect(held).toMatchObject({ level: 'touched', achieved: false, evidence: { entryId: 'p2' } });
    // Only a touched prior uses P(raised); an explored prior still needs even odds for explored itself.
    expect(demoted).toMatchObject({ level: 'touched', achieved: false, evidence: { entryId: 'p4' } });
  });

  test('a declined topic stays closed through later uncertainty, until a supported answer reopens it', () => {
    const prior = [reading('a', 'set-aside', { 'set-aside': .9 }, 'p6')];
    expect(mergeCoverage(prior, [reading('a', 'touched', { touched: .4, 'set-aside': .6 }, 'p8')])[0]).toMatchObject({ level: 'set-aside', achieved: false, evidence: { entryId: 'p6' } });
    expect(mergeCoverage(prior, [reading('a', 'touched', { touched: .6, 'set-aside': .4 }, 'p8')])[0]).toMatchObject({ level: 'set-aside', evidence: { entryId: 'p6' } });
    expect(mergeCoverage(prior, [reading('a', 'not-yet', null, null)])[0]).toEqual(prior[0]);
    expect(mergeCoverage(prior, [reading('a', 'touched', { touched: .99, 'set-aside': .01 }, 'p8')])[0]?.levels?.['set-aside']).toBe(.9);
    expect(mergeCoverage(prior, [reading('a', 'explored', { explored: .9 }, 'p8')])[0]).toMatchObject({ level: 'explored', evidence: { entryId: 'p8' } });
    expect(mergeCoverage([reading('a', 'touched', { touched: .9 })], [reading('a', 'set-aside', { 'set-aside': .9 }, 'p8')])[0]).toMatchObject({ level: 'set-aside', evidence: { entryId: 'p8' } });
  });

});

test('confidence describes exploration, setting aside, or whether a provisional topic came up', () => {
  expect(coverageConfidence(reading('project-role', 'explored', { explored: .91, touched: .07, 'not-yet': .02 }))).toBe(.91);
  expect(coverageConfidence(reading('project-role', 'touched', { explored: .7, touched: .2, 'not-yet': .1 }))).toBeCloseTo(.9);
  expect(coverageConfidence(reading('project-role', 'set-aside', { 'set-aside': .88, 'not-yet': .12 }))).toBe(.88);
  expect(coverageConfidence(reading('project-role', 'not-yet', { 'not-yet': .96 }, null))).toBeNull();
  expect(coverageConfidence(reading('project-role', 'touched', null))).toBeNull();
  expect(coverageConfidence(undefined)).toBeNull();
});
