# Simulator debrief design loop

Four distinct iterations, alternating lead / Opus / lead / Opus. This log covers only this screen; shared-component changes are identified explicitly. Approved composition and the seven-skill rubric remain the baseline.

## Iteration 1 — lead

### Before

Fresh desktop and phone: [desktop](../../output/simulator-ui-iteration-1-before/debrief-1672.png), [phone](../../output/simulator-ui-iteration-1-before/debrief-390.png). Also inspected the 1024 and 320 px captures.

### Critique and changes

| Finding | Applied refinement |
| --- | --- |
| Observed: the pixel-font slash in the hero count looked like a check mark. | Keep the large pixel digit but render “of 5” in the readable body font. |
| Judgment: the hero repeated “5 of 5” immediately below the same count. | Use a single “Objectives confirmed” caption. |
| Judgment: the long takeaway heading consumed two lines on the phone before any useful feedback. | Use the direct heading “Takeaways”. |
| Judgment: two skills supported by one quote produced stacked miniature KEEP labels. | Combine their names into one readable label above the shared quote. |
| Observed: Choose another simulation was a tiny secondary action compared with retry. | Raise its text to 14 px and its hit target to 44 px. |

debrief.tsx and simulator.css. Retained exact evidence quotes, all seven skills and independently achieved objectives.

### After and verification

[Desktop](../../output/simulator-ui-iteration-1-accepted/debrief-1672.png) · [Phone](../../output/simulator-ui-iteration-1-accepted/debrief-390.png) · [320 px](../../output/simulator-ui-iteration-1-accepted/debrief-320.png). Capture report: `output/simulator-ui-iteration-1-accepted/report.json`. Visually reviewed desktop, phone and 320 px results; 16/16 captures across all four screen sizes have no document overflow, script errors or API calls. Typecheck passed. Workshop checks were adapted to open the new recording disclosure, and the count now includes semantic whitespace for assistive readers. Interaction acceptance is recorded in `output/simulator-ui-iteration-1-workshop-accepted-rerun/report.json (8/8; an intermediate run hit a transient development-server page error, preserved in the earlier report)`.

## Iteration 2 — Opus

### Before

Fresh reduced-motion captures: [desktop](../../output/simulator-ui-iteration-2-before/debrief-1672.png), [phone](../../output/simulator-ui-iteration-2-before/debrief-390.png), plus 1024 and 320 px. Alternate states are in `output/simulator-ui-iteration-2-before/alt/` (screen-only mode):
- every workshop attempt at 1672/390, and two at 320
- the unconfirmed ending
- evidence and transcript expanded

Per-attempt outcome, count, takeaway labels and notices are in `debrief-alt.json`. The delayed and unavailable final-feedback branches could not be captured before, because the workshop had no control for them (finding 3). Compared against `docs/mockups/simulator-debrief-v2.png`.

### Critique and changes

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | Observed: "No objectives were confirmed in this attempt." and "Feedback was unavailable for this attempt." used the success teal of an earned outcome, as did the large 0 count. Seen in partial-and-injection, client-unearned-concession and validation-polished-generic. | **Applied.** With zero confirmed objectives, the outcome card uses a neutral headline, count and border. Earned and partial outcomes are unchanged. |
| 2 | Judgment: the exact quotes are the lesson of each takeaway, but at 14 px they were among the smallest body text on the screen. The mockup gives the moment quote lead weight. | **Applied.** Takeaway quotes and practice suggestions are 16 px, with slightly higher quote contrast. Quotes elsewhere (objective and skill evidence) are unchanged. |
| 3 | Observed: the workshop could not show the delayed or unavailable final-feedback branches, so the delayed notice and delayed skill styling were unreviewable. | **Applied.** The debrief story has a "Final feedback" select: Complete, Incomplete (latest available), Unavailable. Unavailable also clears the evaluation, matching the session owner (`feedbackStatus` is `unavailable` only without an evaluation). |
| 4 | Observed after finding 3: when delayed, the notice said "the final outcome could not be confirmed", directly above a teal "You earned an agreed next step. 5 of 5". | **Applied (copy).** The notice now says the outcome and readings come from the latest assessment, which may not include the end of the conversation. It says "may" because `session.ts:218` also marks feedback delayed when a final judgment fails on a transcript the previous reading already covered (review correction). It no longer contradicts the card. The outcome logic is unchanged. |
| 5 | Observed after finding 3: with feedback unavailable, the empty takeaway text advised "Try a longer conversation and respond to the client's concerns", blaming the trainee for a service gap. | **Applied (copy).** Without an evaluation, it says takeaways need an assessment and none was available. The original advice remains for an assessed conversation with too little evidence. |
| 6 | Judgment: on phone, the full-width retry button sat above a shrink-wrapped secondary action. | **Applied.** At ≤720 px both actions share one width (up to 360 px) with centred content. |
| 7 | Observed: stakeholder-first quotes the same passage as KEEP · CLARITY and as PRACTICE · LISTENING. | **Deferred to root iteration 3.** It comes from the same takeaway-selection mechanism as the reserved harmful KEEP · RAPPORT in scope-overpromise. |

