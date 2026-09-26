# Simulator deployment

Current release: **`b86c7e9`**, deployed September 26, 2026 at 23:41 UTC. [Voice Lab](#client-voice-release) plays prepared samples for each client and voice while showing the selected portrait. The nine simulator scenarios and private archive remain included.

## Voice Lab release

Andrew requested deployment of the Voice Lab. Source commit `63b633a2cafdfdfed3dca223fbb580f76193127a` adds `/simulator/voice-lab`, with 22 allowlisted built-in voices, the selected client's public traits/background, documented voice descriptions, and open-ended conversation using the existing happy-hour session flow. The selected voice reaches Live session creation and is recorded in the private archive provenance.

The full pre-deployment gate passed: 133 tests, typecheck, production build, client-bundle boundary check, and Wrangler deploy dry run. `bun run deploy` preserved existing Worker variables and deployed version `6c9c8176-04b1-4a65-801f-f40e711900ef` on September 26 at 20:35 UTC. A fresh deployment listing showed 100% traffic on that version. The HTTPS Voice Lab returned 200, the public catalog reported enabled practice with seven clients and nine scenarios, and the new Voice Lab JavaScript matched the production build byte-for-byte. In the deployed browser, selecting Harper and Willow updated the client profile and voice description while retaining the voice across client changes. No paid voice call or physical-device microphone test was run for this UI release.

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

## Expanded catalog and archive release

Andrew requested deployment of the accepted [catalog expansion](simulator-catalog-expansion.md) and [pace and archive follow-up](simulator-pace-and-archive.md). Source **`d59c5efd3c935b5e99d40df4856f92956ff29371`** contains eight scenarios and seven clients, including Harper, Quinn, Riley and Jamie, public preparation notes for the six new scenarios, stronger theatrical performances, existing pace/bargaining tuning and best-effort private transcript saves.

Deployed **2026-09-26 at 19:35 UTC** to [the simulator](https://outofcharacter.droopy.dev/simulator). Cloudflare version **`dd3f26cb-88f7-4eeb-91b3-840eea060689`**, tagged **`d59c5ef`**, receives **100% traffic** in the fresh deployment lookup. The existing enabled flags and three provider secrets remain configured; deployment used `--keep-vars`.

Cloudflare sign-in was restored through the browser using the existing account. The scoped D1 database **`out-of-character-simulator`** (`e91a81f6-2058-4223-b10a-52f00dc2219f`) was created, bound as `SIMULATOR_ARCHIVE`, and migration `0001_simulator_attempts.sql` was applied **before** deployment. A subsequent remote migration listing reports no pending migrations. No other database was changed.

Accepted production evidence:

- Full `bun run check` passed: **130 tests / 4,230 assertions**, types, production build, privacy scan of **15 client assets**, and Worker dry run. After adding the real D1 ID, the production build and deployment dry run passed again. Receipts: `output/simulator-expanded-release-check.log`, `-build.log`, and `-dry-run.log`.
- All six checked HTTPS routes return 200. The enabled public catalog contains **eight scenarios / seven clients**, without private actor fields or client stats. All **67 public served assets** match the production build byte-for-byte. Report: `output/simulator-expanded-release-http.json`.
- Production workshop checks pass **8/8**, covering each added scenario's preparation notes, all four new portraits, and live/debrief/lab screens at desktop and phone widths. Compact interactions pass **5/5** at 320, 390 and 1672 pixels. No browser errors, unexpected microphone calls or API calls. Reports: `output/simulator-expanded-release-workshop/` and `output/simulator-expanded-release-compact/`.
- Real-provider voice acceptance passes **9/9** at 390 × 844 with prerecorded synthetic trainee speech. Both speakers were transcribed; current Jev feedback appeared during the live conversation; one injected polling failure recovered; provider closure and local-media cleanup were confirmed. **47 provider seconds**, zero test/browser errors. Report: `output/simulator-expanded-release-live/report.json`.
- The same attempt's actual remote D1 export passes **16/16 comparisons** against its browser debrief: full transcript, both speakers, selection, final scores at revision **94**, timestamps, current feedback, confirmed closure, usage and exact actor/opening hashes. Its saved provenance identifies this Worker version and source tag. The final archive superseded the observed 30-second partial checkpoint. Report: `output/simulator-expanded-release-live/archive-verification.json`. The transcript export remains ignored with mode 0600.
- Cloud receipts: `output/simulator-expanded-release-deploy.log`, `-deployments.json`, `-version.json`, `-d1-create.log`, `-d1-migrate.log`, and `-d1-migrations.log`.

All production acceptance commands used `ACCEPTANCE_URL=https://outofcharacter.droopy.dev`; browser reports record the target. The voice smoke establishes deployed WebRTC, feedback, shutdown and archival behavior with synthetic speech, not physical-phone audio acceptance or a quantified increase in human difficulty. Archive writes remain best effort, and no audio is archived. Refresh an already-open tab to load the expanded catalog. No branch push or merge was performed.


## Happy hour release

Andrew requested deployment of the [happy-hour follow-up](simulator-catalog-expansion.md#happy-hour-follow-up). Source **`f81f08bc2fbd313a9e418dcdabf74424cdeeffd3`** adds **The happy hour** as the ninth and last scenario, available with all seven clients. It is free conversation with no agenda, hidden business objective, live coaching, scoring or winning condition. Clients retain their personalities and can improvise everyday stories and preferences. The existing ten-minute limit, transcript, provider shutdown and private archive remain in use.

Deployed **2026-09-26 at 20:10 UTC** to [the simulator](https://outofcharacter.droopy.dev/simulator). Fresh Cloudflare receipts confirm **100% traffic** on version **`1b62fca7-129f-492b-b06c-845953014701`**, tagged **`f81f08b`**. Deployment used `--keep-vars`; the three enabled flags, existing provider secrets and archive binding remain configured. The remote database has no pending migrations.

Accepted evidence:

- Fresh `bun run check` passed: **131 tests / 4,253 assertions**, types, production build, privacy scan of **15 client assets**, and Worker dry run. The new session test covers settled speech, no live/final judging or direction, shutdown and an unscored SQLite archive. Log: `output/simulator-happy-hour-release-check.log`.
- All six checked HTTPS routes return 200. The live catalog contains **nine scenarios / seven clients**, with happy hour last and empty objectives/services. All **67 public served assets** match the release build. Report: `output/simulator-happy-hour-release-http.json`.
- Production workshop acceptance passes **12/12**, including last-place ordering, every client selection, the mobile brief, and unscored live/closing screens. Compact interaction acceptance passes **5/5** at 320, 390 and 1672 pixels. No browser errors, horizontal overflow, unexpected API calls or microphone requests. Reports and screenshots: `output/simulator-happy-hour-release-workshop/` and `output/simulator-happy-hour-release-compact/`.
- A bounded real-provider happy-hour conversation with Jamie passes **9/9** browser checks at 390 × 844 using prerecorded synthetic trainee speech. Both speakers were transcribed; every observed live/final evaluation remained null; live and closing screens had no coaching or scores; one injected polling failure recovered; provider closure and local media cleanup were confirmed. **28 provider seconds**, zero browser/test errors. Report: `output/simulator-happy-hour-release-live/report.json`. The scoped harness is `output/simulator-happy-hour-release-live.mjs`.
- That attempt's actual remote D1 export passes **18/18 comparisons**: complete transcript matches the browser, evaluation remains null, no direction cues were saved, closure is confirmed, and actor/opening hashes and Worker provenance match this release. Report: `output/simulator-happy-hour-release-live/archive-verification.json`. The export remains ignored with mode 0600.
- Cloud receipts: `output/simulator-happy-hour-release-deploy.log`, `-deployments.json`, and `-version.json`.

Every production browser command used `ACCEPTANCE_URL=https://outofcharacter.droopy.dev`. Workshop checks use illustrative dialogue without provider requests. The real voice smoke began with trainee speech and establishes the unscored conversation, closure and archival path; it does not establish spontaneous-greeting reliability, subjective improvisation quality or physical-phone audio behavior. Refresh an already-open tab to load the new scenario. No branch push or merge was performed.

## Role ownership and longer practice release

Andrew authorized implementation, independent Opus and Astra review, fixes and deployment of the [role-play follow-ups](simulator-roleplay-followups.md). Clients now retain responsibility for their own needs, expertise and interests while returning consultancy recommendations, scope and estimates to the trainee. Harper's attention responds to long or unclear explanations and can recover when the trainee clarifies. Scoring distinguishes client-authored plans from trainee guidance while preserving legitimate discovery. The completed prepared-sample Voice Lab is integrated.

The application no longer ends active practice at ten minutes. It allows up to sixty minutes with a final-minute warning, warns after three minutes of inactivity and closes after five. Actual speech, audible playback and relevant page interactions keep practice active. Automatic endings have a bounded audio-drain period; abandoned connections and failed startup also close. Transcript and assessment budgets remain bounded, and archive writes remain best effort.

Deployed **2026-09-26 at 23:11 UTC** to [the simulator](https://outofcharacter.droopy.dev/simulator). Source **`4c6628a`**, Worker version **`b080250e-7692-4355-90e9-a4c46ec7421d`**, tagged **`4c6628a`**, receives **100% traffic** in fresh Cloudflare receipts. Deployment used `--keep-vars`; existing bindings and enabled flags remain configured. No database migration was needed, and the remote migration list has no pending entries.

Accepted evidence:

- The release gate passed **152 tests / 5,916 assertions**, types, production builds, a private-content scan of **17 client assets**, and Worker dry run. A subsequent test-only fix removes a 1 ms deadline assertion race by using the emitted warning deadline; the full gate then passed **152 tests / 5,917 assertions**. Reports: `output/simulator-role-boundary-release-check.log` and `output/simulator-role-boundary-accepted-check.log`. No runtime code changed after the deployed source.
- Opus and a separate Astra session reviewed role ownership, scoring, session cleanup and long-dialogue behavior. Findings led to startup-expiry fixes, complete historical evidence coverage, server-ending microphone shutdown and bounded question groups for large Jev inputs. Both completed follow-up reviews with no remaining concrete deployment blocker. Six browser connection cases also pass.
- The production real-provider browser check passes **10/10** at **390 × 844**, including new trainee speech after ten elapsed minutes, both speakers, live/current Jev feedback, recovery from an injected transient poll failure, confirmed provider closure and local media cleanup. The attempt spans **672.472 wall seconds**, records **248 provider usage seconds**, and has **37 transcript passages**. Provider usage seconds are distinct from elapsed wall time. Report: `output/simulator-role-boundary-production-live/report.json`.
- The same attempt's remote D1 export passes **17/17 comparisons** with the final browser snapshot and source: transcript, evaluation at revision **700**, confirmed closure, current feedback, usage, actor/opening digests, model/voice and exact Worker version/tag. The final archive replaced the observed live partial checkpoint. Report: `output/simulator-role-boundary-production-live/archive-verification.json`. The raw export remains ignored with mode 0600; no audio is archived.
- Production workshop acceptance passes **12/12**, compact interaction acceptance **5/5**, and prepared Voice Lab selection/playback passes at **1440 and 390 pixels**, without overflow, unexpected microphone use or API requests. Mobile and desktop warning screenshots are readable and preserve the existing layouts. Reports: `output/simulator-role-boundary-production-workshop/`, `output/simulator-role-boundary-production-compact/`, and `output/simulator-role-boundary-production-voice-lab.log`.
- Seven checked HTTPS routes return 200. The public catalog has **nine scenarios / seven clients** and excludes private actor fields and client stats. All **223 served assets** match the local release build. Report: `output/simulator-role-boundary-release-http.json`.
- Six bounded direct-provider role-play rehearsals total **924 usage seconds**. Weak Harper/Jamie requests did not obtain consultancy plans; substantive trainee proposals earned cooperation. Harper's rambling/correction rehearsal showed selective attention and recovery in text. Large grading probes covered all-trainee and mixed dialogue through **800 passages / 80,000 characters** and completed in **425–784 ms** across the tested boundary shapes. These findings establish behavior in a small synthetic sample, not a human difficulty rating or guaranteed performance for arbitrary text.

Known grading limits remain visible: catalog fixtures pass **144/147**, original fixtures **72/73**, and challenges **50/55**. The catalog misses concern conservative director selection/eligibility. The broader suites retain a borderline stakeholder false positive, two previously failing trainee-evidence cases and a below-threshold director cue. An unshipped v6 wording trial did not consistently improve them and twice failed provider response validation; it was reverted to reviewed v5. Neither thresholds nor expected outcomes were relaxed. Details and private report pointers are in the follow-up plan.

Production browser commands used `ACCEPTANCE_URL=https://outofcharacter.droopy.dev`; the long voice probe used `ACCEPTANCE_DURATION_SECONDS=650` and prerecorded synthetic speech. This proves an active deployed conversation beyond ten minutes, not an uninterrupted provider hour or physical-phone audio behavior. Vocal acting has not received human listening acceptance. The shared director remains a conservative backup, with actor instructions providing the primary role boundary.

Opus's final follow-up accepted the deployment evidence and test-only fix without changing its no-blocker verdict. The one-hour warning, drain and close have controlled-clock evidence only. Near-capacity grading has synthetic evidence only; future real near-capacity diagnostics should capture the largest per-request input token count before changing limits.

Cloud receipts: `output/simulator-role-boundary-release-deploy.log`, `-deployments.json`, `-final-deployments.json`, `-version.json`, and `-migrations.log`. Source work and review checkpoints are committed on the isolated `simulator-role-boundaries` branch; the final evidence/test-only commit is later than the deployed runtime. The original `simulator-mvp` checkout is preserved. No branch push or merge was performed. Refresh an already-open simulator tab before trying the changes.

## Client voice release

The completed role-play and session-length work from `simulator-role-boundaries` is integrated into `simulator-mvp`. The selected default voices are Morgan–Meridian, Avery–Alloy, Casey–Cedar, Harper–Meridian, Quinn–Beacon, Riley–Ripple, and Jamie–Gleam. Voice Lab samples remain prepared clips; simulator conversations use the same defaults with GPT-Live.

Source **`b86c7e9`** deployed September 26, 2026 at 23:41 UTC to [the simulator](https://outofcharacter.droopy.dev/simulator). Cloudflare version **`465140f0-e7c0-458b-afec-46e05ca110b9`** is tagged `b86c7e9` and receives **100% traffic**. Existing variables and secrets were retained, and the remote D1 migration list had no pending entries.

The complete release gate passed **152 tests / 5,917 assertions**, typecheck, production build, bundle privacy check, and Wrangler dry run. Production Voice Lab playback and selection passed at 1440 and 390 pixels; all seven selected defaults, portraits, and audio URLs were checked. Production workshop acceptance passed **12/12**. A real-provider production simulator attempt passed **9/9** checks, including live Jev feedback, poll recovery, confirmed closure, and local media cleanup. Its final private D1 record confirms Morgan used **Meridian** on the exact Worker version and tag above. The smoke used prerecorded synthetic trainee speech, not a physical-device microphone.
