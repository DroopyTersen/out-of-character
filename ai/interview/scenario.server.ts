import { INTERVIEWER_NAME, interviewVoices } from '../../core/interview';
import type { Client, ClientStats } from '../../core/simulator/types';
import { persona } from '../../interviews/project-closeout/brief.prompt';
import { spec } from '../../interviews/project-closeout/spec';
import * as brief from '../../interview-engine/interview/voice/brief.server';
import type { NoteChannel } from '../../interview-engine/interview/voice/channel';

const stats: ClientStats = { assertiveness: 2, skepticism: 2, guardedness: 1, bargaining: 0, riskAversion: 2, relationship: 4 };

export const interviewers: (Client & { voice: string; behavior: string; stats: ClientStats })[] = interviewVoices.map(({ id, voice, label, image }) => ({
  id, name: INTERVIEWER_NAME, style: `Warm & perceptive · ${label}`,
  description: 'A thoughtful conversation about what happened on a real project.',
  image,
  voice, behavior: persona, stats,
}));

/** Sam's brief for one voice, rendered by the engine from the closeout spec. */
export const interviewerBrief = (clientId: string, channel?: NoteChannel) => brief.interviewerBrief(spec, clientId, channel);
export const interviewOpening = (clientId: string) => brief.interviewOpening(spec, clientId);