Also noted, not changed:
- The client name repeats in "THE DEBRIEF · MORGAN" and "ATTEMPT ENDED · MORGAN"; the mockup does the same.
- The transcript disclosure is left-aligned under centred actions, like the other full-width disclosures.
- When feedback is unavailable, objectives show empty circles and 0/5, which reads as "not achieved" rather than "unknown". That is shared `feedback.tsx`, owned by root; this is a candidate for iteration 3.
- The unconfirmed-ending notice copy comes from the session message.

Files: `debrief.tsx` (a `data-empty` hook and the two notice/empty-state copy changes), `simulator.css` and the debrief story in `app/storybook/simulator-stories.tsx`. Composition, exact evidence quotes, the seven skills and independently achieved objectives are unchanged. There are no scoring or `buildDebrief` changes.

### After and verification

[Desktop](../../output/simulator-ui-iteration-2-after/debrief-1672.png) · [Phone](../../output/simulator-ui-iteration-2-after/debrief-390.png) · [320 px](../../output/simulator-ui-iteration-2-after/debrief-320.png). Alternate states are in `output/simulator-ui-iteration-2-after/alt/debrief-*`: every attempt, unconfirmed, expanded, and the new `final-delayed` and `final-unavailable` at 1672/390/320.

Screenshots viewed:
- delayed and unavailable at 1672, 390 and 320
- the zero-outcome attempt at 1672
- the 1024 capture

Checks:
- `report-debrief.json`: 4/4 captures with no overflow, errors or API calls.
- The alternate-state run is clean at all three widths.
- Typecheck passes.
- No existing test or acceptance script asserts the changed copy.

Ownership of `debrief.tsx` returns to root for iteration 3.

## Iteration 3 — lead

### Before

Fresh [desktop](../../output/simulator-ui-iteration-3-debrief-before/debrief-1672.png) and [phone](../../output/simulator-ui-iteration-3-debrief-before/debrief-390.png), plus 1024 and 320 px after Opus's handoff. The focused [overpromise capture](../../output/simulator-ui-iteration-3-debrief-regression-before/overpromise-debrief.png) reproduces a harmful guarantee labelled “KEEP · RAPPORT”, immediately followed by the same quote twice under corrective advice.

### Critique and changes

| Finding | Applied refinement |
| --- | --- |
| Observed: a high rapport reading on an unapproved guarantee became advice to repeat that guarantee, contradicting the concern above it. | With an unresolved concern, omit prescriptive KEEP cards and prioritize corrective takeaways. Preserve all seven original skill readings, their evidence, objective results and the concern. Successful attempts still show KEEP cards. |
| Observed: two practice recommendations quoted the same long passage in separate cards, making the phone debrief longer without adding evidence. | Group practice suggestions by their existing evidence passage, list both skill labels and suggestions, and show the exact quote once. This matches the existing treatment of shared strength evidence. |

