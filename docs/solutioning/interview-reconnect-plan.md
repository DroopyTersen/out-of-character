# Interview pause and resume on connection loss

Status: **planned, not implemented.** Base: `578a2a9` on `main`. Scope: the live session lifecycle in the browser (`app/simulator/live-connection.ts`, `app/simulator/use-simulator.ts`, the interview screens) and in the session Durable Object (`app/server/simulator/session.ts`), plus small producer changes (`app/server/simulator/interview-producer.ts`). It applies to the simulator and interview scenarios alike, but the interview is the motivating case.

## Problem

A dropped network connection ends the attempt. The trainee loses the rest of the conversation and has to start over, even when the network comes back within a minute.

### Motivating incident (2026-10-01, attempt `0d9538f4…`, local dev)

- Sam's project-closeout interview was about 12½ minutes in when the home internet dropped, around 18:09:35 UTC.
- At that moment every outbound call stopped answering:
  - TypeSafe grades had succeeded every ~5 s; the next three timed out, the last at 18:10:10.
  - The browser's WebRTC audio to Azure went quiet.
  - So did the server's sideband to Azure.
- The browser declared "The voice connection was lost." after its disconnect grace (5 s then; Codex has since raised it to 30 s).
- The server tried to close the Azure session, but Azure never confirmed (`finalization: unconfirmed`).
- The summary call failed too, so the summary is `unavailable`.
- The transcript was saved (82 passages); it ends mid-sentence at p82.

Moving from OpenAI to Azure OpenAI seemed to make drops more frequent. Whatever the cause (home network, VPN, or an Azure hiccup), the fix is the same: a drop should pause the interview, not end it.

### Where the current code ends an attempt on a drop

| Trigger | Where | Today |
|---|---|---|
| WebRTC `disconnected` longer than the grace | `live-connection.ts:81` | Browser fails the attempt |
| WebRTC `failed` | `live-connection.ts:77` | Browser fails the attempt |
| 3 consecutive poll failures (~3 s when offline, since an offline `fetch` rejects at once) | `live-connection.ts:176` | Browser fails the attempt |
| Sideband socket `close` or `error` | `session.ts:229` | Server `end(true)` → `interrupted` |
| Provider `session.closed` with reason other than `close_requested` | `session.ts:253` | Server ends; `connection_lost` → `interrupted` |
| No poll for 35 s | `session.ts:340` | Server ends: "losing contact with this page" |
| Worker restart or eviction (snapshot lives only in memory) | `session.ts:26` | Next request → 410 "interrupted" |

The longer WebRTC grace alone does not help in production. When the trainee's internet drops there, the 1 s polls to Cloudflare fail as well, and three failures end the attempt in about 3 s. If the browser gives up, the server ends the attempt itself at 35 s. The incident above survived its first seconds only because local dev polls `localhost`.

## Goals

- A transient loss of connectivity pauses the interview. The trainee can resume the same attempt, with the same transcript, coverage, producer state and one final summary.
- This covers both failure sources: the trainee's network (browser ↔ Cloudflare and browser ↔ Azure), and Azure (the provider session dies or its sideband drops).
- No paid Azure session idles while paused, and none is orphaned.
- A pause that never resumes still ends cleanly, with a final grade and summary of what was captured.
- Sam resumes naturally: a brief acknowledgement, no re-introduction, no re-asking answered questions.

## Non-goals (v1)

- Resuming after a page refresh or browser crash (see Phase 2).
- Reattaching WebRTC to the *same* Azure session. This only matters if the Live API supports re-offering SDP on an existing session; nothing in the repo documents that. See Open questions.
- Deliberate pause/resume by the trainee (a "pause" button). The mechanism would support it, but it is out of scope.

## Design overview

Pause means the Durable Object keeps the interview (transcript, coverage, producer records, grades) and **closes** the Azure live session. Resume means the browser builds a new peer connection, and the Durable Object creates a **fresh** Azure live session. That session gets the same actor brief and voice, plus the conversation so far and a resume instruction.

```
            drop detected (browser or server)
  live ─────────────────────────────────────▶ paused
   ▲                                            │  ├─ trainee clicks End ─────────┐
   │ /ready (resume instruction)                │  └─ pause deadline (15 min) ────┤
   │                                            │ /resume {sdp}                   ▼
  connecting ◀──────────────────────────────────┘                         ending → ended
                                                                          (final grade + summary)
```

