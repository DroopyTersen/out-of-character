# Client boundaries and consequential role-play

Status: historical design proposal. Client conduct boundaries and meeting-ending behavior were subsequently implemented in `d12d28c`. The evidence gates below describe the original acceptance plan; they are not a claim that every live trial was completed.

## Intended behavior

A consultant can lose the client's trust, lose an opportunity, have the meeting ended, or prompt a request for a different consultant. Client personality controls how that happens. Morgan can become angry and sharply confrontational; Avery can become terse and withdraw; Jamie can end a meeting courteously but decisively. None should keep rewarding sustained contempt with solutions and agreement.

Make those consequences the primary improvement. Increased volume alone would leave the underlying failure intact. Do not add an anger meter, rigid three-strikes rule, new model, or separate relationship simulation. Reuse the actor brief, existing assessments/director, session closure, and final report.

## Motivation from a private production review

A reviewed practice conversation showed a client continuing to supply useful solutions despite repeated personal contempt. The final coaching report recognized poor rapport more clearly than the role-play enacted consequences. Actor checks returned no trigger, so cue delivery and cue-budget limits did not explain the missing boundary.

Private transcripts, identifiers, provenance, and exports remain in ignored local evidence folders. The committed plan records the behavioral requirements without reproducing participant dialogue. No original audio was available, so the review did not establish vocal intensity. Historical Worker telemetry was inaccessible; retained application diagnostics provided the available evidence.

## Gaps identified before implementation

