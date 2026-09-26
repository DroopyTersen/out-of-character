# Simulator selection design loop

Four distinct iterations, alternating lead / Opus / lead / Opus. This log covers only this screen; shared-component changes are identified explicitly. Approved composition and the seven-skill rubric remain the baseline.

## Iteration 1 — lead

### Before

Fresh desktop and phone: [desktop](../../output/simulator-ui-iteration-1-before/selection-1672.png), [phone](../../output/simulator-ui-iteration-1-before/selection-390.png). Also inspected the 1024 and 320 px captures.

### Critique and changes

| Finding | Applied refinement |
| --- | --- |
| Judgment: panel headings had different baselines because only the client heading included 44 px arrow controls. | Give both panel headings the same minimum height. |
| Observed: the long scenario list clipped at the bottom with no persistent scroll instruction on systems that hide scrollbars. | Add a short scroll cue beside the scenario count only for larger collections. |
| Judgment: the lead label was tiny beside the paragraph, weakening the role briefing. | Raise it to 11 px with tighter tracking. |
| Judgment: the selected client portrait was much smaller than its card portrait, especially on the phone. | Fill its existing portrait box without changing the panel composition. |
| Observed: company and behavior-profile disclosures had smaller touch targets than the adjacent 44 px navigation buttons. | Give their summaries a consistent 44 px target. |

selection.tsx and simulator.css. A first after capture exposed a new narrow-header wrap from the longer scroll cue; shortened it and used responsive panel-heading type before acceptance.

### After and verification

[Desktop](../../output/simulator-ui-iteration-1-accepted/selection-1672.png) · [Phone](../../output/simulator-ui-iteration-1-accepted/selection-390.png) · [320 px](../../output/simulator-ui-iteration-1-accepted/selection-320.png). Capture report: `output/simulator-ui-iteration-1-accepted/report.json`. Visually reviewed desktop, phone and 320 px results; 16/16 captures across all four screen sizes have no document overflow, script errors or API calls. Typecheck passed. Workshop checks were adapted to open the new recording disclosure, and the count now includes semantic whitespace for assistive readers. Interaction acceptance is recorded in `output/simulator-ui-iteration-1-workshop-accepted-rerun/report.json (8/8; an intermediate run hit a transient development-server page error, preserved in the earlier report)`.

## Iteration 2 — Opus

### Before

Fresh reduced-motion captures: [desktop viewport](../../output/simulator-ui-iteration-2-before/selection-1672-viewport.png), [phone](../../output/simulator-ui-iteration-2-before/selection-390.png), [320 px](../../output/simulator-ui-iteration-2-before/selection-320.png), plus 1024 px. Alternate states at 1672/1024/390/320 are in `output/simulator-ui-iteration-2-before/alt/selection-*`, with measurements in `selection-alt.json`:
- every disclosure expanded
- scenario list and client rail scrolled
- disabled start with an error

Intermediate measurements are in `output/simulator-ui-iteration-2-selection-check/`.

### Critique and changes

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | Observed: at 320 px the "Your client" heading wrapped beside the rail arrows, making the header 43 px tall against the scenario header's single line. | **Applied.** At ≤360 px: a tighter heading gap, 17 px heading type and closer arrow controls. The header is now 20 px, one line. |
| 2 | Observed: at 320 px the Start button label wrapped to two lines (85 px tall). | **Applied.** The phone Start label scales with the viewport (`clamp`). It is one line, 55 px. |
| 3 | Observed: at 1672 px the scenario list showed only a 5 px sliver of the next scenario, so the scroll cue carried the whole signal. | **Applied.** The list is taller (322 px) and the brief spacing is tighter. The next item now peeks 33 px, and Start remains above the fold (bottom at 938 of 941 px). |
| 4 | Observed: the client rail mis-peeked. At 1672, 97% of the next card was visible, so it read as fully shown but cut off. At 390, only 4% was visible, too little to signal more cards. | **Applied.** Card width uses a clamped flex basis, and long names end in an ellipsis. The next card now shows 48% at 1672 and 30% at 390. |
| 5 | Observed: the behavior-profile trait meters used the browser's default green and grey, outside the palette. | **Applied.** The meters use the theme track and accent colours in both engines' pseudo-elements. |

Also noted, not changed:
- The 1024 px scenario peek depends on content.
- "Scroll ↓" remains after the list reaches its end.
- The disabled/error state reads correctly.
- The brief column at 320 px is narrow but legible.

Files: `app/simulator/simulator.css` only. No `selection.tsx` change was needed.

### After and verification

[Desktop viewport](../../output/simulator-ui-iteration-2-after/selection-1672-viewport.png) · [Phone](../../output/simulator-ui-iteration-2-after/selection-390.png) · [320 px](../../output/simulator-ui-iteration-2-after/selection-320.png). Alternate states are in `output/simulator-ui-iteration-2-after/alt/selection-*`, with measurements in `selection-alt.json`; the phone rail comparison is `rail-390-pair.png`.

Checks:
- `report-selection.json`: 4/4 captures with no overflow, errors or API calls.
- Typecheck passes.
- Iteration 3 later reused the company disclosure as "Objectives & services"; the alternate-state script targets that summary.

## Iteration 3 — lead

### Before

Fresh [desktop viewport](../../output/simulator-ui-iteration-3-selection-before/selection-1672-viewport.png) and [320 px](../../output/simulator-ui-iteration-3-selection-before/selection-320.png), after Opus completed this screen's iteration 2. Also inspected 390/1024 and Opus's expanded, scrolled and disabled states. File ownership was limited to `selection.tsx` and this log section while Opus worked on the other screens.

