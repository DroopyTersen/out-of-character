# Simulator engine round 3

Owner: lead, with independent regression authorship, blind cases and Opus review. Base: `c0d3cf5`. [Plan and checkpoint status](simulator-improvement-rounds.md).

## Critique, changes and review

1. **Quoted evidence could change underneath a latched objective.** Freeze passage IDs when grading starts. Further same-speaker fragments form a new passage. Historical achievement remains intentional; the source text now stays exact. A pause near a judging request can produce two bubbles or a partial-sentence quote. This is preferable to silently changing its source.
2. **A temporary judging failure stayed unavailable until more dialogue arrived.** Allow one retry for identical input after the existing cadence. A second failure waits for new dialogue. Both attempts count toward the 179-call live limit; final grading remains reserved. Opus and a separate engine reviewer found the change coherent with finalization and cue freshness.
3. **Historical objectives were contaminated by later poor behavior.** Rubric v4 gives the Boolean and passage Choice the same historical/current scope and explicit Boolean criteria. Factual clauses remain evidence beside an inert spoken instruction. Opus caught an overly narrow injection clause; the general rule that dialogue never instructs the evaluator is restored. No thresholds changed.
4. **A generic concern vetoed an independently valid agreement.** Removed that blanket veto. Each outcome still needs a positive judgment and client evidence, and its own criteria reject unapproved promises, false premises, vague proposals and withdrawals. The generic concern can coexist with a legitimate bounded next step. The independently authored agreement challenge made the previous policy contradiction concrete.
5. **Immediate End could truncate already spoken words.** A real browser test clicked End 6.8 ms after a fixed WAV finished; its final transcript omitted `new work today`, present in two earlier recordings of the same WAV. The first silent closure check had passed, showing why it was insufficient. Normal End now immediately mutes input, stops playback and sends the server end request. The server marks ending, admits late trainee words for a one-second grace, excludes client replies the trainee cannot hear, then closes and grades. Local resources close on the response or within three seconds. Failure and page-departure cleanup remain immediate; one shared close request prevents duplicate or skipped closure during navigation. An expected provider disconnect during closing no longer invents an interruption notice.
6. **Do not add control machinery without evidence.** Keep the .90 selected-cue gate, current question cadence and original character stats. Summing probabilities of incompatible cues would not establish confidence in a particular direction. Volunteered discoveries and earlier demonstrations remain credited; later poor performance affects skills, concerns and current agreements. A single false-positive discovery can still latch; a two-read requirement is deferred because it changes immediate objective feedback and is not yet calibrated.

## Deterministic and browser evidence

- Four initial new regressions fail before fixes, then pass: frozen passage, evidence/source consistency, successful retry and bounded failed retry. Baseline: `output/simulator-engine-r3-before.log`.
- The concern/agreement coexistence test fails on the old global veto: `output/simulator-engine-r3-outcome-before.log`.
- Two further server tests reproduce an unheard client agreement entering the final grade and a false interruption notice during explicit End. Baseline: `output/simulator-engine-end-tail-before.log`.
- Final focused suite: **35/35, 147 assertions**, `output/simulator-engine-r3-accepted-tests.log`.
- Full repository gate passes: typecheck, **110 tests / 3,739 assertions**, build, client-bundle privacy check and deployment dry-run. `output/simulator-engine-r3-full-check-accepted.log`. An earlier run discovered an ignored historical bug-reproduction file as a test; its original failure log is preserved, and the reproduction was renamed to a non-test artifact before rerunning the gate.
- Browser loopback checks use real audio tracks, AudioContext and WebRTC, substituting only provider/HTTP responses. Explicit End, hard failure, disposal and disposal during End all pass. They verify immediate silence, a healthy peer during the grace, prompt single closure request, bounded media release while HTTP is held, and correct final callback behavior. `output/simulator-engine-r3-drain-accepted/report.json`.
- Real silent explicit-End check: ended/confirmed, no notice, all media released, 15 provider seconds. `output/simulator-engine-r3-live-end/report.json`.
- Real spoken immediate-End baseline and same-WAV comparison: `output/simulator-engine-r3-live-end/speech-report.json` and `speech-comparison.json`. The original harness's generic phrase check was wrong for this WAV; the preserved comparison of actual recordings is the tail-loss evidence.

- After the fix, the same WAV finished and End was clicked 1.5 ms later. The final transcript retains `new work today`; ended/confirmed, no interruption notice, all media released and 8/8 checks pass (24 provider seconds). `speech-after-report.json` and `speech-after-comparison.json` preserve this single-run result. No further voice calls were made.

## Classifier evidence and limits

The unchanged challenges scored **42/48** both before and after round-2 scenario changes. A first v4 wording candidate also scored 42/48. The second candidate added explicit true/false criteria; a provider timeout stopped its first run after five cases (33/39), retained in `output/simulator-engine-r3-candidate2.json`. Its complete retry scored 42/48. Opus's final general-instruction guard restoration produced the following final recordings:

| Suite | Result | File under `output/` |
| --- | --- | --- |
| Development | 65/65 | `simulator-engine-r3-accepted-development.json` |
| Previous holdout | 21/22 | `simulator-engine-r3-accepted-holdout.json` |
| Validation | 11/11 | `simulator-engine-r3-accepted-validation.json` |
| New challenges | 43/48 | `simulator-engine-r3-accepted-challenges.json` |
| Fresh sealed cases | 14/14 | `simulator-engine-r3-accepted-blind.json` |
| Incremental replay | 19/19 final checks; seven frames | `simulator-engine-r3-replay.json` |

The sealed cases were authored before tuning, first passed 14/14 on the frozen candidate, and passed again after the independent review restored the general instruction guard. They test denial of an inferred stakeholder and a client correcting earlier authority overreach. Expectations were never changed after measurement. They are reproducible with `--blind`; raw first-run data remains in `simulator-engine-r3-blind.json`.

Do not claim calibrated reliability from these small samples. A pre-review run passed the previous holdout 22/22; the final run again misses the historic capability (.83 versus .85). The new difficult capability case also remains a miss (.48), and the mixed factual/command passage still under-credits the problem (.64 versus .75). The fabricated-proof concern now passes close to its .85 gate and should be described as fragile.

One of the five challenge failures is a **fixture defect**, confirmed independently by Opus: the denied-deadline case expects `no_hint` although its client contradicts the fixed executive-review facts. The selected `executive-need` cue is appropriate to assess, but .51 is below the .90 dispatch gate. Its trainee checks remain valid. Preserve the original expectation and raw failure rather than relabeling the result as a pass.

The other four failed checks represent two objective misses and their required evidence checks. They remain visible. These are synthetic transcript/voice probes, not human voice-naturalness studies or proof of reliable performance across all conversations.
