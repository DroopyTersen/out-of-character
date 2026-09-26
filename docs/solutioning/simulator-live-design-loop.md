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

### Before

Fresh reduced-motion captures: [desktop](../../output/simulator-ui-iteration-2-before/live-1672.png), [phone](../../output/simulator-ui-iteration-2-before/live-390.png), plus 1024 and 320 px. Alternate states in `output/simulator-ui-iteration-2-before/alt/` (screen-only mode): connecting, ending, delayed and unavailable feedback, muted stage, expanded evidence and turn 0 at 1672/390/320. Voice states from the voice workbench, animated and reduced: [desktop grid](../../output/simulator-ui-iteration-2-before/alt/voice-grid-1672.png), [phone grid](../../output/simulator-ui-iteration-2-before/alt/voice-grid-390.png).

### Critique and changes

| Finding | Disposition |
| --- | --- |
| Observed: the voice key put the client name and "You" at the far left and right under two stacked spectra, so neither label pointed at its channel. Both were 9 px grey in nearly the same tone, and "You" sat flush against the phone edge. | **Applied.** Each label now sits beside its own lane in that lane's colour (client teal on the upper spectrum, trainee blue on the lower). The trainee label turns amber when muted and wraps within the lane. The label column is fixed, so the spectrum does not shift when mute toggles. At 320 px, a narrower gap keeps all 24 bands inside the column. |
| Observed: an unobserved skill showed its "—" in the bright accent teal beside a dashed, empty track, so the missing reading was the loudest mark in the row. This is most visible when connecting and when feedback is unavailable. | **Applied.** The dash uses the muted track tone. The value remains visible. |
| Judgment: when delayed, the readings looked identical to current ones; only the 12 px header label changed. | **Applied.** When delayed, the values and bars are desaturated but remain readable. The header label is unchanged. The shared component also applies this to a delayed debrief. |
| Judgment: the icon-only speaker control is always shown. The blocked-playback notice tells the trainee to "Use Enable audio", but that text is only the accessible name. | **Deferred.** A permanent visible "Enable audio" would falsely suggest audio is off when it is playing. The better fix is to reveal a labelled control only after playback is blocked, which needs session state, so it is out of scope for a small visual pass. |
| Judgment: when connecting, the skills header reads "Listening for evidence", and when ending, "Jev · live" and "Live hint" remain. | **Not changed.** The wording is truthful enough, and it sits next to the connecting/ending status announcement reserved for root iteration 3. |

`app/simulator/simulator.css`, `voice-display.tsx` (a `data-muted` hook only; the visible text is unchanged) and `feedback.tsx` (a `data-status` hook only). The composition is unchanged. The reserved transcript placement and the accessibility/live-semantics findings were not touched.

### After and verification

[Desktop](../../output/simulator-ui-iteration-2-after/live-1672.png) · [Phone](../../output/simulator-ui-iteration-2-after/live-390.png) · [320 px](../../output/simulator-ui-iteration-2-after/live-320.png). Alternate states are in `output/simulator-ui-iteration-2-after/alt/live-*`, with voice grids `alt/voice-grid-{1672,390}.png`. Screenshots viewed:
- desktop/phone viewports
- muted stage at 1672/320
- delayed skills
- the animated and reduced voice grids

Measurements:
- The spectrum's x-position is identical muted and unmuted at 1672/1024/390/320.
- The 320 px spectrum (108 px) holds 24 bands at the 2 px minimum.

Checks:
- `report-live.json`: 4/4 captures with no overflow, errors or API calls. The alternate-state captures are also clean.
- Typecheck passes.
- Voice acceptance, first run (`output/simulator-ui-iteration-2-voice-acceptance`): the 1440 animated case failed on its real-analyser frequency check. That check drives Web Audio with timers and does not read CSS.
- Voice acceptance, rerun (`…-voice-acceptance-rerun`): 5/5, including the analyser. Both reports are preserved.

## Iteration 3 — lead

### Before

Fresh [desktop](../../output/simulator-ui-iteration-3-live-before/live-1672.png) and [phone](../../output/simulator-ui-iteration-3-live-before/live-390.png), plus 1024 and 320 px. Inspected Opus's connecting/ending alternates and the browser accessibility tree. The transcript regression failed at both 390 and 1024 px before the fix: it opened below the viewport, left focus at the trigger and lost focus when closed (`output/simulator-ui-iteration-3-regression-before/report.json`).

### Critique and changes

| Finding | Applied refinement |
| --- | --- |
| Observed: opening the transcript appeared to do nothing on a phone and tablet because it opened after the coaching panels, below the viewport. Closing it also lost keyboard focus. | Focus the transcript panel on opening, bringing it into view; return focus to the trigger on close. Link the trigger to the labelled panel. |
| Observed: the objective mark's label was attached to a generic span and absent from the accessibility tree. | Give each mark an image role so “Achieved” and “Open” are exposed beside the objective. |
| Observed: changing hints and concerns had no announcement semantics. | Make the stable hint container a polite, atomic status region. Keep the existing transition and concern priority. |
| Observed: connecting and ending were visible but were not announced. Announcing all speaking changes would produce constant interruptions. | Add a visually hidden status for the three session phases only; leave continuous audio activity out of announcements. |
| Observed: the ending screen still showed “Mic on”, “Jev · live” and actionable coaching despite the microphone having stopped. | Show the microphone as off, disable audio playback, label the readings as latest available, and replace ordinary coaching with debrief preparation. Retain any unresolved concern. |

`conversation.tsx`, `feedback.tsx`, `voice-display.tsx`, and one hidden-status CSS rule. The shared objective semantics also apply to debrief and lab. No evaluation values, voice transport or director rules changed.

### After and verification

[Desktop](../../output/simulator-ui-iteration-3-live-after/live-1672.png) · [Phone ending](../../output/simulator-ui-iteration-3-live-after/ending-390.png) · [Opened transcript](../../output/simulator-ui-iteration-3-live-regression-after/transcript-390-open.png). Visually reviewed the desktop, ending and transcript captures. Normal captures pass 4/4, without document overflow, script errors or API calls. The focused transcript regression now passes 2/2, including viewport visibility and focus return. The separate accessibility/ending check passes at 1672/390/320: four achieved and one open objective exposed, hint status present, microphone/playback disabled, ending announcement and latest-available feedback. Reports: `output/simulator-ui-iteration-3-live-regression-after/report.json` and `output/simulator-ui-iteration-3-live-after/accessibility-report.json`. Typecheck passes. This verifies browser accessibility semantics, not a physical screen-reader session.

## Iteration 4 — Opus

Pending.
