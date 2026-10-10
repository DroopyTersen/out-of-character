# Microsoft-Decision-1 comparison — 9 October 2026

**Microsoft met both requested targets: 73/82 turn checks and 161/200 real-topic coverage checks. The same optimizations improved Decisions' real coverage, but did not produce a broad improvement for Jev.** Turn checks have 82 assertions in the frozen suite, rather than the estimated 80. Application provider configuration remains unchanged; these are offline evaluation changes.

Spark DEV now has `Decision-1`: Microsoft-Decision-1 version 1, GlobalStandard, East US 2, **354 requests/minute**, increased from 177 to the available quota maximum. Additional quota requires a Microsoft request with justification. Jev resolves to `jev-1.13.0`; Decisions resolves to `gpt-6-luna`.

## Original versus optimized results

Every result below uses the same frozen validation cases and labels, with two repetitions. The original Jev/OpenAI columns reuse saved responses; their optimized columns come from fresh calls after Microsoft tuning. Microsoft silence inputs are unchanged and its saved silence results are reused.

| Validation measure | Jev original → optimized | Decisions calibrated → optimized | Microsoft calibrated → optimized |
| --- | ---: | ---: | ---: |
| Silence actions | 20/22 → 20/22 | 20/22 → 18/22 | 20/22 → 20/22 |
| Turn checks | 69/82 → **67/82** | 72/82 → **70/82** | 60/82 → **73/82** |
| Real topic coverage | 159/200 → **165/200** | 150/200 → **166/200** | 136/200 → **161/200** |
| Existing synthetic grade assertions | 43/48 → **46/48** | 44/48 → **42/48** | 40/48 → **40/48** |
| Real behavioral readings | 54/60 → 54/60 | 60/60 → 60/60 | 49/60 → 49/60 |
| False explored credits, real and synthetic | 16 → **24** | 4 → **14** | 2 → **4** |
| Usable validation responses | 70/70 → **69/70** | 70/70 → **70/70** | 70/70 → **70/70** |

Microsoft's original `.85` coverage gate scored 106/200. Its first calibration reached 136/200, compact evidence reached 140/200, and the final recipe reached 161/200. The compact candidate scored 42/48 synthetic checks; the final recipe dropped to 40/48, missing the `boundary-accepted/process-improve` assertion in both repetitions. The unsupported process-tool credit in `terse-expert` and missed client-decision boundary in `interview-B-p31` remain critical failures, each repeated twice. Its other false explored credit is `interview-B-p129/process-improve`, also repeated twice.

Jev's optimized validation includes one failed grade response. The native response selected `not-yet` with probability `.42` when `touched` had `.43`, so the actual SDK rejected it for not selecting a highest-probability option. Both assertions in that fixture remain failed in the denominator. Separately, Jev rejected the longest development prefix, `interview-A-p155`, with HTTP 400 `max_tokens_exceeded`. These failures are retained without response repair or replacement. All 137 fresh Decisions calls succeeded; Jev had 135 usable responses out of 137.

## Did the prompts help, or just the thresholds?

The optimized arms share Microsoft's frozen gates: silence `.90`, explored coverage `.35`, new project information `.70`, interview feedback `.80`. The original OpenAI calibration used `.70` silence and `.50` coverage; Jev used `.85` for both, with `.80` new-information/feedback gates. Transferring the same gates therefore changes policy as well as wording.

Rescoring the saved responses at the shared gates isolates that policy effect without another API call:

| Provider at the same gates | Saved inputs → optimized inputs: turns | Real coverage | Synthetic | False explored credits |
| --- | ---: | ---: | ---: | ---: |
| Jev | 69/82 → 67/82 | 166/200 → 165/200 | 48/48 → 46/48 | 25 → 24 |
| Decisions | 72/82 → 70/82 | 148/200 → 166/200 | 46/48 → 42/48 | 6 → 14 |

**Decisions' prompt changes gain 18 correct real-topic checks and 12 expected evidence-ID matches, but lose two turn checks and four synthetic checks. Jev's apparent improvement over its original grade scores comes from the gate change; the prompt recipe adds no broad gain.** The higher false-credit counts make a universal adoption of this recipe unattractive. The `.90` silence gate also explains Decisions' drop to 18/22, because its silence requests are unchanged.

Evidence matches remain separate from coverage and readings. Expected evidence-ID lists are not exhaustive; an unmatched citation requires semantic review before calling it fabricated. The results support further provider-specific development and an independent validation set before changing application behavior.

## What the hill climb changed

