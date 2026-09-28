# Out of Character

A party game about the characters you meet in a tech consultancy. Draw from the curated 42-character cast, improvise through a generated scene, and earn **10 consecutive Jev scores in the 80–100 win zone** to win. **Give up** ends the turn.

Targets desktop Chrome on macOS and iOS Safari. [Open the game](https://outofcharacter.droopy.dev) or [explore the component workshop](https://outofcharacter.droopy.dev/storybook). See [implementation status](docs/solutioning/implementation-status.md) for verified browser behavior and remaining physical-device checks.

![Out of Character gameplay mockup](docs/mockups/out-of-character-gameplay-v3.png)

```sh
bun install
bun run dev
bun run check
bun run deploy
```

For local paid services, copy `.dev.vars.example` to the ignored `.dev.vars` and provide `TYPESAFE_API_KEY` and `OPENROUTER_API_KEY`. Cloudflare-hosted Deepgram Flux handles streaming transcription through the Worker AI binding. Luna through OpenRouter generates scenes, and Jev supplies every gameplay judgment. No separate speech API key is needed. Deployment uses the dedicated personal-account Worker in `wrangler.jsonc`; upload the two secrets with Wrangler and retain `PAID_SERVICES_ENABLED=true` to enable paid requests.

`bun run check` runs typecheck, tests, build, and a Wrangler deployment dry run. `bun run eval:jev --mode=both` is an opt-in paid Noul/Score comparison over saved synthetic fixtures. Gameplay combines full-transcript Noul probabilities (70%) with recent-20-second probabilities (30%). The workshop includes interactive composite controls and stored Noul/Score results.

The workshop lets you replay the draw and reel, inspect the flat cast, backstories, and active judge-facing descriptions, adjust the gauge and score streak, expand the character race, replay performance and silence, preview the final top 10 and highlighted transcript, and compare saved Noul/Score readings. Its fixtures use the real presentation components without microphone access or paid requests.

## The Simulator

`/simulator` adds serious sales and consultancy practice. Choose one of nine scenarios and seven reusable client personalities, then talk to GPT-Live 1. Jev updates seven skills and objectives that can be achieved in any sequence. It also detects when contextual coaching or actor direction could help. GPT-6 Sol then generates specific advice from the dialogue. The client pursues its own interests and respects hidden budget, scope, and approval constraints. After scored practice, GPT-6 Sol with medium reasoning writes a concise, streamed coaching report from the full dialogue, provisional Jev assessment, and delivered advice. Jev scores and objectives appear immediately; validated Sol judgments replace them together when the report finishes. Happy Hour and the Voice Lab remain ungraded. `/simulator/voice-lab` plays a prepared sample for any client and GPT-Live voice while showing the portrait, character profile, sample text, and voice description. The lab needs no microphone or practice session. Preview which clips need recording with `bun scripts/voice-lab-samples.mjs --dry-run`; generate them with `bun --env-file=.dev.vars scripts/voice-lab-samples.mjs --paid`.

For local voice practice, add `OPENAI_API_KEY` to the ignored `.dev.vars` alongside `TYPESAFE_API_KEY`, and set `SIMULATOR_ENABLED=true` and `PAID_SERVICES_ENABLED=true`. Scored practice uses Jev to detect coaching opportunities and GPT-6 Sol to generate trainee hints and private actor directions. The deployment configuration enables live practice; the Worker also needs `OPENAI_API_KEY` and `TYPESAFE_API_KEY` secrets. Attempts can last up to sixty minutes; practice warns after three minutes of inactivity and closes after five. Muting does not stop the paid session; use **End session**.

Live attempts save transcripts, scores, selected client/scenario, release provenance, final reports and generation audit records privately in Cloudflare D1 for improving the simulator. Saves are best effort; a database failure does not interrupt practice. Audio is not archived. Before local practice, run `bunx wrangler d1 migrations apply SIMULATOR_ARCHIVE --local`; the local database is separate from production. The workshop uses fixtures and writes no archives. Authenticated developers can list and export attempts with `bun scripts/simulator-transcripts.ts list` and `bun scripts/simulator-transcripts.ts export <attempt-id>`. See [transcript review and retention](docs/solutioning/simulator-transcript-review.md) for access, recovery limits and deletion commands.

The simulator workshop includes these previews:

- `/storybook/simulator-selection`: scrollable collections, character changes, connection availability, and microphone errors.
- `/storybook/simulator-live`: replay, pause, seek, and reset recorded dialogue, animated objectives, hints, skill bars, and connection states.
- `/storybook/simulator-voice`: client/trainee/overlap spectra, connection states, intensity, pause/reset/replay, and reduced motion.
- `/storybook/simulator-voice-lab`: the Voice Lab with prepared clips, portraits, and client profiles.
- `/storybook/simulator-debrief`: completed coaching, final grades, and source quotations.
- `/storybook/simulator-report-compiling`, `/storybook/simulator-report-writing`, and `/storybook/simulator-report-failed`: report generation, streaming, retry/status failures, missing readings, interrupted and ungraded examples. Use **Replay generation** to see the full transition without a paid request.
- `/storybook/simulator-judging`: authored transcripts, stored real Jev judgments, source evidence, and historical raw distributions. Opening any story uses no microphone or paid API.

See [the five report design iterations](docs/solutioning/simulator-report-design-review.md) and [the report implementation and verification](docs/solutioning/simulator-final-report-plan.md). Run `ACCEPTANCE_URL=http://127.0.0.1:5175 node scripts/simulator-report-acceptance.mjs` against the local dev server to verify the report UI with substituted paid boundaries.

Use **Screen only** to compare each screen with the mockup without workshop controls. The live voice display uses real frequency analysis; the workshop uses clearly labeled deterministic samples. See [the two design iterations](docs/solutioning/simulator-design-iterations.md) for responsive and motion evidence.

Explicit paid recordings use `bun run eval:simulator`, `bun run eval:simulator --replay`, or `bun run eval:simulator --holdout`. The last command runs independently authored challenge cases and exits nonzero when an expectation is missed; retain those results when assessing rubric changes. These are synthetic examples, not validated personnel assessments.

See [simulator acceptance](docs/solutioning/simulator-acceptance.md) for reproducible browser/audio commands and evidence, [the implementation plan](docs/solutioning/simulator-implementation-plan.md) for architecture, and [the scenario framework](docs/solutioning/simulator-scenario-framework.md) for authoring more exercises.

- [Product requirements](docs/solutioning/consultancy-party-game-prd.md)
- [Technical design](docs/solutioning/out-of-character-tech-design.md)
- [Measured Jev spike](docs/solutioning/jev-spike.md)
- [Curated character library](docs/consultancy-party-game-characters.md)
- [All 42 artwork prompts and provenance](docs/character-art-prompts.md)
- [Approved desktop draw composition](docs/mockups/out-of-character-character-draw-v6-prompt.md)
- [Third-party source notices](THIRD_PARTY_NOTICES.md)