Why a fresh provider session rather than reconnecting to the old one:

1. **One path for both causes.** An Azure-side failure kills the session anyway. A home-network outage leaves it running, billing and at risk of being orphaned.
2. **No dependency on undocumented API behavior.** It does not need SDP renegotiation on an existing `/live/sessions/{id}`.
3. **Bounded cost while paused.** Nothing paid runs during a pause.

The cost is that Sam's memory is rebuilt from transcript text, which loses prosody and Sam's private delegation and thinking context. To compensate, resume replays the latest rundown and the research Sam already received.

## Detection

### Browser (`live-connection.ts`)

The browser passes through a non-fatal **reconnecting** state before pausing.

| Signal | Behavior |
|---|---|
| WebRTC `disconnected` | Show "Reconnecting…" and wait. ICE often recovers on its own. Pause if still disconnected after `RECONNECT_GRACE_MS` (~15 s). |
| WebRTC `failed` | Pause immediately; ICE does not recover from `failed` without a restart. |
| Poll fails with a network error or timeout | Show "Reconnecting…"; keep polling with backoff. Pause after `POLL_GRACE_MS` (~10 s) of continuous failure. 401/403/404/410 stay fatal (session lost or not owned). |
| `window` `offline` event | Pause immediately. |
| Poll returns `status: 'paused'` (the server paused first, e.g. on an Azure drop) | Pause. |

On pause, the browser:
- stops the microphone tracks, so the OS mic indicator turns off;
- closes the peer connection and stops the meter;
- keeps the attempt `id`, capability, `AbortController` scope and transcript;
- sends `POST /pause` as a best-effort report (it may not arrive, and the server must not rely on it);
- switches polling to a slow heartbeat (every 5 s) that tells it when the server is reachable again.

`fail()` remains for genuinely fatal cases: lost session (401/403/404/410), microphone denied, start-up failures before `live`, and a rejected resume.

### Server (`session.ts`)

| Signal while `live` | Today | New |
|---|---|---|
| Sideband `close` / `error` | `end(true)` | `pause('provider')` |
| `session.closed`, reason `connection_lost` | `end(true)` | `pause('provider')` |
| `session.closed`, any other reason other than `close_requested` | `end()` | Unchanged (policy and limit closures should not auto-resume) |
| No poll for 35 s | `end()` | `pause('browser')` — the home-outage case in production |
| `POST /pause` | n/a | `pause('browser')` |

**Epoch guard.** Each provider segment gets an incrementing `epoch`. `listen(socket, epoch)` ignores every event and `close` from a socket whose epoch is not current. Without this, the old session's late `session.closed` or socket close would pause or end the resumed session.

## Pause (server)

`pause(reason)` is idempotent and only valid from `live` (or `connecting` during a resume). It:

1. Sets `snapshot.status = 'paused'`, plus `snapshot.pause = { reason, pausedAt, resumeBy: pausedAt + PAUSE_HOLD_MS }`, both public. It records `{ epoch, reason, pausedAt }` in a private `pauses[]` list.
2. Stops the live tick (`clearInterval(this.timer)`), aborts in-flight grading (`gradeAbort`), and calls a new `producer.pause()`. That aborts in-flight cue and research generation and marks it `deferred`, not `closed`; `producer.close()` stays terminal.
3. Closes the current provider session. It sends `session.close` over the sideband if open and waits ≤10 s for `session.closed`. If the sideband is gone, it reattaches as `finish()` does today. An unconfirmed segment goes to `lease.pendingClose[]`, and the alarm keeps retrying it through the existing `recoverLease` logic.
4. Writes a **checkpoint** to DO storage (see Durability) and a `partial` archive.
5. Sets the alarm to fire at `resumeBy`, or sooner if `pendingClose` is non-empty.

A paused session stays paused until resumed, ended by the trainee, or past `resumeBy`, at which point the alarm calls `end()`. That ends normally (not `interrupted`), with the message "The interview ended because the connection didn't return within 15 minutes." It runs the final grade, and the summary is generated from the captured transcript.

`checkLifetime()` while paused checks only `resumeBy` and the lease deadline. The 35 s `lastSeen` rule and the idle warnings do not apply.

## Resume

### Browser

