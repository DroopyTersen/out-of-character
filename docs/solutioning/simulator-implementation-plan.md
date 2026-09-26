# Simulator MVP implementation plan

Status: implementation authorized. Read alongside the [product proposal](simulator-proposal.md), [scenario framework](simulator-scenario-framework.md), and [progress log](simulator-progress.md).

This plan is the MVP acceptance contract. The proposal and framework supply rationale and seed content; optional extensions in those documents are not additional acceptance requirements.

## Outcome

Deliver a working simulator inside the existing application: choose a scenario and client, hold a GPT-Live conversation, receive live Jev skill scores and independent objective progress, see one useful trainee hint, and finish with an evidence-backed debrief. A separate client assessment can supply occasional private actor cues. **Resistance follows the client's interests.**

Keep the implementation small enough to understand and extend. Use the existing Bun, React Router, Cloudflare Worker, React, TypeScript, and AI SDK patterns. Authored data, small pure functions, and one session owner are sufficient; the MVP needs no scenario editor, general agent framework, emotion engine, saved history, or manager dashboard.

The MVP also omits an interruption indicator, extra scenario-specific skill bars, reconnect/resume, and audio recording storage. A minimal handler for unexpected Live client-delegation events remains necessary; it uses existing scenario context and does not run another generative agent.

## Product contract

- Two authored scenarios: adjacent SharePoint sales and engineering scope negotiation.
- Three reusable clients with six private behavioral stats, private scenario interests, stable facts, disclosure conditions, authority limits, and plausible concessions. The trainee sees the public identity and background, never the stats or actor directions.
- Seven trainee skills: Credibility, Confidence, Listening, Rapport, Clarity, Guidance, Adaptability. Scores reflect effectiveness with the particular client; unavailable evidence is distinct from poor performance.
- Every scenario objective visible in stable order and independently achievable in any order. Discoveries, trainee behaviors, and current agreements have distinct evidence requirements. Withdrawn agreements stop counting as achieved.
- GPT-Live 1 supplies the conversational audio and transcripts. The simulator uses no Flux path.
- AI SDK supplies Jev evaluation where supported. Use a small direct Live transport adapter where the installed SDK does not cover WebRTC/session control.
- Separate authored hints for the trainee and client. Client cues respect interests and fixed stats, can recognize earned progress, and never contain trainee scores or grader instructions.
- On phones, follow the compact mobile mockup: a small client strip opens the public session brief; all objectives and seven skills remain easy to scan; one dismissible overlay hint takes no layout space; transcript opens on demand. Preserve the existing desktop three-column composition, large portrait, transcript excerpt and inline hint. Selection supports scrollable scenario and client collections. Keep the existing game functional and offer clear navigation between modes.
- Build every simulator screen, important state, and animation in the existing DIY workshop alongside production components. Include replay/pause/reset controls for transitions and transcript playback. Add an isolated Jev analysis lab using authored transcripts, stepwise snapshots, and stored real-provider judgments. New paid runs are explicit CLI actions; workshop stories make no microphone or provider requests.
- Whole-attempt restart, transient results, and a deterministic debrief with actual dialogue evidence. A generative debrief is unnecessary for the first release.
- Keep all client/company material fictional or non-identifying. Credentials stay server-side and in ignored local configuration.

## Architecture boundaries

1. **Domain and authored content:** scenario/character definitions, public projections, actor brief composition, rubric anchors, objective criteria, hint candidates, transcript/evaluation contracts, and deterministic debrief helpers.
2. **Provider adapters:** AI SDK Jev evaluations and direct GPT-Live session/sideband commands. Validate provider results at the boundary; keep the provider protocol out of components.
3. **Session ownership:** one server session owner per attempt coordinates authoritative transcripts, evaluation scheduling, hint eligibility, close, and limits. Protect paid creation/control with existing origin/rate/kill-switch conventions and attempt ownership. Enforce the duration limit server-side and close abandoned sessions.
4. **Browser experience:** a focused hook owns WebRTC, media cleanup, transcripts, and connection state; components render selection, the conversation, feedback, and debrief. Keep client stats out of simulator payloads; the workshop may expose them through its separate diagnostics loader. Actor briefs and evaluation credentials never reach browser payloads or bundles.
5. **Verification:** pure behavior fixtures, transport/session tests at narrow external boundaries, real Jev fixture evaluations, real Live lifecycle/audio evidence, fixture UI checks, and visible browser review.

