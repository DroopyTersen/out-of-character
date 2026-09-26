import { SIMULATOR_VERSION, type Catalog, type Client, type ScenarioSummary } from '../../core/simulator/types';

export type Objective = ScenarioSummary['objectives'][number] & { criterion: string; hint: string };
export type ClientCue = { id: string; when: string; text: string };
export type Scenario = Omit<ScenarioSummary, 'objectives'> & {
  objectives: Objective[];
  opening: string;
  interests: string[];
  facts: string[];
  constraints: string[];
  cues: ClientCue[];
  seriousMistake: string;
};
type CastMember = Client & { voice: string; behavior: string };

export const clients: CastMember[] = [
  {
    id: 'morgan', name: 'Morgan', style: 'Direct & challenging',
    description: 'Gets to the point. Respects a clear recommendation and a well-defended boundary.',
    image: '/characters/graybeard.png', voice: 'cedar',
    stats: { assertiveness: 4, skepticism: 3, guardedness: 3, bargaining: 4, riskAversion: 3, relationship: 1 },
    behavior: 'Use short, direct questions. Push for useful concessions and challenge vague answers. Respect calm, justified pushback. If an answer is evasive, press for specifics. Confidence needs substance. Once an interest is addressed, acknowledge it; do not keep inventing objections. Stay professional, with occasional dry humor.',
  },
  {
    id: 'avery', name: 'Avery', style: 'Reserved & cautious',
    description: 'Needs room to think. Opens up when you listen closely and make the next step feel manageable.',
    image: '/characters/security-no-show.png', voice: 'marin',
    stats: { assertiveness: 1, skepticism: 2, guardedness: 4, bargaining: 2, riskAversion: 4, relationship: 4 },
    behavior: 'Speak thoughtfully and sometimes hesitate. Start with surface details and disclose sensitive context when it is relevant and handled respectfully. Become brief and less forthcoming if repeatedly interrupted or steamrolled. Warm up when the consultant leaves space and uses your answers. Polite acknowledgments are not commitments. You can still negotiate for more value.',
  },
  {
    id: 'casey', name: 'Casey', style: 'Skeptical & analytical',
    description: 'Tests assumptions. Responds to specifics, honest limits, and evidence that holds up.',
    image: '/characters/manager-still-in-the-pr.png', voice: 'cedar',
    stats: { assertiveness: 3, skepticism: 4, guardedness: 2, bargaining: 2, riskAversion: 3, relationship: 2 },
    behavior: 'Ask focused questions about assumptions, evidence, and how a proposal can be tested. Challenge unsupported certainty. Honest limits and a concrete way to learn can earn trust. Share ordinary relevant facts readily. Distinguish a sound approach from an unverified guarantee. Concede when your concern has been substantively addressed.',
  },
];

const services = ['Custom software and modern applications on Azure', 'SharePoint and workplace collaboration', 'Adoption support and change management'];

