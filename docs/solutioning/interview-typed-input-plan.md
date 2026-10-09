# Optional typed input in the interview engine

Status: implementation plan. Product behavior agreed with Andrew on 2026-10-09. Source baseline: `0d1ae84`.

Add optional typed participant input to the core interview engine. Voice remains the primary medium, and the interviewer continues replying aloud. The engine owns submission, transcript handling, composing protection, and microphone behavior. The Debrief is the first consumer and owns the composer and responsive presentation.

## Agreed behavior

- Focusing the composer does nothing. A nonempty draft temporarily mutes the microphone and suppresses engine silence-recovery nudges.
- Protection remains through thinking pauses and focus changes. Unsubmitted words stay in the browser.
- Accepted Send or explicit Clear removes the temporary mute and restores the participant's manual microphone preference. A failed Send retains the draft and protection.
- The interviewer can finish an utterance already underway. Typing never cancels spoken output or restarts the conversation.
- Actual typing counts as activity. An abandoned draft does not disable idle or duration limits.
- Submitted text is participant evidence in the existing transcript, analysis, resume context, archive, and narrative. This feature does not introduce a separate chat mode.

## Engine and host boundary

The reusable unit remains the existing `interview-engine/` folder. Extend its current entry points and three seams; no new package, framework, host interface, or configuration layer is needed.

| Owner | Responsibilities |
| --- | --- |
| Engine shared contract | Submission/activity schemas, limits, and browser-safe receipt types. Both client and server use these definitions. |
| Engine browser client | Submission IDs and retry identity, transport calls, composing reports, microphone tracks, and reconnect synchronization. Expose `setComposing(boolean)` and `submitText(text)` through `LiveConnection`. |
| Engine session actor | Input validation, live-state gating, deduplication, transcript/evidence updates, required saves, provider delivery, and silence suppression. |
| Host server | User/tenant authorization, attempt-to-resource ownership, HTTP origin/body/rate gates, route mounting, provider construction, and implementations of `SessionStore`, `Background`, and `Archive`. Forward validated commands to `SessionActor.handle`. |
| Host UI | Draft text, Send/Clear controls, pending/error presentation, layout, transcript rendering, and product wording. It calls the engine client; it never sends provider events or manipulates microphone tracks directly. |

Keep types and limits in `shared/`, browser behavior in `client/`, and session behavior in `interview/`. New client types must not import the actor's server-only snapshot types; use a receipt generic over the existing client snapshot type. Hosts continue importing `interview/interview.server.ts`, `shared/*`, and `client/*` directly.

The engine knows the interviewer and interview content through `InterviewSpec`, not The Debrief's routes, React components, Sam's name, or application resource IDs. Credentials and platform bindings remain host concerns. Existing engine capability checks remain in addition to the host's user and ownership checks.

A second host should only supply its spec/providers/adapters, forward the new command, and connect its own composer to the client. It should not copy transcript, retry, mute, or silence logic from The Debrief.

## Core engine implementation

### 1 Verify the provider boundary

Start with a narrow local probe through the engine's Bun reference host: audio-only WebRTC plus the server control socket. Test `session.thinking.append` as the initial candidate for submitting a literal participant answer. The engine already uses this event for producer notes; its behavior for participant input must be verified.

The probe must establish:

- A typed answer after a settled question produces a relevant spoken response.
- A submission during an utterance lets the interviewer finish naturally.
- The provider does not echo the answer into a second participant transcript entry.
- Provider acknowledgments and rejections can be correlated with the submission ID.
- Composing protection suppresses engine recovery nudges, with any autonomous provider speech observed separately.

Listen to the result; an event acknowledgment does not prove a useful spoken response. Keep participant framing in `interview-engine/interview/session/voice.prompt.ts`, separate from producer notes, preserving the complete bounded answer. Resolve this provider boundary before building the full feature.

### 2 Add a small public contract

Add `submitText({ id, text })` to the engine's HTTP/socket action lists and client transport union. Reuse the host's existing capability, same-origin, and route-forwarding checks.

| Field or result | Contract |
| --- | --- |
| `id` | UUID created and retained by `LiveConnection` for retries of the same answer. |
| `text` | Nonblank, at most 2,000 characters. Preserve exact text; trim only to reject blank input. |
| Request body | At most 16 KiB, including JSON escaping. Enforce the existing total transcript limits too. |
| Success | Explicit accepted submission ID and current snapshot, after the required save completes. |
| Failure | Actionable error; the browser retains the draft and submission ID. |

New answers require a live, usable session. Reject new text while connecting, paused, ending, ended, or fenced. A generic terminal snapshot is not an acceptance receipt. A repeated ID must match the original text; otherwise return a conflict. Resolve retries against the existing turn without inserting or delivering it twice.

