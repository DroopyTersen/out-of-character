# Simulator live practice design loop

Four distinct iterations, alternating lead / Opus / lead / Opus. This log covers only this screen; shared-component changes are identified explicitly. Approved composition and the seven-skill rubric remain the baseline.

## Iteration 1 — lead

### Before

Fresh desktop and phone: [desktop](../../output/simulator-ui-iteration-1-before/live-1672.png), [phone](../../output/simulator-ui-iteration-1-before/live-390.png). Also inspected the 1024 and 320 px captures.

### Critique and changes

| Finding | Applied refinement |
| --- | --- |
| Observed: the tiny northeast arrow on achieved objectives suggested external navigation rather than expandable evidence. | Use a right-aligned disclosure chevron that rotates when open. |
| Judgment: skill rows looked like static progress bars despite containing useful evidence. | Add the same disclosure affordance to every skill row. |
| Judgment: captions blended into the audio area and had no clear starting edge. | Add a quiet separator and spacing above the latest passage. |
| Judgment: the transcript-only scoring note was too small and faint to explain what the readings mean. | Increase its type and contrast without adding another callout. |
| Judgment: unavailable readings used the same empty track as a measured zero. | Use a dashed empty track for unobserved skills while preserving the dash value. |

feedback.tsx and simulator.css. Kept the client / hint-above-objectives / seven-skills composition. Shared evidence affordances also appear in debrief and lab. No scoring or voice behavior changed.

### After and verification

[Desktop](../../output/simulator-ui-iteration-1-accepted/live-1672.png) · [Phone](../../output/simulator-ui-iteration-1-accepted/live-390.png) · [320 px](../../output/simulator-ui-iteration-1-accepted/live-320.png). Capture report: `output/simulator-ui-iteration-1-accepted/report.json`. Visually reviewed desktop, phone and 320 px results; 16/16 captures across all four screen sizes have no document overflow, script errors or API calls. Typecheck passed. Workshop checks were adapted to open the new recording disclosure, and the count now includes semantic whitespace for assistive readers. Interaction acceptance is recorded in `output/simulator-ui-iteration-1-workshop-accepted-rerun/report.json (8/8; an intermediate run hit a transient development-server page error, preserved in the earlier report)`.

## Iteration 2 — Opus

Pending.

## Iteration 3 — lead

Pending.

## Iteration 4 — Opus

Pending.
