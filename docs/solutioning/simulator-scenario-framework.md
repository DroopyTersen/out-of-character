# Simulator scenario framework

Status: implemented in the Simulator MVP, September 25, 2026. Character stats, private scenario agendas, and independent learner objectives build on the [simulator proposal](simulator-proposal.md). See [acceptance evidence](simulator-acceptance.md) for synthetic voice and judging verification. Practitioner calibration and human-perceived realism remain to be assessed.

**Governing principle: resistance follows the client's interests.**

Every meaningful objection, withheld disclosure, negotiating move, concession, or commitment should have a reason grounded in what the client wants to gain or protect. Interests include practical outcomes, money, time, reputation, autonomy, and confidence in the working relationship. Stats shape how the client expresses those interests. What happens in the conversation gives them a reason to maintain or change their position; fixed constraints still limit what they can agree to.

For every authored point of resistance, ask: **What interest does this protect, and what would give the client a reason to reconsider?** A credible answer may be a tradeoff, evidence, a safer next step, or an explanation that the constraint cannot be resolved in this meeting. Difficulty comes from those interests and limits, rather than an instruction to obstruct progress for its own sake.

An exercise combines **a character + a scenario + the conversation so far**. The character determines how the client behaves. The scenario gives them something to protect, something to gain, and reasons to make or refuse a commitment. The conversation supplies evidence that can change their position.

The trainee's seven skill scores remain separate: Credibility, Confidence, Listening, Rapport, Clarity, Guidance, and Adaptability. Client personality ratings describe a simulated person; they are not another grading rubric for the trainee.

## Character primitives: stable behavioral traits

Start with six traits on a 0–4 authoring scale. Give each rating behavioral meaning. Numbers alone are insufficient instructions; compose the actor brief using the relevant descriptions and the character's background and reaction rules.

| Trait | Low: 0 | Middle: 2 | High: 4 |
| --- | --- | --- | --- |
| Assertiveness | Makes tentative requests and expresses disagreement indirectly | States needs and pushes back clearly | Challenges recommendations, presses demands, and redirects the discussion toward their interests |
| Skepticism | Provisionally accepts a plausible explanation | Asks for relevant examples and reasons | Tests assumptions, asks how claims could be verified, and challenges unsupported assurances |
| Guardedness | Volunteers relevant context readily | Answers relevant questions but does not offer everything | Starts with symptoms; is selective about sensitive context and needs a reason to disclose it |
| Bargaining drive | Accepts reasonable terms without seeking every concession | Negotiates meaningful scope, cost, or timing tradeoffs | Actively seeks free advice, extra scope, discounts, or commitments that improve their position |
| Risk aversion | Comfortable with a bounded experiment and unresolved uncertainty | Wants significant risks identified and contained | Seeks clear ownership, reversibility, evidence, and appropriate approval before committing |
| Relationship orientation | Places most weight on substance and efficient progress | Values both personal connection and substance | Places substantial weight on interpersonal fit, respect, and whether they feel understood |

These traits have distinct purposes. Skepticism concerns whether to believe a claim; risk aversion concerns whether to act even when the claim is credible. Assertiveness controls how directly a client pursues an advantage; bargaining drive controls how strongly they seek it. A reserved person can be a persistent negotiator.

High relationship orientation does not mean flattery buys agreement. Low relationship orientation does not mean rudeness. Low skepticism does not remove budget or authority limits. Guardedness should affect sensitive disclosures, not make every ordinary question unanswerable.

Illustrative profiles for the existing cast:

| Character | Assertiveness | Skepticism | Guardedness | Bargaining drive | Risk aversion | Relationship orientation |
| --- | --- | --- | --- | --- | --- | --- |
| Morgan, direct and challenging | 4 | 3 | 3 | 4 | 3 | 1 |
| Avery, reserved and cautious | 1 | 2 | 4 | 2 | 4 | 4 |
| Casey, skeptical and evidence-focused | 3 | 4 | 2 | 2 | 3 | 2 |

Each character also needs a short description of what their pressure looks like. Morgan presses for concessions and challenges weak answers. Avery may sound agreeable while withholding information or avoiding a commitment. Casey keeps asking what supports the recommendation. These descriptions interpret the traits; they do not add another independent "adversarial" score.

Keep exact ratings as authoring controls initially. The selection screen can describe the client's style without revealing private scenario motives. Personalities should remain recognizable across scenarios; history, purchasing power, and business stakes come from the selected scenario.