Turn requests identify the exact latest participant turn, preserve resumed participant speech across interviewer backchannels, name the preceding interviewer question, and retain the last eight earlier context passages. Gap-state criteria distinguish an unfinished answer or clarification from refusal or a finished non-answer. Feedback criteria distinguish interviewer conduct from feedback about the project. No gold answers enter requests.

Grade requests retain the full dialogue, all participant evidence IDs and the existing 49 questions. They add exact 32-character excerpts to evidence options, tie coverage alternatives directly to the topic criterion, clarify concise facts and topic-specific limits, and render nested instructions and choice criteria as readable text. Evidence, applicability, ranking and reading rules remain in the existing core reader.

Development selected the turn `.70` gate from `[.50, .60, .70, .80, .90]`; `.70` was the highest tied winner in that grid. Grade selection searched `[.30, .35, .40, .45, .50, .60, .70, .80, .85]`, requiring zero development false explored credits and zero critical failures before maximizing real coverage plus synthetic assertions.

| Grade development candidate | Real coverage + synthetic | Outcome |
| --- | ---: | --- |
| Compact evidence | 68/100 + 42/44 | First improvement |
| Topic criteria | 73/100 + 42/44 | Validation reached 150/200 |
| Extra criterion-satisfaction questions, shortened | 72/100 + 42/44 | Rejected |
| Separate participant accounts | 68/100 + 41/44 | Rejected |
| Second-pass evidence anchors | 53/100 + 42/44 | Rejected |
| **Readable topic criteria and instructions** | **79/100 + 42/44** | Selected at `.35`; readings 30/30 |

The final turn candidate scored 41/45 development checks. Both final candidates and their request hashes were frozen before their fresh Microsoft validation calls. Jev and Decisions then received those exact request transformations and shared gates, without further provider-specific tuning. An independent audit verified all 274 fresh cross-provider native payload hashes, replayed the 272 usable responses through the actual SDK offline, and reproduced both failures.

Some rejected longer formats exceeded provider limits. Foundry returned a concrete combined state/question limit of 64,000 tokens for an approximately 66,304-token request. The final 49-question Microsoft grade recipe completed every development and validation request. No transcript truncation was introduced for grading.

Validation had already been inspected during earlier comparisons. Selection used development only, but these runs are **regression replays, not a new untouched holdout**. Two related interview archives, finalized words and frozen one-step maps do not establish live voice performance or full causal interview behavior. Repeated calls measure stability rather than adding independent interviews.

## Latency and price

These are local replay wall times for the optimized validation arms. Microsoft silence timing is reused; optimized Jev/OpenAI calls are contemporary. Azure location and network conditions contribute.

| Lane | Jev p50 / p95 | Decisions p50 / p95 | Microsoft p50 / p95 | Jev / Decisions / Microsoft per 1,000 usable calls |
| --- | ---: | ---: | ---: | ---: |
| Silence | 100 / 154 ms | 155 / 195 ms | 311 / 972 ms | $0.033 / $0.050 / $0.018 |
| Turn | 119 / 157 ms | 197 / 269 ms | 503 / 1,357 ms | $0.262 / $0.678 / $0.219 |
| Grade | 274 / 483 ms | 338 / 511 ms | 922 / 1,987 ms | $1.304 / $3.012 / $1.114 |

