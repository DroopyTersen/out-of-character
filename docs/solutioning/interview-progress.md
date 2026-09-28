# Project closeout interview progress

## Checkpoint 0 — scope and foundation

- Goal created for the approved POC, including implementation, checkpoint reviews and two design loops on each major screen.
- Latest main fast-forwarded into the interview branch: `e90a4d0` preserves the new simulator skill colors.
- All eight design-interview decisions and the accepted review recommendations are captured in `interview-plan.md`.
- Objective achievement based only on interviewee evidence is now explicitly approved.
- Public interview contracts define one interviewer with Cedar/Gleam, three readings and the original three topic groups with fourteen subtopics.
- Work is limited to the POC; no deployment, platform abstractions, admin features or reliability queues.

## Checkpoint 1 — working interview

- Added the dedicated Sam prompt, participant-only Jev evidence, fourteen flexible topics, private recurring interviewer cues, and three neutral readings.
- Reused the existing session owner and browser audio transport. Interview pair validation and private catalog registration keep interviews out of the simulator selection screen.
- Added one bounded summary call after voice closure and independent capability-protected summary polling after media is released.
- Added a separate D1 interview table. Final transcript saving precedes summary generation; failures have a simple unavailable state, without a retry queue.
- Added setup, live and summary screens and isolated Workshop states using synthetic material. Existing portraits and voice animation are reused.

Review dispositions:

- The first checkpoint review found four integration risks: accidental simulator registration/grading, repeated grading of heard topics, performance-style UI, and summary format/polling. Dedicated dispatch, achieved-topic skipping, neutral readings, plain text and independent polling address these.
- Retained the existing Scenario shape for private lookup/prompt/provenance reuse. Adding a second session framework would increase complexity without helping this POC.
- A second read-only code and screenshot review is in progress. It is focused on correctness, privacy, and simple improvements.

Evidence so far:

- Baseline plus first new tests: 169 passing tests. Additional interview lifecycle tests cover protected summary access, final participant tail, separate storage, summary failure, evaluator dispatch, and recurring cues.
- Real loopback browser audio verifies explicit/automatic ending, summary delivery after media closure, unavailable handling, and disposal while summary is pending. All four interview cases pass. A simulator hard-failure check initially timed out during concurrent edits and passed in an isolated rerun; repeat the suite after edits settle.
- Real summary-provider call preserved a named secondhand account and explicitly avoided adopting the interviewer's unsupported theory. Plain-text output instructions were tightened after the provider included Markdown heading markers.
- Real Jev fixtures reject interviewer-only claims and vague assent, credit terse substantive answers, and respect boundaries. Provider tests also exposed overly broad topic credit; rubric distinctions were tightened without requiring a rigid one-topic/one-cue answer.
- First screenshot review and before/after captures exist under ignored `output/interview-ui/`. Setup, live and summary fit 1440, 390 and 320 px. Further mobile density and summary layout refinement is in progress.

No deployment has been performed.

## Checkpoint 2 — review, real providers, and presentation

- Working implementation committed as `e08ccd7`. The full repository gate passed: 174 tests, type checking, production build, browser bundle boundary check and Worker deployment dry run.
- Ten real Jev synthetic fixtures passed 51 checks. The slowest participant assessment measured 340 ms and interviewer assessment 159 ms; these fit the current live deadlines. Borderline optional direction may remain below the 0.9 threshold.
- Added a static Workshop analysis view for those measured synthetic recordings, alongside screen and audio-state previews.
- Accepted review fixes: preserve already-heard interview topics on final assessment; label Jev speakers participant/Sam to distinguish the project customer; avoid implying a follow-up service; retry summary polling up to the existing three-failure limit within the overall deadline. Transcript saves still have no retry queue.
- Kept participant identity optional: the user asked for a project/role softball, and names mentioned in the conversation are preserved without a mandatory name question.
- The real browser/WebRTC probe caught a production integration gap the loopback stub missed: empty summary-poll bodies returned HTTP 400. Summary polling now sends the normal inactive activity body, and the browser test boundary enforces that contract.
- Cedar completed a real three-turn interview and respected a boundary. Gleam did not spontaneously open in two direct API probes; the app/WebRTC path proved it can speak after synthetic participant input. The opening instruction is now short and concrete; a final production-path rehearsal is pending.
- User added matching approachable Sam portraits and shared desktop/mobile navigation. New portraits are saved under `public/interview/`; their art direction is documented in `sam-portraits.md`. Navigation stays in the shared header.
- Second visual pass reduces mobile setup/live height, keeps End reachable, uses descriptive reading levels with source quotes, and corrects the desktop summary button width. Remaining review polish and final captures follow the real voice test.

