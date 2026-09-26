# Simulator jev lab design loop

Four distinct iterations, alternating lead / Opus / lead / Opus. This log covers only this screen; shared-component changes are identified explicitly. Approved composition and the seven-skill rubric remain the baseline.

## Iteration 1 — lead

### Before

Fresh desktop and phone: [desktop](../../output/simulator-ui-iteration-1-before/judging-1672.png), [phone](../../output/simulator-ui-iteration-1-before/judging-390.png). Also inspected the 1024 and 320 px captures.

### Critique and changes

| Finding | Applied refinement |
| --- | --- |
| Observed: recorded scores were labeled “Jev · live”. | Give recorded analysis an explicit recorded-reading label, including its empty state. |
| Judgment: the fixture title had the same small visual weight as subsidiary headings. | Add a clear recorded-analysis eyebrow and stronger fixture title. |
| Judgment: model, rubric, date, file and two timings competed with the main evidence. | Keep checkpoint/synthetic provenance visible and put technical recording details in a disclosure. |
| Judgment: nine raw check tokens created a dense tag cloud before the client analysis. | Show the pass count in a disclosure; automatically expose failed checks. |
| Judgment: the client’s four numeric measurements were a long undifferentiated list. | Group them into a compact labeled metric grid, two columns on phones. |

simulator-stories.tsx, feedback.tsx and simulator.css. Raw typed distributions, source metadata and the recording commands remain available. Opening the lab still makes no provider calls.

### After and verification

[Desktop](../../output/simulator-ui-iteration-1-accepted/judging-1672.png) · [Phone](../../output/simulator-ui-iteration-1-accepted/judging-390.png) · [320 px](../../output/simulator-ui-iteration-1-accepted/judging-320.png). Capture report: `output/simulator-ui-iteration-1-accepted/report.json`. Visually reviewed desktop, phone and 320 px results; 16/16 captures across all four screen sizes have no document overflow, script errors or API calls. Typecheck passed. Workshop checks were adapted to open the new recording disclosure, and the count now includes semantic whitespace for assistive readers. Interaction acceptance is recorded in `output/simulator-ui-iteration-1-workshop-accepted-rerun/report.json (8/8; an intermediate run hit a transient development-server page error, preserved in the earlier report)`.

## Iteration 2 — Opus

### Before

Fresh reduced-motion captures: [desktop](../../output/simulator-ui-iteration-2-before/judging-1672.png), [phone](../../output/simulator-ui-iteration-2-before/judging-390.png), plus 1024 and 320 px. Alternate states at 1672/390/320 are in `output/simulator-ui-iteration-2-before/alt/lab-*` (screen-only mode):
- turn 0 (empty)
- turn 1 (unrecorded checkpoint)
- check failure: `holdout-relevant-but-steamrolling`, the only fixture whose recording fails a check (`achieved:capability`)
- recording details and raw typed judgments opened

`lab-alt.json` lists every fixture's check summary, failures, checkpoint and selected cue. There is no lab mockup; the baseline is the accepted iteration-1 composition.

### Critique and changes

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | Observed: at "Show full result", the conversation sat in a 400 px nested scroller that opened at the top. The turns the checkpoint and checks refer to were hidden. The holdout showed turns 1–4 of 7, hiding the refusal that makes it a holdout. On phone, earned progress showed 3 of 13. | **Applied.** In the lab only, the transcript is unbounded and the page scrolls. The live and debrief transcripts keep their bounded scrollers. |
| 2 | Observed: a failing recording's summary, "8 of 9 checks passed", had the same neutral tone as "9 of 9". The only failure signal was one 11 px chip. | **Applied.** When any check fails, the summary uses the failure rose already used by the chip. The disclosure still opens automatically. |
| 3 | Observed: with no recording, "No checks at this turn" was a disclosure whose arrow opened nothing. | **Applied.** It is now plain text; only a recorded checkpoint has the disclosure. |
| 4 | Observed: without the optional Recording details disclosure (turn 0 and unrecorded turns), the checkpoint line touched the "Conversation evidence" column title. That disclosure supplied the only spacing. | **Applied.** The spacing now sits on the lab grid, so the gap is the same with or without recording details. |
| 5 | Judgment: at an unrecorded turn, "Advance to a recorded checkpoint" did not say how far to step. Fixtures have up to 13 turns and sparse checkpoints. | **Applied.** The line now names the next recorded turn, for example "Next recorded checkpoint: turn 3". It falls back to the original wording if none exists. |

