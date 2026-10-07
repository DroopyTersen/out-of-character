// What Jev reads from a project closeout: the criterion for each topic and the rubric for each reading. Server-only.
import type { ReadingRubric } from '../../interview-engine/shared/spec';
import type { InterviewReadingId, interviewTopics } from './public';

type TopicId = (typeof interviewTopics)[number]['objectives'][number]['id'];
/** What covering each closeout topic takes, as Jev judges it. Sol's map reads the same criteria. */
export const topicCriteria = {
  'client-access': 'The participant describes actual onboarding, access, permissions, environments, equipment, or time to become productive with the client. Client staff being unfamiliar with software development is not onboarding or access.',
  'client-decisions': 'The participant describes who on the client side made, influenced, approved, or delegated a project decision, or how client stakeholders engaged in decisions. Decisions the delivery team kept for itself do not show client decision-making; a client that explicitly left decisions to the delivery team does. A client employee explaining their day-to-day workflow is insufficient by itself.',
  'client-pace': 'The participant describes the actual pace of client reviews, approvals, availability, or waiting, with a concrete effect or pattern. How fast the delivery team itself produced a prototype or build is not client pace, and early client unease alone does not show approval delays or a review cadence.',
  'client-coordination': 'The participant describes actual coordination across client teams, divisions, vendors, or silos.',
  'client-friction': 'The participant describes a difficult interaction or collaboration pattern with the client, or grounded advice for a future team working with that client. A product-design challenge alone is insufficient.',
  'process-worked': 'The participant names an internal team practice that worked and why it helped or should be repeated.',
  'process-improve': 'The participant identifies an internal team practice, decision, or gap the team could improve, with a consequence or suggestion. Naming a missing role or practice without the participant’s own consequence or suggestion is insufficient, as is changing the product or client workflow alone.',
  'process-communication': 'The participant describes how information or handoffs flowed within the delivery team and their effect. An explicitly attributed account can establish this, but a vague report of awkwardness without a practice or effect cannot. A client demo alone is insufficient.',
  'process-tools': 'The participant describes a tool, meeting, documentation practice, or process the delivery team used to do its work and its practical effect. A product feature or client workflow is not an internal team tool.',
  'process-resourcing': 'The participant describes how the delivery team’s staffing, skills, timeline, or organizational support affected its work. A client’s lack of technical skills or cloud infrastructure belongs to client-access, not delivery-team resourcing. The absence of a role, such as a business analyst, does not by itself show a staffing problem; the participant must describe its effect. A wait for initial client access belongs to client-access alone.',
  'project-delivery': 'The participant identifies what the project actually built or delivered, its scope, changes, or current state. Merely mentioning a demo or release does not identify a deliverable.',
  'project-role': 'The participant describes their own responsibility or actual work on the project. Collective “we” activity without their individual role is insufficient.',
  'project-contributions': 'The participant describes what another member of their delivery team actually contributed, with appropriate attribution. Client stakeholders testing the product or providing feedback are client participation, not delivery-team contributions. A named contact or person with an unknown role is insufficient.',
  'project-reflection': 'The participant explicitly reflects on a standout contribution, their growth or performance, or what they would do differently. Merely saying the product challenge was hard is insufficient.',
} satisfies Record<TopicId, string>;

/** Only the participant's own work establishes their role. */
export const topicRules: Partial<Record<TopicId, { creditRule: string; explored: string }>> = {
  'project-role': {
    creditRule: 'Credit only the participant’s own stated responsibility or work. Watching or describing what teammates did, including “our team” or “our testers,” does not establish the participant’s role.',
    explored: 'The participant explicitly identifies their own project responsibility or work.',
  },
};

const readingCriteria = {
  engagement: [
    'The participant repeatedly gives unrelated or evasive replies to clear, answerable questions.',
    'The participant sometimes responds but rarely develops a useful answer when there is an opportunity.',
    'The participant follows the conversation and gives relevant answers, even when brief.',
    'The participant builds on questions with useful context or a meaningful clarification.',
    'The participant actively develops a productive thread, corrects misunderstandings, and helps establish what happened.',
  ],
  openness: [
    'The participant repeatedly sidesteps clear questions without offering a perspective or stating a limit.',
    'The participant shares little perspective despite clear opportunities; a stated boundary or honest uncertainty is not a fault.',
    'The participant shares their perspective within reasonable limits, including honest uncertainty.',
    'The participant discusses meaningful tradeoffs or limitations candidly while keeping appropriate boundaries.',
    'The participant offers a nuanced firsthand account, including uncertainty or difficult aspects where they choose to share them.',
  ],
  specificity: [
    'Only unsupported generalities or slogans are offered when concrete project detail is requested.',
    'Some project context is present but few tangible facts, actions, people, or consequences are identified.',
    'The participant gives at least one concrete fact or example that clarifies the project.',
    'Several grounded details explain who did what, what changed, or why a result mattered.',
    'Precise, useful examples connect actions, people, decisions, and consequences without claiming more than is known.',
  ],
} as const;

const readingTask = {
  engagement: 'How much does the participant follow and develop the conversation? A short expert answer can be strong. Length, emotional intensity, and profanity are not evidence of engagement.',
  openness: 'How candidly does the participant share their own perspective when they choose to answer? Honest uncertainty and a stated boundary are appropriate; do not treat them as low openness.',
  specificity: 'How concrete are the participant’s project facts and examples? A terse answer with a precise fact can be strong; a long vague rant is not.',
} as const;

export const readingRubrics: Record<InterviewReadingId, ReadingRubric> = {
  engagement: { task: readingTask.engagement, criteria: readingCriteria.engagement },
  openness: { task: readingTask.openness, criteria: readingCriteria.openness },
  specificity: { task: readingTask.specificity, criteria: readingCriteria.specificity },
};
