import { validateSpec } from '../../interview-engine/shared/spec';
import { boundaries, opening, orientation, persona, role, techniques } from './brief.prompt';
import { framing } from './framing.prompt';
import { salesNarrativeSchema, salesNarrativeSystem, salesNarrativeVersion } from './narrative.prompt';
import { SALES_WIN_LOSS_ID, SALES_WIN_LOSS_VERSION, salesInterviewerName, salesLimits, salesReadings, salesTopics, salesVoices } from './public';
import { salesCriteria, salesRubrics, salesRules } from './rubric.prompt';

/**
 * A B2B sales win/loss debrief with a buyer. Not wired into any route: it proves the engine runs a second interview.
 * Server code reads it whole, with the brief, the framing, Jev's criteria and the narrative prompt; browser code imports ./public.
 */
export const spec = validateSpec({
  id: SALES_WIN_LOSS_ID,
  version: SALES_WIN_LOSS_VERSION,
  interviewer: { name: salesInterviewerName, voices: salesVoices, role, persona, opening, orientation, boundaries, techniques },
  framing,
  topics: salesTopics.map(topic => ({ ...topic, objectives: topic.objectives.map(objective => ({ ...objective, criterion: salesCriteria[objective.id], ...salesRules[objective.id] })) })),
  readings: salesReadings.map(reading => ({ ...reading, rubric: salesRubrics[reading.id] })),
  limits: salesLimits,
  narrative: { id: 'sales-win-loss-debrief', version: salesNarrativeVersion, system: salesNarrativeSystem, schema: salesNarrativeSchema },
});
