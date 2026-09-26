# Simulator simplification pass

Baseline: `8bfbef0` on `simulator-mvp`. This follows the completed [improvement rounds](simulator-improvement-rounds.md) and uses the thermo-nuclear code-quality review criteria: remove unnecessary concepts, duplicated decisions and unclear ownership while preserving behavior.

## Scope and sequence

Review the simulator branch's source changes, including engine, evaluation, workshop and UI boundaries. Keep the approved layouts, model prompts, rubric, thresholds, evidence, timing, privacy boundary and failure behavior. Recorded JSON is evidence, not implementation to compress or regenerate. No paid evaluations or deployment are needed for this pass.

1. Lead review and implementation, with independent read-only audits of the server and evaluation layers.
2. Verify and commit the lead checkpoint.
3. Ask Claude through the desktop app to read the same skill, review the resulting code, and implement a second simplification pass with explicit file ownership.
4. Review its diff, run the appropriate acceptance checks and commit the final result.

## Lead findings

- The workshop chooses its replay checkpoint independently in the snapshot builder and lab, repeating filtering and fallback rules. Saved records always include their transcript length, but the UI makes it optional and then asserts or supplies it repeatedly. Give replay selection one owner and one required recording contract.
- The debrief builds separate strength and practice maps and then renders nearly identical cards. The existing debrief model should return the grouped takeaways directly, leaving the component to render them once. Preserve separate KEEP/PRACTICE cards when a passage legitimately supports both, and suppress KEEP while a concern remains.
- The simulator JSX is compressed into very long lines, hiding component boundaries and mixing lookup logic with rendering. Make the affected components readable while separating replay data from workshop controls and presentation. Avoid extracting pass-through components merely to shorten files.
- The independent server audit found two closure promises for one browser `/end` lifecycle, plus a greeting flag whose enclosing phase transition already guarantees one send. These are candidates for Claude's subsequent pass; the persisted recovery lease remains a distinct responsibility.
- The evaluation runner has overlapping mode flags and duplicated suite/output precedence. Keep prompt and grading code unchanged; assess whether resolving the command once can remove the branching without silently changing existing command combinations.

No handwritten implementation file added by the branch crosses 1,000 lines. The large JSON files are measured recordings. File length alone understates the current JSX readability problem.

## Verification

Before editing replay or debrief behavior, capture their observable workshop output across authored fixtures, transcript turns and final-feedback states. Compare the same outputs after simplification. Use focused independent expectations for debrief grouping and concerns, the existing workshop/feedback/browser checks, and the full repository gate. Preserve failed checks and classify genuine behavior changes separately from refactoring.

## Lead checkpoint

Implemented one recording-selection path in `app/storybook/simulator-recordings.ts`. The three replay-based stories share its fixture context, reconciled assessment, selected raw record and next checkpoint. `transcriptLength` is required. One documented cast remains where JSON widens literal speaker strings; raw provider answers remain `unknown` because the lab only displays them. No generic decoder or extra validation layer was introduced.

`buildDebrief` now returns grouped takeaway cards, including the existing concern policy. The UI no longer keeps two maps, two grouping loops and two card-rendering paths. The affected JSX is formatted for review. A focused test covers shared evidence, separate KEEP/PRACTICE grouping and concern suppression. Skill scores and raw evaluation objects are unchanged.

Verification:
- The observable browser baseline covers all 13 fixtures: 93 lab turns and 39 debrief states. The accepted after-recording is **byte-for-byte identical**, including evidence, raw diagnostics, provenance and final-feedback variants. No API or microphone calls occurred. Files: `output/simulator-simplification-before.json` and `simulator-simplification-lead-accepted.json`.
- Feedback acceptance passes 3/3 in `output/simulator-simplification-lead-feedback/report.json`.
- Focused state tests pass 10/10 with 53 assertions. Typecheck passes. The initial TypeScript control-flow error in the replay accumulation loop was resolved with an explicitly typed fold; its failed log remains alongside the accepted result.
- Independent read-only review confirmed the previous full-result fallback, checkpoint ordering, latching and next-checkpoint behavior for the shipped corpus.

## Claude pass

Baseline: `586af05`. Claude implemented a second pass using the same skill, followed by an independent diff review and integrated verification. Criteria: delete concepts, give each decision one owner, and add no wrappers or layers beyond what removes duplication.

### Lead changes reviewed

- `simulator-recordings.ts` has one selection path.
- `buildDebrief` returns grouped takeaways.
- The formatted stories JSX kept `Playback` focus behavior.

The review found no concrete defect. Replay selection, debrief grouping and playback behavior were not altered by the second pass.

### Applied

