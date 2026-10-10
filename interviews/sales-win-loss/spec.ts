import { resolveInterview } from '../../interview-engine/interview/definition.server';
import { orientation, persona } from './brief.prompt';
import { report } from './report';
import { SALES_WIN_LOSS_ID, SALES_WIN_LOSS_VERSION, salesInterviewerName, salesLimits, salesTopics, salesVoices } from './public';
import { salesCriteria, salesRules } from './rubric.prompt';

/** The approved plan is plain data; the engine owns prompt construction. */
export const spec = resolveInterview({
  id: SALES_WIN_LOSS_ID, version: SALES_WIN_LOSS_VERSION, title: 'Sales win/loss', goals: 'Understand why the buyer chose the outcome they did, including decisive criteria, doubts, comparisons, and turning points. Learn what the vendor should keep doing or change.',
  guidance: orientation.join('\n\n'),
  topics: salesTopics.map(topic => ({ id: topic.id, label: topic.label, learn: `Understand ${topic.label.toLowerCase()} from the participant’s experience.`,
    topics: topic.objectives.map(objective => ({ id: objective.id, label: objective.label,
      learn: [salesCriteria[objective.id], salesRules[objective.id]?.creditRule, salesRules[objective.id]?.explored].filter(Boolean).join(' '),
    })),
  })),
  report,
}, {
  interviewer: { name: salesInterviewerName, voices: [...salesVoices], persona },
  limits: salesLimits,
});
