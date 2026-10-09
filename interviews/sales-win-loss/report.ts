import type { ReportFormat } from '../../interview-engine/shared/plan';

/** Approved default report requirements. The engine supplies the evidence policy. */
export const report: ReportFormat = {
  audience: 'The vendor’s sales, product, and leadership teams.',
  format: `The reader will use this to change how the vendor sells, prices, and builds, so concrete detail matters more than polish. Keep the trigger for the purchase, named options on the shortlist, criteria and their relative weight, demos, trials, proofs of concept and reference calls, procurement, security, and legal steps, timelines and slips, budget and pricing as stated, roles of the people involved, and specific moments that raised or lowered confidence. Prefer "the security review took six weeks because the vendor could not produce a SOC 2 report" to "the process was slow."
Describe competitors only through what the participant said about them. Do not add public facts, product claims, or pricing about any company that the participant did not supply.
Refer to people by role, or by name when the participant used one. Do not assume anyone's pronouns; use one only if the transcript does, otherwise repeat the role or name or use they/them.
Leave out personal details that do not bear on the decision. Keep figures the participant chose to share, but do not estimate missing ones.
Do not score or rate the participant, the deal, or the vendor's team.

STRUCTURE
No title or level-one heading; the page provides one. Open with two or three sentences: who the buyer is (organization type and the participant's role, as far as stated), what they were buying, and the outcome. If the interview said little about one or more of the sections below, note that in one sentence here rather than writing a thin section.
Then use these level-two headings, in this order, for each one the participant addressed with substance. Keep the names and the order; let length follow the material.
## Why they bought
The problem or event that started the search, what they hoped to achieve, how they would judge success, and what set the timing.
## How they decided
The options considered, including doing nothing or building in-house if mentioned; the criteria and which ones carried the most weight; the steps from first contact to decision; who was involved, who held the final say, and where approvals or procurement shaped the result. A short Markdown table comparing the shortlisted options against the criteria the participant named is welcome when they compared at least two options on at least two criteria; leave cells blank rather than filling them by inference.
## How the vendor came across
The participant's experience of the vendor's people, product, proof, pricing, and terms, compared with the alternatives where they drew the comparison. Separate strengths from concerns, and keep each tied to the moment or evidence the participant gave.
## What would have changed the outcome
For a loss, what the participant said would have won them over; for a win, what nearly lost it or what would make them reconsider at renewal. Report only what the participant said. If you add your own reading of the account, put it under a bold **Inferred** label, keep it to a sentence or two, and ground it in specific statements.
Add ## Follow-ups only when the participant offered a concrete opening, such as a renewal date, an unresolved objection, or an introduction to a colleague, or when a material fact stayed unclear. Do not list questions for every topic that went unmentioned.

Use bullets for separate points and short paragraphs for sequences of events. A single story belongs in the section where it mattered most; elsewhere, mention it in one clause rather than retelling it. Leave blank lines around headings, lists, and tables. Do not wrap the debrief in a code fence, and do not include HTML, images, or diagrams.

Do not invent reasons, competitors, numbers, or recommendations. Paraphrase unless quoting the participant's exact words.`,
};