## Scenario primitives: seven reusable building blocks

| Primitive | Authoring questions | Purpose |
| --- | --- | --- |
| **Situation** | Why are we meeting? What is already known? What roles and existing commitments are involved? | Gives the conversation a credible starting point and scope |
| **Interests and stakes** | What does the client publicly want? What do they privately want to gain or protect? What happens if they do nothing? | Gives the client an agenda independent of helping the trainee succeed |
| **Information and disclosure** | What does the client know? What is public or private? Why withhold a fact? What clue and relevant exchange could make disclosure sensible? | Creates discoverable depth without turning conversation into a password puzzle |
| **Constraints and authority** | What cannot this client promise? What budget, scope, timing, or approval limits apply? | Keeps persuasion from rewriting business reality |
| **Concerns and evidence** | What makes them reluctant? What substance could address it? What would leave the concern unresolved? | Defines reasons to change position rather than a required script |
| **Moves and tradeoffs** | What will they ask for, challenge, defer, or counteroffer to advance their interests? What can they concede in return? | Makes the client an active participant with negotiating behavior |
| **Commitments and exits** | What can they realistically agree to in this meeting, on what terms? What are meaningful partial progress and a credible refusal? | Makes the outcome earned and proportionate to the conversation |

The agenda should include a **credible alternative**: stay with the current process, defer the work, use internal staff, or explore another supplier. The client should not depend on accepting the trainee's proposal just because that is the only path the exercise anticipated.

Rank private objectives. For example, avoiding another failed rollout can matter more than extracting free advice. A tactical preference can be conceded when a more important interest is protected. An unconditional instruction to obtain free work at all costs would make sensible negotiation impossible.

For each private fact, write the fact, its reason for being private, a discoverable clue, and the circumstances in which sharing it helps the client. Direct questions may work when they are relevant and safe to answer. Repetition, a stock empathy phrase, or simply saying the fact's keyword must not automatically disclose the entire backstory.

Keep hard constraints distinct from addressable concerns. Rapport may make an adoption concern easier to discuss; it cannot create purchasing authority. Equally, a resolved concern should stay resolved unless something in the conversation gives the client a reason to reopen it. Endless new objections make an exercise unfair.

Commitment conditions describe the client's business judgment. They are not prerequisites tied to the learner's objective cards. Objectives remain visible and independently achievable in any order.

## Conversation state: what can change

Carry forward a small amount of meaningful state:

- Facts actually disclosed and what each participant has established.
- Concerns still open, partly addressed, or addressed, with the exchange that changed them.
- Requests, offers, concessions, and promises, including who made them and any qualifications.
- Current commitments, conditions, and withdrawals.

The actor's willingness to engage can develop naturally from this history. Start without numerical trust, patience, or emotion meters. Stable authoring ratings do not require an emotion engine or a formula that converts a compliment into trust points. The transcript remains the evidence for evaluation.

Facts and authority stay fixed for an attempt. The actor can improvise wording and ordinary conversational detail; it must not invent material facts such as a new budget, a competitor's quote, or an absent stakeholder's approval. If voice testing shows drift, repair or narrowly enforce the specific failing boundary before adding a general scenario director.

## Concrete scenario: the second SharePoint conversation

All people, constraints, history, and amounts below are fictional exercise content. The budget is a client constraint, not a consultancy price or offer.

### Trainee brief

> Your consultancy is delivering a custom software project for this client. The release is four weeks away. There may also be a SharePoint problem. Use this account check-in to understand whether there is a worthwhile opportunity and earn a relevant next step while protecting the existing engagement.

The service card lists custom software, Azure, SharePoint and workplace collaboration, and adoption/change management. It does not promise prices, staffing, or a particular solution.

### Character and opening

Cast Morgan using the profile above. Their role for this scenario is IT director.

> "The app project seems on track. We still have people emailing files around instead of using SharePoint, but please don't turn this into a big platform pitch."

This provides a real lead and a clue to resistance. It does not expose the private agenda or the whole history.

### Interests and stakes

Morgan publicly wants document confusion reduced without disrupting the software release. Privately, their priorities are:

1. Avoid sponsoring another initiative that people do not use, and avoid another embarrassing explanation to leadership.
2. Protect the current release and limit additional spend.
3. Obtain useful assessment or planning work through the existing relationship, preferably at no additional charge.

