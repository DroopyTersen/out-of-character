# OpenAI Decisions comparison — 9 October 2026

**Decisions is close enough for the interview judging use case after two small confidence-gate changes. Stop tuning here.** Retain the literal request translation, use `P(continue) >= 0.70` for silence, and accept an `explored` selection at `P(explored) >= 0.50` when participant evidence exists. All other criteria, gates, evidence requirements and deadlines remain unchanged.

This is a practical judgment under Andrew's requested “close is enough” standard, not statistical equivalence. The branch contains the experiment adapter and calibrated result reader. The live provider has not been switched or deployed. Simulator/game replacement and live voice behavior were not tested in this tranche.

## Quality

Jev is pinned to `jev-1.13.0`; Decisions resolved to `gpt-6-luna`. Frozen Jev inputs, prompts and results are retained. Independent reviewers labeled real transcript prefixes without seeing either provider's outputs.

| Validation measure | Jev | Decisions, original gates | Decisions, tuned gates |
| --- | ---: | ---: | ---: |
| Silence action, 11 cases × 2 runs | 20/22 | 18/22 | **20/22** |
| Turn assertions, 10 cases × 2 runs | 69/82 | 72/82 | **72/82** |
| Real topic coverage, 5 prefixes × 20 topics × 2 runs | 159/200 | 128/200 | **150/200** |
| Existing synthetic grade assertions, 9 cases × 2 runs | 43/48 | 42/48 | **44/48** |

The tuned real-grade result was **75/100 in each run**; Jev was 80/100 then 79/100. On development, tuned Decisions and Jev each reached **81/100** real-topic checks. Neither provider is a perfect answer key.

No false continuation occurred on the labeled wait/end cases in either paired run. Across the first validation grade pass, tuned Decisions over-credited 2 topic judgments against the labels, versus 8 for Jev; Decisions' remaining errors were mostly missing coverage. A scoped knowledge-limit case was missed by Decisions. A second blind review agreed with the coverage error but did not confirm the original reviewer's critical severity; it also found weak supporting evidence in Jev's corresponding answer.

Evidence-ID matches are retained separately in the detailed results. Their expected lists are not exhaustive, especially for readings that an earlier passage can support. An unmatched ID is a review candidate, not automatically invented or incorrect evidence. The comparison above therefore uses topic coverage, action and existing fixture assertions, rather than pooling all citation matches into one accuracy score.

## Latency and cost

Paired calls were sequential, interleaved by a fixed case/repetition hash, with retries disabled and the existing 3-second silence/turn and 8-second final-grade deadlines. These are local replay wall times, not production-region or audible response timings.

| Lane | Paired calls per provider | Jev p50 / p95 | Decisions p50 / p95 | Jev / Decisions per 1,000 calls |
| --- | ---: | ---: | ---: | ---: |
| Silence | 86 | 99 / 160 ms | 153 / 287 ms | $0.036 / $0.057 |
| Turn | 40 | 145 / 193 ms | 212 / 293 ms | $0.421 / $1.019 |
| Final grade | 53 | 199 / 345 ms | 296 / 721 ms | $0.870 / $2.124 |

**450 measured comparison calls plus one API smoke call completed successfully; no timeout, refusal or malformed response occurred.** Total estimated input cost was **$0.344**, including rejected experiments. Calibrated results reuse the literal arm's responses and incur no extra calls. Repeated examples measure stability, not additional independent accuracy samples.

Costs use returned usage and the published base input rates: [Decisions, $0.10/M](https://developers.openai.com/api/docs/guides/decisions) and [Jev, $0.042/M](https://docs.typesafe.ai/models), with free output tokens. They are estimates, not an invoice reconciliation. At this workload mix Decisions costs approximately 1.55× for silence and 2.42–2.44× for turn/final grades. Per-call amounts remain small.

## Low-effort changes tried

1. **Literal translation:** preserve the current question structure and wording as JSON strings. This remains the selected request format.
2. **Readable question text:** flatten instruction objects to labeled prose. Rejected: development silence fell from 28/31 to 23/31 and turn checks from 43/45 to 38/45; real grades also worsened.
3. **Readable dialogue input:** retain literal questions but render passage ID, speaker and quoted text on separate lines. Rejected: development total grade assertions were 219/277 versus literal 220/277, with no useful improvement.
4. **Silence calibration:** sweep 0.70–0.95 on development, requiring zero false continuations, then choose the highest threshold with the fewest misses. Selected 0.70 before opening validation results; it matched Jev in both validation runs.
5. **Coverage calibration:** sweep 0.50, 0.60, 0.70, 0.80 and 0.85 on development, preserving the selected class and evidence requirement. Selected 0.50: development coverage/synthetic checks rose from 116/144 to 124/144, without false explored credit there. Validation grading became close enough to stop.

The coverage threshold was selected after the first validation results had been inspected. Its selection used development checks, but subsequent validation scoring and the fresh repeat are regression checks, not an untouched holdout. No further tuning was performed after the repeated grade result.

## Scope and reproducibility

There are 102 frozen cases: 43 silence windows, 20 transcript-prefix/map turn cases, and 39 grades (29 asserted existing fixtures plus 10 real prefixes). Development contains 67 cases; validation contains 35. One unfinished-interviewer silence example remains ambiguous and is excluded from quality scoring but included in latency/reliability. One audio-repeat feedback assertion was removed by the still-blind reviewer because the current rubric does not clearly cover it; the original label artifact and report remain preserved.

The two real archives are historical interviews about related work, not a broad independent population. Prefixes use finalized archived words, not exact historical partial transcripts. Turn actions use isolated one-step ranking against frozen maps, not a full causal simulation of the interviewer, future maps or note delivery. Grade results use the final reader, not accumulated live coverage. These limits do not prevent the practical comparison, but they restrict what it proves.

Raw inputs, independent labels, provider payload hashes, request IDs where supplied, raw successful responses, usage and per-attempt results stay in ignored `.data/openai-decisions-evals/`. The sanitized [measurement summary](../../ai/decisions/results-2026-10-09.json) records corpus/gold hashes and per-source denominators. Baseline outputs are immutable run directories; the cumulative ledger counts failed attempts too and enforces a $5/468-attempt ceiling. Run paid commands serially.

```sh
# Show the frozen selection without making API calls.
bun ai/decisions/run.ts --arms=jev,literal --split=validation

# Explicit paid replay; use a new output ID and existing local credentials.
bun --env-file=.dev.vars ai/decisions/run.ts --arms=jev,literal --split=validation --out=another-run --paid

# Rebuild the complete report from saved calls; no API calls.
bun ai/decisions/report.ts baseline-development readable-development validation-frozen paired-repeat dialogue-development grade-repeat --out=.data/openai-decisions-evals/final-report.json

bun test ai/decisions
```

`prepare.ts` creates the frozen corpus exclusively from the checked-in synthetic fixtures and the existing private source/turn manifests; it refuses to overwrite it. The frozen source manifest and reconstruction helper preserve the real archive cutoff/map provenance. A fresh checkout requires those private inputs; raw interviews are intentionally absent from Git.

Verification: the full `bun run check` passed, including repository tests, type checking, engine/probe boundaries, production build, bundle checks and deployment dry-run. After the final format/calibration additions, the focused suite passed **15 tests / 30 assertions**, and type checking passed again. No production application code or configuration changed.
