import type { NarrativeInput, NarrativeRun } from '../../../interview-engine/narrative/narrative.server';
import { NarrativeRunner, type SettledNarrative } from '../../../interview-engine/narrative/narrativeRun.server';
import { writeNarrative } from '../../../interview-engine/narrative/write.server';
import type { Providers } from '../../../interview-engine/providers/providers.server';
import type { NarrativeRequest } from '../../../interview-engine/shared/protocol';
import type { InterviewSpec } from '../../../interview-engine/shared/spec';
import type { Passage } from '../../../interview-engine/shared/transcript';
import { simulatorJson } from '../simulator/api';

/** Writes one narrative run: `writeNarrative` bound to the host's language provider, or a test's stand-in. */
export type Narrate = (input: NarrativeInput, signal: AbortSignal) => NarrativeRun;

export const narrateWith = (providers: Pick<Providers, 'language' | 'telemetry'>): Narrate => (input, signal) => writeNarrative(input, providers, signal);

/** Whether the participant said anything the narrative could be written from. */
export const participantSpoke = (passages: readonly Passage[]) => passages.some(passage => passage.speaker === 'participant' && passage.text.trim());

/**
 * The host's narrative for one transcript: one run plus one retry under the runner's deadline. The live attempt's
 * report and an imported transcript's narrative are both served by this.
 */
export function narrativeRunner(template: NarrativeInput['template'], passages: Passage[], narrate: Narrate, onSettled?: (narrative: SettledNarrative) => void) {
  return new NarrativeRunner(signal => narrate({ template, passages }, signal), onSettled ? { onSettled } : {});
}

/**
 * An imported transcript's narrative, streamed back and not stored. No attempt is involved: the transcript arrives
 * in the request, the spec is one the host serves, and the run ends with the request.
 */
export function importedNarrative(input: NarrativeRequest, specs: readonly Pick<InterviewSpec, 'id' | 'narrative'>[], narrate: Narrate, signal: AbortSignal): Response {
  const spec = specs.find(item => item.id === input.specId);
  if (!spec) return simulatorJson({ error: 'Unknown interview.' }, 404);
  if (!participantSpoke(input.passages)) return simulatorJson({ error: 'There is not enough conversation to write about.' }, 422);
  return narrativeRunner(spec.narrative as NarrativeInput['template'], input.passages, narrate).attach(signal);
}