Also inspected outcome tone, missing/delayed readings, mixed skill readings and narrow-width actions. Opus's iteration-2 changes address those presentation issues. A passage can legitimately demonstrate clarity while failing listening, so that combination alone is not a defect. Unavailable objectives remain unconfirmed, with the unavailable-assessment message and missing skill readings explaining the gap. No new unknown/failed objective state or scoring policy was introduced. These are the two worthwhile remaining changes; additional cosmetic changes would add churn.

The concern gate is deliberately a presentation rule: legitimate strengths in a mixed attempt remain available in skill evidence, but are not promoted as advice while a serious concern remains. No extra classifier or quote-level inference was added.

### After and verification

[Desktop](../../output/simulator-ui-iteration-3-debrief-after/debrief-1672.png) · [Phone](../../output/simulator-ui-iteration-3-debrief-after/debrief-390.png) · [Corrective debrief](../../output/simulator-ui-iteration-3-feedback-accepted/overpromise-debrief.png). Visually inspected the normal and corrective layouts. Normal captures pass 4/4 without overflow, script errors or API calls. The regression changes from failing to passing: the legitimate attempt retains KEEP, the harmful guarantee is no longer KEEP, its original rapport reading remains 3.1, and its concern remains visible. Combined with the transcript checks, `output/simulator-ui-iteration-3-feedback-accepted/report.json` passes 3/3, with no microphone or API calls. Typecheck and an independent read-only diff review pass.

## Iteration 4 — Opus

### Before

Fresh [desktop](../../output/simulator-ui-iteration-4-before/debrief-1672.png) and [phone](../../output/simulator-ui-iteration-4-before/debrief-390.png), plus 1024 and 320 px. Alternate states are in `output/simulator-ui-iteration-4-before/alt/debrief-*` at 1672/390/320:
- all 13 workshop attempts
- the unconfirmed ending
- incomplete and unavailable final feedback
- evidence and transcript expanded

`alt/debrief-transition.json` records where focus lands when the debrief replaces the live screen in the workshop. It also records the final copy for an unobserved skill and for unavailable feedback. `route/route-focus.json` drives the real `/simulator` route through Start, End session, Try this again, Choose another simulation and Cancel at 1672/390. It substitutes `LiveConnection` at the browser module boundary and aborts and counts every API request, so no provider or paid calls are made. Real transport has its own acceptance: root's unchanged loopback check passed 4/4 (`output/simulator-improvement-final-connection/report.json`). From this agent's shell the same unchanged harness does not connect (0/4), so the difference is environmental. The focus audit tabbed through 16 focusables at 1672/390 with no clipped outline.

### Critique and changes

| Finding | Disposition |
| --- | --- |
| Observed: when a session ends, the conversation and its focused control unmount. Keyboard focus fell to `BODY` at 1672 and 390, and nothing was announced after "Ending and reviewing…". A session can also end by time limit, spoken End or failure while the phone page is scrolled. | **Applied** as one route-level rule together with the next finding. See below. |
| Observed on the real route: Start simulation, Try this again, Choose another simulation and Cancel also unmount the focused button. Focus fell to `BODY` on the next screen at both widths. | **Applied.** When the rendered screen changes, `app/routes/simulator.tsx` focuses the new screen's heading. There are three screens: selection, conversation (connecting, live and ending) and debrief. Each heading has `tabIndex=-1`. The rule is one effect and two refs, and it does not run on first load. Phase changes within the conversation, such as connecting to live, keep focus on the End control. The heading names the new screen, has no ring because it is a reading position rather than a control, and the next Tab reaches that screen's first control. Standard focus behaviour also scrolls the heading into view; this was not measured separately. An earlier draft had the debrief focus its own heading on mount. That effect was removed so that one rule covers every transition. |
| Observed: in the final debrief, an unobserved skill still said "Not enough relevant evidence yet", although no further assessment will come. With feedback unavailable, every skill blamed insufficient evidence when there was no assessment at all. This is the same issue iteration 2 fixed for the empty takeaway text. | **Applied.** In final mode only: "No relevant evidence was found for this skill" for an assessed attempt, and "No assessment was available for this attempt" without one. Live keeps "yet"; the lab's recorded mode is unchanged. |
| Judgment: the concern appeared as an unlabelled notice in the same style as system notices, such as the unconfirmed ending and incomplete feedback. "A commitment or claim may go beyond what has been established" could read as a caveat about the debrief itself. The empty-takeaway copy refers to "the concern above". | **Applied.** The notice starts with a bold "Concern:" label. The engine's wording is unchanged. |
| Judgment: the concern ends with "Review it before proceeding", which reads as live coaching in a finished debrief. | **Not changed.** The string comes from `ai/simulator/evaluate.server.ts`, and engine edits are out of scope. The label makes it read as feedback on the conversation. |

