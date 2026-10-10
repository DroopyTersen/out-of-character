import { resolveInterview } from '../../interview-engine/interview/definition.server';
import { SESSION_IDLE_TIMEOUT_MS, SESSION_IDLE_WARNING_MS, SESSION_LIMIT_SECONDS, SESSION_MAX_RESUMES, SESSION_PAUSE_HOLD_MS } from '../../interview-engine/shared/timing';
import { orientation, persona } from './brief.prompt';
import { report } from './report';
import { topicCriteria, topicRules } from './rubric.prompt';
import { INTERVIEW_SCENARIO_ID, INTERVIEWER_NAME, interviewTopics, interviewVoices } from './public';

/** The approved plan is plain data; the engine owns prompt construction. */
export const spec = resolveInterview({
  id: INTERVIEW_SCENARIO_ID, version: 'project-closeout-v4', title: 'Project closeout', goals: 'Learn what the delivery team should repeat, change, or prepare for with this client. Capture concrete lessons about decisions, consequences, tradeoffs, and useful practices.',
  guidance: orientation.join('\n\n'),
  topics: interviewTopics.map(topic => ({ id: topic.id, label: topic.label, learn: `Understand ${topic.label.toLowerCase()} from the participant’s experience.`,
    topics: topic.objectives.map(objective => ({ id: objective.id, label: objective.label,
      learn: [topicCriteria[objective.id], topicRules[objective.id]?.creditRule, topicRules[objective.id]?.explored].filter(Boolean).join(' '),
    })),
  })),
  report,
}, {
  interviewer: { name: INTERVIEWER_NAME, voices: [...interviewVoices], persona },
  limits: { durationSeconds: SESSION_LIMIT_SECONDS, idleWarningMs: SESSION_IDLE_WARNING_MS, idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS, pauseHoldMs: SESSION_PAUSE_HOLD_MS, maxResumes: SESSION_MAX_RESUMES },
});
