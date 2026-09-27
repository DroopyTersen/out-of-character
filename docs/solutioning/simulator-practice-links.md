# Share a simulator practice

Andrew wants to share a specific scenario and client so the recipient opens directly on that pair's prerecorded intro. Keep this within the existing simulator route and briefing screen.

## Plan

- Use `/simulator?scenario=scope&client=morgan`, with the existing stable public catalog IDs. No saved share records, new endpoint, short links or session tokens.
- Validate both query parameters against the public catalog in the route loader. A complete valid pair initializes the existing selections and opens the briefing. A bare URL opens normal selection. Missing or unknown IDs return to normal selection with a brief invalid-link message; do not silently launch a different practice.
- Seed the existing screen state from the validated pair on initial load. Nothing in the app changes the query while `/simulator` is open, and Copy link only copies; no URL writes or state-sync effects are needed. Ordinary selection, Back, retry and debrief remain local state; refresh of a shared URL opens its original briefing again.
- Add a small Copy link action to the briefing. Build a URL for the displayed pair using the current origin. Show success, and on clipboard failure expose the URL in a selectable read-only input. Reuse the same action in the existing Workshop briefing preview.
- Opening, copying or finishing a briefing never requests a microphone or starts a live session. The current explicit Start gesture remains required. A valid link may show its static briefing when live practice is disabled, but Start stays disabled with an availability message.
- Keep the existing intro layout responsive and avoid new sharing dialogs or libraries. No actor, audio, grading, archive or private client data changes.

## Verification

- Test valid, missing and unknown IDs and the stable link format. Verify a public link carries only scenario/client IDs.
- Browser checks: direct entry and reload, correct client/scenario/audio, Copy link round trip from ordinary selection and Workshop, change setup then share the new pair, invalid-link fallback, clipboard failure, and no microphone/API activity before explicit Start. Exercise desktop and narrow mobile widths; retain screenshots and the base URL in evidence.
- Check disabled live availability, blocked autoplay with usable native playback controls, and that the existing briefing playback/start regression still passes. Browser checks substitute only unavailable capabilities and microphone/session creation to avoid paid calls.
- Run `bun run check`, review the diff and obtain Opus's implementation review. Apply concrete feedback, commit explicit paths and record the evidence here and in the progress document.

## Scope and checkpoints

Continue in `simulator-role-boundaries` from `ad029bb`, preserving the deployed Ash and Quinn changes. Plan review precedes implementation. The original implementation request excluded deployment, push and merge. Andrew subsequently requested deployment; the release is recorded below.

Opus reviewed the plan before implementation and found no blocker. Adopted the simpler initial-load-only state, exact public-ID parsing, SSR-safe clipboard access, selectable fallback URL, explicit disabled Start, blocked-autoplay verification and mobile placement that preserves the primary action. The Workshop now includes an availability toggle for isolated verification. Invalid-link notice uses the existing selection error slot only when there is no session error.

## Implemented and verified locally

Use Copy link on the briefing screen (the chain icon on mobile). It copies the current origin plus `/simulator?scenario=<id>&client=<id>`. For example, `/simulator?scenario=scope&client=morgan` opens Morgan's **The small change** intro directly. The Workshop uses the same action and always generates a simulator URL.

Both IDs must be valid. Unrelated query parameters are ignored; incomplete, empty, unknown or differently capitalized IDs show normal selection with an invalid-link notice. Back and subsequent choices remain local; copying after a change uses the displayed pair, while refreshing the original URL restores its original pair. No saved link or session record is created.

Opus reviewed the plan before implementation and then reviewed the code. Its implementation review found no product bug. It caught the same overly exact Workshop test selector found during local verification; the selectors now follow the existing acceptance script's pattern. The first failing report remains in `output/simulator-practice-links-ui/`; corrected and final runs both pass. Applied the suggested persistent screen-reader status for clipboard results and corrected the navigation wording above. The invalid-link notice retains the simple planned lifetime rather than adding dismissal state. Opus's final follow-up verified the fixes and accepted evidence with no remaining concrete issue.

Accepted evidence:

- Final `bun run check`: **157 tests / 6,041 assertions**, no failures, typecheck, production builds, privacy scan of **19 client assets** and Worker dry run. Log: `output/simulator-practice-links-check-final.log`.
- Practice-link browser checks: **5/5 groups** at `http://127.0.0.1:5186`, with direct entry/reload, blocked autoplay and working replay, actual clipboard round trips, changed selections, invalid links, ordinary and Workshop sharing, disabled Workshop Start, and denied-clipboard fallback. Desktop **1440px** and mobile **390/320px** show no overflow, page errors, microphone calls or API calls. Start remains above the fold at 390×844. Report and screenshots: `output/simulator-practice-links-ui-final/`.
- Briefing regression: **5/5 groups**, all nine recordings at three widths, fallback, replay/back and full playback ending without starting a call. A shared deployment/Quinn intro produces zero early requests, then exactly one intercepted microphone request and session creation after Start, with the correct pair in the request. Report: `output/simulator-practice-links-briefing-final/results.json`. Despite the harness's historical `productionGate` field name, this run targets the local URL recorded in that result.
- The disabled-link test renders the real route through the React Router static handler. It confirms the correct intro and disabled Start when the simulator flag is false, with the other availability prerequisites configured using unused test keys.

Browser microphone/session boundaries are intercepted, and the clipboard-failure case substitutes only a permission rejection. Ordinary copy uses the real browser clipboard. No paid voice call or physical-phone test was run; mobile evidence uses desktop Chromium viewports. Direct-link audio may require pressing Play because of browser autoplay policy.

Status: [deployed from `32475bd`](simulator-release.md#shared-practice-links-release) on September 27, 2026 at 13:17 UTC. The local evidence above remains separate from the production acceptance recorded in the release document. No branch push or merge was performed.
