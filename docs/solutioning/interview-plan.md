# Project closeout interview POC

Status: implemented on `project-closeout-interviews` and verified on an isolated Cloudflare preview. Main's contextual simulator director at `d5bd3f5` is integrated; the interview still uses its existing authored cues. See the [contextual interviewer direction plan](interview-contextual-director-plan.md) for the proposed follow-up and `interview-progress.md` for verification and deployment history.

## Goal

Build a small third demo that conducts a useful real-project closeout interview: one warm buddy/journalist character, Cedar or Gleam voice, natural project/role opening, live conversational readings, useful private interviewer hints, and a comprehensive internal summary. Reuse the existing simulator connection, audio display, session lifecycle, passage evidence and private archive patterns. Keep the existing game and simulator working.

This is a POC. No new framework, identity system, admin screens, retry queue, document ingestion, report workflow or cross-interview synthesis. One interview, one summary, simple failure states. No deployment is authorized by this implementation task.

Added scope: replace the reused Sam portraits with matching approachable male/female artwork, and add shared desktop navigation plus a mobile hamburger drawer for Game, Simulator, The Debrief and Workshop. Keep this inside the shared header with no new navigation framework.

## Agreed behavior

- Start with what the person built or the project's goal, then naturally ask their role. One question at a time; skip facts already supplied.
- Sam feels like a perceptive friend at happy hour, with a journalist's ear for a story. Follow useful firsthand detail, accept uncertainty and respect boundaries. No invented shared history or endorsement of accusations.
- Keep the documented client debrief, process improvement, and project details/contributions topics and subtopics. Full coverage is optional. Credit only interviewee evidence; the interviewer asking or suggesting something is not evidence. Both speakers still provide conversational context.
- Show Engagement, Openness and Specificity as neutral observations. Guardedness and director hints stay private. Short precise answers count; verbosity, emotion and profanity do not establish quality. No win/loss, total completion grade, trainee coaching or mistake warning.
- Useful director cues may recur after cooldown; fresh evidence and spacing still apply. Do not leave a productive thread just because its topic was marked heard.
- Close voice first, then generate one bounded summary with pending/ready/unavailable states. Keep names and useful criticism, attribute accounts accurately, preserve uncertainty and avoid invented causes or coverage.
- Use a separate `interview_attempts` table in the existing private D1 database. Keep capability checks and same-origin protection. Simulator exports exclude interview rows; raw real transcripts do not enter the repo, Workshop or logs. Saves remain best effort.

## Small implementation boundary

- Public interview types/topics and one dedicated server-side brief/rubric. Two voice entries share one interviewer personality.
- Reuse the current Durable Object and browser connection with an optional interview state. Keep simulator evaluations unchanged rather than reinterpreting existing skill meanings.
- One `/interview` route with setup, conversation and summary views, plus synthetic Workshop previews and analysis fixtures.
- One summary generation function through the installed AI SDK and one archive table/migration. Preserve transcript saving independently of summary success.

## Checkpoints

1. Goal, current-main integration, shared contracts and this plan. Obtain Opus feedback on the concrete POC implementation boundary.
2. Functional interview, evaluation, private hints, summary and storage; synthetic Workshop coverage. Commit and request Opus code/behavior review.
3. Apply justified review changes. Run two screenshot critique/fix/verification rounds for each major screen (setup, conversation, summary) at desktop and mobile widths. Include Opus visual feedback.
4. Final checks, focused regressions, provider-backed synthetic evidence and clean committed work. Record what was tested and any limitations.

## Verification

- Objective evidence cannot originate from the AI interviewer. Terse expertise, vague answers, uncertainty, boundaries, leading questions, named criticism and one deep thread have synthetic fixtures.
- Verify recurring cues, terminal transcript tail, prompt role, summary timing and failure, isolated archive writes, capabilities and simulator regression behavior.
- Workshop previews use real UI components without microphone or paid calls. Capture setup/live/summary at 1440, 390 and 320 px, including pending, unavailable, mute and transcript states.
- Run `bun run check` and focused browser acceptance. Real-provider tests use synthetic project material only; credentials remain in existing ignored environment files.

Original local closeout research and the design-interview decisions informed this plan. The original real-project examples remain outside this public repository. See `interview-progress.md` for implementation and review evidence.
