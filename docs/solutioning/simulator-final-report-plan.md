# Post-session coaching report

Status: implemented and verified locally after independent plan and implementation reviews. Baseline: `18827cd` on main. This document authorizes no deployment by itself.

## Confirmed product decisions

- Use `gpt-6-sol` with medium reasoning for the post-session review.
- Keep the report concise. Aim for 150–250 words of coaching, excluding expandable evidence and scores: a short overall assessment, one or two strengths, one or two improvements, and one next-attempt priority.
- Sol is the final judge of skill scores and objectives. Jev supplies evidence and provisional judgments; its scores do not constrain Sol's final decisions.
- The report may explain relevant hidden client goals and missed discoveries after the session.
- Show Jev's scores and objectives immediately as a provisional assessment, with a spinner while Sol prepares the report. Stream the prose through the AI SDK, then replace provisional results with Sol's validated final assessment.
- Persist the final report and its generation audit with the private transcript for quality review.
- Keep this a POC: one normal report call, no feature flag, legacy takeaway fallback, agent hierarchy, separate job service, or report-history UI.

## Experience

1. End closes the voice session through the existing shutdown path. Show a spinner and **“Compiling your report…”** while the report has not emitted visible prose. Do not expose internal reasoning or invent a percentage or countdown.
2. Show Jev's existing scores and objective results under **“Provisional assessment”**, along with the transcript, as soon as closure finishes. Missing readings stay unavailable, never zero. Begin the report request automatically for a scored session containing trainee speech. The voice resources remain closed throughout generation.
3. Stream the overview and coaching points into their final positions. Keep a subtle **“Preparing your feedback…”** status visible until completion. Do not auto-scroll the user away from something they are reading.
4. Keep the provisional Jev assessment visible while prose streams. Hide Sol's partial grades and objective decisions. On server-validated completion, replace the entire displayed assessment with Sol's scores and objectives together and label it **“Final assessment”**. Resolve exact quotes only from validated evidence. Remove the old Jev concern banner and static outcome sentence from the final view; Sol owns the entire final assessment. Its prose and evidence explain its judgments without adding a comparison dashboard or narrating every score change.
5. Each coaching point connects a concrete moment to its effect. Improvements can include a short better phrase or action. On strong attempts, look for supported refinements rather than inventing a flaw to fill a quota. Sparse dialogue can yield fewer points and unobserved skills.
6. Use ordinary, concise prose and expandable exact transcript evidence. Retain the existing seven-skill scale and scenario objectives. Keep the report area and assessment in stable positions so the visible scores remain easy to read while prose arrives. Keep the full transcript available.
7. If generation fails, clear incomplete report prose and say **“Final report unavailable.”** Keep the explicitly provisional Jev assessment and transcript available, and offer one explicit **“Retry report”** action when the session is still available and its retry allowance remains. Use that same heading, with a short relevant reason, when retries are exhausted, server state is lost, or a scored attempt has no trainee speech to review; do not leave a spinner or show Retry when generation cannot run. Never promote Jev's readings to a final report, describe a report error as a failed conversation, or display zero grades for unavailable results. A network failure loading report status remains a separate loading error, not proof that generation failed.

Open conversations without objectives, including Happy Hour and Voice Lab, retain their existing ungraded experience. The new report applies to the scored practice scenarios.

## Baseline implementation and relevant seams

- At `18827cd`, `core/simulator/state.ts:buildDebrief` chose up to two high and low Jev readings, grouped their evidence, and attached static improvement copy. It did not synthesize the conversation; implementation removed this path.
- The baseline `app/simulator/debrief.tsx` rendered that derived outcome, takeaways, Jev objective results, and Jev skill readings.
- `app/server/simulator/session.ts:finish` closes the director and voice provider, runs a final Jev assessment, marks the attempt ended/interrupted, and saves the archive. Keep the final Jev assessment as fresh supporting evidence for Sol.
- `app/simulator/live-connection.ts` aborts its voice request controller and polling at End. A report stream must have its own request lifetime; extending the live call's deadline is the wrong integration point.
- The server already owns the transcript, final Jev readings, full intervention history, private scenario facts/interests, and client personality. `interventions_json` stores live diagnostic probabilities and hint/cue decisions, not a complete history of all seven numeric skill scores. Do not claim or build a numeric score timeline.
- The archive stores final Jev readings separately from intervention history. Preserve these inputs for comparison with Sol; do not overwrite them with the final report.

