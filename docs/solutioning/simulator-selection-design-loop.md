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

Pending.

## Iteration 4 — Opus

Pending.
