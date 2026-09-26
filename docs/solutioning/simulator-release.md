# Simulator deployment

Current release: **`8633f24`**, deployed September 26, 2026 at 16:55 UTC. The new spoken meeting kickoffs and stronger client performances are recorded under [Client performance release](#client-performance-release). The existing compact mobile and original desktop layouts remain in this release.

Initial source baseline: `6415f0a` on `simulator-mvp`. Andrew requested deployment and a readiness check for trying the simulator on a phone.

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

## Mobile layout release

Andrew authorized this deployment after the compact-mobile implementation. The release includes the full-width mobile hint, public session brief, transcript sheet and fixed call controls, preserves the original desktop composition, and keeps client stats in workshop diagnostics only. Source commits are `21fe39f`, `10a9bb6` and the production fixes in **`b0e13ab`**. Credentials, flags, migrations and the voice/session engine are unchanged.

Cloudflare deployed **`e4a7c6ae-dc89-4168-bf02-d386514fd262`** on **2026-09-26 at 15:54 UTC**, tagged `b0e13ab`, and a fresh deployment lookup confirms **100% traffic**. The HTTPS simulator remains at [outofcharacter.droopy.dev/simulator](https://outofcharacter.droopy.dev/simulator).

Production verification found two issues that the development server had not exposed. A hint could remain mounted after leaving the live phase; the toast now keeps its entrance animation and unmounts immediately when dismissed or invalidated. CSS minification combined `transform: none` with `translate: none`, removing the individual translation reset needed by the mobile dialogs. Removing the unnecessary transform declaration preserves the reset in the built stylesheet. Acceptance now checks that the brief is entirely inside the mobile viewport and includes error stacks on failure. Both fixes received review before release acceptance.

Accepted evidence:

- `bun run check`: typecheck, **112 tests / 3,765 assertions**, production build, privacy scan of **15 client assets**, and Worker dry run passed. Log: `output/simulator-mobile-release-accepted-check.log`.
- The six checked HTTPS routes return 200, practice remains enabled, and the public catalog has no client stats. All **63 served assets** match the local build. Report: `output/simulator-mobile-release-accepted-http.json`.
- Deployed compact acceptance passes **5/5**: edge-to-edge hints at 320px and 390px, dismissal and recurrence, in-bounds brief, transcript and focus behavior, workshop-only stats, and original desktop layout. No microphone/API requests, page errors or horizontal overflow. Report: `output/simulator-mobile-release-accepted/report.json`.
- Additional deployed probes pass **4/4** dialog cases (320/390px, normal/reduced motion) and **2/2** toast motion cases, with no API requests, microphone calls or page errors. Reports and screenshots: `output/simulator-dialog-release-accepted/` and `output/simulator-toast-release-accepted/`.
- The local production preview also passes the compact suite **5/5**, toast transitions with normal/reduced motion **2/2**, and brief/transcript geometry and focus at 320/390px with both motion preferences **4/4**. Reports: `output/simulator-mobile-release-preview-accepted/`, `output/simulator-toast-probe/`, and `output/simulator-dialog-preview-accepted/`.
- Deployment and version receipts: `output/simulator-mobile-release-accepted-deploy.log`, `output/simulator-mobile-release-accepted-deployments.json`, and `output/simulator-mobile-release-accepted-version.json`.

The first production failure and subsequent CSS diagnosis are preserved in `output/simulator-mobile-release-acceptance/`, `output/simulator-mobile-release-diagnostic/`, and `output/simulator-dialog-preview-verify/`; those are superseded by the accepted results above. This UI release did not repeat paid voice trials or establish physical-phone audio behavior. The earlier real-provider smoke remains the voice integration evidence.

Refresh an already-open simulator tab after deployment so its code uses the new catalog shape. No branch push or merge was performed.

## Client performance release

Andrew requested redeployment after the [spoken kickoff and stronger performance follow-up](simulator-roleplay-performance.md). Source **`8633f248eccd272ab7e2c60df758aba633752bd9`** includes implementation `3729e9a` and its completed local evidence record. Clients now establish the meeting in character before handing over, with more distinctive delivery and reactions. This release changes actor instructions and rehearsal coverage; it adds no UI, scoring, credential, migration or infrastructure changes.

Cloudflare deployed version **`8b61fc6c-50df-4888-a918-1b9a361d444b`** on **2026-09-26 at 16:55 UTC**, tagged `8633f24`. Fresh deployment and version lookups confirm the tag and **100% traffic**. The deploy command used `--keep-vars`; `output/simulator-performance-release-version.json` confirms all three enabled flags and the three existing secret names remain present.

Accepted production evidence:

- Fresh `bun run check` passed: **114 tests / 3,777 assertions**, typecheck, production build, private-content scan of **15 client assets**, and Worker dry run. Log: `output/simulator-performance-release-check.log`.
- All six checked HTTPS routes return 200. The simulator catalog remains enabled with two scenarios and three clients, without private actor fields or client stats. All **63 served assets** match the local release build byte-for-byte. Report: `output/simulator-performance-release-http.json`.
- Real-provider browser smoke passes **9/9** at **390 × 844** in desktop Chromium with prerecorded synthetic trainee speech. Morgan's roughly 25-second opening establishes identity, the existing custom-software relationship, the account-contact role and the SharePoint discussion, then yields before the trainee starts. Both speakers were transcribed, real Jev feedback appeared during conversation and became current, one injected polling failure recovered, provider closure was confirmed, and local media closed. No private actor configuration reached the data channel. **46 provider seconds**, zero browser/test errors. Report and screenshots: `output/simulator-performance-release-live/`.
- Deployed compact acceptance passes **5/5** at 320, 390 and 1672 pixels: full-width dismissible mobile hints, in-bounds brief/transcript dialogs, workshop-only client stats and the original desktop composition. Zero page errors, horizontal overflow, microphone calls or API requests in those workshop checks. Report: `output/simulator-performance-release-compact/report.json`.
- Deployment receipts: `output/simulator-performance-release-deploy.log`, `output/simulator-performance-release-deployments.json`, and `output/simulator-performance-release-version.json`.

Both browser suites were invoked with **`ACCEPTANCE_URL=https://outofcharacter.droopy.dev`**. Their current JSON reports omit the target URL, so the production target is recorded here from the executed commands rather than inferred from those reports:

```sh
ACCEPTANCE_URL=https://outofcharacter.droopy.dev \
ACCEPTANCE_OUTPUT=output/simulator-performance-release-live \
ACCEPTANCE_PHONE=1 \
ACCEPTANCE_AUDIO=output/simulator-performance-release-trainee.wav \
bun scripts/simulator-live-smoke.mjs --paid

ACCEPTANCE_URL=https://outofcharacter.droopy.dev \
ACCEPTANCE_OUTPUT=output/simulator-performance-release-compact \
bun scripts/simulator-compact-acceptance.mjs
```

The synthetic trainee fixture has 30 seconds of leading silence, allowing the longer kickoff to finish before the question. Opus 5.5 reviewed the release through computer use and found no deployment blocker. Its documentation feedback is addressed by recording the explicit browser target and citing the version receipt for preserved bindings. Having the scripts include their target URL in future reports remains a small harness follow-up.

The browser smoke adds production WebRTC and scoring evidence to the earlier direct-provider rehearsals. It does not establish physical-phone audio behavior or subjective acting quality. The earlier silent provider startup remains documented in the performance follow-up; this release smoke succeeded on its first attempt. No branch push or merge was performed.
