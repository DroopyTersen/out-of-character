# Replacing Jev with OpenAI Decisions: eval and experiment design

Designed 2026-10-09 on `spike/openai-decisions-evals`, from `0d1ae84e4495792bd3622eb558e856d58695ef3c`.

## Recommendation

Start with a paired, offline interview comparison: **silence → turn readings/thread selection → final grading**. Keep the current prompts, evidence, thresholds, timers, and code that consumes answers fixed. This gives an interpretable answer to “can Decisions replace Jev?” before spending time on prompt tuning or changing live voice behavior.

The interview engine already accepts an evaluation model. Use that seam for an experiment-only adapter; a production provider switch, another orchestration layer, and a rewrite of Sam/Sol/Luna are unnecessary for this comparison. Simulator and character-game evals follow as separate gates before claiming a repository-wide replacement.

**Status:** design and seed-corpus preparation complete; provider comparison not run. The branch contains a synthetic silence fixture pack and an independent-label rubric. Private source manifests, real cases, and label-review artifacts are under `.data/openai-decisions-evals/`, already ignored by Git. API account access, measured quality, latency, and cost remain untested. No production configuration changes are part of this work.

## API contract verified today

The [OpenAI Decisions guide](https://developers.openai.com/api/docs/guides/decisions) identifies public-beta `POST /v1/decisions`, currently using `gpt-6-luna`. It supports predicate, choice, and ordered-score questions over shared text input. Its advertised comparison with Responses is not evidence of a speedup over Jev. Published base input pricing is $0.10 per million tokens; regional/long-context adjustments may apply. Confirm effective billing during the smoke run.

The [API reference](https://developers.openai.com/api/reference/resources/decisions/methods/create) specifies string instructions, named answers, per-option distributions, individual refusals, and 2–255 unique choices. TypeSafe accepts structured instructions/criteria and maps question IDs to answers; its [API](https://docs.typesafe.ai/api) and [Score semantics](https://docs.typesafe.ai/primitives/score) match the three basic judgment meanings, not necessarily calibration.

| Current AI SDK question | Decisions request | Normalized answer consumed by existing code |
| --- | --- | --- |
| `boolean` (TypeSafe Noul) | `predicate`; retain both true/false criteria in the instruction text | `probability`, not confidence |
| `choice` | Ordered `choices` with original string IDs and descriptions | Selected ID plus probabilities keyed by original ID |
| `score` | Ordered `levels`, preserving all current rubric text | Weighted score and index-keyed distribution; keep 0–4 scales |

Serialize structured state and question text deterministically without summarizing or dropping nested source rules. Archive both canonical input and actual provider payload hashes. A syntax-preserving translation is the first candidate; readable prose reformulation is a later experimental arm.

The installed AI SDK uses `EvaluationModelV4`; the repository has no direct `openai` SDK dependency. A small adapter using server-side `fetch` can exercise the endpoint without a dependency upgrade. Do not point the Azure/Foundry client at this endpoint or infer Decisions availability in Foundry from OpenAI availability.

Two adapter checks matter before semantic testing:

1. Singleton evidence choices occur in current code, including the single-passage highlight case and a `none`-only evidence batch. Resolve that one possible selection deterministically, retaining the existing independent presence/observable gate. Do not invent a second candidate. Record this normalization in both arms; test empty, singleton, 254+`none`, and multi-batch evidence separately.
2. Preserve refusal/missing/malformed answers as unavailable or failed judgments according to each existing reader's required/optional contract. Never turn refusal into probability zero, silently drop a required answer, or fall back to Jev inside the measured Decisions arm. Join by question name; validate IDs, types, finite ranges, full distributions, and sums with numerical tolerance.

## Current behavior to preserve

| Lane | Source and application contract |
| --- | --- |
| Interview silence | `interview-engine/interview/session/silence.server.ts`: `interview-silence-v2`; last 8 passages; `P(continue) >= .85`; transcript inactivity of 4 seconds; 3-second request deadline; once per unchanged revision; 120-check cap. Current checks are **not audio-level gated**. |
| Interview turn | `conversation/ranking.server.ts`: `ranking-rubric-v5`; full settled prefix; focus, new project facts, new feedback, natural-next probability and open/answered/declined/stalled state per open thread. `producer.server.ts` uses a 3-second deadline. Novelty or feedback at `.8` can wake Sol, subject to existing eligibility and budgets. |
| Thread action | `conversation/ranking.ts` and `notes.ts`: retain current ranking, `.1` switching margin, holds, lead changes and note suppression. Raw score agreement alone is insufficient. |
| Interview grade | `conversation/evaluate.server.ts`: `interview-rubric-v8`; 0–4 readings with observable gate `.8`; explored coverage requires `.85`; supported set-aside requires `.5`; evidence must resolve to a participant passage. Live/final deadlines are 3/8 seconds. |
| Simulator | `ai/simulator/evaluate.server.ts`, rubric v12: skill observability `.85`; discovery objectives `.75`, other objectives `.85`; ending `.85` plus recent client evidence. Preserve behavior vs outcome persistence. Long grades partition into 12-question groups when >128 passages or >20,000 characters. Include actor checks and director freshness checks. |
| Character game | `ai/judging.ts`, `core/performance.ts`: live calls use Noul mode; 42 independent persona judgments; full/recent blend 70/30; 20-second recent window; fresh evidence; ten accepted readings at `.8` to win. Score mode is a separate experimental comparison. `ai/highlights.ts` adds presence plus passage selection. |

Jev baseline is the pinned `jev-1.13.0` from `interview-engine/providers/judge.server.ts`. Rerun it against the same frozen inputs and current rubrics; historical stored scores are diagnostic evidence, not the baseline or the answer key.

## Existing corpus and its limitations

| Corpus | Verified inventory | Reuse |
| --- | --- | --- |
| Interview fixtures | 49 in `ai/interview/fixtures.ts`; 29 contain semantic assertions, 20 have empty expected arrays | Preserve the 29 asserted cases. The other 20 are unlabeled inputs, not 20 passing semantic evals. |
| Simulator fixtures | 56 total: 8 development, 3 historical holdout, 2 validation, 11 challenge, 2 blind, 30 catalog | Preserve all authored expectations, evidence IDs, and withdrawn-agreement behavior. |
| Character fixtures | 17 base + 2 Brownfield regression cases in `ai/evals/fixtures.ts` | Include all negative controls. Reuse five highlight cases in `ai/evals/highlights.ts`. |
| Silence seed | 43: 20 real windows + 23 synthetic cases | Synthetic inputs now live in `ai/decisions/silence-fixtures.json`; private real windows have the same source provenance as the archives below. |
| Interview A | 156 passages, 19,018 characters; preview friction review; 125 archived turn records, 33 reconstructable applied maps | Development: statement-only pauses, unfinished answers, repeated topics, clarification, saved preferences. |
| Interview B | 129 passages, 13,159 characters; production review; 80 turn records, 23 reconstructable applied maps | Positive regression: preserve productive behavior as well as catch failures. |
| Reserved historical C/D/E | 75/50/12 passages; 10,266/7,901/1,227 characters | Additional session-level coverage. Inspected metadata only for this design; previous development exposure is unknown. |

Exact archive paths, IDs, byte hashes, spec versions, and counts are in the private `sources.json`. Do not commit raw dialogue, real map text, or transcript-derived notes. The old `holdout-*` case names are retained for provenance, but these are **historical regression cases**, not a fresh holdout. All windows, mutations, and variants from the same interview stay in one split; related stories/participants should be grouped where known.

New blind validation should be collected after prompts/thresholds freeze: initially five further interviews spanning at least three participants and different topics/lengths, with consent and existing archive controls. Label them without seeing either provider's output. This is a screening target, not enough by itself to establish rare-failure safety or a 2-point noninferiority margin. If uncertainty is wide, gather more independent sessions rather than declaring equivalence.

### Concrete seed cases

The inherited silence pack covers these exact cutoffs. Every case uses only its eight supplied passages; later complaints are excluded from model input and label adjudication.

| Case family | Inputs | Expected behavior to adjudicate |
| --- | --- | --- |
| Statement-only dead air | A through p60, p66, p73, p86, p106, p124, p134; B through p80, p102, p121 | Continue after a completed answer and acknowledgement, including after a topic is declined. Do not infer end-of-interview from “leave that here.” |
| Backchannel after a statement | A through p74 | Decide from the preceding exchange; a participant acknowledgement does not create a new unanswered question. |
| Question still outstanding | A through p34, p47, p77 | Wait for the participant's answer. |
| Still building a thought | A through p50, p56; yielding/backchannel endings p70, p42 | Wait; preserve patience despite the hypothetical four-second gap. |
| Clarification and completed answer | A through p100 and p35 | Respond to a repeat request / take the next turn after a completed answer. |
| Synthetic contrasts | 23 cases in the committed pack | Explicit ending, thinking, punctuation mismatch, unfinished answer, clarification, declined topic, acknowledgement with a question outstanding. |

Turn-reading pilot: 20 distinct `(source, passageId, mapId)` inputs are frozen in private `turn-cases.json`, with transcript prefixes, maps, source hashes and original turn IDs. A uses p35, p50, p56, p76, p100, p117, p139, p144 and two map versions at p146. B uses p10, p20, p31, p41, p51, p60, p70, p91, p111 and p120. These cover ordinary facts, unfinished answers, clarifications, new pacing/grounding feedback, and adjacent-topic rejection. The private preparation script validates hashes, each map's input cutoff, map availability at dispatch and participant-turn eligibility. These turn labels are **not yet gold**.

For p117, inspect t6 and t21 together: the correct action must not replace the rejected topic with its near-synonym. The first p146 map lacks the new framing preference; the second contains it with a p144 citation. This supplies a concrete before/after contrast for feedback detection. Do not copy the old novelty number into the expected answer.

Grade pilot: use the 29 asserted synthetic cases plus 10 real prefixes (A/B at roughly 25/50/75/100% and one boundary-heavy cutoff each). Select cutoffs on completed participant turns. Label each topic's coverage and acceptable evidence; include readings only when supported. Useful existing contrasts include `leading-and-mm`, `named-hearsay`, `terse-three-weeks`, `attributed-handoff-effect`, `explicit-boundary`, `corrected-leading`, and `client-testers-not-delivery-staff`.

## Experiments

| ID | Question and controlled comparison | Evidence and decision |
| --- | --- | --- |
| E0: contract | Six small synthetic requests per provider: all three primitives, batched types, source-ID evidence, singleton normalization, near-limit evidence choice count, and larger shared state. Separate local fault-injection checks exercise refusal, duplicate/missing names, unknown IDs, malformed distributions, HTTP errors and aborts. | Validate payload/answer translation and effective account access. Save raw safe response, usage and request ID. No quality claim from these cases. |
| E1: silence | 43 seed windows × both providers × 3 repeats, original question and `.85` threshold. Interleave A/B order with a fixed seed. | Compare continue recall, false continuation on wait/finished, Brier score on adjudicated labels, threshold flips, p50/p95 latency, timeout/refusal rate. Count all attempts. |
| E2: turn readings | 20 frozen prefix+map cases × both × 3. Identical current v5 questions. Apply returned readings through the same ranking/notes code. | Score feedback/novelty, focus, declined/answered/stalled states, acceptable next-thread set, unnecessary switches, forbidden adjacent re-probes and wake decisions. Observe state and resulting action, not just rank correlation. |
| E3: grades | 29 asserted synthetic fixtures + 10 labeled real prefixes × both, once initially. Repeat only borderline/disagreement cases under a separately recorded run. | Coverage confusion matrix, false explored credit, boundary respect, missing observability, evidence support, 0–4 score error against labeled intervals. Compare both raw grade and displayed coverage through existing accumulation code. |
| E4: threshold calibration | Only if syntax-preserving Decisions loses because probabilities cross current thresholds. Fit on development only. Keep prompts/input fixed. | Sweep silence `.70–.95` and boolean gates around their current settings. Choose thresholds under a false-intervention constraint, then freeze and evaluate other sessions. Report original-threshold and calibrated results separately; changing confidence thresholds does not repair wrong evidence. |
| E5: batching/latency | After quality gates, compare production-sized batches to fixed-size question groups on both providers; same questions/evidence. Test short, median and long sessions, first-call and repeated-input timings, concurrency 1 then 3. | Report whole-evaluation latency and cost including every partition, timeout and retry. Avoid rerunning Sol merely to manufacture downstream variance. Treat chunking, serialization changes, and native prose prompts as separate arms. |
| E6: wider Jev replacement | All 56 simulator fixtures, 19 character fixtures and 5 highlights. Replay simulator prefixes and game accepted-snapshot sequences. | Preserve conditional walk-out vs true ending, withdrawal, authority/knowledge/role/personality corrections, exact evidence, negative portrayals and win/reset behavior. A transcript without word timings cannot validate the game's actual freshness/window behavior. |
| E7: live acceptance | After offline success, bounded paired rehearsals with the same voice, interviewer instructions, scripted participant audio and timing. Switch only the judge. Randomize run order; at least 3 repeats across completed answers, within-story pauses, declined topic and closing. | Actual audible interruption rate, time to relevant next question, repeated/declined questions, missed continuation, final-grade usefulness and full session cost. Delivery acknowledgments and offline note text alone do not prove Sam followed the note. |

Recommended first paid tranche: E0–E3, at most **468 request attempts** if the unpartitioned input contract holds (12 + 258 + 120 + 78), with a proposed **$5 total ceiling**. Count requests before dispatch, including failures. Preflight may require a smaller tranche if either provider partitions a request. Print the frozen manifest hash, per-lane request counts, data destinations and estimated token budget before a run. Stop on exhausted budget; never reset counters on retry. This is a proposed execution budget, not evidence that the API was run.

## Replay construction: avoid future evidence and false precision

1. Hash the source bytes and record base commit, spec ID/version, rubric versions and the adapter version. Keep the original archive immutable. Reject missing or altered required inputs; do not silently shrink the corpus.
2. Reconstruct maps from applied updates in order with `applyMapUpdate`. Validate each update against its own `inputCount`/`lastInputId` transcript prefix and only research events available by that map call. A missing/shed update makes dependent cases unreconstructable. Do not substitute the final map.
3. Use each turn's recorded `mapId` and passage cutoff. Assert that the map completed before dispatch and all cited participant passages are at/before the cutoff. Preserve distinct map versions and repeated-turn identity. Reject ambiguous/missing identity instead of guessing from transcript timestamps.
4. Final archived text may include revisions made after the recorded call. Neither `passageId` nor record time alone recovers the exact partial text Jev originally saw. Label these **finalized-prefix semantic replays**, not exact production-request reproductions. Freeze that same approximation for both providers; exclude cases whose ambiguity changes the expected answer.
5. Reset ranking state at each interview, then process readings/maps in order. When simulating measured latency, schedule completion relative to request start; discard results if the session/map/input became stale. The code's map-change and cancellation guards remain authoritative. Provider audio clocks and wall clocks are not interchangeable.
6. Frozen-map replay estimates the effect of changed judgments on the historical path. A different novelty/feedback wake could cause a different Sol map, so this is not a full causal simulation. Record those divergences and test them in E7; do not credit hypothetical downstream improvements as observed.

The existing offline `scripts/interview-replay.ts` successfully reconstructed both anchor archives in this checkout: A had 124 readable turns and 58 replayed list notes vs 58 recorded; B had 80 readable turns and 42 replayed vs 43 recorded. One A turn was not a successful readable record. This establishes useful replay inputs, **not exact behavior parity or model quality**. Preserve the B discrepancy as a limitation to explain before timing-sensitive claims.

## Labels, metrics, and pass/fail

Use [the label rubric](../../ai/decisions/label-rubric.md). Preserve inherited labels, independent reviews, adjudication decisions and reasons separately. A judge receives the case, available evidence, criteria and anonymized output; hide provider name, cost, previous scores and expected winner. Two independent judgments or Andrew's adjudication are required for disputed critical cases. Labels do not come from Jev/Decisions agreement.

The independent silence label pass used evidence-only packets without inherited expectations. It agreed with **42/43** inherited binary labels: 22 continue, 18 wait and 2 finished. `holdout-unfinished-sam-question` was ambiguous because an interviewer question stops halfway through; preserve its inherited label but exclude it from accuracy/calibration until adjudicated. All 43 can still measure transport and latency. “Historical holdout” cases used in that pass remain regression data. This is label verification, not a model accuracy result.

Report per lane and per source session, with macro averages across cases/sessions as well as raw denominators. Do not let dozens of easy objective assertions hide one ignored boundary. Include excluded/unlabeled cases and all transport failures. Repeated calls measure variability; they are not additional independent examples.

| Dimension | Measure | Proposed advancement gate |
| --- | --- | --- |
| Contract | Required answer completeness, types, allowed IDs, valid distributions, evidence from allowed speaker | 100% deterministic checks; no silent normalization of malformed answers |
| Critical behavior | Ignored explicit wait/end/decline, false termination, invented/wrong-speaker evidence, stale actions | Zero critical candidate failures on adjudicated cases; any failure blocks that lane even if Jev also fails |
| Semantic behavior | Acceptable action rate; coverage/state confusion; false positive/negative counts; supported evidence | Pilot: no unexplained case regression. Expanded validation: paired accuracy difference lower 95% bound above −2 percentage points, otherwise inconclusive; judge absolute errors too, even when both providers fail |
| Calibration | Predicate Brier score; per-class reliability; action error at fixed vs tuned threshold; ordinal interval error | Tune only on development. Freeze before validation. Small corpora support plots/descriptions, not a claim of broad calibration |
| Reliability | Successful usable judgments / all attempts; timeouts, refusals, stale completions, unavailable final grade | No unexplained decline in completion rate. Production deadlines remain unchanged |
| Latency | Warm/cold p50/p95 full evaluation wall time; usable result before 3-second live / 8-second final deadline | Do not trade more deadline misses for a faster successful-call median |
| Cost | Actual usage and pricing snapshot, all partitions/failures, per decision and per interview | No “cheaper” claim from input rate alone. Any acceptable cost increase must be explicit in the recommendation |

Use paired resampling by **session/story**, not individual correlated turns, for uncertainty intervals. Show numerator/denominator and session count beside every rate. With only A/B, label conclusions exploratory. No pooled “Jev replacement score” can override a failed lane.

A winning outcome may be **silence-only**, **interview judging only**, **full replacement**, **keep Jev**, or **inconclusive**. Recommend the smallest proven switch. A beta API with equal quality but worse reliability is not automatically an upgrade.

To recommend a switch, require the quality/reliability gates plus a demonstrated benefit in quality, latency, cost, or a concrete reduction in operational work. Report tradeoffs explicitly; a provider consolidation preference is not evidence of faster or cheaper judgments.

## Minimal implementation plan

Keep the experiment code under `ai/decisions/`; do not edit runtime factories to run the pilot.

1. `provider.ts`: `EvaluationModelV4` adapter for direct Decisions HTTP, narrow serialization/answer validation, abort support, no implicit retries. Reuse current Jev factory as baseline. Add local tests for actual contract and failure cases, including weighted-score math from a known nonuniform distribution and singleton evidence behavior.
2. `prepare.ts`: import existing fixture arrays; read explicit private source manifest; build immutable case inputs/labels and hashes. Import current question builders rather than duplicating their prompts. Validate archive reconstruction and split grouping.
3. `run.ts`: select provider/lane/cases/repeats, enforce caps, interleave order, persist each result/error immediately, never overwrite historical evidence. The default invocation should prepare/show a run without calling providers; an explicit paid mode executes it.
4. `report.ts`: apply current readers/ranking, score frozen expectations, output per-case paired results, critical failures, uncertainty and cost/latency summaries. Report model errors and unreadable cases even when no semantic score exists.

For silence/turn/final-grade, call the engine's existing `evaluateSilence`, `evaluateTurn`, and `evaluateInterview` with injected models. For simulator/game, existing wrappers instantiate TypeSafe internally; initially import public question builders and answer readers in the experiment. If a tiny evaluation-model injection is needed for full path parity, make it separately and verify current behavior before comparison. Do not build a generic provider framework.

One private result record must retain: case/source IDs, split, input and payload hashes, cutoff/map identity, requested/resolved model, rubric/adapter versions, repetition/order, start/end/duration, status, response request ID if supplied, safe raw answers, normalized answers, downstream action, expected label/evidence, usage/cost or `unknown`, and error category. Never serialize request authorization headers or arbitrary SDK error bodies.

Current reproducible commands (no provider calls):

```sh
bun scripts/interview-replay.ts output/interview-review/2026-10-08-506432d/archive-row.json output/interview-review/2026-10-08-production-1343bc9/archive-row.json
bun test interview-engine/interview/session/silence.server.test.ts interview-engine/interview/session/session.server.test.ts interview-engine/interview/conversation/ranking.server.test.ts interview-engine/interview/conversation/ranking.test.ts interview-engine/interview/conversation/evaluate.server.test.ts
```

The proposed comparison runner above does not exist yet. Existing paid scripts such as `ai/interview/run.ts`, `ai/simulator/run.ts`, and `scripts/interview-silence-probe.ts` are Jev-only; running them alone cannot answer the replacement question. Keep their historical result files intact when implementing the paired runner.

Verification for this design: both anchor archives replayed locally; all 20 selected turn inputs reconstructed with the cutoff/availability checks; the 23 committed synthetic cases have unique IDs and valid evidence references; the targeted existing interview suite passed **54 tests / 322 assertions**. These checks use local fixtures and provider substitutes; no paid Decisions or Jev comparison was performed.

## Remaining evidence before a replacement decision

- Independently adjudicated real turn/grade labels, reserved session split, and a new unseen validation set.
- Access to the requested Decisions endpoint, effective request limits, resolved model and actual usage/billing. Public documentation does not establish this account's access or an Azure equivalent.
- Fresh paired Jev/Decisions measurements. No inference from old Jev results or OpenAI's Responses comparison.
- Explanation of replay reconstruction differences and complete live-timing evidence where the claim depends on voice behavior.
- Explicitly requested production switch/deployment after the relevant lane passes; this design does not change the live provider.