Define the schema, text/body limits, and acceptance type in `shared/protocol.ts`. The host route imports them; the actor also validates the command, so its behavior does not depend on a particular router. Add an optional `composing` boolean to sequenced activity messages and carry current activity in `ready`. Draft text never travels in activity reports. Existing clients that omit `composing` retain their current behavior.

### 3 Reuse the transcript and checkpoint paths

Use `typed-${id}` as the passage ID and the existing participant speaker value (`trainee` internally). Add the ID to the existing frozen-passage set so subsequent speech cannot extend its text. Checkpointed transcript entries provide durable deduplication; no new table or submission ledger is needed.

Use a point timestamp derived from the current segment:

```ts
const at = Math.max(lastTranscriptEndMs, segment.offsetMs + now - segment.startedAt);
// startMs = endMs = at
```

Here `lastTranscriptEndMs` is the greatest existing passage end time, or zero for an empty transcript. This keeps typed answers on the same timeline as speech across reconnects.

Perform the live-state check, deduplication, limit check, and append synchronously before the first await. Share only the existing speech bookkeeping: passage update time, transcript revision, activity/silence clock, cancellation of a pending silence judgment, response-to-nudge tracking, producer notification, and capacity checks. Use the ordinary transcript immediately; do not maintain a second staged transcript or delay analysis behind a separate commit mechanism.

Keep the persistence machinery narrow:

1. Allow one unresolved send per attempt. Concurrent retries share its operation; a failed save keeps its ID available for retry. The browser also allows one pending Send.
2. Await a checkpoint containing the turn before acknowledging it. Required saves propagate failures; periodic saves can remain best effort. A retry must not mistake an in-memory turn for a successful save.
3. Order checkpoint writes and deletion with one small promise chain in the engine. Build each checkpoint when its write runs. This preserves the contract across host adapters without a general command queue or another revision index.
4. Pause and End already see the synchronously appended turn. Drain the outstanding required write before removing its checkpoint or completing finalization, then use the existing final transcript path. A failed write must not prevent the participant from ending.

After a successful save, forward the answer once to the same usable provider segment. If that segment has changed, use resume context instead. A retry of an already accepted turn returns its receipt without forwarding again. Keep only the current unresolved operation in memory; restored checkpoint entries are already saved and become the resumed interviewer's context.

Give typed provider events a recognizable `typed-` ID. Handle a correlated rejection explicitly: retain the saved turn and use the existing pause/reconnect path with a message such as “Your answer is saved. Reconnect to continue.” Do not treat the answer as an optional producer note and silently ignore rejection. An ambiguous delivery is not a reason to resend blindly.

Acceptance means the turn was saved, not that the interviewer has spoken. The existing store, archive, and finalization contracts still apply; this feature does not redesign persistence for the entire interview.

Finally, adjust the resume instruction: when the last participant passage has a `typed-` ID, treat it as a completed answer and respond or continue from it. Keep the existing “may have been cut off” wording for spoken input.

### 4 Add composing protection to the shared client and actor

Expose `setComposing(boolean)` and `submitText(text)` from `LiveConnection`. The latter creates the wire-level `{ id, text }`, retains the ID across retryable/uncertain results, shares a pending send, and returns the explicit acceptance receipt. A host does not implement submission deduplication or response reconciliation. Keep only the submitted text/ID in the client; the editable draft remains in the host UI.

Add one independent reason to disable microphone tracks:

```ts
track.enabled = !this.muted && !this.composing && !this.autoMuted;
```

Do not capture and restore a second copy of the manual mute preference. Removing composing protection naturally restores the current preference, including any manual change made while typing.

A composition change applies locally immediately and sends an immediate activity report. Normal polls repeat the state; keystrokes use the existing activity mechanism. Number reports with `Math.max(previousSequence + 1, Date.now())`, retaining the actor's greater-than check for stale reports. Do not reset the actor's counter on resume or add a public snapshot watermark. Include the current sequenced activity in `ready` and apply it before returning to live state. Unnumbered legacy polls never change composition.

The actor needs one composing boolean. Entering composition aborts the current silence judgment. Both the launch condition and the condition before sending a nudge check that boolean; the existing abort signal also prevents a late result from surviving a quick type-and-clear sequence. Leaving composition starts a fresh four-second interval. Release the checked-revision marker for a judgment aborted by typing so it can be reconsidered; retain the once-per-exchange bound for completed judgments.

