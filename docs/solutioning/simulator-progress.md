# Simulator MVP progress

Plan: [implementation plan](simulator-implementation-plan.md). Product decisions: [proposal](simulator-proposal.md). Scenario content: [framework](simulator-scenario-framework.md).

## Current status

Checkpoints 0–4 reviewed on `simulator-mvp`. The goal is active. Live ownership, audio, and scoring work together; the production UI and workshop are implemented and reviewed. Core acceptance passed review. The goal now also requires a distinctive audio display and repeated screenshot-driven design passes before completion. The branch starts from the current local `main`; no merge or deployment is authorized.

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
| 5 — Visual iteration one | Pending | Selection, live/audio/coaching, debrief, and lab before/after capture; expressive actual-audio display and replayable states. |
| 6 — Visual iteration two and final acceptance | Pending | Reinspect all major elements on desktop/phone, refine, capture motion and reduced motion, repeat relevant checks and Opus review. |

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
