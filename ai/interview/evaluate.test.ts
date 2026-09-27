import { describe, expect, test } from 'bun:test';
import type { Experimental_EvaluationQuestion } from 'ai';
import { interviewReadings, interviewTopics, INTERVIEW_SCENARIO_ID } from '../../core/interview';
import { INTERVIEW_CONDITIONS } from '../../core/simulator/director';
import { interviewFixtures } from './fixtures';
import { readInterviewAnswers, readInterviewerSignals, type InterviewAnswers } from './evaluate.server';
import { interviewQuestions, interviewerQuestions } from './rubric';
import { interviewerBrief, interviewOpening, interviewScenario, interviewers } from './scenario.server';

function answersFor(questions: Record<string, Experimental_EvaluationQuestion>): InterviewAnswers {
  return Object.fromEntries(Object.entries(questions).map(([id, question]) => {
    if (question.type === 'boolean') return [id, { type: 'boolean', probability: 0.02 }];
    if (question.type === 'score') return [id, { type: 'score', score: 2 }];
    return [id, { type: 'choice', choice: 'none' }];
  })) as InterviewAnswers;
}

describe('project closeout interview contracts', () => {
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
    const evidence = questions['objective:client-access:evidence'];
    expect(evidence?.type).toBe('choice');
    if (evidence?.type === 'choice') expect(Object.keys(evidence.criteria ?? {})).toEqual(['none', 'p2']);

    const answers = answersFor(questions);
    answers['objective:client-access'] = { type: 'boolean', probability: .99 };
    answers['objective:client-access:evidence'] = { type: 'choice', choice: 'p2' };
    const result = readInterviewAnswers(fixture.transcript, answers);
    expect(result.objectives.find(item => item.id === 'client-access')).toMatchObject({ achieved: false, evidence: null });
    expect(result.readings.specificity.value).toBeNull();
  });

  test('a terse project fact is credited to its actual source passage', () => {
    const fixture = interviewFixtures.find(item => item.id === 'terse-expert')!;
    const answers = answersFor(interviewQuestions(fixture.transcript));
    answers['objective:project-delivery'] = { type: 'boolean', probability: .97 };
    answers['objective:project-delivery:evidence'] = { type: 'choice', choice: 'p2' };
    answers['objective:project-role'] = { type: 'boolean', probability: .96 };
    answers['objective:project-role:evidence'] = { type: 'choice', choice: 'p2' };
    answers['reading:specificity:observable'] = { type: 'boolean', probability: .98 };
    answers['reading:specificity'] = { type: 'score', score: 3.5 };
    answers['reading:specificity:evidence'] = { type: 'choice', choice: 'p2' };
    const result = readInterviewAnswers(fixture.transcript, answers);
    expect(result.objectives.filter(item => item.achieved).map(item => item.id)).toEqual(['project-delivery', 'project-role']);
    expect(result.objectives.find(item => item.id === 'project-delivery')?.evidence).toEqual({ entryId: 'p2', speaker: 'trainee', text: fixture.transcript[1]!.text });
    expect(result.readings.specificity).toMatchObject({ value: 3.5, evidence: { entryId: 'p2' } });
  });

  test('contextual two-word facts count while a vague yes does not', () => {
    const duration = interviewFixtures.find(item => item.id === 'terse-three-weeks')!;
    const durationAnswers = answersFor(interviewQuestions(duration.transcript));
    durationAnswers['objective:client-access'] = { type: 'boolean', probability: .98 };
    durationAnswers['objective:client-access:evidence'] = { type: 'choice', choice: 'p2' };
    expect(readInterviewAnswers(duration.transcript, durationAnswers).objectives.find(item => item.id === 'client-access')?.evidence?.text).toBe('Three weeks.');

    const agreement = interviewFixtures.find(item => item.id === 'vague-yes')!;
    const agreementAnswers = answersFor(interviewQuestions(agreement.transcript));
    agreementAnswers['objective:client-decisions'] = { type: 'boolean', probability: .98 };
    agreementAnswers['objective:client-decisions:evidence'] = { type: 'choice', choice: 'p2' };
    expect(readInterviewAnswers(agreement.transcript, agreementAnswers).objectives.find(item => item.id === 'client-decisions')?.achieved).toBe(false);
  });

  test('low confidence and unsupported source IDs cannot establish a topic', () => {
    const fixture = interviewFixtures.find(item => item.id === 'vague-rant')!;
    const answers = answersFor(interviewQuestions(fixture.transcript));
    answers['objective:process-communication'] = { type: 'boolean', probability: .84 };
    answers['objective:process-communication:evidence'] = { type: 'choice', choice: 'p2' };
    expect(readInterviewAnswers(fixture.transcript, answers).objectives.find(item => item.id === 'process-communication')?.achieved).toBe(false);
    answers['objective:process-communication'] = { type: 'boolean', probability: .99 };
    answers['objective:process-communication:evidence'] = { type: 'choice', choice: 'p1' };
    expect(() => readInterviewAnswers(fixture.transcript, answers)).toThrow('Invalid interview selection');
  });

  test('already heard topics are omitted from fresh questions; the other topics remain available', () => {
    const fixture = interviewFixtures.find(item => item.id === 'productive-thread')!;
    const questions = interviewQuestions(fixture.transcript, ['project-delivery']);
    expect(questions['objective:project-delivery']).toBeUndefined();
    expect(questions['objective:project-role']).toBeDefined();
    const result = readInterviewAnswers(fixture.transcript, answersFor(questions), ['project-delivery']);
    expect(result.objectives.find(item => item.id === 'project-delivery')).toEqual({ id: 'project-delivery', probability: null, achieved: true, evidence: null });
  });

  test('Sam is assessed through six independent concerns without participant scores or topic choices', () => {
    const questions = interviewerQuestions();
    expect(Object.keys(questions)).toEqual(INTERVIEW_CONDITIONS.map(condition => `director:${condition}`));
    expect(Object.values(questions).every(question => question.type === 'boolean')).toBe(true);
    expect(interviewReadings.map(item => item.id)).toEqual(['engagement', 'openness', 'specificity']);

    const answers = answersFor(questions);
    answers['director:missed-thread'] = { type: 'boolean', probability: .91 };
    answers['director:boundary-pressure'] = { type: 'boolean', probability: .04 };
    expect(readInterviewerSignals(answers)).toEqual(INTERVIEW_CONDITIONS.map(condition => ({
      condition, probability: condition === 'missed-thread' ? .91 : condition === 'boundary-pressure' ? .04 : .02,
    })));
    delete answers['director:source-confusion'];
    expect(() => readInterviewerSignals(answers)).toThrow('Invalid interview boolean judgment.');
  });
});