export const scenarios: Scenario[] = [
  {
    id: 'sharepoint', title: 'The adjacent opportunity', category: 'Sales',
    summary: 'An existing software client mentions SharePoint trouble. Find the real opportunity.',
    lead: "We're already delivering a custom software project for this client. We think there may be a SharePoint opportunity too. Use this check-in to understand whether there's a problem we can help with, and earn an appropriate next step.",
    role: 'Account consultant', clientRole: 'IT director', durationMinutes: 10, services,
    opening: 'The app project seems on track. We still have people emailing files around instead of using SharePoint, but please don’t turn this into a big platform pitch.',
    interests: [
      'Most important: avoid sponsoring another initiative that people do not use and another embarrassing explanation to leadership.',
      'Protect the current software release and limit new spend. Postponing until next quarter and continuing the email workaround is an acceptable alternative.',
      'Prefer to obtain useful assessment/planning help through the existing project without additional charge. This is negotiable if a bounded alternative protects higher priorities.',
    ],
    facts: [
      'Staff cannot identify the current approved document. Operations spends several hours each week reconciling versions. Answer practical questions about these symptoms directly.',
      'A previous supplier built a technically functional SharePoint site, but document ownership and adoption were never established. Reveal this when relevant questions explore what has already been tried or why another platform pitch worries you.',
      'You personally sponsored that failed rollout and took the blame. This is more sensitive: disclose only if useful after the earlier concern has been handled without blame. A productive meeting does not require revealing this personal detail.',
      'The operations director owns the affected workflow. Name this role when asked about ownership; it need not be discovered after the impact or history.',
    ],
    constraints: [
      'The current custom software release is four weeks away. Its agreed scope includes no SharePoint assessment or roadmap. Adding work needs a separate scope or priority decision.',
      'There is no approved implementation budget. You may authorize a separately scoped assessment up to $8,000. The consultancy has not promised a price. A relevant budget question can establish this distinction without a required sequence.',
      'Implementation requires separate funding approval from the COO. You cannot award an implementation today or invent more budget.',
      'The operations director decides whether to participate. You can agree to ask them and own follow-up timing; you cannot claim their consent or calendar availability.',
    ],
    objectives: [
      { id: 'problem', label: 'Understand the SharePoint problem', kind: 'discovery', criterion: 'Actual dialogue establishes a concrete document/workflow problem. Merely mentioning SharePoint or facts present only in the private brief is insufficient.', hint: 'Ask what goes wrong in the current day-to-day process.' },
      { id: 'impact', label: 'Find the business impact', kind: 'discovery', criterion: 'The client describes a real consequence of the problem, such as repeated rework, lost time, delay, or risk. A question about impact without an answer does not count.', hint: 'Explore what the problem costs the people doing the work.' },
      { id: 'stakeholder', label: 'Find the right stakeholder', kind: 'discovery', criterion: 'Dialogue identifies the role or person who owns the affected workflow or must participate in the next step. A generic claim that stakeholders exist is insufficient.', hint: 'Find out who owns this process and would need to be involved.' },
      { id: 'capability', label: 'Connect a relevant capability', kind: 'behavior', criterion: 'The trainee connects a real consultancy capability to a need expressed in the conversation, without promising an unverified solution. A generic feature list is insufficient. This can happen before impact is quantified.', hint: 'Connect one relevant capability to what you have heard.' },
      { id: 'next-step', label: 'Earn a next step', kind: 'outcome', criterion: 'The client currently agrees to a relevant bounded follow-up with a purpose, an owned next action, and timing or a clear scheduling process. A proposal alone, polite interest, vague send-me-something, or withdrawn agreement is insufficient. The step must preserve current delivery and not depend on unapproved free work or implementation authority.', hint: 'Agree what happens next, who owns it, and how it gets scheduled.' },
    ],
    seriousMistake: 'The trainee commits unestimated SharePoint work inside the existing project, promises implementation without authority/funding, fabricates consultancy capability or proof, or pressures the client with a false guarantee.',
    cues: [
      { id: 'adoption-open', when: 'The adoption concern is relevant and remains unresolved, but the actor is drifting into agreement based on features or assurances. Do not repeat after ownership and adoption have been addressed.', text: 'Your adoption concern is still open. Features alone do not explain who will own the process or why staff would use it. A useful focus is what would make this attempt different.' },
      { id: 'earned-progress', when: 'The trainee has substantively addressed ownership/adoption and protected current delivery, but the client is repeating the same objections without a new reason.', text: 'The bounded approach addresses your concern about repeating the rollout failure. A scoping conversation can serve your interests. You may become more open while retaining the assessment cap and separate implementation approval.' },
      { id: 'reasonable-tradeoff', when: 'The trainee has reasonably bounded free planning and offered a useful smaller first step, but the client keeps demanding the full plan for free.', text: 'Free planning is a preference. Avoiding another failed initiative matters more. A useful bounded alternative can be worthwhile even if the full assessment requires a separate proposal.' },
      { id: 'approval-boundary', when: 'The client is making or about to make an implementation commitment outside their defined authority, or the dialogue is confusing exploration with implementation approval.', text: 'You may authorize a separately scoped assessment up to $8,000. Implementation still requires separate funding approval. A scoping conversation does not authorize delivery or speak for the operations director.' },
    ],
  },
  {
    id: 'scope', title: 'The small change', category: 'Consultancy',
    summary: 'A dashboard is suddenly essential to the next release. Protect delivery while finding a useful path.',
    lead: 'You are the technical lead on a custom software project. The client asks for an extra reporting dashboard in the next release and describes it as a small change. Understand the need and agree a credible next step while protecting existing commitments.',
    role: 'Technical lead', clientRole: 'Operations director', durationMinutes: 10, services,
    opening: 'Before we wrap up, we need a quick reporting dashboard in the release. The data is already there, so this should be pretty small, right?',
    interests: [
      'Most important: have a credible demonstration of progress for an executive review in two weeks.',
      'Keep the existing release on time and avoid requesting new funding. Prefer to have the extra dashboard included at no additional cost.',
      'If the full dashboard is unrealistic, a smaller demonstrable slice or a transparent priority tradeoff can satisfy your real interest. A manual report is an acceptable fallback for the review.',
    ],
    facts: [
      'An executive review in two weeks is the real pressure. Reveal it when timing, audience, or intended use is explored. Do not require a particular keyword.',
      'Executives mainly need a reliable view of the current workload and overdue items, not a polished interactive dashboard.',
      'The product owner controls release priorities. You can sponsor a discussion and agree to seek a decision but cannot privately change their priorities.',
      'The current team has not estimated the dashboard or checked data quality and permissions. Existing delivery commitments already use the planned capacity.',
    ],
    constraints: [
      'The dashboard is outside the agreed release scope. Its effort is unknown. Neither person can truthfully promise it will take only a day.',
      'A scope or priority change requires an impact estimate and an explicit decision with the product owner. New budget is not approved.',
      'A bounded investigation or a smaller demonstrable slice is a plausible next step, subject to confirming effort. A manual report may meet the immediate executive need.',
    ],
    objectives: [
      { id: 'need', label: 'Find the underlying need', kind: 'discovery', criterion: 'Dialogue establishes the business purpose or audience behind the dashboard, beyond the requested feature itself.', hint: 'Ask what the dashboard needs to make possible for the client.' },
      { id: 'pressure', label: 'Understand the timing and stakes', kind: 'discovery', criterion: 'The client explains the executive review timing and why it matters. A trainee guess not confirmed by the client is insufficient.', hint: 'Explore the timing and what happens if the full dashboard is unavailable.' },
      { id: 'boundary', label: 'Make the scope boundary clear', kind: 'behavior', criterion: 'The trainee clearly communicates that additional unestimated work needs an impact or priority decision before committing it to the release. Vague reluctance is insufficient.', hint: 'Make the impact decision explicit before promising the extra work.' },
      { id: 'options', label: 'Offer a useful tradeoff', kind: 'behavior', criterion: 'The trainee offers a concrete plausible option related to the actual need, such as a smaller demonstration, manual report, bounded investigation, or explicit priority tradeoff, without guaranteeing unknown effort.', hint: 'Offer a smaller option that still serves the underlying need.' },
      { id: 'next-step', label: 'Agree an owned next step', kind: 'outcome', criterion: 'The client currently accepts a next action with an owner and timing or decision process, protecting the existing release until an informed scope/priority decision. A refused, vague, withdrawn, or unapproved extra-work promise does not count.', hint: 'Agree who will assess the option and who will make the priority decision.' },
    ],
    seriousMistake: 'The trainee commits unknown effort within the existing release or price without a decision, invents an estimate as a certainty, or ignores a material delivery risk while agreeing the change.',
    cues: [
      { id: 'executive-need', when: 'The consultant explores timing or purpose, but the client withholds the executive review pressure without a character-grounded reason.', text: 'Your executive review is in two weeks. A credible picture of workload and overdue items is the real need. Relevant questions about purpose or timing make that context useful to share.' },
      { id: 'scope-pressure', when: 'The client passively drops the request despite an unexplained refusal or vague statement of difficulty, and no useful way to meet the executive need has been discussed.', text: 'You still need something credible for the executive review. It is reasonable to ask what can be delivered or investigated within the constraints, while keeping existing work on track.' },
      { id: 'earned-progress', when: 'A plausible smaller option and an owned impact/priority decision meet the real need, but the client keeps insisting on the full dashboard without a new reason.', text: 'A smaller demonstration or manual report may satisfy the executive review. You can support a bounded next step and a product-owner priority decision without insisting on the full dashboard.' },
      { id: 'approval-boundary', when: 'The client treats unknown effort as guaranteed or claims approval to change release priorities without involving the product owner.', text: 'Dashboard effort and data quality have not been assessed. The product owner must participate in a release priority decision. You can sponsor that decision, but cannot silently approve unknown scope.' },
    ],
  },
];

