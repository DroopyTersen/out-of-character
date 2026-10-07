import type { TopicGroup } from '../../shared/spec';
import type { MappedSpec } from './map.prompt';

const group = (id: string, label: string, objectives: [string, string][]): TopicGroup => ({
  id, label, objectives: objectives.map(([objective, name]) => ({ id: objective, label: name, criterion: `The participant covers ${name.toLowerCase()}.` })),
});

/** For tests: topics shaped like the closeout's, with placeholder criteria, and an interviewer named Sam. */
export const testSpec = {
  interviewer: { name: 'Sam' },
  topics: [
    group('project', 'What you delivered', [['project-delivery', 'Deliverables & scope'], ['project-role', 'Your role'], ['project-contributions', 'Who contributed what'], ['project-reflection', 'Standouts & growth']]),
    group('client', 'Working with the client', [
      ['client-access', 'Onboarding & access'], ['client-decisions', 'Decisions & stakeholders'], ['client-pace', 'Pace & approvals'],
      ['client-coordination', 'Teams, vendors & silos'], ['client-friction', 'Friction & advice for next time'],
    ]),
    group('process', 'How the team worked', [
      ['process-worked', 'What worked well'], ['process-improve', 'What could work better'], ['process-communication', 'Communication & handoffs'],
      ['process-tools', 'Tools & process'], ['process-resourcing', 'Support, staffing & time'],
    ]),
  ],
} satisfies MappedSpec;
