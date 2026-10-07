import { validateSpec } from '../../interview-engine/shared/spec';
import { salesNarrativeSchema, salesNarrativeSystem, salesNarrativeVersion } from './narrative.prompt';
import { SALES_WIN_LOSS_ID, SALES_WIN_LOSS_VERSION, salesInterviewerName, salesLimits, salesReadings, salesTopics, salesVoices } from './public';

/** A B2B sales win/loss debrief with a buyer. Not wired into any route: it proves the spec type carries a second interview. */
export const spec = validateSpec({
  id: SALES_WIN_LOSS_ID,
  version: SALES_WIN_LOSS_VERSION,
  interviewer: { name: salesInterviewerName, voices: salesVoices },
  topics: salesTopics,
  readings: salesReadings,
  limits: salesLimits,
  narrative: { id: 'sales-win-loss-debrief', version: salesNarrativeVersion, system: salesNarrativeSystem, schema: salesNarrativeSchema },
});
