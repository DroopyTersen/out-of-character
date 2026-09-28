import type { ObjectiveReading, SkillReading } from './simulator/types';
import { z } from 'zod';

export const INTERVIEW_SCENARIO_ID = 'project-closeout';
export const INTERVIEWER_NAME = 'Sam';
export const interviewVoices = [
  { id: 'sam-cedar', voice: 'cedar', label: 'Cedar', presentation: 'Male', image: '/interview/sam-male.png' },
  { id: 'sam-gleam', voice: 'gleam', label: 'Gleam', presentation: 'Female', image: '/interview/sam-female.png' },
] as const;

export const interviewReadings = [
  { id: 'engagement', label: 'Engagement', description: 'Following the conversation and developing an answer.' },
  { id: 'openness', label: 'Openness', description: 'Sharing your perspective, including uncertainty and tradeoffs.' },
  { id: 'specificity', label: 'Specificity', description: 'Giving concrete examples of what happened.' },
] as const;
export type InterviewReadingId = typeof interviewReadings[number]['id'];

export const interviewTopics = [
  { id: 'project', label: 'What you delivered', objectives: [
    { id: 'project-delivery', label: 'Deliverables & scope' },
    { id: 'project-role', label: 'Your role' },
    { id: 'project-contributions', label: 'Who contributed what' },
    { id: 'project-reflection', label: 'Standouts & growth' },
  ] },
  { id: 'client', label: 'Working with the client', objectives: [
    { id: 'client-access', label: 'Onboarding & access' },
    { id: 'client-decisions', label: 'Decisions & stakeholders' },
    { id: 'client-pace', label: 'Pace & approvals' },
    { id: 'client-coordination', label: 'Teams, vendors & silos' },
    { id: 'client-friction', label: 'Friction & advice for next time' },
  ] },
  { id: 'process', label: 'How the team worked', objectives: [
    { id: 'process-worked', label: 'What worked well' },
    { id: 'process-improve', label: 'What could work better' },
    { id: 'process-communication', label: 'Communication & handoffs' },
    { id: 'process-tools', label: 'Tools & process' },
    { id: 'process-resourcing', label: 'Support, staffing & time' },
  ] },
] as const;

export type InterviewEvaluation = {
  revision: number;
  readings: Record<InterviewReadingId, SkillReading>;
  objectives: ObjectiveReading[];
  model: string;
  durationMs: number;
};
export type InterviewSummary = { status: 'pending' | 'ready' | 'unavailable'; text: string | null };
export const interviewSummarySchema = z.strictObject({ text: z.string().trim().min(1) });
export type InterviewSummaryContent = z.infer<typeof interviewSummarySchema>;
/** Public references only; preparation and producer directions remain private. */
export type InterviewBackground = {
  id: string;
  target: { kind: 'organization' | 'product' | 'term'; name: string };
  facts: { text: string; url: string; title: string }[];
  retrievedAt: number;
};
export type InterviewSession = { evaluation: InterviewEvaluation | null; summary: InterviewSummary | null; background?: InterviewBackground[] };

export function emptyInterviewReadings(): InterviewEvaluation['readings'] {
  return Object.fromEntries(interviewReadings.map(({ id }) => [id, { value: null, distribution: null, evidence: null }])) as InterviewEvaluation['readings'];
}