## Request and data flow

```mermaid
sequenceDiagram
    participant U as Debrief UI
    participant S as Existing session owner
    participant J as Jev
    participant M as GPT-6 Sol · medium
    participant D as Private session archive
    U->>S: End practice
    S->>S: Close director and voice; freeze transcript
    S->>J: Final assessment
    J-->>S: Supporting grades, or unavailable
    S->>D: Schedule final transcript, Jev readings, intervention history
    S-->>U: Ended session with Jev assessment
    U->>U: Show provisional scores/objectives + compiling spinner
    U->>S: Authenticated report request
    S->>M: Transcript + rubric + scenario + Jev + delivered advice
    M-->>U: AI SDK stream of partial report prose, through server
    M-->>S: Complete structured report
    S->>S: Validate grades, objectives, evidence, completion
    S->>S: Settle authoritative report result once
    S->>D: After final-row write, save report and generation audit
    U->>S: Read authoritative completed report state
    S-->>U: Final report and Sol grades, or report error
    U->>U: Replace assessment with validated Sol results on success
```

Add `POST /api/simulator/sessions/:id/report` through the existing API and Durable Object. Use the existing same-origin and session-capability checks. If the attempt is already ending, wait for its existing finish promise with a bounded deadline before checking eligibility. Never start or reopen a call from this endpoint. Only ended/interrupted scored attempts with trainee speech are eligible. The browser submits no transcript, scores, rubric, or private context; the session owner constructs all inputs from its frozen state.

The first request starts one generation. Claim the generation synchronously before asynchronous work. A request while it is running returns a conflict without starting another paid call. A request after success returns the cached validated report. Permit at most one user-initiated retry after a failed or cancelled attempt; disable automatic SDK retries for this path. Trigger the client submission once from the ended/interrupted session transition, not a component mount effect. Keep this as a small per-attempt record in the existing session: status, starts, result, and one settled promise for the current generation.

Use a dedicated report AbortController, a 120-second generation deadline, and an initial 12,000 output-token cap that includes reasoning tokens. Adjust only if the representative smoke checks expose a problem. Normal completion, error, abort, and the deadline all feed one idempotent settlement function. Tag callbacks with the generation's existing start number so a late callback cannot overwrite a later retry. Validation stores the authoritative result and resolves settlement before any archive write; a failed save cannot hold the UI in a compiling state.

Wire response-body cancellation and request abort to the report controller, and call the SDK hook's `stop()` explicitly when leaving the attempt. Check cancellation through `wrangler dev`; do not assume a disconnect propagates through the Worker-to-DO stream. The server deadline remains the independent upper bound if cancellation does not arrive. Normal voice cleanup stays independent of report generation; deleting the closure lease does not change the in-memory report result. An evicted/restarted session returns unavailable; no archive rehydration or resumable stream is added for this POC.

## Sol's input and grading policy

Build one compact, explicitly named input object:

- Complete frozen transcript with its existing short passage IDs (`p1`, `p2`, etc.), speakers, approximate timestamps, and whether the conversation ended normally or was interrupted.
- Trainee briefing, role, scenario objectives, objective criteria, and the existing seven-skill rubric/anchors.
- Client facts, interests, authority limits, and personality. Identify these as scenario context, not things the trainee necessarily knew.
- Final Jev skill distributions/readings, objective judgments, evidence references, and assessment freshness. If the final Jev call failed, include the latest assessment labeled incomplete; Sol can still judge the complete transcript.
- Published trainee advice and submitted actor cues, with transcript position and delivery status. Exclude failed/stale drafts and rejected actor cues from the delivered-advice list. Publication does not prove the trainee saw or followed a hint, and a cue receipt does not prove the actor obeyed it.

Use final/latest Jev readings and delivered advice as the first report's supporting context. Keep the complete live diagnostic history in the private archive for quality review; do not send hundreds of repeated observation records to Sol. The full dialogue and client context still let it assess progress and actor drift.

