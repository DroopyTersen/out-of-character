# Simulator deployment

Source baseline: `6415f0a` on `simulator-mvp`. Andrew requested deployment and a readiness check for trying the simulator on a phone.

## Release scope

Deploy the accepted simulator to the existing `out-of-character` Worker and `outofcharacter.droopy.dev`. Enable live practice and client direction, add the existing authorized OpenAI credential as a Worker secret, and preserve the other provider credentials. The application keeps its ten-minute session limit, per-IP creation limit, capability-protected session control and server cleanup lease.

## Verification plan

- Run the complete repository gate for the release configuration.
- Verify the active Worker version, HTTPS routes, simulator availability and served assets after deployment.
- Run one bounded real-provider browser smoke against the deployed site, including live Jev feedback, transient polling recovery, provider closure and local media cleanup.
- Check the deployed phone layouts and browser capability requirements. Keep responsive/browser-engine evidence separate from a physical-phone microphone test.

## Status

The release configuration passes `bun run check`: 111 tests, 3,741 assertions, typecheck, production build, the 15-asset privacy check and Worker dry run. The smoke script now recognizes the current debrief heading and can use a 390 × 844 viewport with `ACCEPTANCE_PHONE=1`; its syntax check passes.

The independent release review found no deployment blocker. The generated Worker configuration includes all three enabled flags, the session binding, the SQLite Durable Object migration and the exported class with its alarm handler. Deployment and live acceptance are pending.

## Operations

This is the Worker's first Durable Object migration. A version rollback to the previous game-only release cannot cross that migration. To disable new practice, set `SIMULATOR_ENABLED=false` and redeploy the simulator-capable source; existing authenticated session controls still work. Until this branch is merged, deploy from `simulator-mvp`, which contains the required class export and migration history.

The deployment secret file contains only `OPENAI_API_KEY`, is created privately outside the repository and is removed after upload. The additive upload preserves the existing remote TypeSafe and OpenRouter secrets.

Current iPhone Safari requires iOS 17.4 or later because session requests use `AbortSignal.any()`. Responsive desktop-browser evidence does not prove physical-phone microphone, speaker routing or background behavior.