1. Wait until it is online (`navigator.onLine` and one successful heartbeat poll).
2. Auto-resume if the pause has lasted less than `AUTO_RESUME_MS` (~60 s) and the tab is visible. Otherwise enable a **Resume** button, so Sam does not start talking to an empty room.
3. Call `getUserMedia` and create a new `RTCPeerConnection` with the existing track and meter wiring. Create the offer and gather ICE (the same steps as `start()`, factored into a shared `negotiate()`).
4. `POST /resume { sdp }`. Then `setRemoteDescription(answer)`, wait for `connected` (15 s), and `POST /ready`.
5. If resume fails, the session falls back to `paused` with the error shown, not ended. Fatal statuses (404/410, budget exhausted, deadline passed) move to the debrief.

### Server `POST /resume`

1. Accept from `paused`. Accept from `live` too: an outage shorter than 35 s means the server never noticed, so pause first, then continue. Reject from any other status.
2. Guards: `resumes < MAX_RESUMES` (5), `now < resumeBy`, lease deadline not passed, transcript capacity not exhausted. Rate-limit `/resume` (reuse `RATE_SIMULATOR` or add `RATE_RESUME`), so a flapping network cannot loop paid session creation.
3. Ensure the previous segment is closed or in `pendingClose`.
4. `createLive(...)` with **seeded instructions**: `actorBrief(...)`, then a `CONVERSATION SO FAR` block rendered from `snapshot.transcript`. Speakers are labelled as in the evaluator input. The block is capped at ~40 k characters; when longer, keep the tail plus a one-line note that earlier conversation is omitted. Same `voice` and `model`.
5. Then `attachLive`, `epoch++`, `listen(socket, epoch)`, and record the new `providerId` on the lease. Set the segment's `timeOffsetMs` (see Details 1). Set `status = 'connecting'`, start the tick, and return `{ sdp, snapshot }`.

### Server `POST /ready` (resume variant)

- Set `status = 'live'` and record `resumedAt` and the duration in `pauses[]`.
- Send a **resume instruction** instead of `openingInstruction`. It covers:
  - the call dropped for about N minutes and is back;
  - acknowledge it in one short sentence, without re-introducing yourself or re-greeting;
  - the last exchange (quote the last client and trainee passages);
  - if the trainee was cut off mid-answer, invite them to finish ("You were saying the rubric let you…").
- Call a new `producer.resume()`. It re-sends a fresh rundown, outside the `LIMITS.rundowns` budget, and re-delivers the research Sam already received (`deliveredBackground(records)`) as one background note.

`resumeInstruction()` lives beside `openingInstruction()` in `ai/simulator/scenarios.server.ts`, so the interview and simulator scenarios can phrase it in character.

## Details that will bite

1. **The transcript clock restarts.** Provider `start_ms`/`end_ms` restart at 0 in a new session. `appendTranscript` merges a delta into the speaker's last passage when `delta.startMs - last.endMs <= 2000` (`core/simulator/state.ts:10`). That check is negative here, so the first resumed words would be glued onto the cut-off passage (p82 in the incident).
   - Fix: on each segment, `timeOffsetMs = max(endMs so far) + pausedWallMs`, added to every incoming transcript timestamp. Producer `providerEvent` timings (`session.ts`, the `session.instructions.appended` handler) get the same offset.
   - Also freeze every pre-pause passage (`judgedPassages`), so no later delta can extend it.
2. **Paused time is not interview time.**
   - The producer's elapsed time drives the time reminder and "About N minutes elapsed" in the rundown (`interview-producer.ts:336`, `:343`). Replace `now - startedAt` with an injected `elapsedMs()` that subtracts paused time.
   - The idle timer treats a pause as activity: on resume, set `lastActivity = now`.
   - The 60-minute safety limit should count live time: extend `lease.deadline` by each pause, capped at 90 minutes of wall clock.
3. **Durability.** `SimulatorSession` keeps the snapshot only in memory (`session.ts:26`).
   - Live, it stays resident because of the outgoing sideband and 1 s polls.
   - Paused, the provider socket is closed and the browser may be unreachable, so only the alarm keeps it resident. A deploy, or an eviction between alarms, wipes it, and the next request returns 410.
   - On pause, write `checkpoint` to `ctx.storage`, with:
     - the snapshot;
     - producer records and counters;
     - `grades`, `pauses`, `epoch` and `timeOffsetMs`.
   - Phase 1 uses the checkpoint only to **finalize** after a lost instance: `alarm()` (`session.ts:525`) or the next request finds a checkpoint but no in-memory snapshot. It then ends the attempt from the checkpoint, running the final grade, archive and summary, instead of returning 410.
   - Phase 2 rehydrates fully and allows resume.