## Checkpoint 3 — final calibration and acceptance

- The final Jev replay passed 50/50 checks across ten synthetic fixtures (`output/interview/results-calibrated.json`). Named hearsay about teammates no longer establishes the participant’s own role. The compact Workshop recordings reflect this rubric; only synthetic passages and reduced results are public.
- All eleven browser connection cases passed (`output/interview/connection-final`): simulator regressions and interview explicit/automatic endings, summary failure, transient polling failure and disposal. Media closes before summary delivery.
- A corrected real Gleam WebRTC rehearsal passed (`output/interview/live-gleam-settled/report.json`). The full spontaneous opener included the project question. The earlier harness interrupted after the first greeting fragment; waiting for settled speech resolved that apparent problem without another production change. The participant was transcribed, Sam asked a relevant follow-up, finalization was confirmed, the summary became ready, the mic ended and the peer closed.
- Replaced the first portrait pair after visual feedback: the final pair uses the actual cast’s large heads, chunky pixels and waist-up framing. Setup now shows only Male voice/Female voice, with the repeated explanation and Before you begin eyebrow removed.
- Final setup/live/summary previews passed at 1440, 390 and 320 px, including actual pending/unavailable summary variants. Shared navigation passed twelve route/viewport checks plus keyboard and drawer interactions. The per-screen critique and fixes are recorded in `interview-design-review.md`.
- Simplified the summary to one reading column, placed transcript access before New interview, added an Audio label, and tightened the mobile live layout. Source quotes remain available for the three neutral observations.
- The full repository gate passed again: 174 tests and 6,122 assertions, type checking, production build, browser privacy boundary check (including interview instructions), and a Worker dry run. Log: `output/interview/final-check.log`. Behavior and presentation were committed as `22b4dac`.

Final review dispositions:

- The read-only code and visual review found no remaining material backend defect. Its test gap is now covered: a live topic survives the final assessment with its exact participant evidence in both the public snapshot and private archive. All 43 session tests passed after that addition.
- Clarified that the full transcript is saved privately alongside the summary. Replaced the decorative opening quote with Sam’s actual project question and removed its extra tagline.
- Removed the redundant Voice Lab header child, pathname special case, unused Workshop prop, and nine obsolete navigation CSS rules. The drawer now uses one shared set of styles. All twelve route/viewport navigation checks pass again (`output/interview-ui/navigation-reviewed`).
- Added breathing room between the mobile observation status and reading dividers, and made desktop reading descriptions larger. All nine screen/viewport checks pass again (`output/interview-ui/final-review`).
- Kept the compact mobile voice panel and one-tap transcript rather than restoring the last-transcript caption, consistent with the earlier mobile direction. Desktop retains the caption. The final summary layouts and failure states needed no further changes.
- The full repository gate passed after these follow-ups: 174 tests, 6,127 assertions, type checking, production build, privacy boundary check and Worker dry run (`output/interview/reviewed-check.log`). Implementation and local acceptance are complete.

Limitations: synthetic provider runs are short rehearsals, not proof of every real interview. Mobile screenshots use browser emulation, not a physical-phone microphone session. This implementation has not been deployed, and the new D1 migration has only been applied locally.

## Presentation follow-up

- Removed the decorative eyebrow labels from setup, live conversation, summary, and the mobile navigation drawer. Removed their unused styles and tightened heading spacing.
- Replaced the setup quote with “What’s the story about this project that never made it into a status report?” The spoken interview still starts with the agreed project softball.
- Type checking passed, along with all nine interview screen checks and twelve navigation checks at 1440, 390, and 320 px. Screenshots and reports are under `output/interview-ui/copy-cleanup/`.

## Feedback visualization

