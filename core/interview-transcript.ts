import { z } from 'zod';
import type { Passage } from '../interview-engine/shared/transcript';

/** Historical exports used the practice simulator's speaker names. Normalize only at the host's read boundary. */
export const archivedTranscriptSchema = z.array(z.object({
  id: z.string(), speaker: z.enum(['participant', 'interviewer', 'trainee', 'client']),
  text: z.string(), startMs: z.number(), endMs: z.number(),
})).transform((entries): Passage[] => entries.map(entry => ({
  ...entry, speaker: entry.speaker === 'trainee' ? 'participant' : entry.speaker === 'client' ? 'interviewer' : entry.speaker,
})));
