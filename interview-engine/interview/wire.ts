import type { Passage } from '../shared/transcript';

/**
 * The transcript names the running protocol, its snapshots and checkpoints still use: the participant is `trainee`
 * and the interviewer `client`, as in the practice simulator. The engine's Passage names reach the wire in a later phase.
 */
export type WireSpeaker = 'trainee' | 'client';
export type WireEntry = { id: string; speaker: WireSpeaker; text: string; startMs: number; endMs: number };

export const toPassage = ({ id, speaker, text, startMs, endMs }: WireEntry): Passage =>
  ({ id, speaker: speaker === 'trainee' ? 'participant' : 'interviewer', text, startMs, endMs });
export const toWireSpeaker = (speaker: Passage['speaker']): WireSpeaker => speaker === 'participant' ? 'trainee' : 'client';
