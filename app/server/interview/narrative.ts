import type { NarrativeInput, NarrativeRun } from '../../../interview-engine/narrative/narrative.server';
import { NarrativeRunner, type SettledNarrative } from '../../../interview-engine/narrative/narrativeRun.server';
import { writeNarrative } from '../../../interview-engine/narrative/write.server';
import type { Providers } from '../../../interview-engine/providers/providers.server';
import type { NarrativeRequest } from '../../../interview-engine/shared/protocol';
import type { Passage } from '../../../interview-engine/shared/transcript';
import { jsonResponse } from '../http';

/** Writes one narrative run: `writeNarrative` bound to the host's language provider, or a test's stand-in. */
export type Narrate = (input: NarrativeInput, signal: AbortSignal) => NarrativeRun;

export const narrateWith = (providers: Pick<Providers, 'language' | 'telemetry'>): Narrate => (input, signal) => writeNarrative(input, providers, signal);

/** Whether the participant said anything the narrative could be written from. */
export const participantSpoke = (passages: readonly Passage[]) => passages.some(passage => passage.speaker === 'participant' && passage.text.trim());

/**
 * The host's narrative for one transcript: one run plus one retry under the runner's deadline. The live attempt's
 * report and an imported transcript's narrative are both served by this.
 */
export function narrativeRunner(input: NarrativeInput, narrate: Narrate, onSettled?: (narrative: SettledNarrative) => void, track?: (work: Promise<unknown>) => void) {
  const frozen = structuredClone(input);
  return new NarrativeRunner(signal => narrate(frozen, signal), { ...(onSettled ? { onSettled } : {}), ...(track ? { track } : {}) });
}

/**
 * An imported transcript's narrative, streamed back and not stored. No attempt is involved: the transcript arrives
 * with its format and explicit context. Nothing could rejoin the run, so it ends with the request.
 */
export async function importedNarrative(input: NarrativeRequest, narrate: Narrate, signal: AbortSignal): Promise<Response> {
  if (!participantSpoke(input.transcript)) return jsonResponse({ error: 'There is not enough conversation to write about.' }, 422);
  const runner = narrativeRunner(input, narrate);
  signal.addEventListener('abort', () => runner.cancel(), { once: true });
  return runner.attach(signal);
}
