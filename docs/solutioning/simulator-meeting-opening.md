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

The revised swap criteria are identified as rubric v7. Version v6 was used only in the rejected, unshipped wording experiments from the previous follow-up, so it is not reused for a different change.

## Delivered and verified locally

All nine scenarios have a reusable colleague recording, a readable transcript, replay/native audio controls, and an explicit Start conversation action. Business briefings run 37.6–44.2 seconds; happy hour is 18.6 seconds. The recording is paused before leaving the briefing. Finishing playback never opens a microphone or a paid call. Retrying the same completed attempt deliberately skips the already-heard introduction; choosing another simulation restores the briefing step.

The Workshop includes `/storybook/simulator-briefing` with all scenarios and clients. Two screenshot critique passes kept the desktop layout spacious and tightened mobile spacing so the primary action is visible at 390×844. The 320-pixel layout has no horizontal overflow and may scroll vertically.

Opus reviewed the plan and two implementation checkpoints through the desktop app. Applied findings: remove a redundant actor-facing compromise sentence and the unnecessary start guard, make the Theo briefing describe authority rather than prescribe the solution, handle interrupted Replay like interrupted autoplay, and assert exactly one session request after the explicit start. The positive Theo fixture now uses ordinary acceptance without repeating that Theo remains on development; it still passes all eight checks, so no grading criterion was loosened. The recorder shares the existing Voice Lab capture/encoding code; it retains failed synthetic takes locally, records event counts, and stops silent takes after fifteen seconds. Existing Voice Lab recordings and the deployed voice selections are unchanged.

The deployment recording initially produced silence despite a started connection. An explicit instruction to begin speaking yielded the complete script, and a subsequent finalized take is the delivered asset. A duplicate opening word in the first SharePoint take was re-recorded. Accepted recordings must match every normalized script word in order; the earlier edit-distance tolerance and its duplicated implementation were removed. The manifest preserves actual script, source and audio hashes; eight successful takes predate the final generator kickoff wording, so a future unfiltered generation run will propose refreshing those source hashes. Their current authored words and audio integrity pass independently.

When refreshing recordings, run `bun scripts/scenario-briefing-samples.mjs --dry-run --scenario=<id>` first, then the same scoped command with `--paid` and the ignored credential file. Always specify `--scenario` unless intentionally refreshing the entire catalog. This preserves accepted takes and avoids paying to regenerate them after an unrelated kickoff change. The final Opus follow-up found no remaining code blocker.

| Evidence | Result |
| --- | --- |
| Repository gate | `bun run check`: 153 tests, 0 failures, 6,023 assertions; types, build, 19-asset private-data boundary scan and Wrangler dry run pass. |
| Briefing assets | All nine match their script words and hashes, decode with ffmpeg, and match ffprobe durations. Routine unit tests do not require ffmpeg or ffprobe. |
| Briefing browser acceptance | All nine clips load at 1440, 390 and 320 pixels; no overflow, page errors or Workshop API/microphone calls. Replay/pause, audio failure, natural ending and back navigation pass. Completion makes zero API/microphone requests; explicit start makes one microphone request and one mocked creation. |
| Real browser live attempt | Nine checks pass at a phone-sized viewport: live Jev/current assessment, both transcripts, transient polling recovery, confirmed provider closure, safe data channel and local media cleanup. 29 provider usage seconds. |
| Browser failure flows | All three pass: denied microphone, failed creation and cancellation while microphone access is pending. |
| Theo grading | Four targeted fixtures pass 28/28 checks: retained-development agreement, dismissal, unsupported full replacement and staffing investigation alone. The natural-agreement revision also passes 8/8. |
| Role-play probes | Final Morgan/deployment four-turn run closes normally with 168 usage seconds. Morgan/Theo closes normally with 140 seconds and challenges the proposed compromise before considering it. The vague deployment run does not reveal the undisclosed staging/review problem. Avery's sampled opening remains hesitant. |

Morgan's Meridian delivery remains variable. For comparable four-turn deployment rehearsals, the transcript-timestamp estimate rose from 176 to 182 words/minute overall, and 173 to 182 for substantial replies after the opening. This is a small synthetic observation, not proof of a reliable rate or a 20% improvement. His faster pace is a stronger instruction, not a numeric API setting. No human listening or physical-phone acceptance is claimed.

Local evidence: `output/simulator-briefing-final-check.log`, `output/simulator-briefing-audio-audit.json`, `output/simulator-briefing-ui-final/`, `output/simulator-briefing-live/report.json`, `output/simulator-briefing-catalog-swap-*.json`, and `output/simulator-briefing-swap-implicit-agreement.json`. Failed takes and real archives remain ignored.

Status: [deployed from `797258c`](simulator-release.md#prerecorded-colleague-briefings-release) on September 27 at 03:20 UTC, with 100% traffic. Production verification includes all nine clips at three widths, full playback without an automatic live start, desktop Safari playback/skip-forward, a real voice/scoring pass on retry, and 16/16 archive comparisons. The release record preserves the initial seek-based harness failure and live-scoring timeout. Only the acceptance script and documentation changed after the deployed source; no runtime fix or additional deployment was needed.
