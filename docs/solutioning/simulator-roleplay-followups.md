# Simulator role-play follow-ups

Status: implementation authorized September 26, 2026, including independent Opus and Astra review, review fixes, and production deployment. Work is isolated from the concurrent Voice Lab change, which will be integrated before the release gate.

Implementation decisions: keep the existing actor/evaluator architecture; remove trainee-addressed instructions from the actor; add one shared director cue. Use a 60-minute application safety limit, warn after three minutes of inactivity, and close after five with speech/playback-aware activity and an explicit continue control. Keep scoring change-driven at most every five seconds with a bounded call budget. Extend transcript capacity while keeping evidence choices within the provider's 255-option limit and retaining earlier cited objective evidence. Re-evaluate historical objective evidence in the final grade instead of preserving an early false positive forever. Provider documentation does not guarantee a one-hour GPT-Live session; verify a real session beyond ten minutes and report the extent of that evidence.

## Diagnosis completed

- Retrieved two completed practice sessions from the private D1 archive. The first exposed a client progressively doing the consultant's planning; the second showed more productive consulting but ended mid-answer at the ten-minute limit.
- Verified the first attempt's actor and opening prompt digests against source. The problem is present in the shared actor contract, although one failing conversation does not establish a failure rate across all clients.
- Reviewed the transcript, actor instructions, scenario data, scoring, director choices and rehearsal coverage independently. Keep the real transcripts and passage-level diagnostic reports in ignored `output/`, outside the public repository.

## Implementation task list

- [ ] **Separate the client's role and knowledge from the trainee briefing.** `actorBrief` currently includes second-person instructions addressed to the trainee. Build the actor's meeting premise from client-facing role/context, facts and interests. Distinguish what the client knows from world constraints used to prevent invented commitments. Preserve mistaken initial assumptions until the conversation corrects them. Remove preferred consulting solutions masquerading as client knowledge. Reuse existing scenario fields where clear; do not introduce a new scenario engine.

- [ ] **Make ownership of the work explicit.** Clients can explain needs, stakes, processes, internal people, authority and acceptance conditions; they can challenge and collaborate within their authored expertise. When asked repeatedly to design the consultancy's method, scope, proposal or estimate, they should state what they need and return responsibility to the consultant. Repeated non-answers should affect engagement in a character-appropriate way. Do not make all clients hostile, stop ordinary discovery or prohibit knowledgeable client initiative.

- [ ] **Correct scoring attribution and weak objective evidence.** Assess the trainee's actual contribution across the conversation. A client-authored plan is not evidence of strong trainee guidance. Keep legitimate discovery credit, independent skill dimensions and out-of-order objectives. Tighten the demo leadership-stakes criterion so a date, audience or general reassurance alone is insufficient. Test the pilot suggestion as a partial adjustment rather than automatically excellent consulting. Check final handling of early false-positive objective confirmations without making valid historical discoveries depend on later performance.

- [ ] **Use the existing director as backup.** Add an authored option for material client takeover of consultant work; use the same client-knowledge boundary in the director's input. Verify that the candidate can actually be selected and delivered through the production lookup. Keep the actor instructions as the primary prevention. Do not add another generator or synchronous gate. Add repeated cues or extra diagnostic storage only if a rehearsal demonstrates the need.

- [ ] **Make Harper's attention respond to the conversation.** Use selective attention during long explanations, a plausible premature interpretation, occasional loss of the thread, and requests for the headline. A correction should restore understanding; a concrete recommendation should earn attention. Avoid invented phone calls, emergencies, forced misunderstandings and mechanical distraction counters.

- [ ] **Allow an engaging conversation to continue past ten minutes.** Replace the current short practice deadline with a proposed 60-minute maximum safety limit. Add an inactivity warning with an obvious continue action and graceful closure for an abandoned session; a proposed starting point is roughly five minutes of genuine inactivity. Preserve disconnect cleanup and explicit End. An actively speaking or listening user must not be cut off by the inactivity path. Treat scenario duration as guidance rather than a forced ending, and update the timer presentation accordingly.

- [ ] **Keep longer practice responsive and bounded.** Decouple Jev cadence from the overall session deadline: merely changing `SESSION_LIMIT_SECONDS` from 600 to 3600 would spread the existing 179 live evaluations over the hour, initially about 20 seconds apart. Check the transcript entry/character caps, final grading and archival limits so a longer conversation does not hit another short-session ceiling. Bound evaluation work explicitly without silently disabling live feedback. Verify the current provider session limit before promising an uninterrupted hour.

## Regression and acceptance work

