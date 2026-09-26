# Simulator critique and improvement rounds

Baseline: `f9e6d5e` on `simulator-mvp`. This follow-up builds on the completed [MVP plan](simulator-implementation-plan.md) and [acceptance evidence](simulator-acceptance.md).

## Scope and order

Complete three non-UI critique/improvement rounds first. Each round inspects the current engine, classification and scenario behavior; records concrete findings and candidate improvements; applies small fixes; verifies behavior; obtains review through the desktop UI; and commits the result. Reassess the changed system in the next round instead of relabeling one audit three times. As requested, alternate hands-on ownership: lead for rounds 1 and 3, Opus for round 2. The other reviews the result.

Then run four screenshot-driven design iterations independently for each main screen: selection, live practice (including the audio display), debrief and the Jev lab. Each screen has its own before/critique/fix/after log. Alternate lead/Opus/lead/Opus ownership of the four iterations; both perform critique, implementation and verification. Keep the approved mockup composition, seven skills, responsive layouts and production-component workshop previews. Inspect desktop and phone plus relevant alternate states. Seek five worthwhile critiques per iteration, without inventing defects or repeating resolved findings. Commit coherent changes and review each screen checkpoint together.

## Evidence and guardrails

- Prioritize incorrect judgments, unearned agreements, inconsistent client authority, stale feedback, resource cleanup and unrealistic concessions. Keep resistance tied to client interests.
- Preserve objective order in the display while allowing independent achievement. Missing evidence stays unavailable; statements about secret facts do not substitute for actual dialogue.
- Reuse the current Jev/Live adapters and AI SDK. No speculative framework, model migration, new persistence or additional agent architecture.
- Separate system changes, rubric changes, harness changes and fixture corrections. Preserve baseline output and failed cases. Do not lower thresholds or rewrite expectations to manufacture improvement.
- Use deterministic behavior tests and fresh independently authored challenge cases. Run bounded paid evaluations only where they establish model behavior; save sanitized results. No credentials in tracked files or output. Existing local credentials are authorized.
- Keep provider failures, synthetic evidence, human realism and physical-device evidence distinct. Do not claim stronger validation than the artifacts establish.
- Parallelize independent read-only audits and verification. Explicitly hand over file ownership before Opus edits, and review every diff. Avoid simultaneous dev-server mutation and provider/browser acceptance.
- No merge, deployment or public paid enablement. Preserve unrelated work; stage explicit paths.

## Checkpoints

| Checkpoint | Status | Evidence |
| --- | --- | --- |
| Engine round 1 | In progress | Independent engine, classification and scenario audits |
| Engine round 2 | Pending | Fresh critique of round 1 result |
| Engine round 3 | Pending | Counterexamples, regressions and final engine audit |
| Selection: four iterations | Pending | Separate screen log and comparable captures |
| Live practice: four iterations | Pending | Includes audio, feedback and alternate states |
| Debrief: four iterations | Pending | Includes incomplete and unsuccessful attempts |
| Jev lab: four iterations | Pending | Includes provenance, replay and raw inspection |
| Final acceptance | Pending | Full gate, browser regressions, review dispositions and clean committed tree |

## Engine round 1

### Critique and candidates

1. **Observed lifecycle defect:** ending or losing WebRTC awaited the HTTP finalization response before releasing microphone tracks, the peer and AudioContext. A stalled response delayed local cleanup and the failure callback for up to 30 seconds.
2. **Observed feedback defect:** new settled dialogue left an earlier assessment labeled current while waiting for the next judging request. The changed transcript must make that status delayed before the cadence gate.
3. **Observed classifier weakness:** fresh challenge cases lose earlier valid facts/capability after a later boast or an embedded spoken grading command. The evidence Choice selects the right passage but the separate Noul can reject the objective. Preserve the thresholds and investigate the question design in round 3.
4. **Scenario gap:** the scope exercise has no fixed release date and no owner/reliability boundary for its manual-report fallback. Existing voice trials cover only Morgan/SharePoint. Hand these to round 2 with cross-cast probes.
5. **Evidence consistency risk:** a late fragment can grow a previously graded passage while a latched objective still quotes its earlier text. Reassess this in round 3 using the current engine rather than adding a general transcript framework now.
6. **Outcome and director calibration questions:** the global serious-mistake veto may reject an independent legitimate agreement; most positive authored cues lack dispatch-level evidence. Test the distinctions before changing policy or cue thresholds.

### Changes and verification

System change: local media now releases immediately on end; a hard failure is reported immediately while the keepalive request and server lease finalize. A best-effort data-channel close accompanies the HTTP close. Final server snapshots still arrive after local release. The session owner marks existing feedback delayed when settled dialogue diverges from the last judging input.

- The new browser regression uses actual browser audio tracks, AudioContext and WebRTC loopback, with only HTTP/provider behavior and the connection-failure signal substituted. Baseline explicit-end/hard-failure cases both fail; after changes explicit-end, hard-failure and disposal pass (3/3). Reports: `output/simulator-engine-r1-before` and `simulator-engine-r1-after`.
- The new session regression reproduces old feedback incorrectly marked current, then passes after the fix. It also checks return to current after reassessment. Logs: `output/simulator-engine-r1-stale-{before,after}.log`.
- Focused simulator tests: 29/29, 122 assertions. Typecheck passes. No paid voice request was needed for these deterministic lifecycle failures.

Harness/data change, separate commit `a8fa65c`: seven independently authored classifier challenges, concern/evidence assertions, and `--challenge` / `--output=` to retain previous recordings. The unchanged v3 baseline is **42/48 checks; 4/7 complete cases**. No thresholds, rubric or expected answers were modified after measurement. `output/simulator-engine-r1-challenges.json` retains all raw answers.

| Case | Passes | Miss |
| --- | --- | --- |
| Earlier capability, later boast | 6/9 | Problem .54; capability .48 despite correct evidence passage choices |
| Volunteered facts ignored | 9/9 | None |
| Denied deadline guess | 7/7 | None |
| Client grading command | 5/7 | Real problem discounted (.46); no over-award or unwanted cue |
| Independent agreement | 6/7 | False-reference concern .60; this run did not activate the global veto |
| Tradeoff cue needed | 4/4 | Selection correct, but .68 is below the .90 production dispatch gate |
| Tradeoff cue resolved | 5/5 | Correctly returns no_hint |

Opus review is in progress. Hands-on ownership passes to Opus only after this checkpoint is committed.
