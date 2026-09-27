# Simulator MVP progress

Ready locally: [shareable practice links](simulator-practice-links.md). `/simulator?scenario=scope&client=morgan` opens the matching prerecorded intro directly. Copy link is available in the intro and Workshop; invalid links fall back to selection, and live practice still requires an enabled explicit Start. Opus reviewed the plan and implementation. The final full gate passes **157 tests / 6,041 assertions**, and both browser suites pass **5/5**, including desktop/mobile sharing, clipboard fallback, blocked autoplay and correct pair submission after Start. This follow-up has not been deployed.

Latest release: [Ash briefings and Quinn voice](simulator-release.md#ash-briefings-and-quinn-voice-release), deployed from `d55033c` on September 27 at 04:43 UTC with **100% traffic**. All nine intros use Ash with factual context and essential constraints, without tactic coaching or objective checklists; Quinn's default is Beacon. A fresh full gate passes **153 tests / 6,023 assertions**, types, builds, the 19-asset privacy scan and Worker dry run. Production briefing acceptance passes all five groups at three widths; Quinn's prepared Beacon playback passes on both Voice Lab surfaces at desktop and mobile widths. Eight HTTPS routes and all **234 served asset hashes** pass. No new paid conversation or physical-phone test was run for this release.

Previous release: [prerecorded colleague briefings](simulator-release.md#prerecorded-colleague-briefings-release), deployed from `797258c` on September 27 at 03:20 UTC. All nine scenarios have a reusable introduction before the live call. Morgan has stronger pace guidance; the Theo scenario now requires preserving his development contribution while addressing the client's concerns. The full gate passes **153 tests / 6,023 assertions**. Production briefing checks pass at three widths; a real voice/scoring attempt passes **9/9 on retry**, with **16/16** archive comparisons. All **234 served assets** match the build, and Cloudflare confirms **100% traffic**. Desktop Safari playback and skip-forward work; physical-phone acceptance remains unverified.

The [role-play ownership and longer practice release](simulator-release.md#role-ownership-and-longer-practice-release) and subsequent client voice/Workshop releases are also complete. Refresh an already-open simulator tab before trying the latest changes.

Previous release: [The happy hour](simulator-release.md#happy-hour-release), deployed from `f81f08b` on September 26 at 20:10 UTC. The ninth and last scenario allows free conversation with any of the seven clients, without objectives, coaching or scoring. The full gate passes **131 tests / 4,253 assertions**; production workshop checks pass **12/12**, compact interactions **5/5**, real-provider happy-hour voice acceptance **9/9**, and remote archive comparisons **18/18**. All **67 served assets** matched that release build.

Previous release: [expanded catalog and archive](simulator-release.md#expanded-catalog-and-archive-release), deployed from `d59c5ef` on September 26 at 19:35 UTC. Eight scenarios and seven clients, stronger theatrical performances, pace/bargaining tuning and private best-effort D1 archives were verified with 130 tests / 4,230 assertions, production workshop checks 8/8, compact interactions 5/5, scored voice acceptance 9/9, and remote archive-to-debrief comparisons 16/16. The archive migration preceded deployment.

The [pace and archive follow-up](simulator-pace-and-archive.md) was simplified to best-effort D1 saves with no staging or retries. Character pace and bargaining are committed in `f582815`; [rehearsal evidence](simulator-pace-evidence.md) records the limited pace measurements. The [catalog expansion](simulator-catalog-expansion.md) preserves the earlier local tests and qualitative acting evidence; a precise human difficulty increase is not established.

The follow-up [parallel quality review](simulator-simplification.md#archive-and-pace-follow-up-review) simplified archive serialization, provenance ownership and test setup. The simplified writer produces identical rows for all 49 recorded browser snapshots; the combined full gate passes.

Previous release: [spoken kickoff and stronger performances](simulator-roleplay-performance.md), implemented in `3729e9a` and [deployed from `8633f24`](simulator-release.md#client-performance-release) on September 26 at 16:55 UTC. Clients now establish the meeting in character and use more expressive, reactive performances. Opus found no code blockers; 114 tests / 3,777 assertions and the full repository gate pass. Production voice acceptance passes 9/9, compact layout checks pass 5/5, and all 63 served assets match the build. Cloudflare confirms 100% traffic on the tagged version. Earlier voice checks cover pressure/recovery, assessment authority, interruption, and the private no-task safeguard. The evidence record preserves earlier prompt deviations and one silent provider startup followed by a successful retry. Listening quality remains a subjective check.

Previous release: [compact layout implementation](simulator-compact-layout.md) implements the mobile mockup with a full-width overlay hint and session brief, preserves the original desktop layout, and exposes client stats only in workshop diagnostics. Two visual iterations and local acceptance are recorded there. [Production release `b0e13ab`](simulator-release.md#mobile-layout-release) is deployed with 112 tests and 5 live compact interaction checks passing. It also fixes production-only toast dismissal and dialog positioning defects found during release verification. This supersedes the earlier mockup's public behavior profile.

Plan: [implementation plan](simulator-implementation-plan.md). Product decisions: [proposal](simulator-proposal.md). Scenario content: [framework](simulator-scenario-framework.md).

This document preserves the original MVP checkpoint record. The subsequent three engine rounds and four design iterations per screen are tracked in [critique and improvement rounds](simulator-improvement-rounds.md), including the current v4 classifier measurements.

## Original MVP acceptance

Checkpoints 0–6 reviewed on `simulator-mvp`. The complete voice practice flow, live Jev feedback, private client direction, debrief, five workshop stories, and two visual iteration rounds were implemented and verified at MVP acceptance. Opus passed that checkpoint with no blocking bugs. The original evidence and review dispositions are below. No merge, deployment, or public paid enablement was performed.

## Decisions

- Use the existing AI SDK 7 / TypeSafe integration for Jev. Verify installed contracts before writing calls.
- Use a direct GPT-Live transport adapter for WebRTC and sideband operations absent from the installed AI SDK provider.
- Keep debrief generation deterministic and evidence-backed for the MVP.
- Use authored actor cues rather than another text generator. Keep trainee and client judgments independent.
- Reuse current app styling and useful components; keep simulator session behavior separate from game streak logic.
- Every simulator screen and animation ships with DIY workshop stories. The workshop also includes an authored-transcript Jev lab with playback controls and stored provider results; opening it performs no paid requests or microphone access.
- Load credentials only into ignored local configuration. Never include values in logs, review prompts, or committed artifacts.

## Checkpoint log

| Checkpoint | State | Evidence and review |
| --- | --- | --- |
| 0 — Plan and baseline | Reviewed | `bun run check` passed: typecheck, 75 tests / 3,592 assertions, client/server builds, and Wrangler dry run. Opus 5.5 desktop review passed with conditions; dispositions below. Requested OpenAI credential loaded into ignored configuration; read-only model lookup returned HTTP 200 for `gpt-live-1`. No audio session yet. |
| 1 — Scenario and judging foundations | Reviewed | Reviewed by Opus 5.5. Eight real Jev fixtures pass all 65 expectations, including unavailable skills and appropriate no-hint cases. Source evidence matches authored passages. Review fixes and verification below. |
| 2 — Live session | Reviewed | Opus 5.5 review passed with conditions, addressed below. Nine session lifecycle tests and four API tests pass. Real WebRTC audio/transcripts, live Jev updates, provider closure, and local media cleanup pass. |
| 3 — Complete simulator | Reviewed | Production selection/live/debrief components and four DIY workshop stories implemented. Seven recorded prefix evaluations support replay. Workshop browser acceptance passes 8/8 flows at desktop and phone widths, with no microphone/API requests or page errors. |
| 4 — Core acceptance | Reviewed | Final gate passed: 103 tests / 3,709 assertions, typecheck, builds, bundle scan, Wrangler dry run. Accepted browser runs pass 8/8 workshop and 3/3 failures. Opus review passed; disposition below. |
| 5 — Visual iteration one | Reviewed | Selection, live/audio/coaching, debrief, and lab before/after capture; expressive actual-audio display and replayable states. |
| 6 — Visual iteration two and final acceptance | Reviewed | Opus passed with no blocking bugs. Sixteen full-screen captures at four widths, five audio/analyser checks, and ten narrow workshop-control checks pass. Final repository gate passed. |

## Verification and remaining gaps

Typecheck and focused simulator tests pass. Rubric v3 passes all 65 development expectations and 19 replay final checks. The first independent holdout run (v2) was 20/22; it exposed outcome wording applied to historical behaviors. After a kind-specific wording fix, v3 is 21/22 on those now-known cases. The remaining capability miss is borderline because a later line promises an unverified solution; it remains visible. Two new cases authored after v3 was frozen pass 11/11. Thresholds did not change. Archived v2 failures are retained in `ai/simulator/holdout-rubric-v2.json`.

The final synthetic WebRTC smoke passes 9/9, including a current live assessment after passage settling, recovery from a transient poll failure, safe data-channel notice shape, provider-confirmed closure, and local media cleanup (28 billed seconds). Workshop acceptance passes 8/8; failure flows pass 3/3; the original game selection passes at 1440 and 390 pixels. The final repository gate passed 103 tests / 3,709 assertions, typecheck, production builds, client bundle scan, and Wrangler dry run. The Jev lab exposes all 13 fixture cases with their actual recording provenance and no API or microphone calls.

Four responsive synthetic roleplays (good/poor approach, director on/off) all finalized cleanly: 91/93 seconds for the good approach and 68/53 for the poor approach. Good approaches earned a bounded next step after resistance; poor approaches earned no agreement. All director judgments chose `no_hint`, appropriately leaving the actor alone. Separate forced-cue probes acknowledged private direction and closed cleanly. These establish protocol delivery and a small role-play proxy, not human realism or causal cue effectiveness.

## Checkpoint 0 review disposition

Reviewer: Claude Opus 5.5 through the desktop Code UI, read-only in this checkout. Verdict: passes with conditions.

- Accepted: make this plan the sole acceptance contract; bound the full-transcript evaluation loop; settle transcript segments; cap paid calls; retain one request per purpose; pin objective update semantics; use server-only private modules and explicit public projections; test bundle/data-channel exposure.
- Accepted: verify the actor alone before enabling private cues; keep an on/off flag; use a small authored cue selector with cooldown/freshness; add a default-off simulator flag and dedicated creation limit; use capability-based ownership and server alarms. Prefer polling for browser feedback over another persistent connection.
- Accepted: workshop is fixture-only; record new provider runs from the CLI; reuse production state helpers in stories; distinguish fixed-audio lifecycle evidence from responsive role-play evidence.
- Retained by design: per-skill applicability and passage evidence because arbitrary word counts cannot establish a skill opportunity. Client objective/fidelity diagnostics remain for the requested behavior lab, but never control personality. Minimal unexpected-delegation handling stays because client mode can emit those events. Browser-forwarded transcript fallback is deferred to avoid duplicate/untrusted sources.
- Clarification: the existing per-IP request limiter counts API requests, not every question in a Jev batch; the quoted 1–2 second target alone does not exceed 180 requests/minute. The new attempt budget still bounds cost and work.
- Existing historical mockups remain reference artifacts. Runtime assets will use only what the implemented UI needs.

## Checkpoint 1 review disposition

Opus 5.5 accepted the foundation with four fixes before session integration.

- Fixed: discovery/outcome evidence must come from the client; behavior/skill evidence comes from the trainee. Exact quotations are copied from source passages.
- Fixed: per-skill opportunity definitions distinguish weak performance from missing opportunity; applicability uses 0.85. Added unavailable-skill expectations and Listening coverage for the good scope conversation.
- Fixed: the director judges actor drift, not trainee mistakes. Added no-hint expectations for appropriate client behavior and raised the send floor to 0.90.
- Fixed: prior latched goals are excluded from hint choices and suppressed defensively; the session owner passes the reconciled IDs.
- Fixed: interleaved backchannels no longer split the other speaker into needless passages; settling excludes the currently growing passage. The session ends honestly at the transcript cap.
- Fixed during integration: debrief receives reconciled objectives and shows material concerns. Director retains all sent IDs; raw judgments are saved for the lab. Strict freshness remains conservative and will be measured in live trials.
- Follow-up: held-out paraphrases, client-cue enabled/disabled trials, lifecycle/browser checks, and visual workshop review remain acceptance work. At roughly 8.3k input tokens per short fixture evaluation, a 180-call attempt can use over 1.5M input tokens; actual transcript length changes that figure. Bounded calls and ten-minute sessions cap exposure but are not a cost forecast.

## Integration notes

- Foundation commit: `e7f1602`; planning baseline: `5804582`.
- A stepwise provider run exposed another ambiguity: the skill evidence Choice could select `none` despite a 0.95 observable judgment. Availability now has one owner (the per-skill Noul); the evidence Choice ranks actual trainee passages when they exist. Both full and replay provider runs pass their expectations after this simplification.
- Local dev initially hit Vite dependency-optimization reload errors before voice creation. Restarting the local development server resolved page rendering; this did not create a provider session.
- Browser audio smoke uses authored speech rendered locally to a WAV and a real WebAudio microphone stream. It is synthetic lifecycle evidence, not a human-run conversation.

## Checkpoint 2 review disposition

Opus 5.5 completed a read-only desktop review of session ownership and transport. Passed with conditions; material findings are addressed:

- Freshness now compares settled dialogue, so ongoing client audio does not make every assessment stale. New settled replies still suppress old cues; both cases have session tests.
- One transient feedback poll can recover. Three consecutive failures end practice; ownership/not-found responses end immediately. HTTP and data-channel timeouts cover separate connection stages; non-JSON upstream errors have a useful message.
- Persisted closure leases and cancellation tombstones are tested across owner replacement. Orphan cleanup is coalesced, handles provider 404/410, and clears leases without a recoverable provider ID.
- Assessment cadence spreads the 179 live calls over ten minutes and reserves the final pass. Late close-time deltas cannot exceed grading limits. A real client reply now separates adjacent trainee passages without splitting overlapping backchannels.
- Cancel before connection returns to selection. End callbacks respect the current attempt. Opening direction is marked sent only after successful transmission.
- Actual audio exposed a handshake-timeout bug: an abort timer remained active after WebSocket upgrade and closed the sideband. The timer now bounds only attachment, and finalization reattaches a dropped control socket.

Residual boundary: a process loss after provider creation but before its returned ID is persisted cannot be recovered by attempt ID with the current Live API. Deployment can interrupt active sessions. Keep public creation disabled until a shared spending/concurrency policy is chosen; per-IP start limiting alone is not a daily budget.

## Checkpoint 3 review disposition

Opus 5.5 reviewed the complete UI, workshop, recorded analyses, scripts, and previous fixes through the desktop UI. Verdict: passes with conditions. A focused follow-up reviewed the independent holdout misses.

- Fixed: passages now settle after their own 1.2-second quiet interval. A client backchannel cannot make an unfinished trainee statement ready for grading. Added a regression test and a real smoke assertion requiring current live feedback.
- Fixed: `bun run check` now includes a client-asset scan for distinctive private actor/rubric text and credential-shaped values. Workshop dialogue and measured synthetic fixtures are intentionally public examples and can reveal scenario answers; the public-source demo is not cheating-proof.
- Fixed: recorded rows carry the actual source file, rubric version, and collection time. Replay latching uses objective kinds rather than one hardcoded outcome ID. Replay stops outside its state updater. Speaking activity no longer floods a screen-reader status region.
- Fixed: behavior/discovery timing is independent of current agreements. Existing negative cases still pass. Preserved the failed v2 evidence and retained the remaining borderline miss instead of changing thresholds. Two fresh v3 validation cases pass.
- Verified: original game selection at desktop and phone widths. Its existing browser script had a stale button label; the selector now matches the current UI. Keeping the Simulator navigation entry while paid practice is off intentionally lets visitors reach the free workshop.
- Small follow-ups: captions use the most recent audio timestamp during overlap, preview debrief buttons explain their action without silently swapping fixtures, and reduced-motion preferences cover hint/selection transitions.
- Additional owner audit: concurrent starts now claim the lease after reading the request, preventing double paid creation. Tests also cover the hard deadline despite continued polling and explicitly unconfirmed provider finalization.

No deployment, merge, public enablement, or infrastructure change has been performed.

## Final acceptance evidence

[Acceptance instructions and limitations](simulator-acceptance.md) and [redacted provider evidence](simulator-evidence.json) are part of the handoff. UI/workshop checkpoint commit: `44c74b9`; Live session checkpoint: `c3f56ee`.

- Final `bun run check`: 103 passed, 0 failed, 3,709 assertions across 13 files; types, production builds, bundle boundary scan, and deployment dry run passed.
- Local Playwright is now a development dependency, so the committed scripts run after `bun install` with installed Chrome. No external workspace runtime path is required.
- Final workshop: 8/8, desktop and phone, no provider/microphone requests or page errors. All 13 transcript cases and correct source-file/rubric provenance were inspected.
- Browser failures: 3/3, tracks closed and selection restored. Original game selection: desktop and phone passed.
- Final live run: 9/9 with current feedback, 28 provider usage seconds, confirmed closure. Four responsive voice trials and two forced-cue protocol probes also finalized cleanly.
- Recorded Jev v3: development 65/65, replay 19/19, now-known holdouts 21/22, fresh blind validation 11/11. The one borderline failure and v2 failures remain inspectable. No broad calibration or human-voice realism claim is made.

## Checkpoint 4 review disposition

Opus 5.5 passed the core acceptance review with no blocking code findings. Accepted documentation clarifications: the direct role-play/cue probes bypass the production session owner and its freshness/cooldown scheduler; the final fixed-audio smoke did not contain a client filler during trainee speech, so the backchannel case is covered by the unit regression. All paid probes have finite deadlines and cleanup. Core evidence/scripts are committed in this checkpoint.

The user subsequently expanded acceptance to require two visual iteration rounds and a dedicated speaking display. Those are checkpoints 5–6; core approval does not complete the active goal. The approved selection/live mockups are now the fidelity target for typography, proportions, portrait identities, spacing and colors, adapted to screen size.

## Visual iteration one

Mockup comparison and scoped critique are recorded in [design iterations](simulator-design-iterations.md). Dedicated transparent client portraits replace unrelated game sprites. The live screen has stronger type and feedback hierarchy, a real frequency-driven dual audio display, and a compact phone stage. Selection uses compact rows and a selected-client portrait; debrief has a portrait/outcome/count banner. The lab caps expanded JSON. A fifth simulator workshop story replays all audio states with intensity and reduced-motion behavior. Browser/animation verification and Opus review passed; details follow.

## Checkpoint 5 review disposition

Opus 5.5 passed visual iteration one with conditions and independently ran 103 tests / 3,709 assertions. No audio lifecycle regression was found. Required fixes are applied: iteration two uses full page and viewport captures in Screen only mode (including the header), production reduced motion now uses steady channel indicators with no reactive glow or bar movement, and the debrief says Attempt ended without reusing the scenario pitch as an outcome.

Additional fixes: the workshop return moved into header flow; duplicate navigation was removed; connecting bars grow upward; breakpoints are consolidated; client arrows have 44-pixel targets and correct endpoint availability. Shared-strength evidence is displayed once with both labels. A synthetic browser analyser check distinguished 440 Hz (band 8) and 1800 Hz (band 17), with zero before/after. The audio story passes all seven states at 390/1440 in normal and reduced motion, including pause/reset/replay, with zero API/microphone calls. An initial reduced-motion hydration mismatch in the description was fixed by using static copy. The complete workshop still passes 8/8.

Parallel read-only audit found no new material privacy or paid-session lifecycle bug. Independent responsive inspection found a 4-pixel header overflow at 320, fixed-button overlap, awkward mobile session wrapping and small control targets. Iteration two fixes pass checks at 320, 390, 1024 and 1672 pixels.

## Checkpoint 6 review disposition

Opus 5.5 passed the second visual iteration with no blocking bugs, including the final CSS/audio/capture-script follow-ups. The reviewer independently checked all 13 debrief fixtures, 320-pixel layouts and the production selection route. All checkpoint 5 conditions are met: comparable full-screen captures, steady reduced-motion indicators and an honest attempt-ended banner. Selection and live screens are close to their approved v3/v4 references; the seven-skill debrief intentionally remains scrollable.

The MVP acceptance follow-up accepted the exact `simulator-design-2-accepted` and `simulator-voice-final-accepted` reports and independently verified the workshop width fix. No material issue remained in that audit. The MVP acceptance gate is recorded in `output/simulator-final-completion-check.log` and includes that final CSS change.

- Fixed: the desktop Start button is above the reference viewport fold; the phone timer/end row and header fit narrow widths. Custom scroll tracks, partial cards and correctly bounded arrows make the collections navigable.
- Fixed: integer bar heights avoid hydration warnings. Browser audio acceptance now records console errors and waits for the visible replay transition instead of relying on a tight fixed timer.
- Fixed: the final reviewer found overflow in the workshop controls at 320 pixels. Constraining the wrapping viewport-control row resolves it. All five simulator stories pass at 320 and 390 with controls visible, zero overflow, errors, microphone access or API requests.
- Verified: 16 final selection/live/debrief/lab captures at four widths; four normal/reduced-motion audio combinations covering seven states, plus a real browser oscillator/analyser check. Workshop 8/8, failure flows 3/3 and original-game checks at two widths pass. The full repository gate passes 103 tests / 3,709 assertions, types, production builds, 15-asset boundary scan and Wrangler dry run.
- Deferred cosmetic suggestions: a different font for the debrief count separator, removing reserved scrollbar gutter when a catalog is short, smoothing the speaking-state threshold, shortening the smallest-phone Start label and further reducing repeated labels. These do not block the MVP; no new state/timer machinery was added for them.

An independent MVP acceptance audit found no missing UI/animation/fixture acceptance requirement. Evidence distinguishes each selected audio state from the replay button's verified first transition, and preserves initial failed runs instead of replacing their history. Human voice realism and physical-phone behavior remain the explicit practical limits documented in [acceptance](simulator-acceptance.md).


## Role ownership and longer practice review checkpoint

The role-play follow-up is implemented in the isolated `simulator-role-boundaries` branch and includes the completed prepared-sample Voice Lab. Actor/scenario instructions preserve client knowledge and interests while returning consultancy planning to the trainee. Rubric v5 credits the trainee’s own contribution, preserves ordinary discovery, and rechecks historical evidence in the final grade.

Independent Opus and Astra reviews found startup cleanup and full-history citation gaps. Those are fixed, including late-ready expiry, server-driven microphone shutdown, all-passage evidence batches, explicit cue eligibility in evaluation reports, and bounded parallel question groups for long Jev inputs. Four successful provider boundary shapes cover 128/20k through 800/80k passages/characters, including all-trainee and mixed dialogue, in 425–784 ms. Longer grades cost more because each group includes the full state; no transcript summary or evidence-dropping fallback was added.

Six direct-provider rehearsals now total 924 usage seconds. Weak Harper/Jamie prompts did not elicit consultancy plans; owned proposals earned cooperation. Harper’s rambling/correction rehearsal demonstrated premature interpretation and recovery in text. The active browser attempt remained live for 650.659 wall seconds and ended normally. Its original duration assertion incorrectly compared provider audio time with wall time; the corrected harness records receipt times. The production check below exercises that assertion. The catalog run passes 144/147 expectations, with all three misses confined to conservative director selection/eligibility. These limits and review dispositions are detailed in [role-play follow-ups](simulator-roleplay-followups.md).

Full release checks, final targeted review, deployment, and production/archive verification are complete. No human listening or physical-phone acceptance is claimed.


The `ac859af` review-fix checkpoint passes the full 152-test gate. Opus and Astra completed targeted follow-ups with no remaining code blocker. All six real-browser connection cases pass, including microphone shutdown while the server finalizes. The subsequent acceptance-harness change waits for an initialized development page before importing the connection class.

## Role ownership and longer practice deployed

Source `4c6628a` is live at [the simulator](https://outofcharacter.droopy.dev/simulator), tagged on Worker version `b080250e-7692-4355-90e9-a4c46ec7421d` with 100% traffic. The ten-minute application cutoff is replaced by a sixty-minute safety cap; inactivity warns at three minutes and closes at five, with speech, playback and meaningful page activity keeping practice active. The completed Voice Lab is included.

The production browser conversation passes 10/10 checks, including new speech after ten wall-clock minutes, live Jev feedback, confirmed closure and media cleanup. Its final D1 export passes 17/17 checks against the browser and source provenance (672.472 elapsed seconds, 248 provider usage seconds). Workshop 12/12, compact interactions 5/5, prepared-voice playback at two widths, seven HTTP routes and 223 asset hashes pass. The final repository gate passes 152 tests / 5,917 assertions; the only post-deploy source change is a test deadline assertion stabilized against the emitted deadline.

The wider grading replay reports remain mixed: original fixtures 72/73, challenges 50/55, catalog 144/147. There is one borderline stakeholder false positive, two older challenge cases that remain false negatives, and conservative director intervention. Opus verified the older failure history. A wording experiment did not consistently improve these and caused catalog response validation failures, so it was reverted without deployment. Thresholds and expectations remain unchanged. See the [release record](simulator-release.md#role-ownership-and-longer-practice-release) for evidence paths and limits. No branch push or merge was performed.

## Prerecorded colleague briefings and scenario follow-up

This follow-up is deployed from `797258c` on `simulator-role-boundaries`, based on `c1a329a` so the subsequently deployed client voices and Workshop Voice Lab are preserved. Each of the nine scenarios now has a prerecorded colleague handover before the microphone/live session starts, with a transcript, replay and explicit Start conversation control. Finishing the clip leaves that decision with the trainee. The Workshop previews every briefing without opening a session.

Morgan has prominent, faster delivery guidance while retaining his commercial resistance. The Live API has no documented numeric speed multiplier; the small same-plan sample changed from approximately 176 to 182 words/minute, so this is directional evidence only. The Theo scenario now makes the unavailable replacement and serious delivery risk explicit, and grades for an accepted intervention that keeps his development contribution while improving the client's experience.

Opus's plan and implementation reviews informed lifecycle simplification, recording verification, more natural agreement evidence and less prescriptive preparation. Two visual critique passes preserve desktop proportions and bring mobile Start above the 390×844 fold. Local checks: 153 tests / 6,023 assertions, full repository build/boundary/dry-run gate, nine exact-script decoded recordings, all-clip browser checks at three widths, three failure flows, and a 9/9 real browser voice/Jev attempt with confirmed closure. Targeted Theo fixtures pass 28/28; the natural-agreement variant passes 8/8. See [the follow-up plan and evidence](simulator-meeting-opening.md). The separate [production release record](simulator-release.md#prerecorded-colleague-briefings-release) records the successful retry, initial failures, Safari observation and archive evidence. No branch push or merge was performed.