Preserve observation gaps and failed finalization honestly. An append acknowledgment does not prove the actor followed a cue. An asynchronous director cannot undo speech already heard. Provider failures must not fabricate scores, objective completions, or a successful session ending.

### Initial evaluation and session policy

- Use the bounded full transcript for each assessment; no recent/full score blending. Group Live fragments into speaker segments. Live assessments use passages that have each stopped receiving deltas for at least 1.2 seconds; another speaker’s backchannel does not settle a growing passage. The final pass considers the frozen transcript and explicitly rejects unfinished propositions.
- Trigger trainee assessment on meaningful new settled dialogue, no more often than every two seconds, with one request in flight and coalescing. Cap trainee calls at 180 per ten-minute attempt, reserving a final pass. Tune cadence from measured provider latency; a fixed update rate is not a correctness promise.
- Preserve achieved discoveries and demonstrated behaviors. Current outcomes follow the latest supported judgment and can be withdrawn. Keep uncertain or missing evidence distinct. Exercise this through the same pure state helpers used by workshop replays.
- Use per-skill applicability judgments so an unobserved skill is unavailable; a word-count rule cannot establish an opportunity to demonstrate Adaptability. Use exact source passages for evidence.
- Build and verify the actor brief before adding client cues. A server-side cue flag supports the required enabled/disabled comparison. Keep the director to an authored Choice including `no_hint`, a conservative probability floor, freshness, and cooldown. Its objective-progress and fidelity scores are diagnostic only and never tune personality or control difficulty.
- Add `SIMULATOR_ENABLED=false` to committed Worker configuration and enable only in ignored local settings for this task. Apply a separate low-rate creation limit, capability-protected session control, and server alarms for duration/abandonment. No browser-transcript fallback is needed for the first sideband implementation.

## Checkpoints and commits

At every checkpoint: update the progress log with exact evidence and remaining gaps; request a read-only Claude Opus review through computer use, with the plan/progress paths and commit or diff scope; assess the feedback; fix material issues; run relevant checks; commit explicit paths. Record actionable review feedback and its disposition. Keep commit titles in normal project language.

| Checkpoint | Deliverable | Verification |
| --- | --- | --- |
| 0 — Plan and baseline | This plan, goal contract, progress log, existing design/mockup baseline, local branch, and review workflow | Inspect scripts and integration boundaries; baseline check; Opus review of scope and simplifications |
| 1 — Scenario and judging foundations | Two scenarios, three characters, seven anchored skills, public/private projections, independent objectives, authored hints, debrief contracts, and transcript-lab fixtures | Meaningful behavior tests; typecheck; model question review; Opus code review |
| 2 — Live session | Session API/ownership, WebRTC adapter, sideband transcript collection, limits, explicit close, cleanup, and connection/error states | Narrow lifecycle tests; actual Live creation/audio/transcript/close smoke; Opus code review |
| 3 — Complete simulator | Selection/live/debrief screens, navigation, live trainee evaluation, objective evidence, private client cues, restart, and DIY workshop stories for every UI/animation state | Real Jev transcript-lab fixtures; workshop playback and browser flows; client-cue stale/duplicate/uncertain cases; Opus review |
| 4 — Core acceptance | Fixes from realistic use, documentation, reproducible acceptance scripts/evidence, final checkpoint commits | Full check suite, game regression, desktop/mobile browser inspection, voice/director comparison, final Opus review and completion audit |

| 5 — Visual iteration one | Mockup fidelity, expressive speaking display, isolated audio story | Desktop/phone before and after screenshots, scoped critique, Opus review |
| 6 — Visual iteration two and final acceptance | Refined major screens, motion/reduced-motion evidence, final audit | Second screenshot iteration, full gates, Opus review, committed handoff |

Make additional small commits within checkpoints when a coherent change is ready. Review shared infrastructure changes carefully; avoid opportunistic game refactors. Do not merge, enable auto-merge, or deploy without a separate explicit request.

## Acceptance evidence

Run the existing `bun run check` gate (type generation/typecheck, Bun tests, production build, Wrangler dry run). Add a simulator-specific acceptance command and opt-in paid provider smoke/evaluation commands with bounded usage and cleanup. Reuse existing browser test conventions where they fit, and use computer use for visible application checks and all requested Opus reviews.

Required behavior evidence:

