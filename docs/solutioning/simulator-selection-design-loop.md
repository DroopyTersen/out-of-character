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

Pending.

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

Pending.