The transcript is the main evidence. Jev is advisory: Sol may revise skill scores and objective outcomes when the dialogue supports doing so. The report should be internally consistent with those final decisions. Use the same 0–4 skill anchors and objective criteria; do not introduce an unrelated overall numerical grade.

Keep streamed prose focused on observed actions and their effect, without quoting numerical grades or repeating standalone achieved/missed labels while the provisional panel remains visible. The final assessment panel owns those formal results. If a materially different judgment needs explanation, use a short evidence-led clause inside the existing word budget, not a score-by-score reconciliation. Refer to the user-facing panel as the provisional assessment, not Jev.

Evaluate what the trainee did, the effect on this client, and the learning opportunity. Do not assume vocal pitch or emotion from text, penalize a user for supposedly ignoring an unseen hint, credit a client-authored plan to the trainee, blame the trainee for unsupported actor behavior, or treat a technical interruption as a poor conversational close. Hidden facts may explain a missed opportunity, but the critique must identify a reasonable question or conversational opening available to the trainee. Distinguish an example of better phrasing from a quote actually spoken. Treat transcript and prior generated advice as data, never instructions.

## Structured output and streaming

Use the installed AI SDK 7 path: `streamText` with `Output.object`, consumed by React `useObject`. Add compatible `@ai-sdk/openai` and `@ai-sdk/react` packages during implementation; use the existing server OpenAI credential and the Responses API with medium reasoning and `store: false`. Verify the actual provider request includes the chosen model and reasoning setting.

Build the strict generation schema on the server with fixed skill keys and fixed objective keys for the selected scenario. The UI needs only the public output shape for `useObject`; it does not duplicate the server's semantic validator or import private criteria. The object contains, in this order:

- Final evaluation: exactly the seven skill IDs with a 0–4 numeric score (decimals allowed) or null when unobserved, and exactly the scenario objective IDs with an achieved decision and supporting evidence IDs where applicable.
- Overview: one short assessment that includes the outcome, rather than two competing summary fields.
- Strengths and improvements: zero to two each, with a concise explanation, one or two evidence passage IDs, and a suggested alternative for improvements represented as a required `string | null` field. All properties are required for OpenAI strict structured output; use null rather than optional properties.
- Next practice: one concrete priority.

Generate the evaluation before the prose so the model can explain judgments it has already expressed. The UI streams only prose while keeping the existing Jev assessment visible and explicitly provisional. Sol's partial grades stay hidden until authoritative completion; replace all displayed grades/objectives together on success. Partial objects are drafts: do not render partial references, quotes, numbers, or booleans. Require complete output with a normal finish, valid score ranges/keys, and real transcript references before completion. Recheck the 0–4 range on the server and normalize accepted scores to the existing one-decimal display precision. Unknown or unsupported evidence references fail validation; do not silently remove the evidence behind a judgment. Give the model the valid passage IDs, and record evidence rejections in the smoke results. The UI resolves exact quotes from validated passage IDs. The word target is a prompt instruction, not a brittle validity check.

Use the SDK's documented text-stream adapter (`createTextStreamResponse` and `toTextStream`) and `useObject`, not a custom stream parser or a chat transcript UI. The SDK adapter streams text deltas only; internal reasoning and provider metadata are not part of the visible report. Do not rely on thrown lifecycle callback errors reaching the browser.

Every stream ending—success, SDK error, or fetch rejection—converges on one authenticated status read for that generation while the attempt remains current. Leaving the attempt cancels local work instead of starting another status request. Reuse the existing POST session `poll` endpoint for this final read, with its same authorization. On an ended/interrupted attempt this is read-only: no heartbeat/lease refresh, live grading, cleanup-timer reset, or live-state transition. Wait only when the current report generation is running; otherwise return the completed/failed state immediately, or idle if generation never started. A report POST that never reached the server consumes no generation allowance.

Do not introduce an unauthenticated GET exception. Give this report-specific read enough time for the server's bounded generation deadline plus a short network allowance, rather than reusing the live poll's five-second timeout. Show the spinner before visible prose, then keep the subtle in-progress status until the authoritative read resolves; `useObject.isLoading === false` alone is not completion. The client consumes only report fields from this response and never passes it through the live-session reducer. A network failure in the status read must not be presented as a failed model judgment or automatically start another generation; the Jev assessment remains explicitly provisional until success is confirmed.