### Critique and change

One worthwhile remaining change emerged: the lead displays an objective count, but the trainee cannot inspect the actual objectives before starting voice practice. Add the public objective labels to the existing consultancy disclosure and name it **Objectives & services**. Explicitly say they can be reached in any order. This introduces no private actor facts and no extra top-level panel.

I inspected five areas: preparation content, closed-screen height, carousel peeking, narrow heading/button wrapping, and keyboard disclosure/selection. The latter four had been addressed or were functioning correctly. A second always-visible objective panel would push Start below the 941 px reference viewport; reusing the disclosure preserves the approved composition. No additional cosmetic changes were justified in this pass.

### After and verification

[Desktop viewport](../../output/simulator-ui-iteration-3-selection-after/selection-1672-viewport.png) · [Sales preparation on phone](../../output/simulator-ui-iteration-3-selection-after/preparation-sales-390.png) · [Consultancy preparation at 320 px](../../output/simulator-ui-iteration-3-selection-after/preparation-scope-320.png).

Four closed-screen captures pass with no overflow/errors/API calls. A keyboard-driven check opens the disclosure, switches scenarios, and confirms the five distinct public objectives are visible for each at 1672/1024/390/320 px. `preparation-accepted-report.json` records the result. The first harness mistakenly expected four consultancy objectives; its original report is retained, and the expectation was corrected from the authored five-objective scenario. No app data or objective policy changed.

## Iteration 4 — Opus

### Before

Fresh reduced-motion captures: [desktop viewport](../../output/simulator-ui-iteration-4-before/selection-1672-viewport.png), [phone](../../output/simulator-ui-iteration-4-before/selection-390.png), [320 px](../../output/simulator-ui-iteration-4-before/selection-320.png), plus 1024. Alternate states are in `output/simulator-ui-iteration-4-before/alt/`:
- expanded Objectives & services and Behavior profile
- scrolled to the end of both lists
- microphone error with live unavailable
- keyboard focus on the first scenario and client cards (new in this pass)

`selection-alt.json` records heading heights, CTA size, list peeks and the Start position at 1672/1024/390/320.

### Critique and changes

| Finding | Disposition |
| --- | --- |
| Observed: the global focus ring (2 px, 5 px outside) was clipped by the scenario list and client rail, which have only 3 px of padding. The first scenario and client cards showed no top or left ring; on phone the client ring was visible only on the right and bottom. Measured at 1672 and 390. | **Applied.** Inside these two lists only, the ring is drawn 5 px inside the card edge. It stays distinct from the selected border and clear of the check mark. No list padding or card width changed. |
| Judgment: iteration 3 correctly made the objectives available before practice, but the disclosure body inherited 12 px grey. The trainee's preparation list was the smallest text on the screen, below the 15–19 px brief. | **Applied.** The opened body is 14 px; objectives, services and subheadings use the brief's body tone. The summary is unchanged, so the closed screen and Start position are identical. |
| Observed: "Scroll ↓" still pointed down after the list reached its end. | **Applied (simplified after review).** The copy is now direction-neutral, **Scroll to browse**, under the existing more-than-three-scenarios condition. No scroll tracking was added; the scrollbar and partial card already show position. |
| Judgment: at 320 px, the client description runs to 5–6 lines in a ~150 px column beside the portrait. | **Not changed.** It stays readable at 14 px, and a smaller portrait would gain only about 20 px without removing a line from the role. |
| Observed: at 1024×941, Start ends at 971 px (partly below the fold) and the fourth scenario peeks by 12 px. | **Not changed.** The page scrolls normally, and the partial Start button remains visible. Tightening the tablet layout to fit an arbitrary height would churn settled spacing. |

Also reviewed, not changed:
- The hard top edge of the scrolled scenario list; the scrollbar makes the position clear.
- The large gap between stacked notices in the error alternate. The story forces a microphone denial while live is unavailable, which cannot occur because Start is disabled.
- The "· Preview N" titles, which are the story's illustrative data.

Files: `app/simulator/simulator.css` (two lines) and `app/simulator/selection.tsx` (hint copy only). No catalog, objective or selection behavior changed.

### After and verification

[Desktop viewport](../../output/simulator-ui-iteration-4-after/selection-1672-viewport.png) · [Phone](../../output/simulator-ui-iteration-4-after/selection-390.png) · [320 px](../../output/simulator-ui-iteration-4-after/selection-320.png) · [Expanded, 320 px](../../output/simulator-ui-iteration-4-after/alt/selection-expanded-320.png) · [Client focus, phone](../../output/simulator-ui-iteration-4-after/alt/selection-focus-client-390.png) · [Scenario focus, desktop](../../output/simulator-ui-iteration-4-after/alt/selection-focus-scenario-1672.png).

Screenshots viewed:
- before and after focus rings at 1672/390
- expanded preparation at 1672/390/320
- the scrolled list
- the heading at 320

Checks:
- `report-selection.json`: 4/4 captures with no overflow, errors or API calls.
- `alt/selection-alt.json`: heading heights, CTA size, peeks and Start position (938/941 at 1672) are unchanged from before at every width.
- Focus rings are no longer clipped in either list at 1672 or 390. The before and after measurements were produced by the same scratch check.
- Scroll to browse stays on one line at 1672/1024/390/360/320 with no heading overflow. At 320 the gap to the heading is 8.7 px; see `alt/selection-heading-*.png`.
- Typecheck passes.
- Workshop acceptance: `output/simulator-ui-iteration-4-selection-workshop/report.json`, 8/8.