- Scenario/client swaps preserve scenario truth and authority while changing personality.
- No private agenda/rubric/credential is serialized in public catalog or browser assets.
- All objectives remain visible and can complete out of order; a generic mention, incomplete speech, unaccepted proposal, or withdrawn consent does not earn a false completion.
- Missing evidence/provider failure remains unavailable. Trainee grading never treats a hidden fact as spoken evidence, and one low Rapport score does not mechanically lower every skill.
- Director cues respect client interests, require applicable evidence, suppress stale/duplicate/uncertain results, allow concessions, and keep trainee coaching private from the actor.
- Actual model calls exercise Jev typed output and the Live protocol. Save redacted results and distinguish synthetic fixture tests from human voice realism.
- Microphone denial, connect failure, disconnection, delayed grading, end/restart, timer expiry, and browser departure release local media and initiate server-side provider cleanup. Failed close acknowledgments remain explicit.
- The UI works at desktop and phone widths, follows the approved composition, exposes useful evidence without clutter, and preserves the existing game.
- The DIY workshop renders the same simulator components as production, exposes all screens and important error/loading/feedback states, and allows animations and authored transcript sequences to be replayed in isolation. Stored Jev runs show their source transcript, expected behavior, actual judgments/evidence, and provider provenance. Distinguish illustrative UI fixtures from measured provider output.

Human-perceived role-play realism is the residual subjective measure. Use scripted good/poor approaches and inspect actual audio/transcripts, with private cues enabled and disabled. Fixed audio proves transport/lifecycle; responsive exchanges provide a stronger but still synthetic role-play proxy. Record which was performed. Do not claim human-run conversation, practitioner calibration, or a physical-device check without that evidence.

## Visual iteration acceptance — added to the active goal

The MVP is not complete until the requested visual work is finished. Treat `docs/mockups/simulator-selection-scroll-v3.png` and `simulator-live-v4.png` as the pixel-fidelity targets: match client identities, type scale/weight, spacing, column proportions, borders and colors as closely as practical. The debrief v2 is a composition reference; preserve the agreed seven-skill rubric and actual evidence. Responsive layouts must preserve readability and useful coaching rather than shrink the desktop screenshot. Run at least two screenshot-driven design iterations covering the major selection, live conversation/coaching, debrief, and transcript-lab elements at desktop and phone widths. Each iteration must capture a before state, identify specific visual weaknesses, apply scoped fixes, and capture the same framing afterward. Keep the critique and disposition in `simulator-design-iterations.md`; aim for five worthwhile critiques per round without inventing defects.

Give speaking audio a dedicated design treatment consistent with the existing navy, mint, and pixel-art style. It should feel expressive and polished, clearly distinguish the client speaking, the trainee speaking, overlapping speech, listening, muted input, connecting, and ending, and respect reduced motion. Drive production activity from actual browser audio analysis. Provide a deterministic, replayable workshop story for every state, including animation intensity controls; opening it must not request a microphone or paid service.

Verify screenshot composition, animated changes over time, state labeling, readability, and overflow at both viewport sizes. Preserve a calm live layout with hints above objectives and skills in the right column. Repeat the relevant browser and repository gates after the changes. Ask Opus through computer use to review the visual checkpoints with this plan and the iteration/progress documents. Update the acceptance evidence and commit each coherent checkpoint. The active durable goal already names this plan as its acceptance contract; these criteria are required before it may be marked complete.

## Live-test follow-up: kickoff and performance

The first user rehearsal calls for a spoken meeting setup and much stronger character acting. Follow [the scoped performance plan](simulator-roleplay-performance.md), retaining the existing scenario truth, distinct personalities, and interest-driven resistance. Verify actual GPT-Live output rather than treating stronger prompt wording as proof of a better performance.

## Goal contract

Implement and verify the complete Simulator MVP in this repository using this plan, the product proposal, and scenario framework. Work through committed checkpoints until the two-scenario/three-client voice practice flow, live Jev skills/objectives, separate trainee/client hints, and evidence-backed debrief work together. Preserve the current game, anonymous public-repository content, and server-only credentials. Use the requested existing local OpenAI credential for bounded development verification. Keep AI SDK usage wherever the installed SDK fits; use direct Live transport only for unsupported protocol operations.

Completion requires the speaking animation and repeated visual iterations above, the final repository check to pass, meaningful simulator behavior tests and browser acceptance evidence, real provider verification with honest limits, every checkpoint's Opus review and disposition recorded, and all implementation work committed. No merge or deployment is authorized. A provider/account or review-UI failure is a concrete external blocker: keep completing independent work, record the exact missing evidence, and do not declare the corresponding requirement complete. Maintain the progress log throughout and audit every acceptance item before marking the goal complete.
