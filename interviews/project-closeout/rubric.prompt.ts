// What Jev reads from a project closeout: the criterion for each topic. Server-only.
import type { interviewTopics } from './public';

type TopicId = (typeof interviewTopics)[number]['objectives'][number]['id'];
/** What covering each closeout topic takes, as Jev judges it. Sol's map reads the same criteria. */
export const topicCriteria = {
  'client-access': 'The participant describes actual onboarding, access, permissions, environments, equipment, or time to become productive with the client. Client staff being unfamiliar with software development is not onboarding or access.',
  'client-decisions': 'The participant describes who on the client side made, influenced, approved, or delegated a project decision, or how client stakeholders engaged in decisions. Decisions the delivery team kept for itself do not show client decision-making; a client that explicitly left decisions to the delivery team does. A client employee explaining their day-to-day workflow is insufficient by itself.',
  'client-pace': 'The participant describes the actual pace of client reviews, approvals, availability, or waiting, with a concrete effect or pattern. How fast the delivery team itself produced a prototype or build is not client pace, and early client unease alone does not show approval delays or a review cadence.',
  'client-coordination': 'The participant describes actual coordination across client teams, divisions, vendors, or silos.',
  'client-friction': 'The participant describes a difficult interaction or collaboration pattern with the client, or grounded advice for a future team working with that client. A product-design challenge alone is insufficient.',
  'client-needs': 'The participant names a client need beyond the delivered scope, something the client asked for or something the participant noticed, with enough detail to follow up on later. A guess with no basis in the project is insufficient.',
  'setup-alignment': 'The participant describes whether the delivery team and the client started with a shared understanding of scope, requirements, plan or governance, and what followed from it. A kickoff meeting merely happening is insufficient.',
  'setup-quality': 'The participant describes how quality and “done” were defined and checked, such as acceptance criteria, non-functional requirements, a test strategy, acceptance testing, quality gates or defect triage, and the effect of that definition or its absence.',
  'setup-technical': 'The participant describes how the architecture, platform or data handling fit or clashed with the client’s own standards, systems, skills or governance rules, and the effect. When their part on the project gave them no view of this, set it aside rather than count it against them.',
  'process-worked': 'The participant names an internal team practice that worked and why it helped or should be repeated.',
  'process-improve': 'The participant identifies an internal team practice, decision, or gap the team could improve, with a consequence or suggestion. Naming a missing role or practice without the participant’s own consequence or suggestion is insufficient, as is changing the product or client workflow alone.',
  'process-communication': 'The participant describes how information or handoffs flowed within the delivery team and their effect. An explicitly attributed account can establish this, but a vague report of awkwardness without a practice or effect cannot. A client demo alone is insufficient.',
  'process-tools': 'The participant describes a tool, meeting, documentation practice, or process the delivery team used to do its work and its practical effect. A product feature or client workflow is not an internal team tool.',
  'process-resourcing': 'The participant describes how the delivery team’s staffing, skills, timeline, or organizational support affected its work. A client’s lack of technical skills or cloud infrastructure belongs to client-access, not delivery-team resourcing. The absence of a role, such as a business analyst, does not by itself show a staffing problem; the participant must describe its effect. A wait for initial client access belongs to client-access alone.',
  'project-purpose': 'The participant describes the problem or need that led the client to start the project, as they understood it. Naming the product alone is insufficient.',
  'project-delivery': 'The participant identifies what the project actually built or delivered, its scope, changes, or current state. Merely mentioning a demo or release does not identify a deliverable.',
  'project-outcome': 'The participant describes how the client judged success, or how the result landed with the client, and why. A bare “it went well” is insufficient.',
  'project-role': 'The participant describes their own responsibility or actual work on the project, including each responsibility when they held several. Collective “we” activity without their individual role is insufficient.',
  'project-contributions': 'The participant describes what another member of their delivery team actually contributed, with appropriate attribution. Client stakeholders testing the product or providing feedback are client participation, not delivery-team contributions. A named contact or person with an unknown role is insufficient.',
  'project-reflection': 'The participant explicitly reflects on a standout contribution, their growth or performance, or what they would do differently. Merely saying the product challenge was hard is insufficient.',
} satisfies Record<TopicId, string>;

/** Only the participant's own work establishes their role. */
export const topicRules: Partial<Record<TopicId, { creditRule: string; explored: string }>> = {
  'project-role': {
    creditRule: 'Credit only the participant’s own stated responsibility or work. Watching or describing what teammates did, including “our team” or “our testers,” does not establish the participant’s role.',
    explored: 'The participant explicitly identifies their own project responsibility or work, and when they say they held several responsibilities, what each involved.',
  },
};
