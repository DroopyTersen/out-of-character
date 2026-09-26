# Simulator deployment

Source baseline: `6415f0a` on `simulator-mvp`. Andrew requested deployment and a readiness check for trying the simulator on a phone.

## Release scope

Deploy the accepted simulator to the existing `out-of-character` Worker and `outofcharacter.droopy.dev`. Enable live practice and client direction, add the existing authorized OpenAI credential as a Worker secret, and preserve the other provider credentials. The application keeps its ten-minute session limit, per-IP creation limit, capability-protected session control and server cleanup lease.

## Verification plan

- Run the complete repository gate for the release configuration.
- Verify the active Worker version, HTTPS routes, simulator availability and served assets after deployment.
- Run one bounded real-provider browser smoke against the deployed site, including live Jev feedback, transient polling recovery, provider closure and local media cleanup.
- Check the deployed phone layouts and browser capability requirements. Keep responsive/browser-engine evidence separate from a physical-phone microphone test.

## Release result

The release configuration passes `bun run check`: 111 tests, 3,741 assertions, typecheck, production build, the 15-asset privacy check and Worker dry run. The smoke script now recognizes the current debrief heading and can use a 390 × 844 viewport with `ACCEPTANCE_PHONE=1`; its syntax check passes.

The independent release review found no deployment blocker. The generated Worker configuration includes all three enabled flags, the session binding, the SQLite Durable Object migration and the exported class with its alarm handler.

Deployed on 2026-09-26 at 14:18 UTC from source **`7f36b72`**. Cloudflare reports **100%** of traffic on version **`7606586d-c54c-435e-bf13-062b5af326a9`**, tagged with that source commit. Live practice and client direction are enabled. The OpenAI secret was added; the existing TypeSafe and OpenRouter secrets remain configured. The temporary upload file was removed.

Try it at **[The Simulator](https://outofcharacter.droopy.dev/simulator)**. The release is ready for a first user trial.

## Deployed acceptance

- Health, catalog, simulator and workshop routes return HTTP 200 over HTTPS. The public catalog reports enabled practice with two scenarios and three clients.
- All **63 served assets** match the local production build byte-for-byte. Evidence: `output/simulator-release-http.json`.
- The real-provider smoke passes **9/9** at **390 × 844** in desktop Chromium. Both speakers were transcribed, real Jev 1.13 feedback appeared during conversation and became current, one deliberately failed poll recovered, provider closure was confirmed, local tracks and peer connection closed, and the browser received no private actor configuration. Provider usage was **27 seconds**, with zero browser/test errors. Evidence: `output/simulator-release-live/report.json`, `live.png` and `debrief.png`.
- The deployed selection, conversation, debrief and lab pass **16/16** captures across 1672, 1024, 390 and 320 pixel widths, with zero browser errors, API calls or horizontal overflow. Evidence: `output/simulator-release-design/report.json`.
- Deployment/version receipts are retained in `output/simulator-release-deploy.log` and `output/simulator-release-deployments.log`. The release gate is in `output/simulator-release-check.log`.

The voice smoke uses prerecorded synthetic trainee speech, real WebRTC and real provider calls. It verifies the deployed connection and evaluation path at phone width; it does not establish physical-phone microphone, speaker or background behavior. Human roleplay quality and the previously documented classifier limits still need practitioner feedback.

## Operations

This is the Worker's first Durable Object migration. A version rollback to the previous game-only release cannot cross that migration. To disable new practice, set `SIMULATOR_ENABLED=false` and redeploy the simulator-capable source; existing authenticated session controls still work. Until this branch is merged, deploy from `simulator-mvp`, which contains the required class export and migration history.

The deployment secret file contains only `OPENAI_API_KEY`, is created privately outside the repository and is removed after upload. The additive upload preserves the existing remote TypeSafe and OpenRouter secrets.

Current iPhone Safari requires iOS 17.4 or later because session requests use `AbortSignal.any()` ([WebKit release notes](https://webkit.org/blog/15063/webkit-features-in-safari-17-4/)). Current Android Chrome also supports the required browser APIs. For the first phone trial, open the HTTPS link in Safari or Chrome, allow microphone access and keep the page in the foreground. Use the speaker button if playback needs enabling, and **End session** when finished.
