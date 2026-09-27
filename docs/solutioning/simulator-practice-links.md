# Share a simulator practice

Andrew wants to share a specific scenario and client so the recipient opens directly on that pair's prerecorded intro. Keep this within the existing simulator route and briefing screen.

## Plan

- Use `/simulator?scenario=scope&client=morgan`, with the existing stable public catalog IDs. No saved share records, new endpoint, short links or session tokens.
- Validate both query parameters against the public catalog in the route loader. A complete valid pair initializes the existing selections and opens the briefing. A bare URL opens normal selection. Missing or unknown IDs return to normal selection with a brief invalid-link message; do not silently launch a different practice.
- Seed the existing screen state from the validated pair. Use a keyed screen boundary for a different incoming pair, avoiding effects that synchronize URL state throughout the live session. Ordinary selection, Back, retry and debrief remain local state; refresh of a shared URL opens its original briefing again.
- Add a small Copy link action to the briefing. Build a URL for the displayed pair using the current origin. Show success, and on clipboard failure provide the actual shareable link so it can be opened/copied manually. Reuse the same action in the existing Workshop briefing preview.
- Opening, copying or finishing a briefing never requests a microphone or starts a live session. The current explicit Start gesture remains required. A valid link may show its static briefing when live practice is disabled, but Start stays disabled with an availability message.
- Keep the existing intro layout responsive and avoid new sharing dialogs or libraries. No actor, audio, grading, archive or private client data changes.

## Verification

- Test valid, missing and unknown IDs and the stable link format. Verify a public link carries only scenario/client IDs.
- Browser checks: direct entry and reload, correct client/scenario/audio, Copy link round trip from ordinary selection and Workshop, change setup then share the new pair, invalid-link fallback, clipboard failure, and no microphone/API activity before explicit Start. Exercise desktop and narrow mobile widths; retain screenshots and the base URL in evidence.
- Check disabled live availability and that the existing briefing playback/start regression still passes. Browser checks substitute only microphone/session creation to avoid paid calls.
- Run `bun run check`, review the diff and obtain Opus's implementation review. Apply concrete feedback, commit explicit paths and record the evidence here and in the progress document.

## Scope and checkpoints

Continue in `simulator-role-boundaries` from `ad029bb`, preserving the deployed Ash and Quinn changes. Plan review precedes implementation. No deployment, push or merge is part of this request.

Status: plan prepared; awaiting Opus review before implementation.
