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

## Progress

- Lead pass: complete, ready for the Claude handoff.
- Claude pass: pending the lead checkpoint.
- Final acceptance: pending.
