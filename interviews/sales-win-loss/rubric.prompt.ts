// What Jev reads from a win/loss debrief: the criterion for each topic. Server-only.
import type { salesTopics } from './public';

type TopicId = (typeof salesTopics)[number]['objectives'][number]['id'];

/** What covering each debrief topic takes, as Jev judges it. Sol's map reads the same criteria. */
export const salesCriteria = {
  'need-trigger': 'The participant names the event, problem, or deadline that started the search. A general wish to improve is insufficient.',
  'need-goals': 'The participant states what the purchase had to achieve, or how the buying organization would judge it a success.',
  'need-timing': 'The participant describes how urgent the decision was and what set the timeline, such as a renewal, a budget cycle, or an outage.',
  'evaluation-options': 'The participant describes the options that were seriously considered, including doing nothing or building in-house. Competitors may stay unnamed.',
  'evaluation-criteria': 'The participant names the criteria the options were compared on and which mattered most. A list of features alone, without what mattered, is insufficient.',
  'evaluation-process': 'The participant describes the steps the decision went through, such as demos, trials, security review, procurement, or approvals, and how long they took.',
  'evaluation-people': 'The participant describes who in the buying organization influenced, approved, or made the decision, and the participant’s own part in it.',
  'evaluation-deciding': 'The participant names what tipped the final decision. Repeating the overall outcome without a reason is insufficient.',
  'vendor-team': 'The participant describes how the vendor’s sales team behaved, such as responsiveness, understanding of the need, or follow-through, with a concrete example or effect.',
  'vendor-fit': 'The participant describes how well the vendor’s product fit the need, and what proof, such as a demo, trial, or reference, did or did not convince them.',
  'vendor-commercial': 'The participant describes how the vendor’s pricing, packaging, or terms compared and affected the decision. Exact figures are not required.',
  'vendor-risk': 'The participant describes how confident the buying group felt in the vendor, or what risk or doubt they saw, such as stability, security, or switching cost.',
  'vendor-outcome': 'The participant says what, if anything, would have changed the outcome, or what the vendor did that secured it.',
} satisfies Record<TopicId, string>;

/** Only the participant's own part establishes their role; the vendor's topics need words about the vendor. */
export const salesRules: Partial<Record<TopicId, { creditRule: string; explored?: string }>> = {
  'evaluation-people': {
    creditRule: 'Who decided must be stated, not inferred from a title. Describing the buying group without the participant’s own part covers it only partly.',
    explored: 'The participant names who made or approved the decision and their own part in it.',
  },
  'vendor-team': { creditRule: 'Credit only words about the vendor’s own team. Praise or criticism of a competitor’s sales team does not cover this topic.' },
  'vendor-fit': { creditRule: 'Credit only words about the vendor’s product. A competitor’s strengths count only when compared directly with the vendor’s.' },
};
