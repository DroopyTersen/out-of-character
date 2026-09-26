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

- [Product requirements](docs/solutioning/consultancy-party-game-prd.md)
- [Technical design](docs/solutioning/out-of-character-tech-design.md)
- [Measured Jev spike](docs/solutioning/jev-spike.md)
- [Curated character library](docs/consultancy-party-game-characters.md)
- [All 42 artwork prompts and provenance](docs/character-art-prompts.md)
- [Approved desktop draw composition](docs/mockups/out-of-character-character-draw-v6-prompt.md)
- [Third-party source notices](THIRD_PARTY_NOTICES.md)
