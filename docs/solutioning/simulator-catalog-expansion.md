# Simulator catalog and performance expansion

Status: deployed from `d59c5ef`, September 26, 2026 at 19:35 UTC. Production verification is recorded in [the release record](simulator-release.md#expanded-catalog-and-archive-release). The existing pace, bargaining, and private-archive work is preserved.

## Accepted catalog

The original adjacent-opportunity and small-change scenarios remain. Six additions bring the catalog to eight scenarios:

| ID | Scenario | Practice |
| --- | --- | --- |
| `proposal` | Just send me a proposal | Qualify a rushed request without overcommitting or selling an unnecessary workshop. |
| `in-house` | We could build this ourselves | Respect internal competence, understand capacity and ownership, and position a useful partnership. |
| `courtesy` | The courtesy call | Stay gracious when losing, explore a fair scope comparison, and accept a professional close. |
| `demo` | The demo went too well | Explain prototype limits and give a champion a credible message without inventing a delivery date. |
| `deployment` | Done, but not deployed | Own missed discovery of corporate deployment processes, hear the impact, and agree a recovery plan. |
| `swap` | The swap request | Hear sensitive feedback about the consultancy team and agree a concrete response with follow-through. |

The proposed requirements-signoff, communication-criticism, and change-adoption scenarios were not selected. There is no replacement fifth pitch.

For deployment, the consultancy owns a development-complete bulk-order approval feature and deployment preparation. Staging cannot be provisioned until architecture, governance, and security operations reviews occur. The client did not volunteer those steps; the consultancy failed to ask and plan for them. Thursday testing is unconfirmed. The trainee must distinguish code completion from deployed software, own the discovery gap without taking responsibility for review durations it cannot control, hear the client impact, and coordinate review owners and inputs through the IT service manager. Neither person can waive reviews or guarantee unknown dates.

All six new scenarios include a public `briefing` with facts the trainee needs. It is shown expanded on selection and is available in the live session brief. The actor and evaluator receive the same shared context. Private interests, disclosure rules, constraints, cues, and grading criteria remain server-side; briefing facts alone do not earn dialogue objectives.

## New clients

Four new personalities join Morgan, Avery, and Casey, for seven interchangeable clients:

- **Harper:** distracted and decisive; interrupts with premature interpretations, sometimes incorrectly. Concise explanations and courteous corrections can regain attention.
- **Quinn:** polished and politically careful; expresses concerns through diplomatic subtext and needs honest framing that can survive organizational discussion.
- **Riley:** enthusiastic and expansive; tries to include every connected need and must be helped to accept a concrete first outcome and explicit exclusions.
- **Jamie:** warm and conflict-avoidant, with a Midwestern cadence. Qualified praise, deflection, and absent commitments signal a real concern. Specific low-pressure questions and non-defensive use of feedback earn candor. Social warmth never substitutes for explicit consent, and an explicit commitment is not secretly withdrawn offstage.

New portraits and prompts are recorded in [the asset record](../mockups/simulator-expanded-client-assets.md).

## Performance and difficulty

The target is approximately 25% more challenge and 30–50% more expressive acting, treated as a human calibration direction rather than a measurable scalar in the prompt or grading system.

The shared actor instructions now call for theatrical, Broadway-scale performance: pronounced emotional contrasts, emphasis, expressive reactions, and character-specific rhythm within short conversational turns. Morgan has sharper bite, Avery more legible restraint and firm objections, and Casey more audible skepticism. The earlier pace and bargaining instructions remain.

Clients press unresolved practical concerns instead of accepting a polished summary, apology, or confident boundary as sufficient. They do not supply the trainee’s missing plan or negotiate against themselves. A substantive answer can still resolve an objection; there are no minimum-turn requirements, arbitrary new hurdles, or moving goalposts. Ordinary relevant factual questions remain answerable. Objective probability thresholds and the seven skill anchors are unchanged.

## Verification

- The combined repository gate passed: 130 tests, 4,240 assertions, typecheck, production builds, private-client-bundle scan, and deployment dry run. Local receipt: `output/simulator-expansion/check-final.log`.
- The new catalog suite passes 83/83 checks across 13 authored conversations. Each new scenario has a good and poor approach; a separate Jamie case checks that a pleasant refusal earns no next-step credit. Receipt: `output/simulator-expansion/catalog-evaluation-final-v2.json`.
- Existing held-out conversations pass 22/22 checks, including withdrawn agreement and relevant expertise paired with poor listening. Receipt: `output/simulator-expansion/existing-holdouts.json`.
- Desktop and mobile workshop acceptance passes 8/8. It selects all six added scenarios, checks their public briefings, selects all four new clients, verifies their portraits load, and exercises the existing live/debrief/lab screens without microphone or provider requests. Final-build receipts and screenshots: `output/simulator-expansion/workshop-final/`. Compact layout checks also pass 5/5 at 320, 390, and 1672 pixels (`output/simulator-expansion/compact/`).

Earlier evaluation failures are retained. Adding an undefined optional briefing to evaluation state initially caused argument errors for the original scenarios; empty briefing arrays fixed that. Two authored fixture statements were clarified: the in-house capacity gap and the connection between document ownership and version confusion. No grading threshold or expectation was relaxed. A transient invalid-response error interrupted a later suite; the final full suite completed successfully.

## Spoken rehearsal evidence and limits

The rehearsal uses local synthesized trainee speech and the live client actor directly. It is not human acceptance testing or a production browser call. All reports and original audio remain in ignored `output/`.

| Rehearsal | Observation |
| --- | --- |
| Morgan scope, old and theatrical briefs, same good plan | Both sessions closed successfully (137 and 143 provider seconds). The new reply to a manual report was more expressive and incredulous. It ultimately accepted a bounded step. Regrading the saved dialogue after the briefing fix found four objectives before and five after; this pair does **not** establish a numerical difficulty increase. |
| Jamie, surface reassurance | 120 provider seconds; clean closure and no reported errors. Warm wording concealed reluctance, then an explicit attempted kickoff assumption elicited a clear refusal. No next step was earned. |
| Jamie, compact candor approach | 132 provider seconds; clean closure and no errors. Low-pressure questions elicited the failed rollout, missing document ownership, and recurring reconciliation work. Three discovery objectives completed; the final “let me sit with that” earned no next-step credit. |
| Harper, deployment recovery | 167 provider seconds; clean closure and no reported errors. Pressed the missed discovery and the need for a usable message; accepted owned coordination and a noon update without receiving a promised deployment date. All five objectives were earned. A low-confidence date-boundary cue (0.60) was observed but not sent; the director was disabled and the send floor is 0.90. |

The first five-turn Jamie candor rehearsal reached the existing three-minute deadline after four turns (178 provider seconds), while capturing the client’s specific adoption concern and four completed objectives. That failed completion is retained; the trainee script was shortened for the separate 132-second follow-up above, without extending the provider deadline.

The first theatrical Morgan run captured valid speech and closed cleanly, but its live evaluations hit the optional-briefing error. `morgan-regraded.json` contains the later offline evaluation of both captured conversations; the original failed report is preserved. The paired sample supports stronger language, not a measured win-rate change. Whether the voices feel sufficiently theatrical, and whether human success is about 25% harder, still needs listening and repeated human practice.

## Reproduce

```sh
bun run check
bun --env-file=.dev.vars ai/simulator/run.ts --catalog --output=output/simulator-catalog.json
bun --env-file=.dev.vars scripts/simulator-roleplay-probe.mjs --paid --scenario=deployment --client=harper --plan=good --label=review
bun --env-file=.dev.vars scripts/simulator-roleplay-probe.mjs --paid --scenario=deployment --client=morgan --plan=poor --label=review
bun --env-file=.dev.vars scripts/simulator-roleplay-probe.mjs --paid --scenario=sharepoint --client=jamie --plan=surface --label=review
bun --env-file=.dev.vars scripts/simulator-roleplay-probe.mjs --paid --scenario=sharepoint --client=jamie --plan=candid --label=review
```

Voice rehearsals are explicit paid opt-ins, bounded by the existing three-minute deadline. Keep transcript and audio artifacts untracked.

## Happy hour follow-up

Implemented locally on September 26, 2026; not yet deployed. **The happy hour** is the ninth and last scenario, available with every client. It is a consultancy-hosted social conversation: talk about hobbies, pet peeves, everyday stories, work, or any tangent. There is no agenda, hidden concern, sales opportunity, required discovery, or next step.

An empty objective list denotes an open conversation. The session skips live/final trainee judging and client direction. Selection, the session brief, the live screen and the closing screen omit objectives, hints and scores; the closing screen keeps the transcript and retry/selection controls. The existing ten-minute limit, provider shutdown and best-effort transcript archive still apply.

Actor direction carries each client's voice and quirks into the social setting, gives a short casual greeting, and permits consistent everyday personal improvisation. Business-meeting pressure does not apply. The eight existing scenarios retain their actor instructions and scoring behavior.

Verification: `bun run check` passes **131 tests / 4,253 assertions**, types, build, private-bundle scan and deployment dry run. The new session test exercises settled speech, no live/final judge or director calls, provider closure and a real SQLite transcript archive with no evaluation. Desktop/phone workshop checks pass **12/12**, including last-place ordering, all seven client selections and unscored live/closing screens; compact interactions pass **5/5**. Receipts are `output/simulator-happy-hour-check.log`, `output/simulator-happy-hour/workshop-frozen/report.json`, and `output/simulator-happy-hour/compact/report.json`. These checks use synthetic workshop dialogue and a narrow mocked provider boundary, not a paid voice rehearsal.

The initial browser run exposed exact-label test selectors and a local Wrangler proxy connection failure. The selectors were fixed. After the proxy interrupted a later screenshot run, the final suite used an isolated copy of the production build and passed all 12 checks, including the mobile session brief and full-screen captures. Earlier failure receipts remain under `output/simulator-happy-hour/workshop/` and `workshop-accepted/`.
