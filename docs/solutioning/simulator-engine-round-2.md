# Simulator engine round 2

Owner: Opus. Base: `bfe6a1e` on `simulator-mvp`. Scope: scenario and actor content (`ai/simulator/scenarios.server.ts`), the synthetic role-play probe (`scripts/simulator-roleplay-probe.mjs`) and one public-projection privacy assertion (`core/simulator/state.test.ts`). The rubric, evaluator, session owner and UI were not changed. The architecture remains all-live, with no backend generator. Plan: [simulator-improvement-rounds.md](simulator-improvement-rounds.md).

## Round 1 review verdict

**`bfe6a1e`: accepted, with one lifecycle risk to verify in round 3.**

- **Stale-feedback marking** (`session.ts:185`): correct and minimal. Changed settled dialogue marks the existing assessment delayed before the cadence gate. Client-only changes also mark it delayed, which is right because client speech can move outcomes.
- **Immediate local release** (`live-connection.ts:140–157`): correct.
  - The keepalive `end` request uses its own timeout, so aborting the controller cannot cancel it.
  - `fail` reports immediately.
  - Guards prevent double release.
- **Risk to verify:**
  - *What changed:* before this commit, the peer closed only after the server had requested `session.close`, allowing the HTTP closure to finish before local transport teardown. Now `pc.close()` runs straight after a data-channel send. That can discard the queued close message, and the provider may observe a lost transport first.
  - *Why it matters:*
    - If a `connection_lost` closure reaches the sideband before the HTTP `end`, `onEvent` (`session.ts:129–135`) calls `end(true)`. An explicit End would then be recorded as *interrupted*.
    - Even with `close_requested`, the provider now closes before the server's `finish()` asks it to. Input transcription still in flight for the trainee's last utterance can then be lost, so the final grade can miss the closing line.
  - *How it was missed:* the regression substitutes provider behavior, so it cannot observe this.
  - *Test:* one real session ended by the user straight after speaking must finish `ended`, with no interruption message and with the last trainee line in the transcript.
  - *Simplest fix, if it reproduces:* stop microphone tracks immediately, but close the peer after the channel drains or the `end` response arrives (bounded to about 1 s).

**Carried findings for round 3 (classification).** These are unchanged from the round 1 review.

1. A latched objective turns one false-positive grade into permanent credit (`state.ts:32`).
   - The harness checks raw grades and replays only positive fixtures.
   - Test: replay negative fixtures at every prefix through `reconcileObjectives`.
   - Fix: latch only after two agreeing grades, or on the final grade.
2. Volunteered disclosures count as discovery (`rubric.ts:6`).
   - Example: the stakeholder named by Morgan while rebuking a poor pitch in `output/simulator-roleplay-poor-off`.
   - This round judged that actor behavior realistic (below), so the scoring policy is the lever.
3. The latched behavior `boundary` survives a later capitulation (`rubric.ts:52` and `state.ts:32`).
4. The global mistake veto makes concern and outcome mutually exclusive (`evaluate.server.ts:50/56/62`). As a result, `challenge-independent-agreement` is unsatisfiable by construction.
5. The settle window is shorter than the merge window (1200 ms vs 2000 ms, `state.ts:24` vs `:11`). A graded passage can therefore still grow.

## Critique and candidates

The evidence comes from:
- the six new synthetic sessions, where "p" is the transcript entry number;
- the four earlier Morgan/SharePoint reports, recorded on an unchanged brief (image paths only differ since then).