Also noted, not changed:
- Check tokens such as `absent:impact` and `cue:no_hint` are harness vocabulary; the lab is a developer surface, and the objectives beside them give the plain reading.
- The raw JSON at 11 px in a 440 px scroller is appropriate for raw distributions.
- "Selected cue: no_hint · 100%" is truthful.
- Finding 1 is an explicit tradeoff: readability over page length. With the 13-turn fixture, the left column now runs past the right on desktop, and on phone the checks and client analysis sit further down the page. That is accepted for an inspection surface, where one page scroll is easier than a nested scroller.

Files: `app/storybook/simulator-stories.tsx` (lab markup only; Playback is unchanged) and `app/simulator/simulator.css` (lab-scoped rules). There are no evaluator, fixture, recording or scoring changes.

### After and verification

[Desktop](../../output/simulator-ui-iteration-2-after/judging-1672.png) · [Phone](../../output/simulator-ui-iteration-2-after/judging-390.png) · [320 px](../../output/simulator-ui-iteration-2-after/judging-320.png). Alternate states are in `output/simulator-ui-iteration-2-after/alt/lab-*`.

Screenshots viewed:
- the full-result desktop capture
- check failure at 1672
- the unrecorded turn at 390

Checks:
- `report-judging.json`: 4/4 captures with no overflow, errors or API calls.
- The alternate-state run is clean at all three widths.
- Typecheck passes.
- Workshop acceptance: `output/simulator-ui-iteration-2-workshop/report.json`, 8/8.

Ownership of `simulator-stories.tsx` returns to root for lab iteration 3.

## Iteration 3 — lead

### Before

Fresh four-width captures after the Opus handoff: `output/simulator-ui-iteration-3-judging-before`. Inspected the full phone transcript, checkpoint/failure disclosures, recorded provenance and the [completed replay controls](../../output/simulator-ui-iteration-3-judging-before/judging-390-completed-controls.png).

### Critique and changes

The remaining concrete interaction defect was at the end of a replay: Next turn and Show full result were still enabled but did nothing, while Play secretly meant restart. Disabled the two exhausted actions and labelled the restart action Replay. Reset and scrubbing restore the ordinary controls. The shared Playback refinement also appears in the live workshop story; it does not affect a live voice session.

Five areas were reviewed: playback completion, transcript access, missing checkpoints, failure visibility and source provenance. The latter four were addressed by iterations 1–2 and did not warrant more changes. The longer lab transcript remains an intentional tradeoff for reading the complete evidence without nested scrolling. No scoring, recording data, timing or new state was introduced.

### After and verification

[Completed phone controls](../../output/simulator-ui-iteration-3-judging-after/judging-390-completed-controls.png) show Replay as the available action, with the exhausted controls visibly disabled using existing workshop styling. Fresh screen captures pass at 1672/1024/390/320, without overflow, script errors or API calls.

The focused before/after browser check covers both lab and live workshop controls at 1672 and 390 px. Before: 0/4 meet the finished-state expectations. After: 4/4 pass, including actual playback advancing from the start and Reset restoring turn zero, Play and Next turn. Reports: `output/simulator-ui-iteration-3-judging-{before,after}/replay-report.json`. Typecheck passes.

## Iteration 4 — Opus

### Before

Fresh reduced-motion captures: [desktop](../../output/simulator-ui-iteration-4-before/judging-1672.png), [phone](../../output/simulator-ui-iteration-4-before/judging-390.png), plus 1024 and 320 px. Alternate states are in `output/simulator-ui-iteration-4-before/alt/lab-*` at 1672/390/320:
- turn 0
- an unrecorded turn
- the failing holdout `holdout-relevant-but-steamrolling`
- recording details and raw judgments open

