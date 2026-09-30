import { describe, expect, test } from 'bun:test';
import type { Experimental_EvaluationQuestion } from 'ai';
import { interviewReadings, interviewTopics, INTERVIEW_SCENARIO_ID, coverageConfidence, mergeCoverage, type CoverageLevel, type InterviewObjectiveReading } from '../../core/interview';
import { INTERVIEW_CONDITIONS } from '../../core/simulator/director';
import { interviewFixtures } from './fixtures';
import recordings from './recordings.json';
import { coverageWindow, interviewerState, readInterviewAnswers, readInterviewerSignals, readResearchProbability, type InterviewAnswers } from './evaluate.server';
import { INTERVIEW_RUBRIC_VERSION, interviewQuestions, interviewerQuestions } from './rubric';
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

  test('the coverage window retains all saved evidence and its questions beside recent dialogue', () => {
    const entries = Array.from({ length: 12 }, (_, index) => ({ id: `p${index + 1}`, speaker: index % 2 ? 'trainee' as const : 'client' as const, text: `${index}`.padEnd(1_000, '.'), startMs: index, endMs: index + 1 }));
    const ids = (keep: string[]) => coverageWindow(entries, keep, 4_000).transcript.map(entry => entry.id);
    expect(ids([])).toEqual(['p9', 'p10', 'p11', 'p12']);
    expect(ids(['p2', 'p4'])).toEqual(['p1', 'p2', 'p3', 'p4', 'p9', 'p10', 'p11', 'p12']);
    expect(ids(['p2', 'p4', 'p6'])).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p9', 'p10', 'p11', 'p12']);
    expect(ids(['p10', 'missing'])).toEqual(['p9', 'p10', 'p11', 'p12']);
    expect(coverageWindow(entries, ['p2'], 4_000).earlierDialogueOmitted).toBe(true);
    expect(coverageWindow(entries.slice(0, 3), ['p2'], 4_000).earlierDialogueOmitted).toBe(false);
  });

  test('Sam is assessed through seven concerns and a separate research judgment', () => {
    const questions = interviewerQuestions();
    expect(Object.keys(questions)).toEqual([...INTERVIEW_CONDITIONS.map(condition => `director:${condition}`), 'research:useful']);
    expect(Object.values(questions).every(question => question.type === 'boolean')).toBe(true);
    expect(interviewReadings.map(item => item.id)).toEqual(['engagement', 'openness', 'specificity']);

    const answers = answersFor(questions);
    answers['director:missed-thread'] = { type: 'boolean', probability: .91 };
    answers['director:boundary-pressure'] = { type: 'boolean', probability: .04 };
    answers['research:useful'] = { type: 'boolean', probability: .73 };
    expect(readInterviewerSignals(answers)).toEqual(INTERVIEW_CONDITIONS.map(condition => ({
      condition, probability: condition === 'missed-thread' ? .91 : condition === 'boundary-pressure' ? .04 : .02,
    })));
    expect(readResearchProbability(answers)).toBe(.73);
    delete answers['director:source-confusion'];
    expect(() => readInterviewerSignals(answers)).toThrow('Invalid interview boolean judgment.');
    delete answers['research:useful'];
    expect(readResearchProbability(answers)).toBeUndefined();
    answers['director:source-confusion'] = { type: 'boolean', probability: .9 };
    for (const probability of [NaN, 1.1, -.1]) {
      answers['research:useful'] = { type: 'boolean', probability };
      expect(readResearchProbability(answers)).toBeUndefined();
      expect(readInterviewerSignals(answers)).toContainEqual({ condition: 'source-confusion', probability: .9 });
    }
  });

  test('only the interviewer receives bounded, actually delivered public facts and truncation state', () => {
    const fixture = interviewFixtures.find(item => item.id === 'background-already-supplied')!;
    const state = interviewerState(fixture.transcript, fixture.deliveredBackground);
    expect(state.deliveredBackground).toEqual([{ target: fixture.deliveredBackground![0]!.target, facts: fixture.deliveredBackground![0]!.facts,
      retrievedAt: fixture.deliveredBackground![0]!.retrievedAt, afterPassageId: 'p2', status: 'accepted' }]);
    expect(state.earlierDialogueOmitted).toBe(false);
    expect(interviewQuestions(fixture.transcript)['objective:project-delivery']).toBeDefined();
    const long = [...fixture.transcript, { ...fixture.transcript[1]!, id: 'p3', text: 'detail '.repeat(1800) }];
    expect(interviewerState(long).earlierDialogueOmitted).toBe(true);
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
