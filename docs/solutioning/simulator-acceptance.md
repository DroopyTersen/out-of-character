# Simulator MVP acceptance

Implementation: `simulator-mvp`. Checkpoint commits: `5804582` (plan), `e7f1602` (scenario/Jev foundations), `c3f56ee` (owned Live sessions), `44c74b9` (UI/workshop and review fixes), `917bf84` (core acceptance), and `584e18b` (mockup fidelity and speaking display). [Progress and review dispositions](simulator-progress.md) track the final acceptance gate. No merge or deployment was performed.

This document preserves the original MVP acceptance evidence. Subsequent engine and design work is tracked separately in [critique and improvement rounds](simulator-improvement-rounds.md). The [third engine round](simulator-engine-round-3.md) records the current v4 rubric measurements, 110-test gate, and same-audio immediate-End regression. The standard workshop recording files now contain those v4 results; the earlier v3 counts below are historical measurements, not the current recording totals.

The subsequent [prerecorded briefing follow-up](simulator-meeting-opening.md) covers the nine scenario introductions, Morgan's pace direction, and the revised Theo constraint. It was [deployed from `797258c`](simulator-release.md#prerecorded-colleague-briefings-release) on September 27 at 03:20 UTC. That release record separates local acceptance from production playback, voice/scoring, retry and archive evidence.