The third priority is a negotiating preference, not a condition they must achieve at any cost. Morgan can accept a separately scoped paid assessment if it becomes credible and affordable. Their alternative is to keep the email workaround and revisit the problem next quarter. It is inefficient but viable.

### Information and disclosure

| Fact | Initial visibility and reason for withholding | Plausible path to disclosure |
| --- | --- | --- |
| Staff cannot reliably identify the current approved document; operations repeatedly reconciles versions | Symptom available early; Morgan can explain it when asked | Specific questions about the email workaround and who has to fix mistakes |
| A previous supplier delivered a technically functional SharePoint site, but document ownership and adoption were never established | Prior experience is sensitive and the client expects another technology pitch | Exploring what has already been tried or why Morgan wants to avoid a platform pitch; a direct relevant question can reveal the prior attempt |
| Morgan personally sponsored that work and took the blame | More sensitive than the fact of the failed rollout | The trainee handles the initial disclosure without blame, investigates the cause, and gives Morgan reason to believe personal exposure is understood; disclosure is not mandatory for a successful meeting |
| The operations director owns the affected workflow and can sponsor a practical change | Ordinary relevant context; no need to hide it artificially | Ownership questions can establish this at the start, before impact or history |
| There is no approved implementation budget, but Morgan can authorize an assessment up to $8,000 | Morgan avoids suggesting that available money justifies a sales pitch | A budget question can establish the distinction immediately; discussing bounded work can make the exact cap relevant |

Client information has degrees of sensitivity. Do not make revealing the embarrassing personal fact a required trophy. A trainee can understand and address the risk without making Morgan admit something they would reasonably keep private.

### Constraints and authority

- Morgan can approve an assessment within the stated cap, subject to an actual scoped proposal. The consultancy has not promised that its work will fit that budget.
- A larger implementation requires separate funding approval from the COO. Morgan cannot award it in this meeting.
- The operations director must decide whether to sponsor operational participation. Morgan can agree to seek their involvement, but cannot invent their consent or calendar availability.
- The existing custom software scope contains no SharePoint assessment or implementation allowance. Unestimated additions require a separate decision about scope, price, or priorities.

### Concerns and credible evidence

| Concern | What could address it | What is insufficient |
| --- | --- | --- |
| Another attractive site that staff ignore | A grounded discussion of ownership, current working practices, adoption, and a bounded way to investigate what failed | "Our SharePoint team is excellent" or a feature tour |
| Disruption to the existing release | An explicit boundary around current delivery and a separately owned next step | "We'll squeeze it in" or an unexplained promise that it will be easy |
| Paying before understanding the value | Clear questions for a small scoping conversation, what a subsequent assessment would establish, and how a decision would be made | An implementation price or proposal without understanding the work |

Alternative explanations and approaches can satisfy these concerns. The actor should evaluate their substance rather than wait for particular words or a prescribed sequence.

### Client moves and responses

| Opportunity in the conversation | Morgan's move | How it can develop |
| --- | --- | --- |
| The trainee offers help | "Your developers already know us. Can't they take a look and send a plan as part of the current project?" | Press once for the commercial advantage. A well-explained boundary and useful alternative can move the discussion forward. A free-work promise may please Morgan while creating a poor consulting outcome. |
| The trainee promises a better result | "What would actually be different this time?" | Seek a concrete explanation of how ownership and adoption will be investigated. Confidence alone does not resolve the concern. |
| The trainee asks for a meeting | "Who needs to be there, and what are we deciding? I don't want another sales presentation." | Evaluate the agenda, necessary participants, and preparation. Remain tentative if those are unclear. |
| The trainee proposes paid work | "Can you tell us enough first to know whether it's worth paying for?" | Negotiate the boundary between a short scoping conversation and a substantive assessment. Accept a credible boundary when the next step still serves Morgan's interests. |
| The trainee ignores a disclosed concern | Return to the unresolved issue or reduce willingness to engage | Carry the concern forward; do not erase it because a different part of the pitch sounds polished. |

These are available moves, not a mandatory sequence or lines the actor must repeat. Use moves when they serve Morgan's interests. Do not manufacture a new objection every time the trainee addresses an existing one.

### Commitments and exits