4. **Finalization and usage across segments.** `finalization: 'confirmed'` means every segment's closure was confirmed. `usageSeconds` sums the segments. The lease changes to `{ providerId (current), pendingClose: string[] }` (`session.ts:21`). `recoverLease` iterates over `pendingClose` and the current ID.
5. **Ending while paused.** `finish()` (`session.ts:453`) skips the drain and the provider close, since nothing is open. It runs the final grade and starts the summary as today. `pagehide` (`use-simulator.ts:20`) still disposes. In Phase 1 that ends the paused attempt; Phase 2 may leave it paused for a refresh-resume.
6. **Cue and producer edge cases.**
   - `canDeliverCue()` must be false while paused or connecting.
   - A cue whose `instructions.appended` acknowledgement never arrived before the drop counts as undelivered; mark it `deferred`, not `delivered`.
   - Coverage grades keep working on the existing transcript after resume. No regrading is needed.

## UI

- `useSimulator` gains `'reconnecting'` and `'paused'` phases. `LiveConnection` gets matching callbacks; `fatal` errors keep their current meaning.
- **Reconnecting** (non-blocking banner over the live screen): "Connection unstable — reconnecting…"
- **Paused** (interview screen state):
  - Headline: "Connection lost — interview paused."
  - Body: "Your transcript is saved. We'll hold this interview for 14:32."
  - **Resume interview**: enabled when online; a spinner while connecting.
  - **End & get summary**: always enabled.
  - The transcript stays readable. Audio meters are silent. The mic is released.
- Add Storybook states for reconnecting, paused (offline), paused (back online), resuming, and resume failed (`app/storybook/interview-stories.tsx`).

## Archive and diagnostics

- Add to `provenance`: `segments: [{ epoch, startedAt, endedAt, closeReason, finalization }]` and `pauses: [{ reason, pausedAt, resumedAt | null, durationMs }]`.
- Add a `pause` and a `resume` record to the producer `interventions` stream, so the timeline shows them in order with cues and grades.
- Today's investigation needed log forensics. With this, one D1 row answers what dropped, when, which side noticed, and whether it came back.

## Testing

### Unit (`app/server/simulator/session.test.ts`, with fake `createLive`/`attachLive`)

- Each server trigger (sideband close, `connection_lost`, 35 s silence, `/pause`) moves `live` to `paused`, closes the provider, and writes a checkpoint.
- Non-`connection_lost` closures still end the attempt.
- `/resume` from `paused`:
  - creates a new provider session whose instructions contain the transcript;
  - `/ready` sends the resume instruction, not the opening instruction;
  - a fresh rundown is sent.
- `/resume` from `live` pauses first, then resumes.
- A late `close` or `session.closed` from the superseded socket is ignored after resume.
- The first resumed delta at provider `start_ms: 0` opens a new passage (no merge into the cut-off one), and its timestamps follow the old ones.
- The pause deadline ends the attempt as `ended`, with summary `pending` then `ready`.
- End while paused finalizes without touching a provider.
- The resume budget and rate limit are enforced. The deadline is extended by paused time and capped.
- A checkpoint with no in-memory snapshot finalizes on the alarm.

### Producer (`interview-producer.test.ts`)

- `pause()` defers in-flight work. `resume()` re-sends the rundown and delivered research.
- `elapsedMs` excludes paused time.

### Browser (`live-connection`)

- An offline `fetch` rejection reaches reconnecting, then paused, not `fail`.
- 401/403/404/410 are still fatal.
- `failed` pauses. `disconnected` that recovers within the grace never pauses.

### Manual

- Chrome DevTools' "Offline" setting does not affect WebRTC. Test by turning Wi-Fi off, or block UDP with `pfctl` or Network Link Conditioner.
- Test against a **preview deploy**, not local dev. In local dev the Durable Object shares the outage, which is not the production failure mode.
- Cases:
  1. 10 s outage: recovers with no pause.
  2. 45 s outage: auto-resume.
  3. 3 min outage: click Resume.
  4. 16 min outage: ended with a summary.
  5. Kill the Azure session mid-interview (debug hook): server-side pause, then resume.

