# Jev transcript experiment

September 18, 2026. Provider requests completed against `jev-1.13.0`; the inputs are handwritten synthetic performances, not recordings of players. The authoritative curated cast contains **44 characters**, replacing the older technical design’s 100-character scope. Names and backstories were copied verbatim into `core/characters.ts`; the maintained cast is now a flat list without category metadata.

The Noul baseline supports continuing implementation: every positive target in the fixed set exceeded 0.80, and the refined questions produced no 0.80 matches on its six negative inputs. This is a small viability result, not broad character-quality or microphone-to-game acceptance. A generic engineering response still reached 0.76–0.77 for a non-target persona, close to the threshold. Keep Noul as the gameplay default and inspect this boundary during real-player acceptance.

## Contract verified

The [live model documentation](https://docs.typesafe.ai/models) identifies `jev-1.13.0` as the version behind `jev-latest`, with input pricing of $0.042 per million tokens and free outputs. It documents a 64k aggregate state-plus-questions context and a 32k state-plus-longest-question context. These experiments used the exact version ID rather than an alias.

The installed `@ai-sdk/typesafe-ai@3.0.2` provider documentation, source, and `ai@7.0.105` evaluation types were inspected. `experimental_evaluate` sends every question in one request over shared state. AI SDK `boolean` maps to native TypeSafe Noul; its result field is `probability`, not `noul`. The actual resolved model is returned as `result.response.modelId`. Credentials are supplied explicitly to `createTypeSafeAi`.

[Noul](https://docs.typesafe.ai/primitives/noul) means probability that the stated condition holds. The condition here is whether the speaker enacts a specific persona’s distinctive behavior. Values do not sum to one and 0.5 does not mean medium acting quality. [Score](https://docs.typesafe.ai/primitives/score) is a probability-weighted position over ordered situation descriptions. Its five-level 0–4 result is divided by four for a 0–1 display. It measures portrayal intensity; it is not a probability of matching the character. A shared numerical threshold does not make the modes interchangeable.

Question instructions carry the exact name and backstory, plus the evidence boundary. Merely naming the role or relevant technology, describing another person, demanding a high score, and spoken instructions to the judge do not count as enactment. Questions never receive the drawn target or generated scene. All 44 are evaluated independently over `{ transcript }`. The provider and application validate answer mapping and values; the application rejects missing/extra IDs and nonfinite or out-of-range readings. No raw provider response, credentials, or headers are returned by the integration.

## Fixed dataset and measured correction

The fixed fixture set has 12 development inputs and 6 holdout inputs. There are eight development positive performances, four development negatives, four holdout positives, and two holdout negatives. These cover distinct architectural, spreadsheet, delivery-estimation, process, refactoring, collaboration, testing, staffing, identity, scope, legacy-experience, and contract behaviors. Negative cases include generic conversation, name reading, score injection, generic pragmatic engineering, product enumeration, and third-person criticism. Holdout text remained unchanged throughout.

`portrayal-v1` passed 17/18 in each mode. Its error was a sensible “keep the checkout change simple and ship a useful button” response matched to The Brownfield Lifer: Noul 0.82 and normalized Score 0.9525. That response did not actually refuse a transformative rewrite or cling to existing tickets.

`portrayal-v2` changes only that character’s model-facing distinction: resistance to a transformative rewrite/greenfield initiative and stubborn focus on existing tickets distinguish the persona; ordinary advice to simplify a single change is insufficient. The amusing player-facing backstory is untouched. The full fixed set was rerun in both modes. Two additional Noul regression cases confirmed a genuine Brownfield performance remained high (0.98) and repeated generic advice remained below the win threshold. No further prompt edits were made.

## Results

| Final questions | Noul | Normalized Score |
| --- | ---: | ---: |
| Fixed cases passing the experiment’s numerical checks | 18/18 | 17/18 |
| Positive targets reaching 0.80 | 12/12 | 12/12 |
| Positive targets ranked first | 12/12 | 12/12 |
| Negative cases with any reading ≥ 0.80 | 0/6 | 1/6 |
| Development checks | 12/12 | 11/12 |
| Holdout checks | 6/6 | 6/6 |
| End-to-end request median | 200 ms | 258 ms |
| End-to-end request p95 / maximum, 18 samples | 401 ms | 821 ms |
| Mean input tokens per all-44 request | 12,849 | 15,621 |
| Estimated cost per judged minute at 1 request/second | $0.03238 | $0.03936 |

Noul’s fixed positive targets range from 0.91 to 0.97. The remaining generic-pragmatism confusion moves to The Magic-Only Buyer: Noul 0.76 in the full regression and 0.77 on repetition; normalized Score 0.89. The source speech favors practical shipping but does not refuse to fund logging, migration, or necessary plumbing. This remains a quality limitation, especially for Score, rather than a reason to silently lower the gameplay threshold or drop cast members. Score remains a comparison tool; these numbers do not establish its gameplay threshold.

There were **78 successful provider calls**, each judging all 44 characters: four initial Noul smoke calls, 36 baseline comparison calls, 18 refined Noul calls, two Brownfield Noul regressions, and 18 refined Score calls. Total input usage was 1,099,726 tokens, estimated **$0.04619** at the documented price. Calls were sequential and retries disabled. A sandbox network denial occurred before the first provider call; rerunning with authorized network access succeeded. No provider failures occurred in the measured requests.

Each latency measures the SDK invocation through response validation. It excludes speech recognition, browser networking to the Worker, rendering, and audio latency. The 18-sample p95 is effectively the maximum; this is insufficient to characterize sustained load or long-tail behavior. Costs assume approximately one successful evaluation each second and these short fixture transcripts; they exclude transcription, scene generation, retries, taxes, and different transcript lengths.

## Artifacts and reproduction

- `ai/evals/comparison.json`: final paired v2 Noul/Score results, full 44-value readings, fixture text, split, target expectation, resolved model, latency, token usage, and summary.
- `ai/evals/baseline.json`: unmodified v1 measurements with explicit row versions.
- `ai/evals/brownfield-regression.json`: the two additional v2 Noul regression observations.
- `ai/evals/smoke.json`, `refined-noul.json`, and `refined-score.json`: individual run evidence retained for request accounting.
- `ai/evals/fixtures.ts`: fixed 12/6 set and separately labeled observed-confusion regressions.

Run `bun run eval:jev --mode=both` for 36 requests, `--mode=noul` or `--mode=score` for 18, or `--smoke --mode=noul` for four. `--regression --mode=noul` runs the two measured-confusion cases. `--output=path.json` chooses the saved artifact. Live evaluations are opt-in; importing the saved JSON makes no provider calls. The runner reads existing environment keys or known local credentials files without printing secret values. Provider errors are reduced to name and numeric HTTP status.

`evaluateCharacters({ transcript, apiKey, mode?: 'noul' | 'score', signal? })` returns `{ readings: Record<string, number>, model, durationMs, usage }`. The default mode is Noul. Both `CAST_VERSION` and `JUDGING_VERSION` are safe constants exported by `core/characters.ts`; browser code must not import the server SDK module to obtain them.

The four judging unit tests pass with 115 assertions. They compare the cast conversion with the authoritative document, require unique IDs and complete question coverage, reject incomplete/extra/invalid readings, and validate fixture splits and target IDs.

Fifteen deterministic performance tests also pass. Every negative saved row in both modes was replayed against all 44 possible targets for twenty seconds of silence/duplicate evidence: no wins occurred, including Score’s initially high false match. Continuing fresh readings from each Noul negative vector also produced no wins. A measured positive vector with newly advancing speech won at ten seconds. These replays test timing composition over saved readings, not fresh inference on changing speech. Additional cases cover the raw 0.799/0.80 boundary, acceptance-time streak starts, result/speech expiry, gaps, correction-only freshness, finalized-segment correction/replacement, window expiry, and final-to-partial downgrades. Tests exposed and verified small fixes for delayed older low readings resetting newer holds and timestamp-only corrections escaping invalidation.

The audio normalizer preserves provider word text and timestamps when supplied. Judging windows filter each word by its actual end time, while captions retain the original complete utterance; segment-level timing remains a documented fallback when word metadata is absent. A parser-to-window integration fixture proves that older architectural cues disappear from a long utterance while its six recent words remain eligible, and trailing silence cannot renew the speech horizon. Word-metadata corrections also invalidate supporting evidence even when the full caption text remains unchanged. The five audio normalization tests pass alongside the performance checks.

Only 13 of 44 personas have positive examples when the separate Brownfield regression is included. This experiment does not prove the other 31 are achievable, robustness to casual speech/transcription mistakes, real ten-second holds, or no false wins over time. Those require real audio and repeated fresh windows during complete gameplay acceptance. The current cast and thresholds are preserved for that next stage.