Expose only the attempt URL/capability headers from the existing connection to the report hook. Pass them directly to `useObject` and the final status fetch. Keep the normal voice request method and cleanup behavior intact; there is no need for a new raw-response transport abstraction. Use an attempt guard so leaving/restarting a simulation cannot apply an older report to the new screen.

## Persistence and review evidence

Add one nullable `report_json` column to `simulator_attempts` with a migration. It holds the final structured report and bounded generation-attempt metadata: model, reasoning effort, report/prompt and rubric version, timestamps, usage, starts, and terminal result/error category. Use the existing Worker/source provenance to locate the scenario definition. Preserve the final Jev assessment and all intervention records in their existing columns.

Keep the final archive write promise on the session, preserving its existing background scheduling. Before the report-only update, await that promise with a bound; do not move this database wait into voice shutdown or the authoritative report status. Report updates write only `report_json`; checkpoint/final upserts must not clear or overwrite it. Check that exactly one row was updated so a missing initial archive cannot silently discard the report. Persist failed and cancelled generation audit records too. Any archive failure is logged distinctly from model failure; the user can still receive a successfully validated report.

Extend the private export script to include the report and its audit. Raw prompts, credentials, and internal model reasoning are not persisted or sent to the browser. Persist enough versioned inputs and references to inspect report quality; this POC does not promise exact historical reconstruction after scenario definitions change.

## Implementation steps

1. Add report schema/validation and a small server generator with the dedicated coaching/grading prompt. Reuse existing rubric definitions and transcript evidence helpers.
2. Integrate the report endpoint and single-generation lifecycle into the existing session. Keep live director behavior separate. Add the report archive migration/writer and export support.
3. Replace canned takeaways with the concise streaming report. Add four stories: compiling with provisional Jev results and a spinner; writing with provisional results; completed with Sol's final assessment; and failed/retry with provisional results retained. Use controls within them for strong, weak, sparse, and unavailable cases. Show the entire final assessment from Sol only after validation.
4. Verify the stream and provider contract, report quality, persistence ordering, and mobile presentation; remove the static takeaway selection code once the new path owns the scored debrief.

## Acceptance evidence

- Real SDK with a narrow simulated provider HTTP boundary: correct model/medium/strict/store-false/no-retry payload; incremental prose then authoritative status; invalid references/schema; truncated, refused, aborted, timed-out, or failed streams. Include valid-looking complete JSON followed by an error to prove it is not accepted as final. The provider network is mocked because these failure modes cannot be induced reliably or cheaply through paid calls.
- Session behavior: wrong capability denied; live/open-ended/empty attempts rejected; in-flight finish awaited; normal and interrupted endings each trigger once under React StrictMode; no concurrent duplicate or successful regeneration; bounded retry; late prior-generation callbacks cannot overwrite a retry; normal cleanup does not prevent report completion; lost state disables Retry; cancellation cannot reopen or delay the voice provider. Terminal polling must not mutate the session/lease or reset timers; an idle report returns immediately without using an allowance, and a report-status response cannot update the live-session reducer. Verify disconnect propagation once through `wrangler dev` and retain the independent server deadline.
- Real SQLite migration/write tests: transcript and Jev evidence survive; checkpoint then report update then late final upsert preserves the report; report write waits for final-row creation; zero updated rows is an observable archive failure; failed/cancelled audit attempts are stored; archive failure does not change a successful report into a model error.
- Three representative real Sol smoke cases, inspected for grounding and usefulness: a strong attempt with a supported refinement; a weak attempt with a missed hidden concern and questionable Jev judgment; a sparse/interrupted attempt that must not invent evidence or blame the interruption. Include delivered advice and actor imperfections in the fixtures without adding separate paid cases. Measure time to first prose and completion through the deployed Worker when deployment is authorized.
- Storybook and browser checks at 390 px, 320 px, and desktop: provisional Jev scores/objectives immediately visible with a compiling spinner before the first prose; progressive report without layout jumps or forced scrolling; no partial Sol grades; one complete replacement with validated Sol results; failure retains explicitly provisional Jev readings; missing readings never become zero; accurate failure and retry copy; no accidental second voice/session request; exact evidence links.
- Full `bun run check`, including the client privacy boundary and deployment dry run. New private report prompts/rubrics must remain server-only even though the generated report may explain authorized scenario discoveries.