| # | Candidate | Evidence | Disposition |
| --- | --- | --- | --- |
| 1 | Scope release date undefined relative to the executive review | Before, Casey p7 invented "The release is also in two weeks". | **Fixed.** The release goes live in ten days, four days before the review (fixed limit). The trainee's public lead now states the date, because a technical lead knows their own release. |
| 2 | Manual-report fallback lacks an owner, data and access boundary | Before, Casey p13 invented "I can pull the numbers". The close left unclear who produces the "vetted manual snapshot". | **Fixed.** The fallback now has an owner (operations analyst prepares, client presents), a data gap (figures unconfirmed) and an access boundary (no access to overdue history without a developer extract or product-owner approval). |
| 3 | High-bargaining client volunteers the budget ceiling instead of bargaining | Before, Morgan p7 answered a paid proposal with "under say, 8 thousand"; nobody had asked about budget. | **Fixed.** The ceiling is "not a price to offer", and a relevant budget/authority question is still answered truthfully, including the figure. Bargaining is conditional on usefulness; Morgan may trade cost against protecting delivery without countering every proposal. No counteroffer is forced. |
| 4 | Coach-like questions: the client prompts the trainee toward discovery | Before, Morgan p3 answered a pitch with "What's the impact if we just wait?". Earlier `poor-off` ended all 3 client turns with questions; `poor-on` p7 asked "What's the actual impact…". | **Fixed.** "Ask one relevant question at a time" became: at most one question, only when the client wants the answer, and no steering. Morgan's "Use short, direct questions" became "Be brief and direct". |
| 5 | Turn-taking not organized per official GPT-Live guidance | [Live prompting guide](https://developers.openai.com/api/docs/guides/live-prompting) recommends the headings Backchannel, Interruption and Delegation policy. | **Aligned.** The existing rules moved under those headings, and the delegation policy is now "never delegate". The production delegation fallback is unchanged. No delegation event occurred in any of the 6 runs. |
| 6 | Guarded Avery may withhold ordinary facts | Before, Avery p3/p5 answered symptoms, impact and history directly. After, p3/p5/p7 did the same, plus ownership. | **Not reproduced; preserved.** No prompt change. |
| 7 | Stakeholder "leakage" under pressure (earlier `poor-off`) | Naming the approvers when asked to bypass them is realistic client behavior. | **Rejected as an actor defect.** The consequence for credited discovery is classification (round-1 finding 2). |
| 8 | Exercise vocabulary in authored facts ("need not be discovered", "without a required sequence") | Text inspection | **Cleaned up** in the rewritten ownership fact and budget limit. No behavioral claim. |
| 9 | Morgan and Casey share the `cedar` voice | Catalog | **Deferred.** Voice availability for `gpt-live-1` is unverified and would cost a paid session. |
| 10 | "I'll ask ops and reply by Friday" scores just under the outcome threshold | `next-step` scored .80 (Morgan before), .83 (Avery after) and .83 (Morgan after), against .90–.95 elsewhere. | **Round 3 calibration candidate.** Rubric not touched. |

## Changes

- **Scenario content:** candidates 1–5 and 8.
  - Interests, other facts, objectives, cues and `seriousMistake` are unchanged.
  - The scope summary, opening and all SharePoint constraints except the budget limit are unchanged.
- **Probe** (harness only):
  - `--scenario`, `--client`, `--plan` and `--label` options.
  - Responsive plans: `sharepoint/practical` (ordinary questions, then a paid proposal), `sharepoint/mixed` (overconfident pitch, recovery, paid proposal) and `scope/good` (purpose, timing, boundary with manual report, preparation, owned next step). The `good`/`poor` plans are unchanged.
  - Each report records the scenario, cast, voice and a 12-character brief digest, never the brief text.
  - A delegation attempt is recorded as an error.
  - A slow client judge no longer aborts the paid session.
  - The production opening request is reused.
  - One harness fix between the before and after runs: the ownership skip pattern is now `operations director|owns|owner` instead of `operations`. Before, the impact answer "operations spends hours" had skipped the ownership question for Avery. As a result, Avery's after path asks one question that the before path did not.
- **Test:** the public-catalog privacy assertion now also excludes `operations analyst` and `overdue-item history`. It guards the projection; it passes on the old content too, trivially. Brittle prompt-wording tests were deliberately not added.

## Probe evidence

Six sessions in total, all explicit `--paid`, director off, synthetic Samantha TTS trainee. All finalized with no errors or delegation. GPT-Live usage was 583 s.

| Cast / plan | Brief | Usage | Key actor behavior | Objectives achieved | Mean client fidelity |
| --- | --- | --- | --- | --- | --- |
| Casey / scope, before | `90e6969677b0` | 96 s | Invents a two-week release; client personally pulls numbers | all 5 | 3.56 |
| Casey / scope, after | `4f00a4c4c38b` | 112 s | "release is in 10 days, so four days before that review". Raises analyst/overdue-history access unprompted (p7) and names the extract or product-owner approval (p9) before accepting | all 5 | 3.62 |
| Avery / practical, before | `16378e1c950d` | 76 s | Direct factual answers; accepts readily | all 5 | 3.81 |
| Avery / practical, after | `ae6ae69bc2dd` | 94 s | Direct answers incl. "The operations director owns that process". Protects the four-week release; "no promises on their time" | 4/5 (next-step .83) | 3.82 |
| Morgan / mixed, before | `7968441db20a` | 104 s | Coaching question after pitch; volunteers ~$8k ceiling | 4/5 (next-step .80) | 3.86 |
| Morgan / mixed, after | `dd02e1208d15` | 101 s | Flat refusal of pitch; no ceiling volunteered; declines folding into scope; asks ops with Friday timing and "no blank check" | 4/5 (next-step .83) | 3.87 |

Reports and client audio are in `output/simulator-roleplay-{scope-casey-good,sharepoint-avery-practical,sharepoint-morgan-mixed}-off-{before,after}/` (ignored). A scan found no credential-shaped values or brief text. The Jev client-fidelity score barely moved and did not penalize the invented date, so it is not a discriminating metric for these changes.

## Verification

- **Tests:** `bun test ai/simulator core/simulator app/server/simulator` gave 29/29, 124 assertions on the round-2 files alone. Later round-3 regression results are recorded separately.
- **Typecheck:** `bunx tsc --noEmit` passes. `react-router typegen` was not run, to avoid touching generated files; routes are unchanged.

## Limits

- One run per condition, so behavior differences are indicative, not statistical. Avery's after path differs by the harness fix.
- The synthetic trainee is turn-based, with no barge-in and no backchannels, so the new Backchannel and Interruption policies were not exercised.
- Budget-question answerability was not exercised after the change, because no plan asks about budget.
- The Jev graders read the scenario text:
  - the trainee grader reads constraints as `referenceNotSpoken`;
  - the client evaluator reads facts and constraints.

  Round 1's 42/48 classification baseline was therefore measured on the previous text, and round 3 should re-measure before attributing changes.
- The scope lead copy is public, so the selection screen and workshop previews now show "the release due in ten days".

Reproduce one session with:

```bash
bun --env-file=.dev.vars scripts/simulator-roleplay-probe.mjs --paid --scenario=scope --client=casey --plan=good --label=after
```

Ownership of the round-2 files returns to root.
