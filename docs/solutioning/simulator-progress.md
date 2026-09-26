# Simulator MVP progress

Plan: [implementation plan](simulator-implementation-plan.md). Product decisions: [proposal](simulator-proposal.md). Scenario content: [framework](simulator-scenario-framework.md).

## Current status

Checkpoint 0 reviewed; checkpoint 1 in progress on `simulator-mvp`. The goal is active. Scenario definitions, shared contracts, rubric questions, and pure transcript/feedback helpers are being implemented. The branch starts from the current local `main`; no merge or deployment is authorized.

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
| 1 — Scenario and judging foundations | In progress | Two scenarios, three clients, shared contracts and rubric questions authored; behavior tests and provider evaluation pending. |
| 2 — Live session | Pending | — |
| 3 — Complete simulator | Pending | — |
| 4 — MVP acceptance | Pending | — |

## Verification and remaining gaps

No simulator tests, audio smoke, browser acceptance, or runtime realism checks have run. Model lookup confirms the identifier is accessible, not that voice behavior works.

## Checkpoint 0 review disposition

Reviewer: Claude Opus 5.5 through the desktop Code UI, read-only in this checkout. Verdict: passes with conditions.

- Accepted: make this plan the sole acceptance contract; bound the full-transcript evaluation loop; settle transcript segments; cap paid calls; retain one request per purpose; pin objective update semantics; use server-only private modules and explicit public projections; test bundle/data-channel exposure.
- Accepted: verify the actor alone before enabling private cues; keep an on/off flag; use a small authored cue selector with cooldown/freshness; add a default-off simulator flag and dedicated creation limit; use capability-based ownership and server alarms. Prefer polling for browser feedback over another persistent connection.
- Accepted: workshop is fixture-only; record new provider runs from the CLI; reuse production state helpers in stories; distinguish fixed-audio lifecycle evidence from responsive role-play evidence.
- Retained by design: per-skill applicability and passage evidence because arbitrary word counts cannot establish a skill opportunity. Client objective/fidelity diagnostics remain for the requested behavior lab, but never control personality. Minimal unexpected-delegation handling stays because client mode can emit those events. Browser-forwarded transcript fallback is deferred to avoid duplicate/untrusted sources.
- Clarification: the existing per-IP request limiter counts API requests, not every question in a Jev batch; the quoted 1–2 second target alone does not exceed 180 requests/minute. The new attempt budget still bounds cost and work.
- Existing historical mockups remain reference artifacts. Runtime assets will use only what the implemented UI needs.
