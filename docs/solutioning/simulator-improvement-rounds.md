# Simulator critique and improvement rounds

Baseline: `f9e6d5e` on `simulator-mvp`. This follow-up builds on the completed [MVP plan](simulator-implementation-plan.md) and [acceptance evidence](simulator-acceptance.md).

## Scope and order

Complete three non-UI critique/improvement rounds first. Each round inspects the current engine, classification and scenario behavior; records concrete findings and candidate improvements; applies small fixes; verifies behavior; obtains a read-only Opus review through the desktop UI; and commits the result. Reassess the changed system in the next round instead of relabeling one audit three times.

Then run four screenshot-driven design iterations independently for each main screen: selection, live practice (including the audio display), debrief and the Jev lab. Each screen has its own before/critique/fix/after log. Keep the approved mockup composition, seven skills, responsive layouts and production-component workshop previews. Inspect desktop and phone plus relevant alternate states. Seek five worthwhile critiques per iteration, without inventing defects or repeating resolved findings. Commit coherent changes and review each screen checkpoint with Opus.

## Evidence and guardrails

- Prioritize incorrect judgments, unearned agreements, inconsistent client authority, stale feedback, resource cleanup and unrealistic concessions. Keep resistance tied to client interests.
- Preserve objective order in the display while allowing independent achievement. Missing evidence stays unavailable; statements about secret facts do not substitute for actual dialogue.
- Reuse the current Jev/Live adapters and AI SDK. No speculative framework, model migration, new persistence or additional agent architecture.
- Separate system changes, rubric changes, harness changes and fixture corrections. Preserve baseline output and failed cases. Do not lower thresholds or rewrite expectations to manufacture improvement.
- Use deterministic behavior tests and fresh independently authored challenge cases. Run bounded paid evaluations only where they establish model behavior; save sanitized results. No credentials in tracked files or output. Existing local credentials are authorized.
- Keep provider failures, synthetic evidence, human realism and physical-device evidence distinct. Do not claim stronger validation than the artifacts establish.
- Parallelize independent read-only audits and verification. Keep edits owned and review every diff. Avoid simultaneous dev-server mutation and provider/browser acceptance.
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

Audits and baseline challenge selection are in progress. Findings, chosen changes, rejected candidates and before/after evidence will be recorded here before advancing to round 2.