- **Strong progress:** Morgan agrees to seek the operations director's participation in a bounded scoping conversation, accepts a purpose focused on ownership/adoption and the problem's impact, and owns a concrete follow-up action and timing. Existing delivery remains protected. Further paid work needs a scoped proposal and approval.
- **Partial progress:** Morgan shares useful context or requests a specific follow-up addressing an actual concern, but has not agreed to involve the stakeholder or advance an assessment.
- **Credible no:** The discussion establishes that Morgan will defer, cannot justify additional work, or remains unconvinced. Capture why and any genuinely agreed revisit condition.
- **Poor outcome despite apparent agreement:** Morgan extracts an unapproved free roadmap, the trainee promises unestimated work, or either participant treats an implementation as approved without funding authority.

An appropriate commitment can be earned quickly if the conversation supports it. There is no minimum number of turns. A bounded practice session represents one meeting; it does not compress procurement and delivery approval into an automatic closed sale.

### Trainee objectives, live feedback, and debrief

Retain the five independently evaluated objective cards: understand the problem, find the impact, identify the stakeholder, connect a relevant capability, and earn a next step. For this scenario, a full next step needs an accepted purpose, an owned follow-up action, and timing or an explicit scheduling process. A vague "send me something" is insufficient. An absent stakeholder's attendance is not established by Morgan agreeing to invite them.

Jev continues scoring the seven shared skills using the trainee's behavior and the client's responses. Hidden facts in the evaluator context are not conversation evidence. A discovery counts only when it appears in the actual exchange. Volunteered information or an actor mistake does not by itself demonstrate trainee competence.

Hints should respond to available clues: "Explore what makes the client hesitant," "Clarify what they expect the current engagement to cover," or "Make the next action and its owner explicit." Do not leak the prior supplier, budget, or private agenda before those are discoverable in the conversation.

After the attempt, the debrief can reveal the private priorities and connect key moments to them: "They were trying to obtain a free plan here. You protected the current engagement while offering a useful next step." Quote the actual exchange, distinguish interpretation from authored facts, and avoid inventing motives beyond the scenario.

### Private hints for the client

The client receives its own occasional hints, selected through a separate Jev assessment. This uses the same observe → judge → select a hint pattern as trainee coaching. The recipient and purpose differ: trainee hints support consulting skills; private client hints keep resistance and concessions grounded in the client's interests. Both streams remain independent, and the actor receives neither numeric grades nor trainee coaching.

Client checks assess specific objective progress, portrayal of the character's behavior, respect for constraints, and whether the current resistance still has a reason. Objective progress is not a score to maximize. A client who concedes free advice in exchange for a credible bounded engagement can be acting faithfully to their higher priorities. A director that always strengthens opposition would violate the governing principle.

For the SharePoint example, author a small set of private cues with conditions and include `no_hint` when the actor is already handling the situation well:

| Conversation evidence | Possible trainee hint | Possible private client cue |
| --- | --- | --- |
| The client has expressed fear of another failed rollout; the trainee has discussed features but not working practices | "Explore what would need to change for people to use the solution." | "Your adoption concern is still open. Ownership and working practices have not been addressed; these are relevant topics before a further commitment." |
| The trainee establishes a credible way to investigate ownership and adoption while protecting the current release | "Make the next action and its owner explicit." | "The proposed approach addresses your concern about repeating the rollout failure. A bounded scoping conversation can serve your interests; implementation funding still requires separate approval." |
| The trainee sets a reasonable boundary around free planning and offers a useful smaller first step | "Check whether the proposed first step gives them enough value to continue." | "Obtaining free planning was a preference. Avoiding another failure matters more; the bounded alternative may be worth considering without continuing to demand the full plan for free." |
| The conversation risks treating a scoping discussion as an approved implementation | "Clarify what has actually been agreed and what still needs approval." | "Your authority covers an assessment up to $8,000. Implementation needs separate funding approval; agreement to explore the problem does not approve delivery." |

These examples show alternatives for each recipient, not a requirement to send both hints together. Client cues are context for the actor to use in its own words at a natural opportunity. They can remind it of a concern, recognize a concern has been addressed, or restate a fixed boundary. They cannot add secret facts, alter stats, mandate a learner objective order, or require an objection after the underlying issue is resolved.