## Documentation checked

- [GPT-6 Sol model](https://developers.openai.com/api/docs/models/gpt-6-sol): medium reasoning and structured output support.
- Installed `ai@7.0.105` documentation/source: `docs/04-ai-sdk-ui/08-object-generation.mdx`, `docs/07-reference/02-ai-sdk-ui/03-use-object.mdx`, and `src/generate-text/stream-text.ts`. The current registry release is `7.0.118`; no major upgrade is needed to plan this feature.
- [AI SDK OpenAI provider](https://ai-sdk.dev/providers/ai-sdk-providers/openai): Responses provider and reasoning options. Check the compatible installed provider version before implementation.

## Plan review

Opus 5.5 reviewed the self-contained proposal and inspected-source findings in a fresh Claude Desktop session on September 27, 2026. Initial verdict: approve with changes. The revisions above address settlement, cancellation, closure races, session eviction/cleanup, archive ordering, and strict-schema requirements. The review also simplified streaming to prose only, reduced the live checks to three representative cases, removed duplicate summaries/client validation/transport abstraction, and removed bulk observation history from the model input.

Two recommendations were not adopted: restricting scores to integers would change the existing score granularity, and silently dropping invalid evidence could accept an unsupported final judgment. Existing short passage IDs already avoid the need for another ID mapping. Source code was not changed as part of this planning task.

Final review verdict: **ready to implement**. The final clarifications—read-only terminal polling, immediate idle status when no generation started, separation from the live reducer, explicit score range checks, and recording evidence rejections—are incorporated above. Review session: `local_54217bd2-79a7-4a64-967e-b48a8bcfeb80`.

Opus also reviewed the subsequent UX refinement to show provisional Jev scores/objectives immediately with a spinner, stream prose, and replace the assessment only after validation. No blocker. Incorporated its advice to keep streamed prose free of numeric grades, avoid lengthy score-change explanations, and explicitly identify unavailable final reports while preserving provisional readings. No additional generation, comparison system, or grading threshold is needed for this refinement.


## Implementation and verification (September 27, 2026)

Implemented in the existing Worker and session Durable Object. The client uses the AI SDK object stream; one authenticated terminal status read commits validated grades and refreshes the final transcript. A report-only D1 migration/update preserves transcript and Jev audit data. Storybook covers all report states with replay and strong/weak/sparse/ungraded controls.

The full gate passed with 224 tests, typecheck, production build, private-content bundle checks and Wrangler deployment dry run. Nine actual-browser report flows passed with only paid network/media substituted, including a persisted-page lifecycle simulation that can check report status after returning without generating again. This is not an iOS Safari Back/Forward cache test. Three real direct GPT-6 Sol medium report calls passed validation and quality checks (185–207 coaching words; approximately 13–21 seconds to completion). These are representative local/provider checks, not production timing guarantees.

The server owns report eligibility. The client sends one request after any completed live attempt; ungraded or silent attempts are rejected before any model call. Their existing ungraded UI remains unchanged. Final report and result types are discriminated unions, and the hook and Storybook share one presentation policy. Existing score/evidence components accept a narrow feedback assessment rather than fabricated Jev metadata. Actual model settings and archived provenance share one definition.

Five UI iterations and their before/after screenshots are recorded in [the design review](simulator-report-design-review.md). Implementation and Claude Desktop review findings are recorded in [the quality review](simulator-report-quality-review.md).

Runtime verification found that local Wrangler compression buffers short text streams. The report response now uses identity encoding. Report status reads send the existing inactive activity JSON to satisfy the API boundary. Local browser disconnect did not propagate into the Worker request signal; the independent deadline correctly aborted the provider and settled the report. No separate cancellation endpoint or durable job system was added. The final report may continue until completion or the 120-second deadline after a client leaves.

Migration 0003 is applied locally. Deployment requires applying it remotely before releasing the Worker; no remote migration, push, merge or deployment has been performed for this feature.