| Area | Finding | Change |
| --- | --- | --- |
| `live-connection.ts` | Browser closure had two promises (`ending` and `remoteClosure`), with separate end and dispose paths initiating the same memoized request. Every guard had to check `disposed \|\| ending`. | `end()` is the single closure owner. `dispose()` marks the connection disposed, calls `end()`, and still releases media immediately. `remoteClosure`/`closeRemote` are removed, and guards check only `ending`. |
| `live-connection.ts` | The data channel was a field used only inside `start()`. `pollFailures` was mutable state that belongs to the poll chain. Two abort-aware waits were copied almost verbatim. | The channel is a local. The consecutive failure count is passed through `poll(failures)`, still ending on the third failure. One private `until()` owns both waits. |
| `session.ts` | `greeted` duplicated a guarantee the `connecting → live` transition already gives, since the lease makes `start` single-use. | The flag is removed and the opening is sent once in the transition. `end()` uses `??=`. |
| `state.ts`, `session.ts`, `evaluate.server.ts` | The evaluator input bound (240 passages, 80,000 characters) was defined separately in the session's late-delta guard and the evaluator's validation. | Both now use `TRANSCRIPT_LIMIT` and `transcriptCharacters`. |
| `api.ts` | The four-part live availability condition appeared twice, once negated, so the catalog's `enabled` and the sessions 503 could drift apart. | One `liveAvailable(env)`. |
| `run.ts` | Five booleans fed two parallel seven-way ternaries: one picked fixtures, the other picked the default output. | One ordered table pairs each flag's collection with its output. `--fixture` still wins, then blind > challenge > validation > holdout > replay. `--replay` still sets checkpoint lengths independently. |

These changes are intended to preserve behavior, and each preserved guarantee was reasoned through case by case:

- **Keepalive `/end`:**
  - Sent exactly once, including dispose during end and dispose after a poll saw the session end.
  - No request is sent before `requested`.
- **Timing:** The 3-second local deadline, healthy-peer drain and immediate silence are unchanged.
- **Callbacks:** The closure response's snapshot and error callbacks remain suppressed after dispose.
- **Startup cancellation:** The existing startup and poll guards still exit after end or dispose.

Two small observable differences:

- The ICE wait now rejects at once if the attempt was already aborted, as the channel wait already did. This only lets an abandoned start exit sooner.
- After dispose, the deadline or the final `release()` can emit an extra silent `levels` callback. The old dispose-during-end path already did this. `use-simulator.ts` drops callbacks from a replaced connection through its generation guard, and after unmount or pagehide nothing consumes them.

### Deferred

- The session's early-stop threshold of 72,000 characters remains a local literal. It is intentional headroom below the shared bound for late deltas, not a second copy of it.
- The recovery lease, `closeOrphan`, the DO's Bearer re-check and the duplicated DO request forwarding in `api.ts` remain distinct responsibilities.
- The one documented JSON speaker cast in recordings remains.

### Checks

- `bunx tsc --noEmit` passes.
- `bun test`: 111/111 tests across 13 files, 3,741 assertions.
- **Evaluator CLI:**
  - **Setup:** Stubbed offline copies of `586af05` and the candidate `run.ts` were used. The evaluator and file write were replaced, and each copy ran from the scratchpad with a placeholder key, so no provider calls and no repository writes occurred.
  - **Baseline:** Both copies reproduce root's `output/simulator-run-cli-baseline.json` for all 320 cases, and their outputs are identical.
  - **Extra combinations:** Five combinations outside the baseline also match: empty `--fixture=`, empty `--fixture=` with `--blind`, a repeated `--output=`, `--fixture` with `--replay --blind`, and `--output` with `--holdout --replay`.
  - **Harness bug fixed:** The first harness run misreported 32 missing-fixture errors on the old file. Bun prints surrounding source lines on a throw, so the harness picked up the message from the source listing instead of the actual `error:` line. After the fix, all cases above pass.
  - **Evidence:** `output/simulator-simplification-cli/` contains the source copies, offline helper, stubs, before/after outputs and comparison reports. The recorded candidate source matches the accepted `run.ts`, and the old/new 320-case outputs are byte-identical.
- **WebRTC loopback:** Deferred to the independent integrated verification below.

## Final acceptance

The independent review accepted the second pass. The server's soft and hard transcript limits, commit-before-end ordering, authenticated control after the creation kill switch, and recovery lease retain their previous behavior. The closure and retry refactors remove duplicate state without changing the three-failure threshold or local media deadline.

- `bun run check` passes: **111 tests / 3,741 assertions**, type generation/typecheck, production build, privacy verification for **15 client assets**, and the Worker deployment dry run. Log: `output/simulator-simplification-final-check.log`.
- Real-browser WebRTC loopback passes **4/4**: explicit end, hard failure, dispose and dispose during end. It verifies prompt silence, healthy-peer drain, local cleanup while HTTP closure remains pending, one closure request, and callback suppression after disposal. Report: `output/simulator-simplification-final-connection/report.json`.
- Startup-failure acceptance passes **3/3**: denied microphone, failed creation and cancellation while microphone access is pending. All tracks close. Report: `output/simulator-simplification-final-failure/report.json`.
- Workshop acceptance passes **8/8**. Report: `output/simulator-simplification-final-workshop/report.json`.
- The lead's **132 observable replay/debrief states** remain byte-for-byte identical to baseline, and feedback acceptance passes **3/3**. The second pass did not alter those rendering paths.
- Responsive capture passes **16/16** across all four screens at 1672, 1024, 390 and 320 pixels. Layout measurements match the previous final-design capture exactly; visual comparison found only tiny glyph/background rendering differences, with no material layout or content change. There are no browser errors, API calls or horizontal overflow. Report: `output/simulator-simplification-design/report.json`.

Verification used saved model results and local browser loopback. Prompts, rubrics, thresholds, scenario data and measured recordings were not changed. The previously documented classifier limitations remain outside this structural pass.

## Progress

- Lead pass: complete, committed as `586af05`.
- Claude pass: complete and independently reviewed.
- Final acceptance: complete.