- Replaced the setup quote with a before-and-after example: candid speech bubbles flow into concise, professional project feedback. The example preserves both the access complaint and the positive pairing feedback.
- The same visualization appears in the existing Workshop setup story. A small CSS animation connects the two sides; reduced motion retains the static example. There are no new dependencies, requests, or runtime state.
- Two screenshot review rounds refined the copy, desktop readability, tablet proportions, and small-phone spacing. Type checking and all nine Workshop checks passed. Additional captures cover 1440, 1024, 768, 390, and 320 px; review notes, screenshots, and reports are under `output/interview-ui/feedback-visual/`.

## Isolated Cloudflare preview — September 27, 2026

- Deployed branch revision `e198374` to [The Debrief preview](https://project-closeout-interviews-out-of-character.droopy.workers.dev/interview). Cloudflare preview deployment: `aebd8ed1-211d-41ff-991f-8c89825135e6`. The branch remains unmerged.
- Updated Wrangler to support Worker Previews and added `bun run deploy:preview`. The existing Vite build carries the preview settings through without a build workaround or plugin upgrade.
- Created `out-of-character-interview-preview` and applied both D1 migrations there. Verified the live preview uses different database, Durable Object namespace, and rate-limit namespaces from production. Provider credentials are preview secrets; no credential values are tracked.
- The full release gate passed: 174 tests, 6,127 assertions, type checking, production build, browser privacy boundary check, and Worker dry run. All four routes and the health/catalog endpoints returned HTTP 200. Twelve desktop/mobile navigation checks passed at 1440, 390, and 320 px.
- Updated the paid interview acceptance script to use the real setup, Start interview, and End interview controls, so it works against built deployments. A real Gleam WebRTC rehearsal passed: spontaneous project opener, audible speech, participant transcription, relevant follow-up, confirmed closure, and ready summary. The microphone ended and the peer connection closed.
- The completed synthetic conversation and summary were verified in the preview D1 database, with the deployed revision recorded in provenance. Missing/wrong session capabilities were rejected; there is no public archive listing.
- Production remains on deployment `81ec45d7-9617-4866-94d1-2c5d287b8a68`, version `bf21802a-6cae-4f74-896e-af5c476b2253`. Its deployment history and served asset URLs matched the baseline after preview deployment. No production deployment or migration was performed.
- Evidence is under ignored `output/interview-preview-deploy/`. Mobile checks use browser viewports; a physical-phone microphone session remains user acceptance. This separate preview needs no production rollback.

## Contextual director integration and planning — September 27, 2026

- Merged main through `d5bd3f5` (including `fc7e884`) into the interview branch in `0a47264`. Resolved the shared session, archive, scenario, Workshop, and rehearsal conflicts while preserving the interview's current authored cue behavior. The simulator uses main's new contextual director.
- Added integration assertions that interview sessions never invoke simulator grading or Sol coaching, keep `coaching` null, and retain private cue history and its enabled/disabled provenance. These assertions describe the compatibility merge; they will change with the proposed interviewer producer.
- The full gate passed: 223 tests, 6,396 assertions, type checking, production build, browser privacy boundary check, and Worker dry run. Evidence: ignored `output/interview-contextual-plan/final-check.log`. No provider calls or deployment were performed in this planning pass; the existing preview is unchanged.
- Wrote `interview-contextual-director-plan.md`: reuse only the actor lane for Sam, with interview-specific Jev concerns and producer instructions. Keep participant readings and participant-only topic evidence. Reuse main's bounded work, freshness check, private transport, and archive records; remove the old authored sender when the new path is implemented.
- Additional main fixes are pending. Wait for Andrew's signal before fetching or integrating them, then reconcile the proposal with the final main implementation.
- Requested a cloud review through computer use. The signed-in Claude workspace reports that GitHub access for cloud sessions requires an organization owner, and the desktop app has no cloud environment. Used a new local Opus 5.5 session, **Interview contextual director plan review** (`local_7ddb3f48-7011-436f-ac79-fcf82f2e7c56`), for the requested read-only review instead. No account permissions were changed.
- The review supports six independent booleans and reuse of the existing actor lane. Incorporated explicit boundary exceptions and precedence in Jev, Sol, the recheck, and Sam's brief; an interview-specific recheck that permits useful returns to skipped details; participant/Sam labels and no topic progress in director context; the required empty legacy `cues_json` write; and the complete fixture, Workshop, configuration, and privacy-check cleanup. No scheduler framework or new participant coaching is needed.
- Reviewed the recommendations against the actual signal resolution, context builder, archive schema, and remaining cue references. The proposed behavior has not been implemented, provider-tested, or deployed. The full check above validates the compatibility merge only.

## Main follow-ups integrated — September 27, 2026

- After Andrew confirmed main was ready, fetched and merged through `18827cd` in `31dbae7`. The merge was clean and carries the main fixes unchanged: `a49e9f8` serializes freshness-check context for the Jev SDK; `18827cd` adds simulator personality checks and actor cue history with delivery positions and recent assessments.
- The full repository gate passed: 226 tests, 6,430 assertions, type checking, production build, privacy bundle check, and Worker dry run. Evidence: ignored `output/interview-contextual-plan/main-followup-check.log`.
- Reconciled the interview plan with the final main architecture. Preserve the shared history fields and serialization. Judge cue uptake from Sam's response, not the participant's talkativeness or willingness to disclose; continued boundary pressure calls for another respectful angle, never a stronger probe.
- A bounded follow-up in the existing Opus review supported keeping the six interview concerns. Keep their condition list separate from the simulator's seven conditions, preserve stable passage IDs when relabeling speakers, and allow personality direction within a relevant interview review. No extra style detector is justified before rehearsals reveal a need.
- The interview producer remains a reviewed proposal. No new producer implementation, paid rehearsal, database migration, or deployment was performed in this follow-up.

## Interview producer implementation — checkpoint 1

- Replaced authored interviewer cues with six independent Jev concerns and the existing actor-only contextual director. Participant grading is unchanged; there are no participant coaching observations or Sol calls.
- Sam receives a private producer brief with participant/Sam speaker labels, source limits, boundary precedence, and the existing cue history. The interview freshness recheck permits a useful return to a missed detail, but rejects declined topics, corrected problems, and competing productive stories.
- Added the private `interventions_json` archive column with an additive migration, retained the required empty legacy `cues_json` value, and preserved the summary finalization guard. End aborts pending direction before archiving; summaries receive only the actual transcript.
- Removed the old cue catalog, sender, repeat state, and director-enabled flag. Migrated fixtures, the Workshop readout, and rehearsal tools to measured signals and contextual direction. Synthetic provider results are being collected; no new results are claimed until inspected.
- Focused tests cover actor-only observations, private cue receipt, a Sol decision to do nothing, aborted generation at End, historical archive migration, and the public/summary boundaries. A read-only desktop checkpoint review follows this commit.
- No database migration or deployment has been performed against Cloudflare.

## Interview producer — rehearsal and review follow-up

- Checkpoint `db332ff` received a read-only desktop review: no blocking runtime defect. Added HTTP-boundary coverage for interview prompt selection and expanded the browser bundle check to include both the interviewer rubric and freshness instructions. The independent review also caught duplicate fixture IDs in the recording reducer; incomplete or duplicated fixture sets now fail before publishing a Workshop recording.
- Fifteen synthetic Jev fixtures passed **90/90 checks** (`output/interview-contextual/jev-refined.json`). Calibration changed ambiguous expectations rather than weakening thresholds: a tentative guess need not also be an asserted invented fact; a participant correcting Sam’s launch premise does not independently identify the deliverable; a mild aside is distinct from an abandoned firsthand release-decision story. The clearer case triggered missed-thread at 0.84.
- Eight actual actor-only gate replays produced six short Sol directions and two `no_trigger` decisions (`output/interview-contextual/replays/`). The Workshop now contains fifteen fresh reduced recordings, with the six signals, actual gate decision, generated direction, and cited dialogue. It explicitly distinguishes missing replays from no-call decisions. Participant and producer outputs are separate synthetic runs; no real interview material is included.
- A separate paid cue-history rehearsal found Sol could repeat a note after only the participant had spoken. The private instruction now explicitly requires a substantive Sam response after the delivery marker before repeating that concern. Four follow-up cases returned `none` (no response opportunity, participant-only speech, Sam already adjusted, participant declined); a fifth produced a more concrete direction after Sam actually repeated the mistake.
- Four real Jev freshness checks exercised the interview policy at the unchanged 0.90 delivery threshold: a missed detail after a generic pivot was retained (0.92); a declined topic (0.07), an already-corrected question (0.59), and another productive story (0.80) were discarded. Evidence and the initial failing calibration run are in `output/interview-contextual/producer-behavior*.json`. These small synthetic cases are regression evidence, not a general accuracy estimate.
- Cedar and Gleam each completed a real three-turn GPT-Live interview with confirmed closure (71 and 66 seconds), a project opener, a relevant follow-up to the hallway/access story, and acceptance of the participant’s no-speculation limit. Reports and playable audio are under `output/simulator-roleplay-project-closeout-sam-{cedar,gleam}-rehearsal-contextual-{cedar,gleam}/`. Neither needed a cue: these runs demonstrate healthy restraint and **do not prove live cue uptake**. The probe waits for review between synthetic turns, so it also does not reproduce uninterrupted live timing.
- All five interview browser connection modes passed: explicit End, automatic End, summary failure, summary retry, and disposal while summarizing. One transient Vite import error disappeared on the isolated rerun. The updated Workshop correction and evidence were inspected at 1440 px and 390 px; both remain readable. Existing local Miniflare state had a schema conflict, so verification used an isolated ignored state directory without modifying existing data.
- Before any authorized preview deployment, apply `0002_simulator_interventions.sql` and `0003_interview_interventions.sql`, then verify a real private interview archive write/read. No Cloudflare migration or deployment has been performed in this implementation pass.

## Interview producer — complete locally

- The final desktop review of `db332ff..2365802` found no remaining runtime, privacy, or archive defect. Its last nonblocking suggestion is included: a free contract test now requires exactly one recording per selectable interview fixture, preventing future fixture edits from breaking the Workshop.
- At `2365802`, the full repository gate passed: **231 tests, 6,475 assertions**, type checking, production build, privacy checks for 26 client assets, and Worker dry run. Evidence: `output/interview-contextual-plan/producer-reviewed-check.log`. The subsequent recording-contract test and type checking also passed; it changes no production code.
- Implementation and local verification are complete. Both key implementation commits were reviewed in Claude desktop. The isolated local verification server was stopped; existing local data and other servers were left untouched.
- The branch has not been pushed, merged, or deployed by this implementation pass. The existing Cloudflare preview is unchanged. Live cue uptake during a naturally drifting interview remains a real-conversation check, not something these short healthy voice trials establish.

## Contextual producer — existing preview updated

- Deployed application revision `ae9c8be` to the existing [The Debrief preview](https://project-closeout-interviews-out-of-character.droopy.workers.dev/interview). Preview ID `efba90ebdcd7421c8913c10442b044cf` is unchanged; its new deployment is `d997ded3-3d4a-4b6e-a567-68effe48fff2`, tagged `ae9c8be`.
- Applied `0002_simulator_interventions.sql` and `0003_interview_interventions.sql` to the separate `out-of-character-interview-preview` database. Confirmed the active preview retains that database, its own session namespace, rate limits, and existing provider secrets.
- The release gate passed at the deployed revision: **232 tests, 6,476 assertions**, type checking, production build, privacy checks for 26 client assets, and Worker dry run. All twelve desktop/mobile navigation checks passed. The interview, updated Workshop analysis, health, and enabled catalog returned HTTP 200.
- A real Gleam browser/WebRTC rehearsal passed on the deployed preview: spontaneous project opener, audible response, participant transcription, confirmed End, ready summary, ended microphone, and closed peer. Its exact synthetic attempt was read back from private D1 with three transcript passages, a ready summary, two actor-only observations, zero participant producer calls, empty legacy cue history, and the new deployment ID/tag. Missing and incorrect session capabilities returned 401 and 403.
- Production deployment `d49441e7-4ffc-4dbe-a552-0d447c6eef08` / version `ac9e8ec6-61eb-4911-9173-1799a9372875`, deployment history, and served asset URLs remained unchanged across this operation. No production migration, production deployment, branch merge, or push was performed.
- Evidence: ignored `output/interview-producer-preview-deploy/`. The rehearsal was healthy and required no producer cue; the previously documented live cue-uptake limitation remains.

## Presentation updates — preview deployed

- Deployed application revision `494c285` to the existing [The Debrief preview](https://project-closeout-interviews-out-of-character.droopy.workers.dev/interview), deployment `6588f6aa-7b66-4cb0-b7c4-bf8d97485692`. Debugger is a smaller desktop link and sits at the bottom of the mobile menu. “What you delivered” appears first, with the revised conversational guidance above the topic groups.
- The full release gate passed: 232 tests, 6,476 assertions, type checking, build, privacy checks, and Worker dry run. Twelve deployed navigation checks passed; topic order, copy, and Debugger placement also passed at 1440, 390, and 320 px. Preview pages, health, and the enabled catalog returned HTTP 200.
- Verified the existing preview database and session namespace remain attached and production deployment history is unchanged. No database migrations or live voice rehearsal were needed for this presentation update. Evidence: ignored `output/interview-ui-preview-deploy/`.

## Streamed summaries and interview focus — implementation checkpoint

- Merged main's streamed coaching reports through `3819e6a` in `aa51d0b`, then recorded the small reuse plan in `2fcf805`. The desktop review caught a merge-only regression that skipped final simulator grading; final grading for spoken simulator sessions is restored.
- Interview summaries now use GPT-6 Sol with medium reasoning through the same OpenAI Responses / AI SDK streaming path as simulator reports. Shared lifecycle and browser code accept the interview's `{ text }` schema. Removed the separate summary polling loop and background generation path. Transcript saving remains independent; only valid completed summaries are saved or copyable. Leaving the screen cancels unfinished generation.
- Summary input contains only the participant/interviewer transcript. Private producer notes and readings stay out. The existing capability-protected report endpoint supplies partial text, one explicit retry and an authoritative final read. No new endpoint, queue, table or dependency was added for this feature.
- The Debugger summary story now has Preparing, Writing, Ready and Unavailable states plus Replay stream. All eight synthetic browser flows and nine screen/viewport checks passed at 1440, 390 and 320 px. Screenshots under `output/interview-streaming/browser/workshop/` were inspected for desktop/mobile reading and partial text layout.
- Sam's brief and producer now treat project/role as orientation, then follow firsthand experiences and useful stories. The fourteen optional topics and participant rubric are unchanged. Two real GPT-Live rehearsals followed a volunteered win and an approval story and respected boundaries; the bare introduction still elicited an unnecessary technical question. Added a specific instruction to invite what stood out about working on the project; a focused follow-up rehearsal is pending.
- The full gate passed: **247 tests, 6,605 assertions**, type checking, production build, privacy check of 26 browser assets and Worker dry run (`output/interview-streaming/check.log`). Replaced an existing fixed-sleep test race with a bounded wait for actual assessment. A real summary-provider smoke streamed after 2.9 seconds and completed after 4.5 seconds, preserving credit and uncertainty (`output/interview-streaming/summary-smoke.json`). These timings are one short synthetic sample.
- No branch push, Cloudflare migration or deployment was performed. The existing preview is unchanged. The next requested preview deployment must also apply main's `0003_simulator_report.sql`; retain the already-applied interview migration filenames.

## Streaming review and final acceptance

- Desktop review of `837e398` found no blocking runtime, privacy, archive or lifecycle defect. Accepted the small prompt clarification that Sam's opening already asked about the project, so that answer supplies the orientation. Kept the agreed spoken opener and optional topic order. Documented that a closed row can remain `pending` when its browser never requested the summary. Summary usage auditing remains out of scope for this POC.
- The refined bare-introduction rehearsal opened with “What was the part that felt most consequential to you?” and followed the participant's story and no-speculation boundary (`output/interview-streaming/rehearsal-friction-refined/`). The positive rehearsal stayed with Maya's contribution instead of inventing a problem. These are short synthetic samples; sustained interview quality still needs real use.
- All eight media lifecycle modes and all nine existing simulator report modes passed with no page errors, alongside the eight interview summary and nine responsive Debugger checks. The interview harness now waits for page startup and verifies voice selection is interactive before starting a real call; its initial attempt made no API request because it clicked before the screen was ready.
- The final real Gleam browser/WebRTC run passed on the reviewed prompt: audible opening, participant transcription, confirmed End, a successful text-stream response, authoritative completed summary, ended microphone and closed peer. After applying existing migrations to the isolated local database, its exact attempt was read back with a final transcript and the same ready summary, and no row in the simulator table. Evidence: `output/interview-streaming/browser/live-archived/report.json` and `archive-verification.json`. The earlier run demonstrated best-effort summary delivery when the fresh local archive had no schema.
- Type checking, the eight SDK/lifecycle tests and script syntax checks passed after the review follow-up. The full gate at `837e398` remains **247 passing tests** plus build, privacy boundary and Worker dry run. No hosted database, preview, production deployment, branch push or merge was changed.

## Story judgment and public research plan — September 27, 2026

- Wrote [the next interview plan](interview-story-and-research-plan.md) from journalism news values, solutions journalism, current Jev/producer code, and Andrew's live-research idea. This is a plan only; application code is unchanged.
- Claude desktop reviewed the draft against `78f7d60`. Incorporated one combined overprobing detector, one research trigger, interview-specific priority for boundaries/source accuracy, a narrow tool-free preparation step before Luna web search, immediate source references, shared note limits, and cancellation. The plan keeps story improvements and research as separate checkpoints.
- Resolved review questions in the proposal: disclose organization/product/term lookups on setup and show sourced background when delivered, rather than detecting whether Sam speaks it. Kept a small delivered-facts context for accuracy checks and two synthetic Debugger cases. Model thresholds and research usefulness still require later fixtures/rehearsals; no new paid experiments or deployment were run.

- Added [the concrete Jev request draft](interview-jev-request-design.md): bounded settled state, explicit source/window rules, full instructions and true/false criteria for missed-thread, overprobing, and research usefulness, the five retained checks, SDK response shape, and code-owned routing. Verified the installed provider's boolean-to-Noul mapping and current TypeSafe documentation. This remains documentation only; example probabilities are illustrative.

## Story judgment and public research — implementation started

- Claude desktop reviewed both documents at `35d6e2a`, confirmed alignment and reported no blockers. Accepted four small corrections: research episode suppression after a declined lookup, interviewer-only background state, deadline measured from the captured observation, and punctuation-tolerant participant target matching.
- Created an explicit implementation goal covering both slices, bounded provider rehearsals, isolated UI verification, tests, checkpoints and final Claude desktop code review. No deployment or merge is included.

## Story judgment and public research — implementation checkpoint

- Sam and the Sol producer now use the colleague test for useful stories. The interviewer request has seven concerns plus a separate public-research signal. Boundary and source corrections precede story-flow reviews; simulator priority is unchanged. Only interviewer assessment and direction receive delivered background, never participant grading or summary input.
- Added a focused two-call Luna helper: tool-free selection of a short public participant-mentioned target, then a web-enabled request containing only its kind/name. It checks cited URLs against provider sources. The existing director owns cancellation, one outstanding lookup, three preparation attempts, two research notes inside the six-note cap, and the 25-second deadline from the captured observation. A declined attempt must see the signal clear before another episode. Sol work takes priority; blocked results are discarded.
- Acknowledged background appears with citations in live/summary views. Pending/rejected notes, preparation, queries and producer direction remain private. Research history uses the existing interview archive JSON; there is no migration. Added delivered/skipped synthetic Debugger views and refreshed the measured analysis recordings.
- Final 26-case real Jev replay passed its authored routing/evidence checks. Eight-question interviewer latency was median 118 ms, maximum 188 ms. Initial experiments showed conservative probabilities; overprobing and research use a 0.5 referral threshold, with Sol/Luna still allowed to decline. All other actor thresholds remain 0.6. These are small-sample POC settings, not calibrated guarantees. Evidence: `output/interview/story-final-v3.json` and eight paired Sol replays in `output/interview/replays/`.
- Real Luna smoke selected public USGS background and returned two official-source facts in 6.9 seconds; private budget discussion declined. Earlier preparation varied on the public 3DEP example, so preparation now focuses on target selection after Jev flags a possible gap. Broader-than-ideal target selection remains possible.
- Three real GPT-Live rehearsals finalized without errors (112, 94 and 124 seconds). Sam followed a quiet success, a consequential decision, and a public technical-program story, and respected stated limits. Research probabilities remained below the referral threshold during these healthy stories, so these rehearsals do not establish live research uptake. Evidence: `output/simulator-roleplay-project-closeout-*/` with `story-research` labels.
- Type checking, automated tests, production build, client privacy scan and Worker dry run passed in `output/interview-story-research/check.log`. Responsive source references are being inspected locally. Claude desktop code review and any follow-up corrections are next. No deployment, database migration, branch push or merge was performed.
