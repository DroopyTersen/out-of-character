import { validateSpec } from '../../interview-engine/shared/spec';
import { SESSION_IDLE_TIMEOUT_MS, SESSION_IDLE_WARNING_MS, SESSION_LIMIT_SECONDS, SESSION_MAX_RESUMES, SESSION_PAUSE_HOLD_MS } from '../../core/simulator/types';
import { boundaries, opening, orientation, persona, role, techniques } from './brief.prompt';
import { framing } from './framing.prompt';
import { narrativeSystem } from './narrative.prompt';
import { readingRubrics, topicCriteria, topicRules } from './rubric.prompt';
import { INTERVIEW_SCENARIO_ID, INTERVIEWER_NAME, interviewReadings, interviewSummarySchema, interviewTopics, interviewVoices } from './public';

/** The project closeout interview. Server code reads it whole, with the interviewer's brief, the framing, Jev's criteria and the narrative prompt; browser code imports ./public so they stay out of the bundle. */
export const spec = validateSpec({
  id: INTERVIEW_SCENARIO_ID,
  version: 'project-closeout-v1',
  interviewer: { name: INTERVIEWER_NAME, voices: interviewVoices, role, persona, opening, orientation, boundaries, techniques },
  framing,
  topics: interviewTopics.map(topic => ({ ...topic, objectives: topic.objectives.map(objective => ({ ...objective, criterion: topicCriteria[objective.id], ...topicRules[objective.id] })) })),
  readings: interviewReadings.map(reading => ({ ...reading, rubric: readingRubrics[reading.id] })),
  limits: {
    durationSeconds: SESSION_LIMIT_SECONDS,
    idleWarningMs: SESSION_IDLE_WARNING_MS,
    idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
    pauseHoldMs: SESSION_PAUSE_HOLD_MS,
    maxResumes: SESSION_MAX_RESUMES,
  },
  narrative: { id: 'project-closeout-summary', version: 'interview-summary-v1', system: narrativeSystem, schema: interviewSummarySchema },
});
