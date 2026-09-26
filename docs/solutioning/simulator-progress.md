# Simulator MVP progress

Plan: [implementation plan](simulator-implementation-plan.md). Product decisions: [proposal](simulator-proposal.md). Scenario content: [framework](simulator-scenario-framework.md).

## Current status

Checkpoints 0–2 reviewed on `simulator-mvp`. The goal is active. Live ownership, audio, and scoring work together; the production UI and workshop are implemented and entering checkpoint review. The branch starts from the current local `main`; no merge or deployment is authorized.

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
| 3 — Complete simulator | In progress | Production selection/live/debrief components and four DIY workshop stories implemented. Seven recorded prefix evaluations support replay. Workshop browser acceptance passes 8/8 flows at desktop and phone widths, with no microphone/API requests or page errors. |
| 4 — MVP acceptance | Pending | — |

## Verification and remaining gaps

Typecheck and focused simulator tests pass. Eight authored transcripts pass 65/65 real Jev expectations, plus seven replay prefixes (19/19 final checks). These are development fixtures; independently authored holdouts are next. Thresholds: discovery 0.75, behavior/outcome 0.85, observable skill 0.85, client cue 0.90.

Real WebRTC smoke passed seven checks, including Jev feedback during live conversation and provider-confirmed closure (26 billed seconds). Three browser failure flows release media. Both primary-WebSocket cue probes closed cleanly at 32 seconds; the enabled probe acknowledged the private cue and maintained authority/budget limits. This forced cue was sent early, so the comparison proves protocol delivery, not causal improvement. Responsive dialogue and a stronger browser event inspection remain final acceptance work.

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