- [ ] Add synthetic grading fixtures for a passive trainee whose client authors the plan, an ordinary discovery exchange, a mixed early-good/later-passive conversation, and a competent trainee-owned proposal. Verify objective evidence as well as scores.
- [ ] Add weak and competent `demo` plans to the existing live role-play probe and test a second client/scenario. Weak prompts must not make the client progressively fill every missing piece; a good proposal must earn appropriate cooperation. Preserve client-side expertise and truthful answers.
- [ ] Listen separately for Harper's character performance. Text transcripts establish role behavior but cannot establish vocal quality.
- [ ] Verify active conversation beyond ten minutes, genuine inactivity with a warning, cancellation of that warning by renewed activity, no idle closure during playback, explicit End, lost-browser cleanup, confirmed provider closure and final archive saving. Give automatic endings a clear reason and warning where possible; let a reply finish within a bounded grace period rather than silently cutting it off.
- [ ] Verify live scoring cadence and the transcript budget at representative longer-session sizes. Exercise deadline and inactivity paths with controlled clocks; do not require a paid hour-long call for every test.
- [ ] Run the normal repository gate and obtain review before the implementation checkpoint is considered ready. Deployment remains a separate requested action.

## Source pointers and evidence limits

Actor/scenario ownership: `ai/simulator/scenarios.server.ts` (`actorBrief`, `demo`, client `harper`). Judge input and questions: `ai/simulator/evaluate.server.ts`, `ai/simulator/rubric.ts`. Objective retention and debrief: `core/simulator/state.ts`. Director, deadline, evaluation budget and cleanup: `app/server/simulator/session.ts`. Session maximum: `core/simulator/types.ts`. Live rehearsal coverage: `scripts/simulator-roleplay-probe.mjs`.

The first archive records the director enabled and no cues sent. Its available demo cues do not target role takeover; the archive does not retain the raw decisions or suppression reasons. The second archive records confirmed closure at 600 billed seconds with an unfinished client reply. It does not store a distinct close reason, so the exact tick/alarm path cannot be established from that row; both enforce the application deadline.

For inactivity, browser polling only proves that the page remains connected. Transcript gaps alone are also insufficient to establish silence. Account for audio activity, playback and relevant user interaction, and close gracefully so billing stops. See the [Live session inactivity guidance](https://developers.openai.com/api/docs/guides/live-conversations#close-idle-sessions-and-resume). A seamless restart/resume system is outside this MVP follow-up unless separately requested.

## Implementation checkpoint for review

Source checkpoints: `b7c164a` (actor and scoring), `e600953` (longer-session lifecycle and controls). The finished Voice Lab checkpoint is integrated as `5f68400`; its generator and playback received a separate review. Review the role-play/lifecycle changes against `dba0034`, concentrating on the source named above rather than the generated voice clips.

Evidence collected before independent implementation review:

- 41 session/API tests pass, including activity beyond ten minutes, three/five-minute inactivity behavior, renewed activity, a bounded one-hour drain, final objective correction, and private ownership cue delivery. Typecheck and focused core/evaluator tests pass.
- Four synthetic paid voice rehearsals used 611 billed seconds. Harper rejected repeated requests to write the trainee's scope, proposal, and estimate; a substantive trainee proposal earned cooperation. Jamie answered ordinary technical discovery but declined to invent the consultancy's delivery model. Her competent run reached the probe's three-minute wall deadline before the last reply, so it does not prove a completed next-step agreement.
- A 500-passage, 55,926-character Jev evaluation completed in 750 ms and retained earlier objective citations. Evidence choices are capped at 254 passage IDs plus `none`; full dialogue remains in the judgment state.
- New ownership fixtures distinguish ordinary discovery, weak outsourcing, mixed performance and a trainee-owned proposal. All raw successes and failures stay under ignored `output/role-boundary-*`. A repeated-takeover case selects the shared cue at 0.57, below the existing 0.90 send threshold. The actor prompt is the primary prevention; backup intervention sensitivity remains a review question. Two recovered-client fixtures still expect a cue although the latest client reply already restores ownership; those expectations need independent disposition, not a prompt change designed just to pass them.
- Browser activity checks with real WebRTC/audio nodes passed for speech, muted mic, audible output, paused output, automatic mic shutdown and resource release. Full browser runs will be repeated after the source is frozen; earlier runs crossed Vite hot reloads. A real provider session beyond ten minutes is still pending.

Review questions: Does the ownership rule preserve capable clients and ordinary discovery? Can a client still turn an empty question into a full consultancy plan? Do final rescoring and bounded evidence selection preserve valid earlier facts? Does the shared director option meaningfully help without forcing personality changes? Are automatic endings bounded, clearly explained and playback-aware? Prefer narrow fixes and concrete behavioral evidence over a new framework.
