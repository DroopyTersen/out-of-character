import { validateSpec } from '../../interview-engine/shared/spec';
import { SESSION_IDLE_TIMEOUT_MS, SESSION_IDLE_WARNING_MS, SESSION_LIMIT_SECONDS, SESSION_MAX_RESUMES, SESSION_PAUSE_HOLD_MS } from '../../core/simulator/types';
import { narrativeSystem } from './narrative.prompt';
import { INTERVIEW_SCENARIO_ID, INTERVIEWER_NAME, interviewReadings, interviewSummarySchema, interviewTopics, interviewVoices } from './public';

/** The project closeout interview. Server code reads it whole; browser code imports ./public so the prompt stays out of the bundle. */
export const spec = validateSpec({
  id: INTERVIEW_SCENARIO_ID,
  version: 'project-closeout-v1',
  interviewer: { name: INTERVIEWER_NAME, voices: interviewVoices },
  topics: interviewTopics,
  readings: interviewReadings,
  limits: {
    durationSeconds: SESSION_LIMIT_SECONDS,
    idleWarningMs: SESSION_IDLE_WARNING_MS,
    idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
    pauseHoldMs: SESSION_PAUSE_HOLD_MS,
    maxResumes: SESSION_MAX_RESUMES,
  },
  narrative: { id: 'project-closeout-summary', version: 'interview-summary-v1', system: narrativeSystem, schema: interviewSummarySchema },
});