Coverage, producer work, ordinary interviewer responses, idle limits, and hard limits continue normally. If connectivity prevents confirmation of composing state, show the existing connection state. Engine protection does not promise that the provider cannot speak autonomously.

## The Debrief integration

Once the engine contract works, expose its two methods through `app/simulator/use-simulator.ts`, preserving the existing attempt-generation guard. Keep draft state in The Debrief screen or a small interview-specific composer. The shared practice client continues working without a composer.

- Above the existing 800px breakpoint, show more transcript and a persistent secondary composer alongside Sam, voice controls, and topic coverage. Placeholder: “Type an answer or add a detail…”
- On compact screens, expose the composer through the transcript area. A collapsed draft still protects the microphone and shows a visible status and a way back to it.
- Show “Mic paused while typing.” Protect whenever `draft.length > 0`; reject whitespace-only Send.
- Enter inserts a newline. Ctrl/Cmd+Enter sends except during IME composition. Disable editing, Clear, and duplicate Send while a submission is pending.
- Accepted Send clears only that attempt's submitted draft. A retryable or uncertain result retains the exact draft and ID until reconciled; never create a replacement submission just because a response was lost.
- Render submitted answers using the existing participant transcript presentation. Do not add a separate typed-turn display model. Sending and clearing do not move focus or pull the reader away from earlier passages.
- Preserve drafts through same-page connection pauses. Persistent draft storage across reloads is outside this change; retain the existing leave warning.
- End stays available, with confirmation before discarding a nonempty draft. Never silently submit it.

## Files and verification

| Area | Files |
| --- | --- |
| Core protocol and client | `interview-engine/shared/protocol.ts`, `interview-engine/client/transport.ts`, `interview-engine/client/liveConnection.ts` |
| Core transcript, persistence, and provider behavior | `interview-engine/interview/session/session.server.ts`, `interview-engine/interview/session/transcript.ts`, `interview-engine/interview/session/voice.prompt.ts` |
| Host forwarding | `app/server/interview/routes.ts`; the existing socket adapter forwards through it |
| The Debrief | `app/simulator/use-simulator.ts`, `app/routes/interview.tsx`, `app/interview/screens.tsx`, `app/interview/interview.css`, `app/storybook/interview-stories.tsx` |
| Documentation | `interview-engine/README.md`, `interview-engine/CONTEXT.md` |
| Portability proof | `scripts/engine-copy-check.ts`, using existing engine fixtures and entry points |

No checkpoint schema migration is expected. Passage IDs and text already travel through the existing JSON transcript and `toPassage` mapping. Preserve the engine import boundary: application UI and host-specific code stay outside the core.

Use real actor, memory-store, transcript, and client implementations. Substitute only browser APIs and paid providers where deterministic tests need those boundaries.

| Check | Observable result |
| --- | --- |
| Protocol | Both transports accept valid input and enforce authorization, state, text/body limits, and conflicting-ID rejection. |
| Submission | One immutable participant turn across concurrent retries, a lost response, and owner replacement; failed storage never acknowledges success. Ordered saves cannot overwrite a newer accepted turn. |
| Lifecycle | Pause/End include a turn appended before them, exclude new submissions after their state transition, and never forward to a closed/replaced provider segment. |
| Evidence | Exact participant text reaches coverage/producer inputs, resume context, archive, and narrative. Completed typed answers receive appropriate resume wording. |
| Composition | Focus alone does nothing; draft entry protects; blur retains protection; Send/Clear restores manual mute; delayed reports and late judgments cannot undo current protection. Include a reloaded client with a resident actor and delayed pre-resume polls. |
| UI | Verify keyboard/IME behavior, failure/reconnect retention, stale-attempt responses, mic-track state, and layouts at 1440/390/320px. Sam's current utterance continues while typing. |
| Portability | The copied engine compiles and a focused typed-input consumer smoke runs using only engine entry points, providers/fixtures, and the existing memory adapters. No app imports or copied host business logic. |

Extend adjacent engine/client/host tests. Extend the existing copy check with the focused consumer smoke, then run `bun run check:engine` and `bun run check`. The Bun reference host reuses application routing helpers; the copied-folder smoke provides independent portability evidence. Document the two client calls and minimal server forwarding in the engine README so another host can adopt the feature directly.

Add `scripts/interview-typed-input-acceptance.mjs` using the existing real-page and WebRTC fixture patterns. Run it with the workshop and relevant practice connection acceptance checks. Correct the existing connection script's stale activity expectation: microphone noise is not interviewer speech.

Completion also requires a real voice interview: type after a spoken question, hear a relevant response, return to voice, mix spoken and typed answers, reconnect, and inspect the resulting report. Record actual listening separately from provider receipts and fixture results.