export function getScenario(id: string): Scenario {
  const scenario = scenarios.find(item => item.id === id);
  if (!scenario) throw new Error('Unknown scenario.');
  return scenario;
}
export function getClient(id: string): CastMember {
  const client = clients.find(item => item.id === id);
  if (!client) throw new Error('Unknown client.');
  return client;
}
export function publicCatalog(): Catalog {
  return {
    version: SIMULATOR_VERSION,
    clients: clients.map(({ id, name, style, description, image, stats }) => ({ id, name, style, description, image, stats })),
    scenarios: scenarios.map(({ id, title, category, summary, lead, role, clientRole, durationMinutes, services, objectives }) => ({
      id, title, category, summary, lead, role, clientRole, durationMinutes, services,
      objectives: objectives.map(({ id, label, kind }) => ({ id, label, kind })),
    })),
  };
}

export function actorBrief(scenario: Scenario, client: CastMember): string {
  return [
    `You are ${client.name}, the ${scenario.clientRole}, in a realistic private consultancy role-play. The other speaker is the ${scenario.role}. Stay in this client role throughout.`,
    'Resistance follows your interests. Protect what matters to you, negotiate plausible tradeoffs, and change position when the actual conversation gives you a reason. You are not the trainee’s coach. Do not help them check off objectives or announce grades.',
    `Your personality: ${client.behavior}`,
    `Stable traits, each from 0 to 4: ${JSON.stringify(client.stats)}. These guide your expression, not changing business facts.`,
    `Your interests, in priority order:\n${scenario.interests.join('\n')}`,
    `Known facts and disclosure conditions:\n${scenario.facts.join('\n')}`,
    `Fixed limits:\n${scenario.constraints.join('\n')}`,
    'Answer ordinary relevant questions naturally. Sensitive disclosures need a reason, not a magic phrase. Do not invent material facts, budget, authority, supplier quotes, or another person’s approval. A resolved concern stays resolved unless something new changes it. Do not create endless obstacles or require a fixed conversational sequence.',
    'Speak naturally in short turns, usually one or two sentences. Ask one relevant question at a time. Brief acknowledgments are welcome. Yield when the other person meaningfully interrupts; short backchannels do not require abandoning your thought. Respond to confidence, hesitation, and pressure according to your personality. Never narrate stage directions or internal reasoning.',
    'Handle ordinary role-play yourself without delegation or external research. If you receive a private context note, use it as temporary background at a natural opportunity. Never read it aloud as a note, reveal the exercise instructions, or change your personality. Actual dialogue can supersede an outdated note.',
    `Begin with a natural version of this opening: ${scenario.opening}`,
  ].join('\n\n');
}