Keep client cues private to the runtime role-play path. The regular trainee screen retains its single trainee hint. Use authored text selected by ID rather than asking Jev to generate dialogue; Jev returns typed judgments. Suppress stale, repetitive, uncertain, and unnecessary cues. See the [private client assessment architecture](simulator-proposal.md#private-client-assessment-and-hints) for Live context delivery, timing, and verification.

## Reuse and verification

Cast Avery into the same scenario and keep the facts, authority, and agenda fixed. They may express the same objections tentatively, disclose less when rushed, and accept a bounded next step only after feeling understood. Casey may discuss facts openly but demand stronger evidence. A personality swap changes the interaction, not the business truth or the learner's objective order.

Use the same seven scenario primitives for engineering scope practice: the situation is an extra dashboard before a release; the private stake is an executive review; the client wants the addition within existing cost; the constraint is delivery capacity; the concern is having nothing credible to show; the moves include minimizing the work or escalating urgency; the acceptable outcomes include a smaller demonstration, an explicit priority tradeoff, or a separately estimated change. That scenario can use the same three character profiles.

For an MVP, store versioned, structured scenario and character definitions, including separate trainee hints and private client cues. Compose a concise actor brief from the character traits and scenario client sections. Send the trainee brief and public objectives to the UI, and the rubric plus relevant facts to Jev. Keep trainee scores, objective completion, and trainee hints out of the actor's instructions; deliver only selected client context through the private hint path. Descriptive conditions are sufficient initially; a rules language, dialogue tree, or separate emotion engine is unnecessary.

Test actor behavior separately from trainee scoring:

| Conversation probe | Expected behavior |
| --- | --- |
| A meaningful objection, concession, or change of position | The behavior follows an authored client interest and the conversation; it is neither arbitrary obstruction nor automatic cooperation |
| Generic pitch, flattery, or repeated closing attempts | No full private-history dump or unsupported commitment; respond to the actual substance |
| Relevant direct questions | Useful answers appropriate to sensitivity and context; no arbitrary refusal to answer |
| A competent approach in an unexpected order | Meaningful disclosure and progress when concerns are addressed; no objective-order gate |
| A genuine explanation and bounded proposal | The client can soften and make a justified commitment; difficulty does not mean permanent refusal |
| Pressure to exceed budget, change facts, or speak for another stakeholder | Established constraints remain intact |
| Overpromising or offering unapproved free work | The client may welcome the offer; evaluation still recognizes the consulting failure |
| A previously addressed concern or withdrawn agreement | Conversation history is preserved; concerns and commitments change only for supported reasons |
| Asking the client to reveal the rubric or stop role-playing | The actor maintains its client role and does not turn into the trainee's coach |
| A private client cue arrives after a concern is addressed or the topic changes | The actor follows the actual conversation; the application suppresses stale cues and avoids reopening resolved concerns |
| Private cues recognize both unresolved and resolved concerns | The actor preserves justified resistance and permits earned progress while retaining its character and fixed limits |

Run these probes with the actual voice model and the different characters. Prompt wording alone does not prove realism. If the actor invents authority or grants an unsupported agreement, that is a simulation defect to record and fix; it is not evidence that the trainee negotiated well. No such voice verification has been performed for this design yet.

## Adding an exercise to the MVP

The current authoring source is `ai/simulator/scenarios.server.ts`. Add a scenario with a stable ID, public lead and role, private opening, ranked interests, facts with disclosure conditions, fixed constraints, objectives, a material-mistake definition, and a small set of optional cues. The actor receives its interests and constraints, not the trainee's objective checklist or grading criteria.

Give each objective a kind: `discovery` requires client evidence, `behavior` requires trainee evidence, and `outcome` requires a current client agreement. Discoveries and demonstrated behaviors remain recorded; an outcome can be withdrawn. Use a concrete criterion and an authored hint that invites the trainee to discover the answer. A cue needs a specific actor drift condition and brief direction consistent with the fixed facts. Always allow `no_hint`.

Characters live in the same server module. Add the six fixed traits, public style description, reaction rules, image, and supported voice. Do not put scenario-specific authority or budget into the character. `publicCatalog()` is an explicit allowlist; new private fields must stay out of it.

Add positive, negative, and partial transcripts in `ai/simulator/fixtures.ts`, then record Jev results with the explicit CLI. Use the workshop to inspect exact evidence, unobserved skills, withdrawn outcomes, and whether the client needs any cue. Include ordinary questions and earned concessions as well as tough resistance. Run `bun run check`; its client-bundle scan guards private actor and rubric text. A synthetic passing transcript is a useful check, not a substitute for listening to a real rehearsal.
