# Implementation and release status

September 18, 2026. The public application is at [out-of-character.droopy.workers.dev](https://out-of-character.droopy.workers.dev), with the [result workshop](https://out-of-character.droopy.workers.dev/storybook/result) and [character gallery](https://out-of-character.droopy.workers.dev/storybook/gallery). Worker version `0a25bbce-ff3d-4f0e-ae9f-f6002f395f5f` is deployed on Andrew’s personal account. Public health reports `consultancy-42-v1`, `portrayal-v6-score-streak`, all services configured, and `speech: cloudflare-flux`. All 55 public client files match the checked build, including the new logo and revised character sprites (`output/streak-recap-public-assets.json`). The Wrangler `.assetsignore` control file is intentionally not served.

## Experience

The game follows a repeatable draw → performance → result loop using the curated **42-character flat cast**. All category metadata and selectors have been removed. The reel spins downward for 6.2 seconds, passes every character, and lands independently of scene generation. A desktop press holds the lever down until release or pointer exit; touch performs a complete pull and return. All 42 individual transparent pixel-art sprites are complete, visually inspected, and documented in [artwork provenance](../character-art-prompts.md).

Cloudflare-hosted **Deepgram Flux** supplies live captions and word timestamps through the same browser audio path on Chrome and Safari. **Luna through OpenRouter** generates scenes. **Jev** supplies all gameplay judgments: at most one paired cycle per second evaluates the full performance and recent 20 seconds. Each character’s displayed score weights the full-transcript Noul probability at 70% and the recent probability at 30%. The recent text intentionally also occurs inside the full transcript. This composite is a gameplay score, not a newly calibrated probability.

Ten consecutive accepted target composites of at least 0.80 win immediately. A lower accepted score resets the count. Pauses preserve the last scores and streak, and waiting never advances it. Duplicate or invalid results do not count. The result screen freezes the final top 10 and complete transcript, then uses Jev to highlight its strongest character passages without changing the outcome. Give up and technical interruption stop audio and cancel pending work. One scene failure stays recoverable through Retry scene and keeps Start disabled.

## Workshop and phone layout

Eight workshop previews use the actual presentation components: draw, reel, gallery, gauge/streak, character race, performance, results, and judging. Fixtures require no microphone or paid calls. The judging preview has independent full/recent sliders and shows their exact 70/30 weighted score; the saved Noul/Score experiment remains separately labeled.

The flat gallery supports search, hover/focus preview, and click-to-pin. Every character has a two-sentence **judge-facing description** shown beneath the player backstory. The same text is now included in every live Jev question for both full and recent transcript contexts, and the workshop displays it for review. It remains hidden in gameplay. Search includes this text.

Phone layouts keep the pulled lever inside its card, show the complete scene, put captions before the race, and keep Start, Give up, and Draw again reachable. Eighteen focused checks passed across Chromium and WebKit at 390×844 and 430×932, including all 44 race rows, bounded scrolling, touch lever interaction, and desktop layout preservation. Evidence: `output/ios-ui/report.md` and `final-results.json`.

These are browser-engine tests, not physical iPhone acceptance. Safari browser bars, real microphone permission, physical swipes, device interruption, and actual Teams sharing still need a device playtest.

## Current release checks

`bun run check` passed TypeScript, all **75 tests**, the production build, and the Wrangler dry run. The final 42-character workshop passed **28/28 checks**, including final top 10 versus peaks, a target outside the top 10, exact transcript preservation, highlight loading/error/retry/no-match/empty states, and a 390px phone layout (`output/streak-final-workshop/results.json`).

The exact frozen release completed real Luna → Flux → paired Jev wins in Chrome 153 and WebKit 26.5, then loaded a real Jev highlight review. Chrome deliberately muted speech for 15 seconds: the 81% gauge, all bars, and 4/10 streak stayed unchanged once pending speech settled, with no additional judge requests during the quiet observation. Speech resumed and the attempt won at 00:35. WebKit won at 00:22. Both verified final top-ten values against the last score vector, exact rendered transcript text, actual source highlights, cadence, and cleanup. Evidence: `output/streak-final-chrome/report.json` and `output/streak-final-webkit/report.json`.

A fresh public WebKit run also won with 19 paired judgments, loaded the recap, and closed every audio track, context, and socket without browser errors (`output/streak-public-webkit/report.json`). These tests use synthetic audio through the real worklet and hosted providers; they do not establish physical iPhone acceptance.

The bounded semantic-find evaluation passed 5/5 fictional cases: mixed positive, a single unpunctuated positive passage, neutral speech, opposite behavior, and instructions aimed at the judge. Only the positive cases received highlights (`output/jev-highlights-eval.json`). This is a focused quality check, not validation of every character or conversational style.

## Earlier release checks (historical)

The following evidence predates the score-streak rule. Its timed holds, score clearing, and older cast sizes describe those earlier builds, not current gameplay.

The hold-timer investigation reproduced two failure paths. Missing microphone-input blocks previously disappeared from the PCM stream, permanently shifting transcript timestamps behind the performance clock after a gap. The worklet now emits silent PCM for those blocks. Separately, the hold used the previous judged snapshot’s speech timestamp for ongoing freshness; it could reset between fresh judgments despite continuing speech. The timer now checks the latest settled speech separately from accepted-result freshness. Completion still requires a fresh qualifying judgment after ten continuous seconds, and silence, low scores, expired judgments, and corrections retain their reset rules. Invalidated readings are cleared rather than leaving an old high percentage visible.

Before the audio fix, a real Chrome → Flux → Jev run became stuck at 92% and 0/10 after a controlled four-second input gap (`output/hold-bug-audio-gap-before/report.json`). A separate WebKit trace exposed repeated freshness resets despite no below-80 judgments after qualification (`output/hold-bug-ten-second-finish/report.json`). The final build completed a WebKit ten-second win in 24 seconds with 21 paired judgments and a Chrome gap-recovery win in 31 seconds with 25 paired judgments (`output/hold-bug-final-webkit/report.json`, `output/hold-bug-final-chrome-gap/report.json`). The new public build also recovered from a four-second gap and won in WebKit with 29 paired judgments (`output/hold-bug-public-webkit/report.json`). All three final runs used the real worklet, Flux, Luna, and Jev, validated all 44 weighted scores, and closed every track, context, and speech socket without browser errors. Input speech and the deliberate gap were controlled fixtures; Andrew’s exact device event was not captured.

The earlier grounding activation passed a fresh integrated check and **18/18 live Noul transcript checks** across all 44 characters (`output/jev-grounding-active.json`). Median Jev request time was 215 ms, maximum 692 ms, over 276,516 input tokens. These are the fixed target/negative checks, not proof that every non-target reading is correct. The gallery now identifies its descriptions as active in both judging contexts. A fresh public WebKit run also completed a ten-second win with 23 valid paired responses and clean audio shutdown (`output/browser-acceptance-grounding-public/report.json`).

**The preceding Flux/composite release completed a real-provider WebKit win** in about 26 seconds: a Luna scene, streamed Flux captions, and 23 paired Jev responses with exact all-44 arithmetic means. The full transcript grew beyond the recent window. Browser cadence was at least 1.039 seconds, with at most one unfinished cycle; cleanup left zero live tracks/contexts/sockets and no browser errors. Evidence: `output/browser-acceptance-flux-public-webkit/report.json` and `real-providers-won.png`. `output/acceptance-flux-final-summary.json` consolidates public and local gates.

The integrated `bun run check` passed **72 tests**, TypeScript, production build, and Wrangler deployment dry run. Tests cover the real PCM worklet, both transcript contexts, exact composite responses, clock/hold behavior, recorded Flux events, genuine corrections, timestamp refinement, API limits, late-resume cleanup, and terminal outcomes.

Chrome 153 completed an actual provider-driven ten-second win in about 26 seconds of performance, using a real Luna scene, live Flux words, and 23 paired Jev cycles covering every character. Paired Worker response median was 218 ms for this local-preview run; this excludes audio and caption latency. Full history grew beyond the recent window, cadence stayed at about one cycle per second without overlap, and outcome cleanup left zero tracks, AudioContexts, or speech sockets. The separate silence test first established a positive hold, then muted input: the hold reset without a win and backgrounding cleaned up the attempt. Evidence: `output/browser-acceptance-flux-final-chrome/report.json` and `output/browser-acceptance-flux-final-chrome-quiet/report.json`.

WebKit 26.5 also completed a real Luna → Flux → paired Jev win in about 27 seconds, with 24 complete composite responses, full history beyond the recent window, no overlapping requests, and zero remaining tracks, contexts, or speech sockets. Its immediate-denial regression now also closes the context after a late resume. Earlier WebKit lifecycle probes verified late permission cancellation, Give up while an actual judgment was pending, sound-check cleanup, and silence/background interruption. Evidence: `output/browser-acceptance-flux-final-webkit/report.json` and `output/browser-acceptance-flux-final-webkit-denial/report.json`.

The integrated workshop passed **27/27** acceptance checks plus **12/12** additional Chromium/WebKit checks covering composite controls and the flat gallery at desktop and both phone sizes, with no API requests or browser errors. Evidence: `output/workshop-final-local/report.md`, `results.json`, and `extra-results.json`.

Public workshop acceptance also passed **27/27** checks, six additional composite/gallery checks, and a temporal reel check. All 44 unique hosted sprites decoded at 1254×1254, and the reel passed every character downward before landing. No paid calls or browser errors occurred. Evidence: `output/workshop-final-public/report.md` and adjacent JSON/screenshots.

## Judging evidence

The original [Jev spike](jev-spike.md) used handwritten synthetic inputs against all 44 characters with `jev-1.13.0`. Noul passed 18/18 fixed checks, with all 12 intended positive targets ranked first above 0.80 and six negatives below 0.80 for every character. Score passed 17/18 and overmatched generic practical-shipping advice. Those results measure single-context classification, not the later full/recent gameplay composite or every character’s natural-speech quality.

The proposed grounding was then tested with **68 all-cast calls**, comparing identical text across the baseline and candidate. Both retained 18/18 fixed checks; targeted lookalike probes improved from 12/16 to 15/16, and total high non-target readings fell from 24 to 15. However, six newly high cross-persona readings appeared, including identity-access speech matching Low-Code Freedom Fighter. The candidate also added about 19.6% input tokens. Andrew subsequently requested activation: all 44 descriptions were enabled in both transcript contexts under `portrayal-v4-grounded-composite`. The measured cross-persona ambiguities remain playtesting limitations. Evidence: `output/character-grounding-eval/report.md`, `comparison.json`, and frozen inputs; the proposed text is maintained in [character-grounding-proposal.md](character-grounding-proposal.md).

The earlier measured Jev estimate was roughly $0.032 per minute at one all-cast request per second. The composite sends two evaluations per cycle, so that baseline roughly doubles before longer full transcripts, speech, and scene costs. It is not a measured end-to-end cost guarantee. Provider budget alerts remain an operational follow-up.

## Speech research and verification

AI Elements’ default Chrome speech path was investigated and completed a native-speech win, but the explicit iOS Safari requirement led to shared Flux streaming. A direct Flux probe returned 48 live updates with a median 215 ms update interval and actual word timestamps. A WebKit 26.5 browser test exercised the real 44.1 kHz AudioWorklet → PCM → Worker → Flux path, received live words, and left zero tracks, AudioContexts, or speech sockets after closing sound check. Evidence: `output/stt-hosted-spike/flux-streaming-probe.json` and `output/browser-acceptance-webkit-flux-sound/report.json`.

OpenRouter Whisper also worked; six short-clip requests took 1.00–3.90 seconds. Browser Whisper remains possible, with quantized Tiny/Base encoder and decoder weights around 41/77 MB before runtime overhead, but download, startup, battery, and phone performance are unmeasured. Neither alternative is a second shipped mode. Research sources and precise boundaries are in the [technical design](out-of-character-tech-design.md).

Recorded browser input is synthetic speech. The app does not persist audio or transcripts. Only device preference and the last 20 played scenes use local browser storage. This statement does not claim that external providers have zero retention.

## Stack and operations

The application follows May I’s Bun, React Router, Cloudflare Vite plugin, Tailwind/shadcn, and Wrangler pattern. AI SDK 7.0.105, TypeSafe provider 3.0.2, OpenRouter provider 3.0.0, React Router 7.14.2, Wrangler 4.125.0, and Cloudflare Vite plugin 1.33.1 are pinned together. Motion handles the reel, and XState owns the attempt lifecycle. No multiplayer rooms, Durable Objects, database, or login are needed.

AI Elements’ Mic Selector, Transcription, and Speech Input were installed through the shadcn registry. Owned source lives in `app/ai-elements/`; audio capture has one application owner. [Third-party notices](../../THIRD_PARTY_NOTICES.md) retain Apache-2.0 provenance.

Paid routes require the same Origin, bounded bodies, canonical IDs, fixed models, and per-IP rate limits. Judge requests pair two complete vectors and fail atomically. Speech accepts short PCM frames at an audio-rate cap and stops after ten minutes. `PAID_SERVICES_ENABLED=false` disables new paid work. Existing `TYPESAFE_API_KEY` and `OPENROUTER_API_KEY` remain Worker secrets; the `AI` binding supplies speech without exposing a Cloudflare credential.

Run `bun run check` for typecheck, tests, build, and deployment dry run; use `bun run deploy` for the authorized dedicated personal-account Worker. Set `WRANGLER_LOG_PATH` to a writable temporary path in restricted environments. Browser acceptance scripts accept configurable Playwright, Chrome, target URL, and output paths. No repository commit, push, or merge was part of this work.