[Microsoft costs $0.042 per million input tokens](https://commandline.microsoft.com/microsoft-decision-1-model-foundry/), [Jev costs $0.042/M](https://docs.typesafe.ai/models), and [Decisions costs $0.10/M](https://developers.openai.com/api/docs/guides/decisions). Output tokens are free. Workload estimates use returned input usage and exclude unknown charges; they are not invoice reconciliation. Grade verbosity raises input cost for Jev and Decisions. The rejected Jev response's known native usage remains charged in the experiment ledger, although it is excluded from the usable-call latency/cost table.

At completion of the initial comparison, the cumulative ledger had **1,494 paid reservations, approximately $1.3034**, including prior baseline work. That task added **1,043 reservations, approximately $0.9596**, of which the final 274-call Jev/OpenAI comparison accounts for approximately **$0.2701**. There were **676 recorded Microsoft replay attempts, 668 usable responses**, plus one successful smoke call. Two interrupted requests have no retained response; eight Microsoft HTTP failures and the Jev token-limit failure remain conservatively reserved. Ninety early fresh baseline calls are excluded from comparison scoring and retained in accounting. Recovered responses are offline replays of paid calls, not additional calls. All paid calls were serial, with retries disabled and unchanged 3-second turn/silence and 8-second grade deadlines.

## Four further synthetic-focused iterations

The continuation tested four atomic grade-presentation changes, retaining the original cases, labels, core reader and `.35` coverage gate. Each candidate started from the existing readable grade recipe because every preceding candidate was rejected. Selection required retaining every development score and introducing no additional false credit or critical failures before fresh validation.

| Development candidate | Synthetic /44 | Real coverage /100 | Readings /30 | Evidence /103 | Decision |
| --- | ---: | ---: | ---: | ---: | --- |
| Existing recipe | **42** | **79** | **30** | **44** | Retain |
| 1. Concise factual accounts and unresolved coordination | 41 | 77 | 29 | 43 | Reject |
| 2. Separate known facts, attributed accounts and knowledge limits | 42 | 76 | 29 | 44 | Reject |
| 3. Internal tools versus product features, with neutral examples | 42 | 76 | 29 | 44 | Reject |
| 4. Evidence can support partial coverage without full credit | 42 | 79 | 29 | 42 | Reject |

**None improved synthetic checks while preserving the other scores.** Candidate 1 also introduced two false explored credits and one critical failed assertion; candidate 2 introduced one false explored credit. All 100 calls succeeded. The reading regression in every candidate is one real engagement estimate falling just below the frozen lower bound of 3.0; it remains a failed assertion rather than being rounded up or relabeled.

Independent rubric review found a legitimate missed concrete workload allocation and a separate ambiguity in the vendor-coordination fixture: the dialogue does not explicitly establish the other team's client/vendor relationship. Its existing positive label remains frozen; the request should not invent that relationship to win a check. This limits how strongly a perfect synthetic total can be interpreted.

Turn and silence inputs remain identical to the selected precise/literal recipes across all four variants, verified by **252 request hashes**. No candidate cleared development, so no candidate advanced to validation. The retained validation measurements are **40/48 synthetic, 161/200 coverage, 49/60 readings, 105/178 evidence, 73/82 turn and 20/22 silence** from the prior frozen runs. The recipe stayed unchanged, so Jev/Decisions results also remain the prior comparison results.

These four iterations added **100 calls costing approximately $0.1156**, bringing the cumulative reserved/settled ledger to **1,594 reservations and $1.4191**. The [continuation measurements](../../ai/decisions/microsoft-synthetic-climb-2026-10-09.json) include every candidate's score, failed acceptance floor, manifest/source/request hashes and accounting. The independent audit reproduced all **100 native payloads, answers, reader outputs and usage totals**, with zero mismatches or transport failures. The focused suite passed **27 tests / 89 assertions**; the full `bun run check` passed **584 tests / 9,209 assertions**, type checking, boundaries, build, bundles and deployment dry run. The retained 39 grade and 20 turn request hashes still match their original freezes.

## Reproduction and checks

The [sanitized measurements](../../ai/decisions/microsoft-results-2026-10-09.json) contain corpus/gold hashes, source hashes, run manifests, frozen recipes, dimensions, per-source denominators and accounting. Raw interviews, questions, responses and credentials remain in ignored `.data/openai-decisions-evals/`.

The corpus has 102 cases: 43 silence windows, 20 turns and 39 grades. Development has 67 cases and validation 35; one ambiguous silence case is excluded from quality scoring. The reader locally normalizes archived trainee/client speaker names to participant/interviewer without changing frozen API inputs. All **450 historical outputs reproduced exactly**, with no changed labels or input hashes.

```sh
# Preview the frozen shared recipe without provider calls.
bun ai/decisions/run.ts --arms=jev-optimized,literal-optimized --split=validation --repeat=2

# With existing local credentials and the private frozen files, use a fresh run ID.
bun --env-file=.dev.vars ai/decisions/run.ts --arms=jev-optimized,literal-optimized --split=validation --repeat=2 --max-attempts=2200 --out=another-optimized-validation --paid

# Development-only offline grade search; refuses to overwrite an existing file.
bun ai/decisions/tune.ts microsoft-human-development-2026-10-09 --out=.data/openai-decisions-evals/another-human-search.json

bun test ai/decisions interview-engine/providers/decisionJudge.server.test.ts
bun run check
```

A fresh checkout also requires the private frozen corpus, labels, candidate freezes and saved runs. Reports reject incomplete plans, duplicate records, changed inputs/gold, changed formed requests and late freezes. The final focused suite passed **27 tests / 89 assertions**. The full `bun run check` passed: **584 tests / 9,209 assertions**, type checking, engine/probe boundary checks, production build, bundle checks and Wrangler deployment dry run. No application deployment was performed.