The newer [Ash and factual handovers](simulator-meeting-opening.md#ash-and-factual-handovers) revision was [deployed from `d55033c`](simulator-release.md#ash-briefings-and-quinn-voice-release) on September 27 at 04:43 UTC. The fresh full gate, nine-clip production briefing checks at three widths, Quinn's prepared Beacon playback on both Voice Lab surfaces, and all 234 served asset hashes pass. This release did not repeat paid voice/scoring or physical-phone tests.

The [shareable practice links follow-up](simulator-practice-links.md) was [deployed from `32475bd`](simulator-release.md#shared-practice-links-release) on September 27 at 13:17 UTC. A fresh **157-test** full gate, **5/5** groups in both production browser suites, all 11 HTTPS routes and all 234 served asset hashes pass. The shared-start check intercepts the microphone and session endpoint; no new paid voice or physical-phone test is claimed.

## Delivered behavior

- Sales: explore an adjacent SharePoint opportunity with an existing software client. Consultancy: handle an unestimated dashboard request without surrendering scope or ignoring the real need.
- Morgan, Avery, and Casey provide interchangeable behavior profiles. Six stable traits shape expression; scenario interests, disclosure rules, budget, and authority determine resistance and concessions.
- GPT-Live 1 provides WebRTC speech and authoritative transcripts. Jev, through AI SDK 7, independently assesses seven trainee skills, unordered achievement of ordered objectives, and client behavior. The voice actor receives authored private cues only when a fresh judgment supports intervention.
- Selection, live conversation, audio states, debrief, and the Jev lab share production components with the DIY workshop. Replay controls cover hints, objective checks, score bars, captions, errors, unavailable grading, and connection transitions. No microphone or paid request occurs when opening a story.
- Exact dialogue passages support displayed evidence. Missing observations remain unscored. Discoveries and demonstrated behaviors persist; client agreements can be withdrawn. Results are transient, with whole-attempt restart.

## Evidence

A compact, redacted record of real provider behavior is committed in [simulator-evidence.json](simulator-evidence.json). Full local screenshots, audio, and reports are written to ignored `output/` directories by the scripts below.

| Check | Result | Limits |
| --- | --- | --- |
| Synthetic real WebRTC session | 9/9: both speakers transcribed, live Jev, current settled assessment, recovery from one HTTP 503, provider closure, local media cleanup, safe data-channel notice | 28 seconds; authored audio, desktop Chrome. Empty server event allowlist still produced one `info/data_channel_permissions` notice; no actor config event was received. |
| Responsive sales roleplay | Good approaches earned all five objectives; poor approaches earned only the concrete problem. All four sessions finalized without errors. | Good/poor × director on/off, one run per cell. A locally synthesized trainee selected one response based on what the actor actually said. This is a small synthetic proxy for realism. |
| Client director | Every responsive trial correctly chose `no_hint`; clients already protected their interests. Two separate forced-cue protocol trials finalized and the enabled trial acknowledged the cue. | No causal improvement claim: the forced cue was sent early, and the responsive trials did not need one. An acknowledgment proves receipt, not compliance or secrecy of future speech. |
| Jev development fixtures, rubric v3 | 65/65 expectations across eight transcripts | Development cases informed rubric wording. |
| Jev stepwise replay | Seven prefixes; 19/19 final checks | Illustrates progressive evidence, not interpolation between provider calls. |
| Initial blind holdouts, rubric v2 | 20/22; failures retained in `holdout-rubric-v2.json` | Both misses discounted earlier capability connections after later problems. |
| Same cases after kind-specific v3 wording | 21/22 | These cases now informed the change, so this is not blind validation. The remaining borderline capability miss is retained: the trainee later asserts an unverified solution. Thresholds were not lowered to force a pass. |
| Fresh cases after v3 freeze | 11/11 across two independently authored transcripts | A specific early capability survives later dismissal; a polished generic pitch earns no capability. Small sample, not broad calibration. |
| Workshop browser acceptance | 8/8 desktop/phone flows; zero API/microphone requests, page errors, or horizontal overflow | Desktop Chrome at 1440×1000 and 390×844, including replay and evidence expansion. |
| Browser failure handling | 3/3: denied microphone, failed creation, cancel before permission resolves | HTTP creation is deliberately intercepted; real local fixture media tracks all end and selection returns. |
| Original game regression | Passed at 1440×900 and 390×844 | Selection, scene/re-spin timing, scene error, and cancellation; external scene transport is mocked. |

The repository gate is `bun run check`: type generation, TypeScript, Bun tests, production builds, a client bundle boundary scan, and Wrangler dry run. The final run passed 103 tests / 3,709 assertions across 13 files, with all build and boundary checks passing. Session tests cover ownership, duplicate creation, cancellation races, persistent cleanup after owner replacement, server deadline and abandonment, uncertain closure, transcript settling, and cue freshness. Paid adapters and the Workers runtime boundary are substituted in those tests; actual WebRTC/provider evidence is separate above.

## Reproduce locally

Run `bun install`. Start the app with `bun run dev --host 127.0.0.1`. Copy `.dev.vars.example` to ignored `.dev.vars` and supply your own provider keys for paid checks. Local voice needs `OPENAI_API_KEY`, `TYPESAFE_API_KEY`, `PAID_SERVICES_ENABLED=true`, and `SIMULATOR_ENABLED=true`. Private contextual direction runs for scored simulator and interview sessions.

Nonpaid checks:

```sh
bun run check
bun scripts/simulator-workshop-acceptance.mjs
bun scripts/simulator-briefing-acceptance.mjs
bun scripts/simulator-failure-acceptance.mjs
bun scripts/simulator-voice-acceptance.mjs
DESIGN_SCREEN=1 bun scripts/simulator-design-capture.mjs
bun scripts/selection-acceptance.mjs
```

Playwright is a development dependency. Browser scripts default to installed macOS Chrome; set `CHROME_PATH` for another compatible Chrome installation. `ACCEPTANCE_URL` and `ACCEPTANCE_OUTPUT` override the server and artifact directory. No browser binary is downloaded automatically by these scripts.

Explicit paid Jev recordings:

```sh
bun run eval:simulator
bun run eval:simulator --replay
bun run eval:simulator --holdout
bun run eval:simulator --validation
```

The holdout command intentionally exits nonzero if the retained borderline expectation is still missed. It does not rewrite expectations. Use `--fixture=<id>` for one case. Results preserve typed answers, distributions, exact evidence, model, rubric version, timings, and source transcript length. Archive a prior recording before overwriting evidence used to explain a rubric change.

For the real browser audio smoke, provide a short WAV at `output/simulator-fixture.wav` (or set `ACCEPTANCE_AUDIO`). A 15–25 second spoken discovery/recommendation works; the script sends it through a real WebAudio microphone stream. Example fixture preparation on macOS:

```sh
mkdir -p output
say -v Samantha -r 185 -o output/simulator-fixture.aiff 'Hi Morgan. Before we talk about platforms, who owns the document workflow? I want to understand what goes wrong today and how it affects their work. If ownership and adoption were the problem last time, our SharePoint team could explore that with operations. I would keep that separate from the current release. Could you ask operations about a short scoping discussion?'
ffmpeg -y -i output/simulator-fixture.aiff -ar 48000 -ac 1 output/simulator-fixture.wav
bun scripts/simulator-live-smoke.mjs --paid
```

The smoke creates one bounded paid attempt, intentionally fails its first feedback poll, ends the session, and verifies provider closure and media cleanup. Avoid editing source or rebuilding the dev server during a paid attempt; reloads interrupt local Durable Objects.

Responsive voice rehearsals use macOS `say` and `ffmpeg`, validate their audio fixtures before opening the connection, and have a three-minute session deadline:

```sh
bun --env-file=.dev.vars scripts/simulator-roleplay-probe.mjs --paid
bun --env-file=.dev.vars scripts/simulator-roleplay-probe.mjs --paid --director
bun --env-file=.dev.vars scripts/simulator-roleplay-probe.mjs --paid --poor
bun --env-file=.dev.vars scripts/simulator-roleplay-probe.mjs --paid --poor --director
```

The separate `simulator-cue-probe.mjs --paid [--cue]` requires a prepared `output/simulator-budget.wav`, or `ACCEPTANCE_AUDIO`. It forces an authored approval-boundary cue for protocol testing. Do not interpret that forced intervention as a Jev-selected decision.

## Practical limits

- Human-perceived voice naturalness, practitioner calibration, and physical iPhone/microphone behavior remain unverified. No human conversation was recorded for this acceptance run.
- Jev uses transcript evidence; it does not hear vocal tone. GPT-Live hears the speech and handles its own full-duplex response. The app does not turn overlapping transcripts into a punitive interruption count.
- Private actor configuration and rubric instructions stay out of browser assets and public session snapshots. The public-source workshop intentionally contains synthetic scenario spoilers. It is an authoring/demo environment, not a cheating-proof examination.
- Per-attempt duration and request budgets, creation rate limiting, and server alarms bound ordinary usage. They are not a shared daily spending/concurrency budget. Keep public paid creation off until that policy is chosen.
- A process loss after provider creation but before its returned ID is persisted cannot be recovered by attempt ID with the current Live API. Known IDs remain in a closure lease and are retried. Provider shutdown without acknowledgment is shown as unconfirmed.
- Client cues are occasional authored context. They cannot undo speech already heard, and the model may ignore or verbalize supplied context. The actor brief explicitly instructs it to keep direction private and preserve its personality; the trials do not establish a general secrecy guarantee.

The direct role-play and cue probes bypass the production session owner. Their director gate tests probability and deduplication; production freshness and cooldown are covered separately by session/state tests. The final fixed-audio smoke had no client filler during the trainee passage; the overlapping-backchannel settling case is established by its unit regression.

Two screenshot-driven visual rounds are recorded in [design iterations](simulator-design-iterations.md). Final full-screen captures at 1672, 1024, 390 and 320 pixels have no overflow; the desktop selection and live controls fit the reference viewport. The speaking display uses actual microphone/remote-audio frequency bands, with distinct client, trainee, overlap, idle, muted, connecting and ending states. A dedicated workshop provides intensity, pause/reset and state replay without a microphone. Normal/reduced-motion browser checks and a real local oscillator/analyser check pass, including zero console errors. Assets and exact image-generation prompts are recorded in [client assets](../mockups/simulator-client-assets.md).

MVP acceptance evidence directories: `output/simulator-workshop-final`, `simulator-failures-final`, `simulator-game-final`, `simulator-design-2-accepted`, `simulator-voice-final-accepted`, and `simulator-workshop-narrow-final`. The final narrow workshop check covers all five simulator stories with controls shown at 320 and 390 pixels: ten passes with no overflow, errors, API or microphone requests. One first game-regression run timed out under parallel browser load and passed on a single retry; the accepted report is retained. New image/layout work did not change provider/session policy. The original real-provider evidence above remains the voice lifecycle evidence; the new frequency display was tested locally with actual Web Audio.
