# Interview engine: implementation notes

Written 2026-10-07 on branch `interview-engine` (off `main` at 47f2c3e, which includes everything from `interview-quality`). This is the working contract for the refactor agents. It reconciles the three design documents:

- `interview-engine-api-design.html` is the **current, authoritative** design (seams, providers, contracts, names). It was revised after the two Markdown documents and wins every conflict.
- `interview-engine-refactor-plan.md` gives the **phases, commit boundaries, file fates and gates**. Follow its structure, but with the corrections below.
- `interview-engine-api-design.md` and `interview-engine-extraction-plan.md` are background only.

## Corrections to the refactor plan

| Refactor plan says | Do this instead (from the HTML design) |
|---|---|
| components `conducting/` and `reporting/` | phases `interview/` (Interview phase) and `narrative/` (Narrative phase); public files `interview/interview.server.ts`, `narrative/narrative.server.ts` |
| four seams incl. `ControlSocket`; `Providers = { foundry, typesafeApiKey, fetch }` | **three seams**: `SessionStore`, `Background`, `Archive` (`interview/seams.server.ts`). `ControlSocket` is gone; the control socket is opened by the **voice provider**. |
| engine receives keys and resource names | engine receives **clients**: `Providers = { voice: VoiceProvider; language: { agent: LanguageModel; fast: LanguageModel }; judge: EvaluationModel; telemetry?: TelemetrySettings; log?: (event) => void }` in `providers/providers.server.ts`, built by the host with `foundryProviders(config, { fetch?, socket?, telemetry? })`. `VoiceProvider = { create({sdp, voice, instructions}) → {id, sdp}; attach(id) → WebSocketLike; close(id) }`. |
| `evaluateInterview` (Jev final grade) lives in reporting | it lives in `interview/conversation/evaluate.server.ts` (+ `rubric.prompt.ts`). The Narrative phase needs **only** `providers.language` (and optional telemetry); no judge, no TypeSafe key. |
| `summarizeInterview`, `ReportRun`, `ReportInput`, `ReportResult`, `OutputTemplate`, `summarize.server.ts`, `summary.prompt.ts`, `reportRun.server.ts`, `client/reportStream.ts`, protocol action `report` | `writeNarrative(input: NarrativeInput, providers: Pick<Providers,'language'|'telemetry'>, signal?) → NarrativeRun { stream, result: Promise<Narrative> }`; `NarrativeRunner` (host-side helper from `app/server/simulator/report.ts`, one run + one retry, re-attachable); `NarrativeTemplate`; files `narrative/write.server.ts`, `narrative/narrative.prompt.ts`, `narrative/narrativeRun.server.ts`, `client/narrativeStream.ts`; protocol action `narrative`. |
| snapshot keeps a `report` status field | **no narrative status in the snapshot**. The browser asks the host's narrative route (`POST /api/interview/sessions/:id/narrative`), which answers from the live actor's transcript if resident, else the archive row, and streams or returns the stored text. |
| `conducting/` may import `reporting/` | the two phases **never import each other**. Both import `shared/` and `providers/` only. Enforced by `scripts/engine-boundary-check.ts`. |
| `providers/foundry.server.ts`, `structured.server.ts`, `judge.server.ts`, `diagnostics.server.ts` | `providers/providers.server.ts` (Providers type + `foundryProviders` factory), `providers/gptLive.server.ts` (the Foundry voice provider: create/attach/close, `transcriptEvent`, `LiveSessionGone`), `providers/structured.server.ts` (copy of `requestSol`), `providers/judge.server.ts` (`JEV_MODEL`, `evidenceBatches`), `providers/diagnostics.server.ts`. `FoundryConfig` type may live in `providers/providers.server.ts`; `foundryConfig(env)` stays in `ai/foundry.server.ts`. |
| `client/transports.ts` with `Transport = { send(command, attempt?) }` | `ProtocolTransport = { request(action, body?, options?) }`; `pollTransport(baseUrl)` now, `socketTransport(url)` in Phase 6. `LiveConnection(transport, callbacks, attempt?)`. |
| `shared/spec.ts` minimal spec | shape it from what the code actually consumes today (topics with objectives, readings, voices, interviewer brief parts, opening, limits, narrative template) and lean toward the HTML §6 `InterviewSpec` where the data already exists. Do not invent content. `RoleBranch` is a hypothesis: leave it out (decision 06). |
| Phase 3 waits for interview-quality | interview-quality is merged into main. Phase 3 can run as soon as Phases 0–2 are in. Phase 3 **must** precede Phase 4 so the lifecycle never imports from `app/`. |
| Phase 5 has two deploys | code only. Commit 1 (browser cutover) and commit 3 (removal from the practice simulator) are separate commits so a deploy can sit between them. **Nothing is deployed by this refactor.** |

## Rules for every agent

1. Branch `interview-engine`. Commit small, per the plan's commit list. **Never push, never deploy, never run `wrangler deploy` without `--dry-run`, never touch the private host repository.**
2. Moves are `git mv` so history follows. Prompt text is byte-identical after a move; `MAP_PROMPT_VERSION`, `PRODUCER_VERSION`, `SUMMARY_VERSION` (→ `spec.narrative.version`) keep their values. No prompt wording changes anywhere in this refactor.
3. Conventions inside `interview-engine/`: `.server.ts` for server-only files, camelCase filenames, prompts in `*.prompt.ts`, **no `index.ts`**. Allowed packages inside the engine: `ai`, `@ai-sdk/azure`, `@ai-sdk/typesafe-ai`, `zod`. No `~/`, `@/`, `cloudflare:workers`, `react`, `react-router`, `bun:*`, `node:*`, `virtual:*`, no `Env`, `D1Database`, `DurableObject`, `ExecutionContext`.
4. Outside the engine the repo's existing style continues (kebab-case files, `~/` paths in `app/`).
5. Tests: `bun test <path>` for the files you touch while working; the full `bun test` (about 2.5 minutes, 457 tests at baseline) and `bun run typecheck` before every commit; `bun run check` at the end of the phase (it includes `wrangler deploy --dry-run`, which is allowed).
6. Behaviour is preserved. If a move forces a behaviour change, stop and write it down in your report instead of improvising.
7. Report at the end: commits made (hash + subject), checks run with results, anything left undone, and any contract question you had to decide.
