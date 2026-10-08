import type { Technique, TopicGroup } from '../../shared/spec';
import type { MappedSpec } from './map.prompt';

const group = (id: string, label: string, objectives: [string, string][]): TopicGroup => ({
  id, label, objectives: objectives.map(([objective, name]) => ({ id: objective, label: name, criterion: `The participant covers ${name.toLowerCase()}.` })),
});

/** For tests: placeholder framing for every spec part that reads one. */
export const testFraming = {
  occasion: 'a test interview', topic: 'test topic', purpose: 'TEST PURPOSE', setting: 'TEST SETTING', defaultThread: 'TEST DEFAULT THREAD',
  terms: 'client means the test customer', party: 'TEST PARTY',
};

/** For tests: the brief's two spec techniques, as placeholders. */
export const testTechniques: { grounding: Technique; lesson: Technique } = {
  grounding: { name: 'TEST GROUNDING', means: 'Ground it.', when: 'First.', how: 'One question.', sounds: ['What is it?'] },
  lesson: { name: 'TEST LESSON', means: 'Draw the lesson.', when: 'After a story.', how: 'Ask what to do next time.' },
};

/** For tests: topics shaped like the closeout's, with placeholder criteria, placeholder framing, and an interviewer named Sam. */
export const testSpec = {
  interviewer: { name: 'Sam' },
  framing: testFraming,
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