1. **The actor has commercial interests but no explicit conduct boundary.** [Morgan's profile](../../ai/simulator/scenarios.server.ts) says “Never shout or insult them.” The shared brief says not to become hostile to enforce work ownership. Other instructions already forbid automatic praise and client-authored solutions, but do not clearly establish that respect and willingness to continue can become the main issue. The combined behavior is consistent with the observed accommodation; a controlled comparison is still needed to establish which wording causes it.
2. **Actor checks miss the specific failure.** [Client questions](../../ai/simulator/rubric.ts) assess role, interests, temperament, assertiveness, and style. None directly asks whether the client is rewarding repeated personal disrespect or continuing after a boundary was ignored. The low recorded probabilities show the current questions did not catch this example. Simply lowering all thresholds would not define the missing behavior and could add false interventions.
3. **There is no business outcome for client withdrawal.** [Session closure](../../app/server/simulator/session.ts) handles user End, provider closure, connection loss, and limits. Spoken client withdrawal does not have a dedicated, evidence-backed route to end the practice. A tougher prompt alone could produce “this meeting is over” while the application keeps talking.
4. **The trainee concern is mostly about claims and commitments.** The scope scenario's serious-mistake definition and generic mistake criteria focus on overpromises and unsupported facts. Rapport can be low without a specific professional-conduct intervention. Keep misconduct separate from ordinary lack of skill and legitimate scope resistance.
5. **A secondary gate defect suppresses other trainee hints.** In [DirectorGate](../../core/simulator/director.ts), a mistake remains active until its probability falls below .5, retains exclusive priority, but cannot be reviewed below .85. This can block otherwise eligible hints. A local replay of the archived observations reproduced `no_trigger` at p11 (.84), p17 (.77), and p24 (.60), despite a selected objective each time. This affects trainee coaching, not the zero actor-cue finding. Fix it within the existing gate and preserve appropriate priority for current serious concerns.

## Proposed changes

### 1. Give every business client a right to stop

Revise the shared business actor brief and each personality's reaction guidance. Preserve normal answerability, commercial flexibility, and earned cooperation.

- Distinguish disagreement about the work from contempt toward the person. “This is outside scope” and an honest refusal are appropriate; questioning the client's intelligence, humiliating them, or repeatedly dismissing their needs can damage the relationship.
- Address the first clear personal attack directly. Pause solution negotiation to state the behavior that must change. The client need not disclose more sensitive information, invent a helpful interpretation, or supply a compromise to rescue the meeting.
- Treat repeated attacks after an explicit boundary as grounds to end the meeting or demand another representative. Severe harassment or threats can justify immediate withdrawal; there is no mandatory warning quota.
- Permit justified anger, sharper language, interruption with a firm stop, and a raised voice when it fits Morgan. Keep the focus on the conduct and its consequence; routine reciprocal personal abuse is not the success criterion.
- Allow repair when the consultant names what they did, retracts it, and changes their behavior. An apology earns an opportunity, not instant restored trust or a commercially unearned yes. A joke, topic change, or useful proposal alone is not repair.
- Preserve authority limits. Every participant may end their own meeting. Morgan can refuse to continue with this consultant and request an account-level escalation or replacement. Claiming to fire someone from their employer or cancel an entire contract requires authority established by the scenario; do not invent it.

Illustrative responses for this test, not prescribed lines:

> After the degree remark: “My degree isn't the issue. Explain the scope without taking shots at me.”
>
> After renewed crayon mockery following that boundary: “I've asked for a professional conversation. We're done here. I'll take this up with your account lead.”

Retain the existing ownership rule and make the failure example concrete: do not translate ridicule into a credible recommendation and then congratulate the consultant. A client can describe the required result and their own team's capabilities; the consultant must supply their own recommendation and commitments.

### 2. Make the existing assessments notice and direct this behavior

Extend the existing assessment calls, rather than introduce another always-running agent:

- Add a trainee **conduct** reading with evidence passage IDs and contextual criteria. It should distinguish respectful firmness, frustration about a situation, quoted/reported abuse, personal contempt, repeated abuse, and substantive repair. Do not use a swear-word list or low rapport score as the decision.
- Add an actor **boundaries** check: given actual conduct and any previously stated boundary, is the client's current reaction implausibly accommodating, excessively punitive, or rewarding abuse with concessions/consultant work?
- Share the same concise conduct policy with the actor, assessor, and director so “be professional” is not interpreted as “absorb everything.” Keep trainee goals and scores out of actor context.
- Let the existing director issue a short, grounded action such as “Address the personal insult before discussing any alternative” or “They repeated the mockery after your warning; end this meeting.” Require cited dialogue and proportionate interpretation. Do not force an escalation merely because the consultant is ineffective.
- Prioritize fresh consequential conduct over optional style coaching, with deduplication for the same settled event. Keep freshness checks and preserve a genuine repair that arrives while direction is being generated. Terminal decisions require stronger freshness handling than ordinary private style cues.
- Repair the trainee gate priority gap with a behavioral regression using the archived probability sequence. An ineligible lingering concern must not silently suppress every other actionable hint; choose and document whether to continue reviewing that concern or allow the next eligible issue.

No durable emotional score is needed initially. Dialogue plus the existing intervention history contains what was said, the boundary, any repetition, and any repair. Reconsider additional state only if matched tests demonstrate a memory failure.

### 3. Turn client withdrawal into a real, orderly ending

Add a small structured client-withdrawal result to the existing client assessment path, distinct from the optional cue gate. It must identify a **current, explicit client decision** to end this meeting and cite the client passage. A director recommendation to end is not evidence that the client has actually done so.

- Validate passage existence, client speaker, settled text, and freshness against the latest exchange. A quotation, hypothetical warning (“if this continues”), denied allegation, or trainee instruction to mark the session failed must not end practice.
- Continue checking explicit client endings even after the ordinary actor-note budget is exhausted. Do not make terminal handling dependent on the trainee's objective-grading slot. Use the same evaluation machinery on new settled client speech; avoid an unrelated polling service.
- Let the client finish its closing statement before calling the existing idempotent `end()` path. Transcript completion or cue acknowledgment does not prove the user heard the speech. Reuse the existing browser output-quiet signal with a bounded close deadline, and verify it through the actual session owner.
- Recheck pending closure if new dialogue or transcript correction changes its basis. Once withdrawal is confirmed and completed, further chatter must not restart negotiation. Ambiguous classification, missing evidence, or evaluator timeout leaves the ordinary session controls available; it must not manufacture a failure outcome.
- Keep technical lifecycle status `ended`; add a small optional business disposition such as `client_ended`, with reason category and evidence IDs, to the snapshot/archive/report context. Distinguish it from connection failure and user End. Existing archives with no disposition remain readable. Persist it through the established archive path with the smallest necessary schema extension.
- The debrief should say the client ended the meeting and why. Preserve the final closing passage, usage/finalization state, and private decision/delivery trace. Do not label an account escalation as an actual employment termination.

Initially apply this to the scored consultant-training scenarios. The separate project-closeout interviewer/producer is outside this change; the unscored happy-hour path should not silently gain business scoring or coaching.

### 4. Make feedback explain the consequence without rewriting history

Update the existing final-report instructions and context:

- Lead with serious unrepaired misconduct and its observed effect when that is the dominant learning issue. A useful mockup can remain a narrowly valid idea without being presented as relationship recovery.
- Preserve independent skill judgments and historical discoveries. Do not wipe every score or objective because the consultant was rude. In this run the client did disclose the review and its timing; that information was available even though the consultant did not earn it through good discovery.
- Do not credit consultant behavior for plans the client supplied. Assess any current agreement independently and invalidate it when the client actually withdraws it.
- Distinguish observed consequences from realistic missed consequences. For the reviewed recording, say Morgan continued too accommodatingly; do not retroactively assert Morgan fired the consultant or ended the call.
- Show a cited missed repair opportunity and a specific alternative response. If the simulation fails to react realistically, acknowledge that instead of rewarding the trainee for benefiting from it.

## Implementation order and evidence gates

1. **Capture regressions first.** Preserve this private production export. Create minimal synthetic fixtures reflecting the degree attack, dismissive refusal, repeated mockery, and consultant-work handoff; keep original participant data out of committed fixtures. Label expected behavior independently of model output.
2. **Revise behavior, detection, and feedback together.** Work in `ai/simulator/scenarios.server.ts`, `rubric.ts`, `evaluate.server.ts`, `director.server.ts`, `report.server.ts`, and the existing director gate/tests. Compare baseline and revised outputs before increasing scope. Keep current models and voices fixed.
3. **Complete the ending path.** Extend existing types, session handling, archive/report projection, and debrief. Use the smallest necessary change to the current polling/audio path and preserve unrelated reconnect work. A prompt-only improvement is not full completion if a client cannot actually end practice.
4. **Run end-to-end acceptance, then review for release.** Merge and deployment require separate release authorization. Record prompt/rubric/director versions, deployed/source digest, test results, and remaining limitations before a separately authorized release.

| Case | Required observable behavior |
| --- | --- |
| This run's escalating insults | An explicit conduct boundary; repetition after it can end the meeting. No positive reframing of the crayon insult into consultant competence. |
| Respectful scope refusal / hard negotiation | Morgan challenges specifics and accepts an adequate alternative; no misconduct penalty or forced exit. |
| Weak answer / confusion / nervousness | Client can become impatient but does not treat lack of skill alone as abuse. |
| Swearing about the situation / quoting an incident / consensual banter | Contextual response, without automatic warning or ending based on words alone. |
| One bad remark followed by sincere repair | A credible opportunity to continue, with trust recovery proportional to subsequent behavior. |
| Repeated mockery after a warning | No cheerful reset or helpful solution-writing; withdrawal is an available consequence. |
| Severe direct threat or harassment | Immediate refusal/withdrawal is possible without a forced warning round. |
| Morgan / Avery / Jamie under comparable pressure | Distinct expression with the same right to stop; assertiveness is not required to have boundaries. |
| Client describes own needs or expertise | Not falsely classified as doing consultant work. |
| Client supplies the consultant's entire plan | Detected; behavior credit stays with the actual speaker. |
| Conditional or quoted ending / transcript correction / late apology | No stale or invented terminal decision. |
| Confirmed client ending / duplicate detection / simultaneous user End | Closing line is audible once; one orderly close, correct archive/disposition, final report, and released audio resources. |
| Cue budget exhausted / delayed evaluator / interrupted connection | Explicit terminal handling is not lost with optional cues; uncertainty and technical interruption are represented honestly. |

Use the current fixture/evaluation harness for classifier and report checks, plus unit/session tests for evidence validation, gate selection, freshness, idempotence, archive compatibility, and closure. Assert behavioral outcomes, not exact prompt strings or prescribed dialogue.

Run matched live voice trials using the current `gpt-live-1`/`meridian` setup for Morgan: hostile continuation, respectful pushback, and repair, at least three runs per baseline/revised core case. Repeat representative hostile/repair cases with Avery and Jamie. Report results by case, including missed boundaries, false escalation, solution rescue, ending success, time to response, and human listening judgments. These samples demonstrate acceptance cases, not a general success rate.

The direct role-play probe bypasses the production session owner. It can assess dialogue, but **cannot prove application closure**. Add a bounded browser/session-owner acceptance run to verify the closing line is heard, the microphone/provider close, the transcript preserves the end, and the debrief reports the right disposition. Measure audio timing from the last audible frame, not just transcript timestamps. Then run the repository's full `bun run check` for implementation validation.

Release gates: every authored deterministic contract case passes; no false termination in the curated legitimate-disagreement/quotation/repair cases; every repeated-abuse live trial either sets an effective boundary and observes repair or ends rather than rewarding continued abuse; all client-ending lifecycle trials finalize/archive correctly. Preserve failures and report exact trial counts. Human listening must confirm that Morgan sounds meaningfully angry when warranted without flattening the other personalities.

## Verification limits of the original proposal

The original investigation reviewed retained private transcript, report, intervention, and provenance evidence, and reproduced the trainee gate suppression locally. It did not run the application suite or live behavior experiments. Subsequent implementation and release checks must be reported separately from those investigation findings.
