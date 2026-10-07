import { INTERVIEW_SCENARIO_ID, INTERVIEWER_NAME, interviewTopics, interviewVoices } from '../../core/interview';
import type { Client, ClientStats } from '../../core/simulator/types';
import type { Scenario } from '../simulator/scenarios.server';
import { topicCriteria } from '../../interviews/project-closeout/rubric.prompt';
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

export const interviewScenario: Scenario = {
  id: INTERVIEW_SCENARIO_ID, title: 'Project closeout interview', category: 'Interview',
  summary: 'Talk through a real project and capture what the team should remember.',
  lead: 'Have a candid, useful conversation about what was delivered, how the team worked, and what it was like working with the client.',
  role: 'Project participant', clientRole: 'interviewer', durationMinutes: 30, services: [],
  opening: 'You are meeting someone who worked on a real project for a process-improvement closeout. You know nothing about that project yet. State the purpose briefly, then ask what the project delivered and who the client was. Ask their role only if it is still unclear.',
  interests: [], facts: [], constraints: [], seriousMistake: '',
  objectives: interviewTopics.flatMap(topic => topic.objectives.map(item => ({
    ...item, kind: 'discovery' as const, criterion: topicCriteria[item.id],
    hint: `If it fits naturally, explore ${item.label.toLowerCase()}.`,
  }))),
};

/** Sam's brief for one voice, rendered by the engine from the closeout spec. */
export const interviewerBrief = (clientId: string, channel?: NoteChannel) => brief.interviewerBrief(spec, clientId, channel);
export const interviewOpening = (clientId: string) => brief.interviewOpening(spec, clientId);
