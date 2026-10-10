// Browser labels and choices; spec.ts supplies the approved plan and host runtime configuration.
import { z } from 'zod';

export const INTERVIEW_SCENARIO_ID = 'project-closeout';
export const INTERVIEWER_NAME = 'Sam';
export const interviewVoices = [
  { id: 'sam-cedar', voice: 'cedar', label: 'Cedar', presentation: 'Male', image: '/interview/sam-male.png' },
  { id: 'sam-gleam', voice: 'gleam', label: 'Gleam', presentation: 'Female', image: '/interview/sam-female.png' },
] as const;

export const interviewTopics = [
  { id: 'project', label: 'What you delivered', objectives: [
    { id: 'project-purpose', label: 'Why the client needed it' },
    { id: 'project-delivery', label: 'Deliverables & scope' },
    { id: 'project-outcome', label: 'Success & how it landed' },
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
    { id: 'client-needs', label: 'Needs beyond the scope' },
  ] },
  { id: 'setup', label: 'How the work was set up', objectives: [
    { id: 'setup-alignment', label: 'Shared starting picture' },
    { id: 'setup-quality', label: 'What “done” meant' },
    { id: 'setup-technical', label: 'Technical fit with the client' },
  ] },
  { id: 'process', label: 'How the team worked', objectives: [
    { id: 'process-worked', label: 'What worked well' },
    { id: 'process-improve', label: 'What could work better' },
    { id: 'process-communication', label: 'Communication & handoffs' },
    { id: 'process-tools', label: 'Tools & process' },
    { id: 'process-resourcing', label: 'Support, staffing & time' },
  ] },
] as const;
export const interviewSummarySchema = z.strictObject({ text: z.string().trim().min(1) });
