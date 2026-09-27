# Prerecorded briefings, Morgan's pace, and the developer complaint

Andrew's next practice was Morgan in **Done, but not deployed**. The resistance felt useful, but Morgan still sounded slow and the opening did not give enough context to someone who skipped the written preparation.

Andrew also clarified **The swap request**: there is no timely substitute for Theo's technical expertise. Removing him from development would materially endanger the project timeline. Success means retaining his development contribution while obtaining the client's agreement to a credible improvement in the meeting experience.

The agreed orientation is now a noninteractive prerecorded message from a colleague for every scenario. It can give the trainee their private preparation before the client joins, without leaking those facts into the client actor's context.

## Approach

- Keep GPT-Live 1 and the existing voice/session path. Its current [session configuration](https://developers.openai.com/api/docs/guides/live-conversations#configuration-fields) documents voice selection but no numeric speech-speed multiplier. [Speaking pace is prompted](https://developers.openai.com/api/docs/guides/live-prompting#personality); do not pass an unsupported Realtime setting to Live or introduce browser audio time-stretching.
- Give Morgan concise, prominent pace direction that takes precedence over generic theatrical pauses. Preserve his bargaining and justified resistance. Other clients retain their own delivery.
- Add a static briefing stage between selection and live practice. A colleague explains the trainee's role, known situation, constraints and purpose. Playback is noninteractive with play/pause, replay, transcript, skip/start and back controls. Finishing a clip never starts a paid session automatically; the trainee explicitly starts the conversation. No microphone or live session is opened during the briefing.
- Generate nine reusable MP3s ahead of time with GPT-Live 1 and the Sage voice, using the authored trainee-facing scripts in `core/simulator/briefings.ts`. Serve them as ordinary assets and retain script/audio hashes and generated transcripts in a manifest. Use the existing prepared-voice recording approach, not an API request for each learner.
- Keep the existing one-time in-character kickoff short: identify the client, orient to the project and make the opening request. The prerecorded colleague supplies the fuller preparation; the client does not repeat the briefing or explain the exercise.
- Use only client-known context. In the deployment case Morgan still believes Thursday testing is on track; he must not reveal the trainee's undisclosed deployment problem, reviews or recovery plan. Happy hour keeps its short social hello.
- Reuse the existing rehearsal, prepared-voice capture and ready-event architecture. The briefing is local UI state, outside the paid session lifecycle. Only the swap scenario's objectives change; shared grading rules and thresholds stay unchanged.

## The swap request

- Make the staffing constraint explicit in the trainee's lead and preparation, and in the actor's world limits. The client does not know the consultancy's staffing position until the trainee explains it.
- Preserve the client's legitimate interest in respectful, useful reviews. Expertise never excuses dismissing the complaint. Distinguish removing Theo from client-facing reviews from removing him from development.
- Update the response and agreement objectives: explain the continuity risk, offer a concrete intervention within the engagement manager's control, retain Theo on implementation, and agree ownership and a check on whether the client's experience improves. A vague promise to coach him, a guaranteed personality change, or an immediate full replacement does not earn success.
- A client may reject a weak plan and escalate; the actor must not hand over the desired compromise or automatically accept keeping Theo because the scenario wants that outcome.
- Extend the existing scoring fixtures with a retained-development agreement, dismissal of the complaint, and an unsupported full-removal promise. Keep unrelated rubrics and thresholds unchanged.

## Verification

1. Retrieve the latest matching private archive if Cloudflare access is available, keeping it in ignored output. Inspect the actual opening and record the source provenance.
2. Capture a Morgan deployment baseline, then the changed opening and continued conversation. Inspect the opening for identity, roles, project context and meeting purpose; ensure the client still waits for the trainee to disclose the problem and own the recovery.
3. Sample another scenario and a slower client. Use transcript timestamps only as a pace proxy, and retain audio for human listening. An instruction or a single faster sample does not establish a guaranteed speech rate.
4. Obtain a focused Opus review, apply justified feedback, and run the repository gate. Keep the current production release separate from this follow-up until deployment is authorized.
5. Verify all nine recorded scripts and assets, including the important caveats. Exercise briefing playback, replay, skip, back and audio failure at mobile and desktop widths with zero microphone or live requests until explicit start. Add a Workshop story and complete two scoped screenshot critique/fix passes.

## Initial diagnosis and plan review

Cloudflare access was restored through the existing personal-account sign-in. The matching Morgan/deployment archive is final with confirmed closure and 408 provider seconds, matching the 06:48 screenshot. It identifies production `f696fbb`, the Meridian voice and rubric v5. Its opening contains some context, but prioritizes a pointed challenge over a clear meeting purpose; the client passage spans 22.4 seconds. The real transcript stays ignored with mode 0600.

The worktree was fast-forwarded to `c1a329a`, preserving the intervening client voice selections and Workshop Voice Lab integration. The first local rehearsal used the earlier Cedar voice, reached its 180-second harness limit, and is excluded from the Meridian pace comparison. Current-voice baselines use the unchanged production prompt and a 240-second bound for the existing four-turn deployment plan.

Opus accepted the existing-path approach and identified three useful checks: protect undisclosed client knowledge, separate the first-turn instruction from normal later replies, and test vague trainee updates before any disclosure. Generic instructions for dramatic pauses were removed, while character-specific pacing remains. A content checklist replaces the old thirty-second budget.

We did not adopt a blanket ban on credit for discoveries in an opening: actual volunteered client facts still count under the agreed scoring contract. Instead, new setup context is limited to the authored public premise and avoids adding hidden impacts, internal staffing details or preferred solutions. No exact prompt-wording tests were added; real spoken samples check behavior.

The revised swap criteria are identified as rubric v7. Version v6 was used only in the rejected, unshipped wording experiments from the previous follow-up, so it is not reused for a different change. Status: implementation and verification in progress; not deployed.