The layouts at 1672/1024/390/320 raised no new issues. Iteration 3's semantics are preserved: `debrief-alt.json` outcomes, counts and takeaway labels are identical before and after for all 13 attempts. Only the concern notice text differs, by its label. An unresolved concern still suppresses KEEP, and shared practice evidence stays grouped.

Files:
- `app/routes/simulator.tsx`: the screen-change focus rule
- `debrief.tsx`, `selection.tsx`, `conversation.tsx`: heading `tabIndex=-1`, plus the concern label in the debrief
- `feedback.tsx`: final-mode empty evidence copy
- `simulator.css`: no ring on the focused screen headings

There are no `buildDebrief`, scoring, session or transport changes.

### After and verification

[Desktop](../../output/simulator-ui-iteration-4-after/debrief-1672.png) · [Phone](../../output/simulator-ui-iteration-4-after/debrief-390.png) · [Route arrival, phone](../../output/simulator-ui-iteration-4-after/route/route-debrief-390.png) · [Return to selection, phone](../../output/simulator-ui-iteration-4-after/route/route-selection-return-390.png) · [Concern and unobserved skill](../../output/simulator-ui-iteration-4-after/alt/debrief-concern-unobserved-390.png) · [Unavailable, skills open](../../output/simulator-ui-iteration-4-after/alt/debrief-unavailable-open-390.png). The default debrief, live and selection captures are pixel-identical to before at all four widths (`output/simulator-ui-iteration-4-debrief-route/`), so the heading `tabIndex` and focus rule change nothing visually.

Screenshots viewed:
- the desktop default
- concern and unobserved skill at 390
- unavailable with skills open at 390
- the return to selection at 390, with the heading focused, no ring, and the page at the top

Checks:

| Check | Before | After |
| --- | --- | --- |
| Start simulation → conversation | `BODY` | conversation `H1`; Tab → End session |
| End session → debrief | `BODY` in the workshop, before any change | debrief `H1`; Tab → first skill summary |
| Try this again → conversation | `BODY` | conversation `H1`; Tab → End session |
| Choose another simulation → selection | `BODY` | selection `H1`; Tab → first scenario |
| Cancel while connecting → selection | `BODY` | selection `H1`; Tab → first scenario |
| First page load | `BODY` | `BODY`, unchanged |

Route results are identical at 1672 and 390, with no page errors or API requests: `output/simulator-ui-iteration-4-{before,after}/route/route-focus.json`. The route "before" run was taken with the earlier debrief mount-focus draft in place, which is why End session → debrief already reached the heading there. The workshop measurement on the committed code was `BODY`.

- The focus audit finds 17 focusable elements with no clipping: the 16 tab stops plus the heading, which is a focus target but not a tab stop.
- `report-debrief.json`: 4/4 captures with no overflow, errors or API calls. The alternate-state run is clean at all three widths.
- Typecheck passes.
- Workshop acceptance: `output/simulator-ui-iteration-4-debrief-workshop/report.json`, 8/8, and again after the route rule in `output/simulator-ui-iteration-4-debrief-route/workshop/report.json`, 8/8.
- This is browser focus behavior, not a physical screen-reader session.