The workshop controls were also inspected at 320 and 1672 px. `alt/lab-exhaust-focus.json` records where keyboard focus goes when a control uses up the replay, in both the lab and the live workshop at 1672/390. The focus audit found 16 focusables with no clipped outline.

### Critique and changes

| Finding | Disposition |
| --- | --- |
| Observed: iteration 3 correctly disables Next turn and Show full result at the end of a replay. Activating either from the keyboard therefore disables the focused button, and focus fell to `BODY` in all four lab/live × 1672/390 cases. | **Applied.** When a button step reaches the end, focus moves to the Transcript turn slider. The slider reports "13 / 13" and ignores a repeated Enter. Replay was rejected as the target, because a held or repeated Enter would immediately restart playback. Show full result moves into `Playback` behind a `full` prop, so both buttons share one step helper and one ref. Its position and label are unchanged, and it is still disabled at the end. Replay, Reset and scrubbing behave as in iteration 3. |
| Judgment: the assessment column stacks Objectives and Your skills. The gap between the last objective and the skills heading (24 px) roughly matched the gap between objectives (27 px), so the boundary between the two sections depended only on heading style. Live and debrief separate these sections with a rule: a column border side by side, or a top rule when they stack. | **Applied.** Lab-scoped: the skills section gets the same 1 px divider and 28 px spacing as `.sim-coaching .sim-objectives`. |
| Judgment: the client metrics are labelled "Interest 1–3", while the raw JSON uses `interest:0–2`. | **Not changed.** Interest wording is private scenario data (`scenarios.server.ts`) and is deliberately kept out of the client bundle. The numbers follow the authored priority order. Showing the names would mean shipping private prompt material to the workshop. |
| Judgment: at an unrecorded turn, the shared skills footer still says "Open a skill to see the evidence". | **Not changed.** The section status says "No recording yet"; an open unobserved skill says "Not enough relevant evidence yet". The footer remains a shared instruction for inspecting evidence when available. |
| Previously noted: the failed chip `× achieved:capability` does not say whether the check expected or observed the objective. | **Not changed.** This is harness vocabulary, as noted in iteration 2. The objective list beside it shows what was observed. |

The layouts at 1672/1024/390/320 raised nothing new. Iteration 2's accepted tradeoffs stand: the unbounded transcript, and the client analysis appearing below it on phone. There are no evaluator, fixture, recording, scoring or timing changes.

Files: `app/storybook/simulator-stories.tsx` (`Playback` focus and the Show full result placement) and `app/simulator/simulator.css` (the lab skills divider).

### After and verification

[Desktop](../../output/simulator-ui-iteration-4-after/judging-1672.png) · [Phone](../../output/simulator-ui-iteration-4-after/judging-390.png) · [320 px](../../output/simulator-ui-iteration-4-after/judging-320.png) · [Assessment column before/after](../../output/simulator-ui-iteration-4-after/alt/lab-assessment-before-after-1672.png) · [End-of-replay focus, phone](../../output/simulator-ui-iteration-4-after/alt/lab-controls-end-focus-390.png). Alternate states are in `output/simulator-ui-iteration-4-after/alt/lab-*`.

Screenshots viewed:
- assessment column before and after at 1672
- turn 0 at 390
- end-of-replay controls at 390: Replay is available, Next turn and Show full result are disabled, and the focus ring is on the slider

| Check | Before | After |
| --- | --- | --- |
| Next turn to the end: lab and live, 1672/390 | `BODY` in all 4 | slider "13", with a visible ring, in all 4 |
| A further Enter | nothing happens | nothing happens; still 13 / 13 |
| Show full result: lab, 1672/390 | `BODY` | slider "13" |

Reports: `output/simulator-ui-iteration-4-{before,after}/alt/lab-exhaust-focus.json`.

Checks:
- `report-judging.json`: 4/4 captures with no overflow, errors or API calls.
- `lab-alt.json` is identical before and after: checks, failures, checkpoints and cues for every fixture.
- The focus audit finds 16 focusables at 1672/390 with no clipping.
- Typecheck passes.
- Workshop acceptance: `output/simulator-ui-iteration-4-lab-workshop/report.json`, 8/8.