### Acceptance (real Azure)

Add `scripts/interview-resume-acceptance.mjs`: run an interview, force a pause mid-answer through a debug-only hook, and resume. Judge Sam's first resumed turn on four checks:
- it acknowledges the drop briefly;
- it does not re-greet or re-introduce;
- it continues the open thread or invites the trainee to finish;
- it does not re-ask an answered question.

Run several seeds.

## Phasing

**Phase 1: pause, resume, never lose the attempt**
- Detection changes in the browser and server, the epoch guard, `pause`/`resume`/`ready` variants, the transcript offset, paused-time accounting, checkpoint-for-finalize, UI states, archive fields, unit tests.
- The "End & get summary" path from paused.

**Phase 2: survive refresh and restarts**
- Persist `{ id, capability }` in `sessionStorage` and offer "Resume your interview" after a reload.
- Full rehydration from the checkpoint, so resume works after an eviction or deploy.

**Phase 3 (only if the Live API supports it): same-session reattach**
- If Foundry can take a new SDP for an existing session, prefer that for short outages, keeping Sam's live context. Fall back to a fresh session.

**Related, separate change:** retry the interview summary instead of marking it `unavailable` on one failure, and allow regenerating it for saved attempts. That would recover attempt `0d9538f4…`.

## Open decisions (recommended defaults)

| Decision | Default | Notes |
|---|---|---|
| Pause hold time (`PAUSE_HOLD_MS`) | 15 min | After that, end the attempt and summarize |
| Auto-resume window (`AUTO_RESUME_MS`) | 60 s | Longer pauses require a click |
| WebRTC disconnect grace (`RECONNECT_GRACE_MS`) | 15 s | Codex set the fatal grace to 30 s; this replaces it with "reconnecting → pause" |
| Poll failure grace (`POLL_GRACE_MS`) | 10 s | Replaces the 3-failure fatal rule |
| Resumes per attempt (`MAX_RESUMES`) | 5 | Bounds cost on a flapping network |
| Live-time limit | 60 min of live time, 90 min wall clock cap | Extends `lease.deadline` by paused time |
| Transcript seed cap | ~40 k characters, tail-first | Realtime context headroom |
| Resume after refresh | Phase 2 | Needs the capability in `sessionStorage` |

## Open questions

- Does the Foundry Live API accept a new SDP offer for an existing session (true reattach)? If so, Phase 3 becomes cheap.
- Does Azure send `session.closed` with `connection_lost` promptly when the browser's media path dies, and after what delay? Measure on a preview deploy; it decides whether the server or the browser usually notices first.
- Is the instruction channel or session creation the better carrier for the transcript seed? Creation instructions are simplest. A post-attach `session.instructions.append` keeps the actor brief byte-identical, which keeps `actorDigest` stable in provenance.

## Files expected to change

- `app/simulator/live-connection.ts`: reconnecting and paused states, a shared `negotiate()`, `resume()`, `/pause` reporting, poll backoff.
- `app/simulator/use-simulator.ts`: the `reconnecting` and `paused` phases, plus resume and end-from-paused actions.
- `app/interview/screens.tsx`, `app/interview/interview.css`, `app/storybook/interview-stories.tsx`: the paused and reconnecting UI.
- `app/server/simulator/session.ts`: `pause()`, the `/pause` and `/resume` routes, the `/ready` resume variant, the epoch guard, the time offset, the checkpoint, lease `pendingClose`, `checkLifetime` and `alarm` changes.
- `app/server/simulator/api.ts`: route wiring, schemas, the rate limit for `/resume`.
- `app/server/simulator/live.server.ts`: `liveConfiguration` accepts an optional seeded transcript.
- `app/server/simulator/interview-producer.ts` and `contextual-director.ts`: `pause()` and `resume()`, plus `elapsedMs()`.
- `ai/simulator/scenarios.server.ts`: `resumeInstruction()` and the transcript seed rendering.
- `core/simulator/types.ts`: the `paused` status and `snapshot.pause`.
- `app/server/simulator/archive.server.ts` and `app/server/interview/archive.server.ts`: the provenance `segments` and `pauses` fields.
- Tests: `session.test.ts`, `interview-producer.test.ts`, `live.test.ts`, and a new `scripts/interview-resume-acceptance.mjs`.
