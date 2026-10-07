# Interview engine: API design pitch

Written 2026-10-06, revised the same day to ground every seam in the host application's actual stack. Status: design for review. No refactor has started; the interview-quality experiments on `interview-quality` continue untouched.

The host app was inspected read-only at `a private host repository`. Paths cited as "the host app:" refer to that repo. Nothing there was modified and no secret values were read.

Companion to [interview-engine-extraction-plan.md](interview-engine-extraction-plan.md), which covers the current layout, and to [interview-engine-refactor-plan.md](interview-engine-refactor-plan.md), the file-level coding plan with phases, commit boundaries and acceptance gates. This document is about the seams: what each layer owns, what it must leave alone, the public contracts that cross between them, and the few decisions that need a call.

## 1. In one paragraph

The engine is a folder holding two independent components. **Conducting** runs a spoken interview and produces a transcript. **Reporting** turns a transcript plus an output template into a document, and works on imported transcripts with no live session, no storage and no alarms. Conducting takes an interview specification (topics, criteria, framing) and a per-interview context (who, which voice, anything already known), and needs five small things from its host: a key-value store for the hot session state, a durable one-shot alarm, a way to keep work alive past a request, somewhere to archive transcript rows, and a way to open an outbound WebSocket. Reporting needs only model credentials. On Cloudflare the five are the Durable Object's storage, alarm, `waitUntil`, D1 and the fetch upgrade. On the host app they are two Postgres tables in the existing database, a due-time column on one of them polled by the existing App Service process, a tracked promise set, and Bun's `WebSocket`. Cloudflare and the host app otherwise do not appear in the engine.

## 2. Layers and what each owns

Seven layers, each with one job. The test for each boundary is the deletion test: delete the layer and the complexity should reappear in several places, not vanish.

**Spec.** Declarative data describing one kind of interview: purpose, participant framing, interviewer persona and voices, topics with "explored" criteria, default threads, optional role branches, limits, and the output template. Owns every sentence that is about project closeouts rather than about interviewing. Leaves to others: anything with behaviour. A spec is a file in the consuming app, not in the engine. *Why here:* today that content is spread over six source files; moving it to one object is what makes a second subject a data change.

**Shared contracts.** Types both the browser and the server agree on: `Passage`, `InterviewSnapshot`, the wire protocol, and the spec types. Owns the vocabulary. Leaves to others: all I/O. *Why here:* the browser renders what the server computes; one definition of the snapshot stops the two drifting.

**Browser voice link (`client/`).** Microphone, WebRTC to the voice provider, level meters, the poll loop, pause and resume holds, heartbeat while paused, auto-mute when the server is ending, rejoin after reload. Owns media and connection health. Leaves to others: rendering, URL layout, user identity. *Why in the engine:* none of this is about this repo's UI, all of it is about the voice provider's behaviour and the session protocol, and the host app needs it unchanged.

**Server session (`conducting/session`).** The lifecycle of one attempt: capability, start, ready, poll, pause, resume, end, wake, drain. Owns time (limits, idle warnings, pause holds, resume caps), the transcript, checkpoints, when to archive, and when to call the conversation runtime. Leaves to others: how storage, alarms and archives are implemented, and who is allowed to start. *Why here and not in the host:* this logic is the hard part of running a voice interview reliably and it is identical on every host. Leaving it in the Durable Object would make the host app rewrite a thousand lines that already work.

**Conversation runtime (`conducting/conversation`, `conducting/*.prompt.ts`, `providers/`).** The producer loop: Sol's map, Jev's turn and coverage readings, Luna's research, thread ranking, and the private notes to the interviewer. Owns interview quality. Leaves to others: the voice transport, persistence, and lifecycle. *Why private:* a host never needs to drive Sol or Jev directly; it needs an interview to happen. Exposing the pieces would make the interface as large as the implementation.

**Reporting (`reporting/`).** Takes a transcript, an output template and optional enrichment (map, coverage, research facts), and streams a Markdown document. Owns the writing and the generic run-once-retry-once rule. Leaves to others: persistence and display. *Why a separate component:* the host application will have transcripts from elsewhere, and the document is the piece most likely to be re-run with a new template; it must not need a session to exist (section 7).

**Host.** Routes, user identity, rate limits, the four adapters, the report composition, and the UI. Owns the platform. Leaves to others: everything above.

## 3. Folder overview

The folder follows the host app's file conventions now (the host app: `AGENTS.md`, `docs/code-conventions.md`): no barrel `index.ts`, server-only files end in `.server.ts`, camelCase filenames, prompts in `*.prompt.ts`. That way the move into the host app is a copy, not a rename.

```
interview-engine/
  README.md  CONTEXT.md  adr/

  shared/                         types + zod, no I/O; imported by browser and server
    spec.ts                       InterviewSpec, TopicGroup, OutputTemplate, validateSpec
    transcript.ts                 Passage, Evidence
    snapshot.ts                   InterviewSnapshot (what the browser renders)
    protocol.ts                   start | ready | poll | pause | resume | end messages

  client/                         browser only; no React
    liveConnection.ts             WebRTC, polling, pause/resume, heartbeat, rejoin
    audioLevels.ts
    reportStream.ts               read a streamed document, poll for its final state
    react.ts                      optional thin hooks

  reporting/                      COMPONENT 2: transcript + template -> document. No session, no storage, no alarms.
    reporting.server.ts           public: summarizeInterview, evaluateInterview, ReportRun
    summarize.server.ts
    evaluate.server.ts            coverage + readings for any transcript
    reportRun.server.ts           one bounded run plus one retry, re-attachable stream (from app/server/simulator/report.ts)
    summary.prompt.ts  rubric.prompt.ts

  conducting/                     COMPONENT 1: live interview -> transcript. Imports reporting/ for the final coverage grade.
    conducting.server.ts          public: createInterviewSession, InterviewSession, protocol handler
    seams.server.ts               SessionStore (with wake), Background, Archive, ControlSocket
    adapters/memory.server.ts     in-memory adapters for tests and the reference host
    session/                      lifecycle state machine, mailbox, capability, checkpoint, time rules
    voice/                        GPT-Live create, attach, event translation
    conversation/                 producer, map, ranking, notes            (private)
    interviewer.prompt.ts  map.prompt.ts  ranking.prompt.ts  research.prompt.ts   (private)

  providers/                      shared by both components
    foundry.server.ts  structured.server.ts  judge.server.ts  diagnostics.server.ts
```

Public: `shared/*`, `client/*`, `reporting/reporting.server.ts`, `conducting/conducting.server.ts`, `conducting/seams.server.ts`, `conducting/adapters/memory.server.ts`. Everything else is private collaboration.

Dependency rule, enforced by a boundary check: `reporting/` imports `shared/` and `providers/` only. `conducting/` may import `reporting/`. Nothing imports `client/` from the server or vice versa. The engine imports `ai`, `@ai-sdk/azure`, `@ai-sdk/typesafe-ai` and `zod` and nothing else. The host app already has `ai` 6.x, `@ai-sdk/azure` and `zod` 4 (the host app: `package.json`); TypeSafe is the one new dependency.

In the host app the folder lands as `app/debrief/engine/`, because the host application is its only consumer and the host app keeps module code under `app/<module>` (the host app: `docs/architecture.md`, "Platform and module code"). If a second the host app module later wants interviews, lift it to `app/toolkit/`. Host glue lives beside it: `app/debrief/debrief.db.schema.ts`, `app/debrief/interviewHost.server.ts`, `app/debrief/*.route.tsx`, registered in `app/routes.ts` and `app/database/db.schema.ts`.

## 4. Diagrams

### 4.1 Dependencies (arrows point at what is imported)

```
 host (Cloudflare worker | host app)          host UI (React Router | The host app screens)
   │ implements seams, mounts protocol, owns identity      │ renders snapshot, drives LiveConnection
   │                                                        ▼
   ├──────────────────────────────┐                      client/
   ▼                              ▼                         │
 conducting/                   reporting/                   │
 (session, voice,              (summarize, evaluate,        │
  conversation)  ────────────▶  reportRun)                  │
   │        │                     │                         │
   │        └──────────┬──────────┘                         │
   ▼                   ▼                                    ▼
 seams.server.ts    providers/                           shared/
 (SessionStore,     (foundry, structured, judge)         (spec, transcript, snapshot, protocol)
  Background,
  Archive,
  ControlSocket)

 reporting/ never imports conducting/, seams, or anything with storage in it.
```

### 4.2 Runtime flow

```
 Browser                      Host routes            InterviewSession           Conversation runtime        Providers
 ────────                     ───────────            ────────────────           ────────────────────        ─────────
 LiveConnection.start ──SDP──► POST start ──────────► start(sdp, voice) ───────────────────────────────────► GPT-Live create (webrtc)
   ◄── SDP answer ────────────────────────────────────┘  attach control socket ◄─────────────────────────────┘
 audio ◄═══════════════ WebRTC ═══════════════════════════════════════════════════════════════════════════► GPT-Live
 POST ready ─────────────────► ready() ──► opening instruction ──────────────────────────────────────────► control socket
                                           transcript deltas ◄───────────────────────────────────────────── control socket
                                           settled passages ──► producer.onTranscript ──► Jev turn, Sol map, Luna ─► TypeSafe, Foundry
                                           private note ◄─────── pickThreads / notes ────────────────────► control socket (thinking.append)
 POST poll (1s) ─────────────► poll() ──► snapshot ◄── coverage, readings, background
   ◄── snapshot ──────────────┘
 [network drops]              POST pause ──────────► pause('browser') ──► checkpoint ──► SessionStore.save; SessionStore.wake(hold)
 POST resume ──SDP──────────► resume(sdp) ─────────► new GPT-Live session + resume instruction (transcript so far)
 POST end ───────────────────► end() ──► close voice; final evaluate (reporting/) ──► Archive.write(final)
 POST report ────────────────► host: ReportRunner(summarizeInterview(transcript, template, enrichment)) ──────────► Foundry (stream)
   ◄── Markdown stream ───────┘        host stores the document on its own record; the session is not involved
```

### 4.3 What crosses each seam

```
 IN                                    SEAM                         OUT
 ─────────────────────────────────     ───────────────────────      ───────────────────────────────────
 InterviewSpec, InterviewContext   ─►  createInterviewSession   ─►  InterviewSession
 SDP offer, voiceId, capability    ─►  session.start/resume     ─►  SDP answer, InterviewSnapshot
 Activity {active, audio, network} ─►  session.poll             ─►  InterviewSnapshot (transcript, coverage, readings, background, warning, pause)
 checkpoint, wake hint             ◄─► SessionStore             ─►  actor.wake() where the host has durable timers (Cloudflare)
 Promise                           ─►  Background
 InterviewArchiveRow               ─►  Archive
 url, headers                      ─►  ControlSocket            ─►  WebSocketLike
 FoundryConfig, typesafe key       ─►  Providers
 Passage[], OutputTemplate, enrichment? ─► summarizeInterview  ─►  { stream: ReadableStream<string>, result: Promise<ReportResult> }
 Passage[], InterviewSpec          ─►  evaluateInterview        ─►  InterviewEvaluation
 ReportRun factory, AbortSignal    ─►  ReportRunner.attach      ─►  Response (stream or stored text), ReportState
```

## 5. Public contracts

Illustrative, not exhaustive. Names follow the current code where it exists.

### 5.1 Shared

```ts
// shared/spec.ts
export type InterviewSpec = {
  id: string; version: string;
  purpose: string;
  participant: { role: string; setting: string };
  interviewer: {
    name: string; persona: string;
    voices: { id: string; voice: string; behavior: string }[];
    opening: string; orientation: string[]; boundaries: string[];
    vocabulary: Record<string, string>;            // 'client' -> 'the project customer'
  };
  topics: TopicGroup[];                             // { id, label, objectives: { id, label, criterion, hint }[] }
  defaultThreads: { id: string; label: string; rule: string }[];
  branches?: RoleBranch[];                          // { id, when, add: TopicGroup[], remove?: string[] }  (hypothesis, see §10)
  research?: { enabled: boolean };
  limits?: { durationSeconds: number; idleWarningMs: number; pauseHoldMs: number; maxResumes: number };
  summary: OutputTemplate;                          // { title, audience, sections: {heading, purpose, required}[], rules: string[] }
};

/** Per-interview input from the host. Everything here is optional except the id. */
export type InterviewContext = {
  sessionId: string;
  subject?: { id: string; label?: string };        // the host's user or record id, for archive attribution only
  known?: { kind: EntityKind; name: string; note?: string }[];   // facts the host already has (project, client, role); become seed entities for Sol
  locale?: string;
};

// shared/transcript.ts
export type Speaker = 'participant' | 'interviewer';
export type Passage = { id: string; speaker: Speaker; text: string; startMs: number; endMs: number };
export type Evidence = { passageId: string; speaker: Speaker; text: string };

// shared/snapshot.ts
export type InterviewSnapshot = {
  id: string; specId: string; voiceId: string;
  status: 'connecting' | 'live' | 'paused' | 'ending' | 'ended' | 'interrupted';
  startedAt: number; limitSeconds: number; usageSeconds: number | null;
  warning: { kind: 'idle' | 'limit' | 'capacity'; endsAt: number } | null;
  pause: { reason: 'browser' | 'provider' | 'restart'; pausedAt: number; resumeBy: number; resumes: number; maxResumes: number } | null;
  transcript: Passage[];
  coverage: { objectiveId: string; level: 'not-yet' | 'touched' | 'explored' | 'set-aside'; evidence: Evidence | null }[];
  readings: Record<string, { value: number | null; evidence: Evidence | null }>;   // engagement, openness, specificity
  background: { facts: { text: string; url: string; title: string }[]; status: 'none' | 'pending' | 'delivered' | 'skipped' };
  summary: SummaryState;                            // { status: 'idle'|'running'|'completed'|'failed'|'unavailable'; starts; text?; failure? }
  message: string | null;                           // one line the UI may show, e.g. why the attempt ended
  revision: number;
};

// shared/protocol.ts  (HTTP, JSON, Bearer <capability> on every call)
export type ProtocolAction = 'start' | 'ready' | 'poll' | 'pause' | 'resume' | 'end' | 'report';
export const startBody  = z.object({ id: uuid, voiceId: z.string(), sdp: audioOnlyOffer });
export const resumeBody = z.object({ sdp: audioOnlyOffer });
export const activityBody = z.object({ active: z.boolean(), audio: z.boolean(), outputQuietMs, sequence, network: networkSample.optional() });
// responses: start/resume -> { sdp, snapshot }; ready/poll/pause/end -> snapshot; report -> text/plain stream
```

### 5.2 Browser

```ts
// client/live-connection.ts
export type ProtocolTransport = {
  request(action: ProtocolAction, body?: unknown, options?: { timeoutMs?: number; keepalive?: boolean }): Promise<unknown>;
};
export type Callbacks = {
  snapshot(value: InterviewSnapshot): void;
  levels(value: AudioLevels): void;
  link(value: Link): void;                          // { state: 'stable'|'reconnecting'|'paused'|'resuming', reach: 'answered'|'unanswered'|'offline' }
  error(message: string, fatal?: boolean): void;
};
export class LiveConnection {
  constructor(transport: ProtocolTransport, callbacks: Callbacks, attempt?: Attempt);   // Attempt = { id, capability } to rejoin after reload
  readonly attempt: Attempt;
  start(voiceId: string): Promise<void>;
  resume(): Promise<void>;
  pause(): Promise<void>;
  end(): Promise<void>;
  setMuted(muted: boolean): void;
  dispose(): void;
}

// client/report-stream.ts
export function readSummary(transport: ProtocolTransport, onText: (markdown: string) => void, signal?: AbortSignal): Promise<SummaryState>;
```

The React hooks in `client/react.ts` are thin wrappers over these and are optional.

### 5.3 Server

Two entry files, one per component.

```ts
// conducting/conducting.server.ts
export function createInterviewSession(spec: InterviewSpec, context: InterviewContext, providers: Providers, seams: Seams): InterviewSession;

// Public: the serialized actor (full contract in 8.4). Hosts hold one per owned attempt and call handle / wake / close.
export class SessionActor { static restore(spec, context, providers, seams): Promise<SessionActor>; handle(command: Command): Promise<Reply>; wake(): Promise<void>; close(reason: 'connection' | 'drain' | 'fenced'): Promise<void>; idle(): boolean; snapshot(): InterviewSnapshot; transcript(): Passage[]; }

// Reached only through the actor's mailbox; listed so the lifecycle is visible.
class InterviewSession {
  restore(): Promise<void>;                                             // load checkpoint; the actor calls it once before anything else
  start(input: { voiceId: string; sdp: string; capability: string }): Promise<{ sdp: string; snapshot: InterviewSnapshot }>;
  ready(): Promise<InterviewSnapshot>;
  poll(activity: Activity): InterviewSnapshot;
  pause(reason: 'browser' | 'provider' | 'restart'): Promise<InterviewSnapshot>;
  resume(input: { sdp: string }): Promise<{ sdp: string; snapshot: InterviewSnapshot }>;
  end(): Promise<InterviewSnapshot>;                                    // closes voice, final coverage grade, final archive row
  wake(): Promise<void>;                                                // the host's durable wake fired (see 8.2)
  authorize(capability: string): boolean;                               // constant-time compare against the hash in the checkpoint
  snapshot(): InterviewSnapshot;
  transcript(): Passage[];                                              // the primary output; stable once status is 'ended'
}
// There is no summary() here any more. See 7.2.

// reporting/reporting.server.ts
export function summarizeInterview(input: ReportInput, providers: Providers, signal?: AbortSignal): ReportRun;
export function evaluateInterview(spec: InterviewSpec, transcript: Passage[], providers: Providers, signal?: AbortSignal): Promise<InterviewEvaluation>;

export type ReportInput = {
  transcript: Passage[];                           // required; from a session, an archive row, or an import
  template: OutputTemplate;                        // from spec.output or supplied on its own
  enrichment?: {                                   // all optional; improve grounding when present
    map?: ConversationMap; coverage?: Coverage; background?: Fact[]; known?: KnownFact[];
  };
};
export type ReportRun = {
  stream: ReadableStream<string>;                  // Markdown as it is written
  result: Promise<ReportResult>;                   // settles once, after the stream
};
export type ReportResult =
  | { document: { text: string }; failure: null; usage: Usage }
  | { document: null; failure: 'provider' | 'invalid' | 'cancelled' | 'timeout'; usage: Usage | null };

/** Host-side helper: one bounded run plus one explicit retry, with a re-attachable stream for a reloaded page. */
export class ReportRunner { constructor(start: (signal: AbortSignal) => ReportRun, deadlineMs?: number); attach(signal: AbortSignal): Response; state(): ReportState; }

// conducting/seams.server.ts
export type Providers = { foundry: FoundryConfig; typesafeKey: string; fetch?: typeof fetch };

export type SessionStore = {                       // bound by the host to one attempt (and on the host app to one segment, 8.6)
  load(): Promise<{ checkpoint?: Checkpoint }>;
  save(patch: { checkpoint?: Checkpoint | null }): Promise<void>;   // durable before return; throws FencedError if this writer was superseded
  wake(at: number | null): Promise<void>;                            // a hint: one pending durable wake where the host has timers; a no-op elsewhere
  clear(): Promise<void>;                                            // everything for this attempt
};
export type Background = { track(work: Promise<unknown>): void };                   // must outlive the current request
export type Archive = { write(row: InterviewArchiveRow): Promise<void> };            // upsert by row.id; best effort
export type ControlSocket = { connect(url: string, headers: Record<string, string>): Promise<WebSocketLike> };
export type Seams = { store: SessionStore; background: Background; archive: Archive; socket: ControlSocket };

export type InterviewArchiveRow = {
  id: string; specId: string; specVersion: string; subject: InterviewContext['subject'];
  state: 'partial' | 'final'; capturedAt: number;
  transcript: Passage[]; snapshot: InterviewSnapshot; map: ConversationMap | null;
  producerLog: ProducerLogRecord[];                // Sol/Jev/Luna calls with timings; trimmed to fit the adapter's byte budget
  provenance: { producer: string; map: string; rubric: string; ranking: string };   // prompt versions
};
```

Changes from the first draft, and why: `Alarm` and `Clock` are gone. The alarm is now `SessionStore.wake`, because on both real hosts the durable wake lives in the same place as the checkpoint (Durable Object storage holds both `setAlarm` and the keys; on the host app both are columns of one row). The browser's secret is now called the *capability* and lives hashed in the checkpoint; the word *ownership* is the host's (8.4), and `SessionStore.save` can fail with `FencedError` so a superseded writer stops. `Clock` goes because replay tools can fake time without a seam. `summary()` leaves the session because report generation is the second component and the host composes it (7.2). The archive row drops the `summary` state because the document is the host's to store.

### 5.4 Private collaboration (not part of the contract)

`InterviewProducer` and its `services` record (`generateMap`, `evaluateTurn`, `evaluateTraits`, `lookupInterviewBackground`), the map types and `applyMapUpdate`, `pickThreads`, the note templates, the prompt builders, `requestSol`, the GPT-Live event schemas. The session owns one producer and is its only caller. These stay exported from their modules for the replay and probe scripts, but they are not in `conducting.server.ts` or `reporting.server.ts` and carry no compatibility promise.

## 6. Cross-cutting contracts

**Authentication and authorization.** Two layers, deliberately. The host owns identity: who the user is, whether they may start an interview, rate limits, and the `subject` placed in the context. The engine owns the per-session capability: a 64-hex token the browser generates, sends on `start`, and presents as a Bearer on every later call. The actor compares it against the hash in the checkpoint, so a guessed session id is useless without the token and a reload can rejoin with the token kept in session storage. The host checks identity before routing to a session and lets the session check the capability. The engine never sees cookies or the host's auth. *Why both:* today the capability is the only thing protecting the session id, and it keeps working on a host with weak or no login.

**One writer per interview.** The engine requires that at most one process writes an attempt's state at a time and gets that from the host (8.4): Durable Objects supply it from the runtime; the host app scopes ownership to the browser's WebSocket and guards every write with a segment number, so a superseded writer fails, closes its voice session and stops. Instance count and sticky routing are not part of the guarantee. Recovery differs by host and is documented policy, not a capability: Cloudflare restores and waits on its own; on the host app the browser reconnects from the persisted transcript.

**Cancellation.** Every provider call takes an `AbortSignal` and has a timeout. `end()` aborts in-flight grading and producer work and tells the voice provider to close. `ReportRunner.attach(signal)` ties the stream to the caller's request; cancelling the request does not cancel the generation, which continues and is re-attachable, up to two starts and a two-minute deadline. In the browser, `dispose()` releases media and stops timers; `end()` is sent with `keepalive` so a closing tab still ends the attempt.

**Reconnection.** The browser pauses after fifteen seconds of WebRTC `disconnected` or ten seconds of failed polls, and heartbeats every five seconds while paused. The server holds a paused attempt for the spec's `pauseHoldMs` (fifteen minutes today) and up to `maxResumes` (five) resumes, because each resume is a new paid voice session. Within sixty seconds the browser resumes on its own; after that the user chooses. A resume sends a fresh SDP, the server opens a new provider session with a rebuilt "conversation so far" instruction, and the transcript clock stays monotonic through a per-segment offset. After a page reload, `Attempt {id, capability}` from session storage rejoins. All of this is inside `client/` and `server/session`; the host does nothing.

**Error handling.** Three kinds, each with one owner. Protocol errors are HTTP statuses the browser already interprets: 400 invalid input, 401/403 bad capability, 404/410 session gone, 429 rate limited, 503 feature unavailable; the engine returns typed errors and the host maps them to statuses, with a default mapping provided. Model failures inside the conversation runtime never surface to the browser: a failed Sol call leaves the map as it was, a failed Jev reading leaves coverage stale, a failed lookup is skipped, and each is recorded in the producer log with `callFailure` diagnostics. Report failures are state, not exceptions: `ReportResult.failure` is `provider | invalid | cancelled | timeout` and the browser offers retry while `starts < 2`.

**Data privacy.** The engine enumerates what leaves the box and the host decides retention. What leaves: transcript audio and text to the voice provider; settled transcript text to Foundry (Sol, summary) and TypeSafe (Jev), all with `store: false` where the provider supports it; for research, only `{kind, name, clue}` where the name and clue must appear in the participant's own words, to a web search tool. The interviewer's brief and private notes never reach the browser: there is no data channel, and a bundle check fails the build if brief text appears in client output. The capability token is never logged or archived. Archive rows carry the `subject` the host supplied and nothing else about the user, and deletion is by session id. This repo is public and must never hold real interview data; the archive adapter here writes to D1 only, and fixtures are synthetic. On the host app the archive sits in the same Postgres as employee data, behind the same Entra login and the existing read-only role, which is the retention and access story the host app already has.

## 7. Two independent components

### 7.1 What each one is

| | Conducting | Reporting |
|---|---|---|
| Job | Run a spoken interview with a participant | Write a document from a transcript |
| Primary input | `InterviewSpec` + `InterviewContext` + a browser with a microphone | `Passage[]` + `OutputTemplate` |
| Primary output | `Passage[]` transcript, plus the snapshot history and a conversation map | Markdown document, streamed, plus a settled result |
| Optional inputs | `known` facts to seed the map | map, coverage, research facts, known facts |
| Needs from the host | SessionStore (with wake), Background, Archive, ControlSocket, identity, routes | Model credentials only |
| Time | Minutes to an hour, stateful, resumable | Under two minutes, stateless, one call |
| Can run without the other | Yes: a transcript is a complete, useful output on its own | Yes: works on any transcript, including imports |

Reporting has no persistence, no timers and no knowledge of sessions. Its inputs are plain data. That is a hard rule enforced by the import graph, not a convention: `reporting/` imports `shared/` and `providers/` only. Conducting imports reporting for one thing, the final coverage grade at `end()`, which is a pure function of the transcript.

### 7.2 Where `session.summary` goes: host composition

Today `startReport` in `app/server/simulator/session.ts` does five things in one method: builds a `SessionReport` (retry count, two-minute deadline, request abort, re-attach), calls `summarizeInterview` with the session's transcript, writes summary status into the snapshot the browser polls, records provenance for the archive, and chains a final archive write after the session's own final write. Only the first of those is generic. The other four are glue between the session's storage and the document, and they are exactly what the host application will do differently: the host application has its own tables, its own idea of where a report is displayed, and transcripts that never had a session.

So the session loses `summary()`. The engine keeps the generic part as `ReportRunner` in `reporting/`, because both hosts need "one run, one retry, deadline, re-attach for a reloaded page" and it is easy to get wrong. The host composes:

```ts
// the host app host sketch, app/debrief/reportHost.server.ts
const row = await db.query.interviews.findFirst({ where: eq(interviews.id, id) });   // transcript from Conducting's archive, or imported
const runner = runners.get(id) ?? new ReportRunner(signal => summarizeInterview({ transcript: row.transcript, template: closeoutSpec.output, enrichment: { map: row.map } }, providers, signal));
runner.result.then(result => db.update(interviews).set({ report: result.document?.text ?? null, reportFailure: result.failure, reportedAt: now() }));
return runner.attach(request.signal);
```

Report status leaves `InterviewSnapshot`. The browser's `reportStream.ts` reads it from the host's report route instead, which is where a reloaded page would ask anyway. This is the one place the host writes more code than before, about thirty lines, in exchange for the reporting component having zero coupling to sessions.

### 7.3 Imported transcripts

An import is `Passage[]` with `participant | interviewer` speakers and millisecond offsets. A recording transcribed elsewhere, a Teams transcript, or a copied chat log all fit once mapped. `evaluateInterview` grades coverage against a spec's topics for the same input, so the host application can report "topics not covered" on an import too. Nothing in either call knows whether a live session ever existed.

## 8. Persistence, wakes and ownership

### 8.1 SessionStore versus Archive

They look alike (both store the interview) and are not.

| | SessionStore | Archive |
|---|---|---|
| Responsibility | Let a replacement process pick up where this one died | Keep what happened, for people and later tooling |
| Written | On every state change: start, each pause and resume, end, and every 30 s while live (checkpoint) | Every 30 s while live (partial) and once at end (final); upsert by attempt id |
| Read | Once, by `restore()` on the next owner; never by the browser | By humans, replays, probes, analysis; never by the engine |
| Size | Checkpoint = snapshot + producer state including the capability hash and provider id, tens to hundreds of KB | One row per attempt, up to 2 MB today (`ROW_BYTES` in `app/server/interview/archive.server.ts`) |
| Lifetime | The attempt plus five minutes, then `clear()` | Retention policy, owned by the host |
| Consistency | Must be read-your-writes within the owning process; a lost write means a leaked paid voice session or an unfinished attempt | Best effort; today a failed write logs a warning and is never retried ("never delay closure") |
| Recovery guarantee | The checkpoint (with the provider id) always survives, so orphan provider sessions can be closed by a new owner and a paused attempt can be resumed or finished with what was captured (so a paused attempt can be resumed or finished with what was captured) | None. It is the record, not the recovery |

Same physical database? **Yes, on the host app.** Both become tables in the existing Azure Database for PostgreSQL flexible server (the host app: `infra/modules/postgres.bicep`, database `nri_spark`, PG 17, dev SKU `Standard_B2s` per `infra/parameters.dev.bicepparam`). Cloudflare keeps them physically apart only because Durable Object storage and D1 are different products.

Do two interfaces earn their complexity? **Yes, for three reasons that survive the deletion test.** First, the recovery contract differs: an adapter author must know that `SessionStore.save` has to be durable before it returns and `Archive.write` may be fire-and-forget. One interface would need that written in comments per method. Second, the Archive is optional: the reference host and tests pass a no-op, and a privacy-sensitive deployment could keep sessions resumable without keeping transcripts. Third, the engine never reads the archive, so its shape is free to be whatever analysis wants (today one wide upserted row) while the SessionStore shape is dictated by `restore()`. Merging them would make the Cloudflare adapter one object over two backends and would give the host app nothing, since Drizzle makes a second table one more schema export.

What does change: `SessionStore` shrinks to four typed methods (`load`, `save`, `wake`, `clear`) instead of a generic key-value `get<T>/put<T>`, and it absorbs the alarm (8.3).

### 8.2 What the alarm wakes up for today

Every `setAlarm` in `app/server/simulator/session.ts`, with what the single `alarm()` handler (line 984) then does:

| Set at | When | Delay | What the wake does |
|---|---|---|---|
| L140 | `/end` arrived before `/start` (browser cancelled during creation) | 60 s | Lease is closed → `storage.deleteAll()` |
| L253 | `start()` succeeded | 30 s | First lifetime check; re-arm |
| L577 | `pause()` wrote its checkpoint | 30 s | If the browser never resumes: `checkLifetime` ends the attempt at `resumeBy`; otherwise re-arm |
| L849 | `end()`; checkpoint deleted | 300 s if every provider close was confirmed, else 15 s | Confirmed: `deleteAll`. Unconfirmed: `closeOrphan` retries the provider close |
| L911 | Restart recovery found a live checkpoint; segments marked `unconfirmed`, attempt put on `restart` hold | 1 s | `retryClosures` closes the provider sessions the dead process was attached to ("still billing") |
| L951 | `recoverLease` closed every orphan | 300 s | `deleteAll` |
| L997 | Inside `alarm()` while the attempt is live, connecting or paused | 30 s | Re-arm. While live: `saveCheckpoint` and a partial `saveArchive`. Always: `checkLifetime`, then `retryClosures` |

So the alarm does six jobs, none of which is "run the interview":

1. **Close orphaned paid voice sessions** after the process that held their control socket died (L911, L849 unconfirmed path, `retryClosures`).
2. **End a paused attempt whose browser never came back** at the fifteen-minute hold deadline, so it is graded and archived (L577 → `checkLifetime`).
3. **Finish an interrupted attempt from its checkpoint** when too little time remained to resume (`recovered` → `recoverCheckpoint` → `end(true)`).
4. **Enforce idle and limit rules when the browser stopped polling** and the in-process tick is gone (`checkLifetime` from the alarm).
5. **Checkpoint and partially archive every 30 s** while live, as a safety net under the tick (L997).
6. **Garbage-collect storage** five minutes after closure (L140, L849, L951).

The interview itself runs on an **in-process timer**: `setInterval(tick, 500)` at L261, which does `checkLifetime`, the producer's cadence, grading and the ending watch. The alarm is a 30-second backstop under that timer that also survives the process.

### 8.3 Could the interview work without a durable alarm?

**The live conversation: yes.** While the process lives, `tick` handles everything the alarm checks, more often. A host with no alarm at all would conduct interviews correctly in the happy path.

**What would be lost is everything that happens when both the browser and the process are gone**, or when the browser is gone and the process restarted:

| Without a durable wake | Consequence |
|---|---|
| Orphan provider sessions never closed after a restart | Each keeps billing until GPT-Live's own session limit (an hour) |
| Paused attempt whose browser never returns | Never ended, never graded, never finally archived; its row and checkpoint sit forever |
| Interrupted attempt near its limit | Transcript captured but never graded or written as final until someone happens to request it |
| Finished attempt | Storage never cleaned |

An **in-process timer** (`setTimeout`/`setInterval`) is lost with the process. **Durable scheduling** means the due time is persisted somewhere a *different* process can see after a restart. Cloudflare has it in the alarm. The question for the host app is whether to build it or to do without.

**Recommendation for the host app: do without, and make every wake job lazy.** the host app has no queue, no cron and no background worker today (checked: `infra/main.bicep` deploys Log Analytics, Application Insights, Postgres, Key Vault, App Service plan and App Service and nothing else; `tasks/*.ts` are hand-run CLI scripts that the deploy workflow ignores via `paths-ignore: tasks/**`; no `setInterval`, `cron` or queue client under `app/`). An earlier revision proposed a `wake_at` column swept by every instance every ten seconds; it worked, but it also needed ownership of the attempt it woke, which is where the lease machinery came from. Instead, each row of the table above has a lazy equivalent that needs no process to be running:

| Alarm job on Cloudflare | On the host app |
|---|---|
| Close an orphaned provider session | The browser closes its peer connection before it resumes; the next owner closes the recorded provider id on `restore`. After a hard crash with no return, the provider's own session limit ends it; a `tasks/` sweep over stale `live` rows is available if that cost shows up. |
| End a paused attempt whose browser never returns | The hold is checked on `restore` and on `resume`; an expired attempt is refused and finalized the moment anyone touches it, including the host application page listing it. Meanwhile it costs nothing: no voice session, no process, one row. |
| Finalize an interrupted attempt | Same: the next touch finalizes it. Grading is reporting's job and runs when a report is requested (7), so nothing is lost by waiting. |
| Periodic checkpoint and partial archive | Still runs from the live `tick` while a process holds the attempt, which is the only time there is anything new to write. |
| Storage GC | Host policy; a `tasks/` script or nothing, since ended rows are the archive. |

The requirement this places on the engine is stated in 8.4: **every wake job is idempotent and also runs on `restore` and on the first command after it.** Written that way, the alarm on Cloudflare is an optimization that makes tidy-up prompt, and the host app's lack of one is a documented difference in promptness, not in correctness.

### 8.4 Who runs the session: the minimum the interview needs

The previous revision of this section answered "one process owns the session" with a lease runtime: epochs with a TTL, renewals, self-fencing, forwarding between App Service instances, a release-and-retry transfer and a sweep. Reviewing it against what the interview actually needs showed that most of that machinery recreates Durable Objects over Postgres. This revision keeps the Durable Object behaviour where the runtime gives it for free and gives the host app the smallest mechanism that is still sound.

Two tokens, two names, unchanged: the browser's **capability** (minted at `start`, hashed in the checkpoint, checked inside the actor) says *this browser may drive this attempt*; the host's **ownership** says *this process may write this attempt right now*. The browser never sees ownership; the engine meets it only as a `FencedError`.

#### Essential, on every host

| | Guarantee | What breaks without it |
|---|---|---|
| E1 | **One writer.** At most one process writes an attempt's persisted state at a time. A superseded writer's write fails, and on that failure it stops driving the voice provider. | Two processes conducting one interview: a forked or overwritten transcript, two billed voice sessions. |
| E2 | **Serialized inside the writer.** Commands, provider messages, the 500 ms tick, a wake and background completions are applied one at a time through a mailbox. | Interleaving at `await`s, as today's Durable Object allows: a `pause` racing a `resume`. |
| E3 | **Successor safety.** Events and closures from a superseded provider session never act on its successor. | A late `session.closed` from the old voice session pausing the new one. Exists today as segment binding in `session.ts`. |
| E4 | **Durable before acknowledged.** `save` returns only once the checkpoint is durable, and the transcript a participant resumes from is the last acknowledged one. | Recovery becomes reconstruction. |
| E5 | **Capability check in the actor.** | A guessed attempt id drives someone else's interview. |

#### Optional: availability and recovery

| | Behaviour | Cloudflare | The host app |
|---|---|---|---|
| O1 | Continuity across process death without the browser doing anything | Yes: the Durable Object restores and waits, paused, for the hold | No: the browser reconnects; its client does this automatically once |
| O2 | Timers that run with no browser and no process: hold expiry, orphan-close retries, finalizing interrupted attempts, GC | Yes: durable alarm | No: each job runs on the next touch, or by host policy |
| O3 | Re-attaching the same voice session after a move | No (unverified provider capability) | No |

The engine code is identical on both hosts. The only adapter-level difference is that the host app's `SessionStore.wake` does nothing. For that to be correct the engine carries one requirement: **every wake job is idempotent and also performed on the next `restore` plus first command.** Hold expired means `resume` is refused and the attempt finalized; an interrupted attempt within its hold is offered for resume and otherwise finalized; the orphaned provider id recorded in the checkpoint is closed once by the next owner; GC is the host's. "Finalize" writes the final archive row; coverage grading belongs to reporting and runs when a report is requested (7), so no background compute is needed to end an attempt. These differences are documented host policy, not capability flags: there is nothing for the engine to branch on.

#### The shared contract

```ts
// conducting/conducting.server.ts
export class SessionActor {                       // one per owned attempt, in the owner's process; every entry point is enqueued
  static restore(spec: InterviewSpec, context: InterviewContext, providers: Providers, seams: Seams): Promise<SessionActor>;
  handle(command: Command): Promise<Reply>;       // start / ready / poll / pause / resume / end; capability checked here
  wake(): Promise<void>;                          // hosts with durable timers call it; others never do
  close(reason: 'connection' | 'drain' | 'fenced'): Promise<void>;
  //   connection: the browser's link closed → pause('browser'): close voice, checkpoint, keep the attempt resumable
  //   drain:      process is stopping → same, then tell the browser to resume elsewhere
  //   fenced:     a write was rejected → close the voice socket, stop the tick, discard pending results, write nothing
  idle(): boolean; snapshot(): InterviewSnapshot; transcript(): Passage[];
}
export class FencedError extends Error {}

// conducting/seams.server.ts
export type SessionStore = {                        // bound by the host to one attempt and, where the host needs it, one segment
  load(): Promise<{ checkpoint?: Checkpoint }>;
  save(patch: { checkpoint?: Checkpoint | null }): Promise<void>;   // durable before return; throws FencedError if superseded
  wake(at: number | null): Promise<void>;                            // a hint; a host without timers may ignore it
  clear(): Promise<void>;
};
// Background, Archive, ControlSocket unchanged (5.3).
```

There is no shared `SessionHost` type. What hosts have in common is a sentence, not an interface: *construct one actor per attempt you own, feed it commands, call `wake` if you have timers, call `close` when the connection or the process ends.* How a host decides it owns an attempt is its own business, and the two real hosts decide very differently.

### 8.5 Cloudflare host: keep what the runtime gives

Unchanged from the current code in shape, thinner in size. `env.INTERVIEW.idFromName(id)` is the identity and the router; the runtime constructs one object per id and delivers events to it one at a time; `ctx.storage` holds the checkpoint; `setAlarm` is the durable wake; the constructor restores under `blockConcurrencyWhile`. The Durable Object keeps everything in 8.2: it waits out a pause with no browser, enforces the hold and the limits, retries orphan closes, finalizes interrupted attempts and cleans storage. `FencedError` is unreachable here and the code path still exists, because the actor is the same code. The mailbox is still worth having: the input gate blocks new events only during storage operations, not during provider or model calls.

```ts
// app/server/interview/durable-object.ts (about a hundred lines)
export class InterviewObject extends DurableObject<Env> {
  private actor!: Promise<SessionActor>;
  constructor(ctx, env) { super(ctx, env); ctx.blockConcurrencyWhile(async () => { this.actor = SessionActor.restore(...wire(ctx, env)); await this.actor; }); }
  fetch(request) { return route(request, command => this.actor.then(a => a.handle(command))); }   // HTTP poll protocol, as today
  alarm() { return this.actor.then(a => a.wake()); }
}
```

### 8.6 the host app host: the connection is the owner

**Ownership is scoped to a connection.** On the host app the live segment of an attempt is owned by the process holding the browser's WebSocket for it. The actor is created when a `start` or `resume` arrives over that socket and closed when the socket closes. There is no registry to consult across instances and no routing problem: a TCP connection is pinned to one process by nature, so every command for a live segment reaches the actor that holds its voice socket. Hono exposes `upgradeWebSocket` through `react-router-hono-server/bun` when `useWebSocket: true` is set (`node_modules/react-router-hono-server/dist/helpers-BRZLziEZ.d.ts`), in the same `configure` hook `app/server.ts` already uses for the chat timeout and the forwarded-proto fix.

This changes the browser transport for the host app. `shared/protocol.ts` already defines the command and snapshot messages; it gains a socket framing of the same messages, and `client/liveConnection.ts` takes either `pollTransport` (Cloudflare, as today) or `socketTransport` (the host app). Snapshots are pushed on change instead of polled every second. Two transports of about sixty lines each is the price of letting the hosts differ; the messages, the state machine and the UI do not change.

**The minimal mechanism that is still required: a segment guard.** Connection scoping alone does not give E1. During a rolling deploy, or when a process is frozen or half-partitioned, the browser's socket can be gone from the browser's side while the old process has not noticed yet. The browser resumes on another instance, which starts a new voice session; the old actor, when its old voice session finally closes, would write a stale checkpoint over the new one. One integer stops that.

```ts
// app/debrief/debrief.db.schema.ts  (new; one table serves both SessionStore and Archive on the host app)
export const interviewAttempts = debrief.table("interview_attempts", {
  id: text().primaryKey(),
  userId: text("user_id").references(() => usersTable.id).notNull(),
  specId: text("spec_id").notNull(),
  status: text().$type<'live' | 'paused' | 'ended'>().notNull(),
  segment: integer().default(0).notNull(),                           // bumped by start and resume; every write is conditional on it
  checkpoint: jsonbColumn("checkpoint").$type<Checkpoint>(),         // capability hash and provider session id live inside
  archive: jsonbColumn("archive").$type<InterviewArchiveRow>(),      // Archive.write upserts here; 'partial' while live, 'final' at the end
  document: text(),                                                  // the report, written by the host's report route (7.2)
  startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true, mode: "string" }),
});
```

```sql
-- start (after INSERT ... ON CONFLICT DO NOTHING) and resume: take the next segment, read what to resume from
UPDATE debrief.interview_attempts SET segment = segment + 1, status = 'live', updated_at = now()
 WHERE id = $id RETURNING segment, checkpoint;

-- every later write by that actor (checkpoint, archive, status): 0 rows → FencedError
UPDATE debrief.interview_attempts SET checkpoint = $cp, archive = coalesce($archive, archive), status = $status, updated_at = now()
 WHERE id = $id AND segment = $segment;
```

Two statements, both autocommit, no TTL, no renewal, no sweep, no forwarding. A superseded actor learns it is superseded at its next write, closes its voice socket (`closeProvider`, existing) and dies. On Cloudflare the same store adapter ignores `segment` because the runtime already guarantees one writer.

**What happens to the voice provider.** Three things, none of them a retry loop. The owner closes its own voice session whenever its browser socket closes, on drain, and on `FencedError`. The browser closes its old WebRTC peer connection before it resumes, so the old voice session loses its audio transport. The new owner, on `resume`, closes the provider id it finds in the checkpoint once, best effort, before creating the new one. What can remain after a hard crash is one voice session with no audio peer and no controller, bounded by the provider's own session lifetime. It is not verified whether GPT-Live ends a session when its WebRTC transport drops; if it does not, the worst case after a crash is one orphan billed until the provider's limit, and a `tasks/` script sweeping provider ids of attempts whose `status = 'live'` and `updated_at` is stale is the remedy. Liveness is derived, not tracked: while live, the periodic checkpoint bumps `updated_at`, so `status = 'live' AND updated_at < now() - interval '60 seconds'` means "the process that ran this is gone".

**Shutdown and rolling deploys.** `app/server.ts` has no termination hook today. New: on `SIGTERM`, call `close('drain')` on every local actor, which closes the voice session, checkpoints and closes the browser socket with a code meaning *resume now*, then exit. App Service's default stop grace for Linux containers is short; set `WEBSITES_CONTAINER_STOP_TIME_LIMIT` to `30` in `appService.bicep` `appSettings` so three or four drains finish. This setting is optional for correctness: if the drain is cut short, the segment guard and the browser's reconnect still hold E1, and the cost is one orphan voice session.

**What the participant sees** on a deploy or a crash: the socket closes, the client shows its existing "reconnecting" state, closes its peer connection, opens a new socket to whichever instance answers and sends `resume` with a fresh SDP. Sam picks up with the rebuilt conversation after a gap of a few seconds, and the resume count goes up by one. If the client cannot reconnect, the page shows a Resume button backed by the persisted transcript, exactly like coming back from a tunnel today. This is explicit reconnection from persisted state, not server-side migration, and the user-visible difference from Cloudflare is that Cloudflare would have waited silently while the host app reconnects out loud.

**Scaling to two instances** changes nothing above. Sticky routing is not used and not needed.

### 8.7 Diagram

```
 browser ── capability ──► host route ── identity ──► one actor per owned attempt
                                                              │
               ┌──────────────────────────────────────────────┴──────────────────────────────┐
   Cloudflare (HTTP poll)                                              the host app (one WebSocket per live segment)
   env.INTERVIEW.idFromName(id).fetch                                  upgradeWebSocket → actor lives while the socket lives
   runtime: one object per id, events one at a time                    socket close → actor.close('connection') → pause, voice closed
     InterviewObject                                                   SIGTERM     → actor.close('drain')      → pause, "resume now"
       └─ SessionActor ─ mailbox                                         SessionActor ─ mailbox
            ├─ voice control socket (attach by id)                         ├─ voice control socket (attach by id)
            ├─ 500 ms tick                                                 ├─ 500 ms tick
            ├─ SessionStore(ctx.storage; wake = setAlarm)                  ├─ SessionStore(row WHERE segment = mine) ── 0 rows ──► close('fenced')
            └─ Background(waitUntil)                                       └─ wake(): no-op; wake jobs run on next touch

   browser client: on socket close or 15 s of WebRTC 'disconnected' → close peer → resume once with a fresh SDP → else show Resume
```

### 8.8 Walkthroughs

**Start.** The browser mints an id and a capability. The host app: it opens the WebSocket (`requireAuth` runs on the upgrade), sends `start` with its SDP; the route inserts the row, takes segment 1, restores an actor with an empty checkpoint, and the actor creates the voice session, attaches the control socket, hashes the capability into the first checkpoint and `save`s with segment 1. Cloudflare: the same from `restore` onward, over HTTP, with the Durable Object constructor in place of the segment update.

**Competing request (deploy overlap).** A new container is warming up while the old one still runs. The old process gets `SIGTERM` and drains: each actor closes its voice session, checkpoints with its segment, and closes the browser socket with *resume now*. The browser reconnects, lands on the new container, sends `resume`; the row goes to segment 2 and the new actor starts a new voice session. Suppose the drain was cut short and one old actor is still alive with its voice socket open: its next checkpoint says `WHERE segment = 1`, updates nothing, raises `FencedError`, and the actor closes its voice session and dies. The transcript on the row is segment 2's. Nothing moved between processes; the browser moved.

**Ownership loss (frozen process).** The old process stalls for thirty seconds with the voice session open. The browser's socket pings fail, the client closes its peer connection and resumes on another instance: segment 2, old provider id closed once, new voice session. The old process wakes up and tries to write: fenced, voice socket closed, actor gone. If it had emitted a provider instruction in the second before noticing, that instruction went to a voice session that no longer has an audio peer and is being closed. The participant saw "reconnecting" for about ten seconds.

**Recovery (crash, no drain).** The process dies. The browser's socket closes immediately (the kernel resets it) and the client resumes elsewhere within a few seconds; the transcript is the last checkpoint, at most one checkpoint interval old. If the participant closed the tab instead, the row stays `status = 'live'` with a stale `updated_at` until someone touches it: the participant's Resume button within the hold, which runs the hold check and the orphan close on `restore`, or the host application page listing the attempt as interrupted and offering to finish it, which writes the final archive. On Cloudflare the same crash is invisible: the alarm would have finalized the attempt on its own.

### 8.9 Behavioural acceptance criteria

The host app's run against two Bun processes sharing one PGlite or Postgres, with a scripted provider; Cloudflare's run under `wrangler dev`.

1. **One writer.** Resume on process B while A's actor is still alive: A's next write raises `FencedError`, A sends `session.close` for its voice session, and the row's checkpoint is B's.
2. **Serialized.** Two `resume`s and twenty `poll`s sent concurrently to one actor are applied one at a time; the invariant checker inside the actor sees no overlapping mutation.
3. **Connection scoping.** Closing the browser socket pauses the attempt, closes its voice session and checkpoints within two seconds; the row is resumable on any instance.
4. **Drain.** `SIGTERM` with three live attempts leaves three paused rows and three closed voice sessions, and each client receives *resume now*; all three resume on the surviving process.
5. **Lazy wake jobs.** With `wake` a no-op, a `resume` after the hold is refused and the attempt finalized; a `restore` of a stale `live` checkpoint closes the recorded provider id exactly once.
6. **Transcript integrity.** After a crash mid-interview and a resume, the transcript contains every passage settled before the last checkpoint, in order, and nothing from the superseded segment after it.
7. **Capability.** A valid capability presented over a new socket resumes the attempt; a missing or wrong one is refused before any state changes.
8. **Cloudflare.** Criteria 2, 6 and 7 pass unchanged; the alarm paths in 8.2 keep their existing tests.

### 8.10 Engine versus host

| Belongs to the engine | Belongs to the host |
|---|---|
| `SessionActor`, its mailbox, the interview state machine | Identity: who may start, which `subject` and spec apply |
| What a checkpoint contains, when it is written, the capability hash, the provider id | Where the row lives and how one writer is guaranteed (runtime, or segment guard) |
| Wake jobs, each idempotent and also run on touch | Whether wakes fire at all (alarm, or never) |
| Provider close by id, segment binding, behaviour on `FencedError` | Process lifecycle: `SIGTERM` drain, stop grace, health checks |
| Both browser transports and the client's reconnect-once rule | Which transport is mounted, and on which route |
| The archive row shape | Archive storage, report composition, rate limits, secrets, GC policy |

### 8.11 What disappeared, and what remains

Gone from the previous revision: the `LeaseStore` port and the engine-shipped leased host runtime; epochs with a TTL, renewals and self-fencing; forwarding between instances by affinity cookie; the release-request and 409 transfer protocol with its minimum dwell; the `FOR UPDATE SKIP LOCKED` sweep and the `wake_at`, `owner_instance`, `lease_until` and `release_requested` columns; the optional `LISTEN`/`NOTIFY` fast path; the shared `SessionHost` type; eleven acceptance tests, replaced by eight smaller ones.

What remains for the host app: one table, one `segment` column, two conditional `UPDATE` statements, a `SIGTERM` drain, one WebSocket route, a second transport in the client, and one optional App Service setting. What Cloudflare keeps: everything it has today, minus about nine hundred lines that move into the engine.

## 9. Each layer three ways: general, Cloudflare today, Azure for the host app

"Existing" means a resource or file already in the host app. "New" means this design proposes adding it.

### 9.1 Spec

- **General.** Declarative data: topics, criteria, framing, voices, limits, output template. A file in the consuming app.
- **Cloudflare (this repo).** `interviews/project-closeout/spec.ts`, replacing the text spread over six files today.
- **The host app.** New: `app/debrief/specs/projectCloseout.spec.ts`. The host application's own; the engine never ships one.

### 9.2 Shared contracts and browser voice link

- **General.** Types both sides agree on; a browser class that owns media and connection health.
- **Cloudflare.** `shared/`, `client/` imported by the React Router screens under `app/interview/`.
- **The host app.** Same files, imported by the host application's `*.route.tsx` screens, with `socketTransport` instead of `pollTransport` (8.6): `shared/protocol.ts` frames the same command and snapshot messages over one WebSocket, and the client resumes once, automatically, when the socket closes. Existing: the host app's SSR shell (`app/layout`), React 19, Vite via React Router framework mode (the host app: `AGENTS.md` notes Vite overrides the parent CLAUDE.md rule). The microphone and WebRTC code needs `https`, which App Service provides (`httpsOnly: true`). One the host app-specific wrinkle: `app/server.ts` restores the `https:` scheme from `x-forwarded-proto` because Azure terminates TLS; the engine's same-origin check must read the restored URL, which it will since it sees the request after that middleware.

### 9.3 Conducting: the server session

- **General.** One `SessionActor` per owned attempt holding the transcript, time rules, checkpoints, archive cadence and the conversation runtime, with every entry point serialized through a mailbox. Requires `restore()` before the first command and a store that fails with `FencedError` when the writer was superseded (8.4).
- **Cloudflare.** `SimulatorSession` becomes a thin Durable Object: constructor restores the actor under `blockConcurrencyWhile` with adapters over `ctx.storage` and `env`; `fetch` routes to the protocol handler; `alarm()` calls `actor.wake()`. One writer comes from the runtime (8.5).
- **The host app.** New: `app/debrief/interviewSocket.server.ts`, an `upgradeWebSocket` handler that creates the actor on `start` or `resume`, holds it in a `Map<socket, SessionActor>` for the life of the socket, and calls `actor.close('connection')` when the socket closes. One writer comes from the connection plus the `segment` guard on every write (8.6). No instance count or routing assumption.

### 9.4 Conducting: the conversation runtime and voice

- **General.** The producer loop (Sol, Jev, Luna, ranking, notes) and the GPT-Live session. Private.
- **Cloudflare.** Unchanged behaviour, moved into `conducting/conversation` and `conducting/voice`.
- **The host app.** Unchanged code. Needs from the host app: a GPT-Live realtime deployment on the host's existing Foundry resource (existing account, managed outside Bicep per the header of `infra/main.bicep`; **new** model deployment), surfaced as a **new** app setting, e.g. `AZURE_OPENAI_LIVE_MODEL`, next to the existing `AZURE_OPENAI_AGENT_MODEL` and `AZURE_OPENAI_FAST_MODEL` in `infra/modules/appService.bicep`. TypeSafe's key is a **new** Key Vault secret and Key Vault reference in the same file, following the existing `LangfuseSecretKey` pattern. Observability: the host app traces AI SDK calls through the `telemetry` option and `app/common/instrumentation.ts` (existing: Langfuse and Application Insights); the engine's Foundry calls should accept an optional `telemetry` passthrough in `Providers` so Sol and Jev calls appear in Langfuse like every other agent.

### 9.5 Seam: SessionStore (with wake)

- **General.** `load / save / wake / clear` for one attempt. `save` durable before return and may throw `FencedError`. `wake(at)` is a hint: a host with durable timers replaces any pending wake and calls `actor.wake()` when it fires; a host without them ignores it, which is correct because every wake job also runs on the next touch (8.3).
- **Cloudflare.** `ctx.storage.get/put/delete/deleteAll` for `checkpoint`; `ctx.storage.setAlarm / deleteAlarm` for `wake`.
- **The host app.** One table `interview_attempts` in a new `pgSchema("debrief")`, following the convention the host's other modules use for their own schemas, serving both `SessionStore` and `Archive`: `status`, `segment`, `checkpoint`, `archive`, `document`, timestamps. `save` is one `UPDATE ... WHERE id = $id AND segment = $segment`; zero rows is `FencedError`. `wake` is a no-op (8.4 explains why that is correct). Adapter: `app/debrief/attemptStore.server.ts` over `getDb()` from `app/database/db.context.ts` (existing); `jsonbColumn` is the host app's existing helper (`app/database/jsonbColumn.ts`). Locally this runs on PGlite with no changes (existing: `DATABASE_URL=./.appData`).

### 9.6 Seam: Background

- **General.** Keep a promise alive past the request that started it.
- **Cloudflare.** `ctx.waitUntil`.
- **The host app.** A `Set<Promise>` per process with `unhandledrejection` logging; nothing else is needed because a Bun process does not cancel work when a response finishes. New, ten lines in the host file.

### 9.7 Seam: Archive

- **General.** Upsert one wide row per attempt; best effort.
- **Cloudflare.** D1 `interview_attempts` via `writeInterviewArchive` (`INSERT … ON CONFLICT(id) DO UPDATE`), 2 MB byte budget.
- **The host app.** New table `debrief.interview_archive` in the same schema file: `id` pk, `state`, `captured_at`, `transcript jsonb`, `snapshot jsonb`, `map jsonb`, `producer_log jsonb`, `provenance jsonb`. Postgres `jsonb` has no 2 MB ceiling, so the byte budget becomes a plain cap on `producer_log` length. Backups: existing, 7-day retention and auto-grow on the flexible server (`infra/modules/postgres.bicep`). Read access for analysis: existing read-only role `DATABASE_URL_RO` (the host app: `tasks/setupReadOnlyUser.ts`, `tasks/queryAppDB.ts`), so the host app SQL agent and ad-hoc queries can read archives with no new plumbing. The host application's own `interviews` table (the thing a user sees in a list, with the report text) is separate from this engine row and is the host application's to design.

### 9.8 Seam: ControlSocket

- **General.** Open an outbound WebSocket with custom headers.
- **Cloudflare.** `fetch(url, { headers: { Upgrade: 'websocket', … } })` then `response.webSocket.accept()`, because Workers lack a `WebSocket` client constructor with headers.
- **The host app.** Bun's built-in `WebSocket` accepts `{ headers }` in its constructor; the adapter is three lines. No infrastructure. Outbound to Foundry is already allowed (the app calls Azure OpenAI today).

### 9.9 Providers and secrets

- **General.** Foundry endpoint and model names, TypeSafe key, optional `fetch` and `telemetry`.
- **Cloudflare.** `foundryConfig(env)`, `env.TYPESAFE_API_KEY` from Wrangler secrets.
- **The host app.** Existing: `AZURE_OPENAI_API_INSTANCE_NAME`, `AZURE_OPENAI_API_KEY` (Key Vault reference), `AZURE_OPENAI_AGENT_MODEL` (dev: `gpt-6.1-sol`), `AZURE_OPENAI_FAST_MODEL`, fallback instance via `ai-retry`, validated by `app/common/envVars.server.ts`. New: `AZURE_OPENAI_LIVE_MODEL`, `TYPESAFE_API_KEY` (Key Vault secret `TypesafeApiKey` in `infra/modules/keyVault.bicep` plus a reference in `appService.bicep`), and both added to the Zod schema in `envVars.server.ts`. The engine takes a `Providers` object, so the host app can pass models from its registry (`app/toolkit/ai/llm/modelRegistry.ts`) rather than env names.

### 9.10 Host: identity, routes, rate limits, one-active-session

- **General.** Who may start, which `subject` goes in the context, how many starts per minute, and how the host decides it owns an attempt (8.4).
- **Cloudflare.** `api.ts`: same-origin check, `RATE_SIMULATOR`, `idFromName(id).fetch`; the Durable Object runtime is the owner guarantee (8.5).
- **The host app.** Existing: `requireAuth` and the `_session` cookie (`app/auth/authSession.server.ts`, one day, `sameSite: lax`), users table with roles, `configure` in `app/server.ts`. New: `useWebSocket: true` and one `upgradeWebSocket` route for the live segment, an in-process map of open sockets to actors, a `SIGTERM` drain, and the HTTP report route in `app/debrief/api.interview.route.tsx` registered in `app/routes.ts` (8.6). The actor checks the capability. Rate limiting: the host app has none today; a per-user count in `interview_sessions` over the last hour is enough and needs no new resource. The `subject` placed in `InterviewContext` is the users-row id and the host application project id.

### 9.11 Reporting on the host app

- **General.** Stateless call, under two minutes, streamed.
- **Cloudflare.** Today composed inside the Durable Object; after the split, composed in `routes.ts` with `ReportRunner` and a D1 write.
- **The host app.** `app/debrief/reportHost.server.ts` as sketched in 7.2. Runs inside the request on the existing App Service; Hono's `idleTimeout` is 60 s and the stream emits continuously, so no timeout change is needed (the host app already disables the timeout for `/api/chat` for the same reason, and the report route can do the same). The document is stored on the host application's own `interviews` row. No alarm, no background job, no new infrastructure.

### 9.12 Summary of what the host app adds

| Kind | Item | Where |
|---|---|---|
| Existing, reused | App Service (B2, always on), Postgres flexible server, Key Vault, App Insights + Langfuse, Entra auth, Drizzle + migrations, Bun + Hono runtime, CI/CD | `infra/*`, `app/server.ts`, `app/database/*`, `app/auth/*`, `.github/workflows/*` |
| New, code only | `app/debrief/engine/` (the folder), `debrief.db.schema.ts` (one table), the attempt store adapter with the segment guard, the WebSocket route and socket-to-actor map, a `SIGTERM` drain, the report route, one migration | `app/debrief/*`, `app/server.ts` |
| New, config | `AZURE_OPENAI_LIVE_MODEL`, `TYPESAFE_API_KEY` secret and reference, Zod entries; optionally `WEBSITES_CONTAINER_STOP_TIME_LIMIT = 30` so drains finish | `infra/modules/keyVault.bicep`, `infra/modules/appService.bicep`, `app/common/envVars.server.ts` |
| New, outside Bicep | A GPT-Live realtime model deployment on the existing Foundry account | Azure portal / Foundry, as the other deployments are managed today |
| Not added | Queues, Functions, Container Apps Jobs, Redis, a second database, sticky routing, a lease runtime | |

## 10. End to end

1. The participant picks a voice. The browser creates `LiveConnection`, which generates a session id and a capability, opens the microphone, builds an audio-only SDP offer, and POSTs `start`.
2. The host checks identity and rate limits, routes to the session for that id, and the session hashes the capability into its first checkpoint, creates a GPT-Live session with the interviewer brief built from the spec, attaches the control socket, and returns the SDP answer. Audio now flows browser to provider directly.
3. The browser POSTs `ready`. The session sends the opening instruction. Sam speaks. Transcript deltas arrive on the control socket, are merged into passages, and settle after 1.2 seconds of no change.
4. The producer sees settled participant passages. Jev reads the turn (focus, novelty, per-thread state). Sol updates the map on its own cadence (at least twenty seconds apart, at most a minute). If the participant names an organisation, Luna looks it up and the facts appear in the snapshot's background and in Sol's next seed. Code ranks the open threads and sends Sam a short note on the thinking channel. Sam never sees the topics.
5. The browser receives snapshots (polled every second on Cloudflare, pushed over the socket on the host app) and renders coverage, readings and the transcript from the snapshot. Partial archive rows are written on a timer.
6. The participant's train enters a tunnel. WebRTC goes `disconnected`; after fifteen seconds the browser POSTs `pause`. The session closes the provider session, checkpoints to `SessionStore`, calls `store.wake(holdDeadline)` (an alarm on Cloudflare, nothing on the host app), and reports `status: paused`. The browser heartbeats every five seconds.
7. Signal returns within a minute. The browser POSTs `resume` with a new SDP. The session opens a new provider session with the brief plus a rebuilt "conversation so far", bumps the resume count, and continues. Sam picks up where they left off.
8. At ten minutes Sol's pace verdict allows a finish offer; Sam offers. The participant says they are done. Sam wraps up and the session moves to `ending`, then `ended`, when Sam's last words finish. The session runs the final coverage evaluation and writes the final archive row.
9. The browser POSTs `report` to the host's report route. The host reads the transcript and map (from the session if it is still in memory, otherwise from the archive row), calls `summarizeInterview` with the spec's output template through a `ReportRunner`, and streams Markdown back. The browser renders it as it arrives. When the run settles, the host stores the document on its own record. A reloaded page asks the report route, which re-attaches to the running stream or returns the stored text. The session was not involved.

## 11. Hypotheses and things that could be simpler

- **`RoleBranch` and `activeBranches` are unproven.** The idea rides on Sol's existing `vantage` judgment, but whether Sol can reliably declare a branch with a citation needs a probe before the spec type is fixed. Ship the spec without `branches` first if the probe is slow.
- **Resolved: the alarm belongs to `SessionStore`, not to `Background`.** The first draft guessed Alarm and Background might merge. Tracing the call sites (8.2) and both hosts showed the opposite: the wake is per-attempt state next to the checkpoint where a host has it at all, while Background is in-process and non-durable. `Clock` is dropped. Since then the wake has become a hint that the host app ignores (8.3).
- **Whether GPT-Live ends a session when its WebRTC transport drops is unverified.** If it does, orphan voice sessions after a the host app crash cost nothing; if not, a small sweep script closes them by id. Deferred: this is a the host app acceptance task to run when the host app host is built, not a blocker for the Out of Character refactor ([interview-engine-refactor-plan.md](interview-engine-refactor-plan.md), section 12).
- **The host app could keep HTTP polling instead of a WebSocket**, relying on App Service client affinity to keep polls on the owning instance, with the segment guard catching every miss as a forced reconnect. Correct but noisy under affinity misses; the socket makes ownership follow the connection by construction. If the second transport proves costly, this is the fallback.
- **The host app's hold expiry and finalization are lazy.** An abandoned attempt sits as `live` or `paused` until touched. Nothing is billed meanwhile; if tidy rows matter, a `tasks/` script or a boot-time pass over stale `updated_at` closes them.
- **`ProtocolTransport` could be `{ baseUrl, fetch }`.** It is a function so the host app can add its own headers and so tests can stub it. If that proves unnecessary, collapse it.
- **The HTTP poll protocol is a design choice inherited from this repo.** It exists because the browser cannot have a data channel to the provider and polling survives Durable Object restarts well. The host app could want server-sent events or a WebSocket to the browser. The snapshot type stays; the protocol module would gain a second transport. Not needed now.
- **An event emitter on `InterviewSession`** (`onChange`, `onEnded`) would suit hosts that push rather than poll. Not added, because nothing needs it yet.
- **`InterviewContext.known`** maps onto Sol's existing `seed` entity source, so it is cheap, but no caller provides it yet. It is in the type because the host application almost certainly knows the project and role before the interview starts.

## 12. Decisions to review

1. **The session lifecycle lives in the engine**, and the Durable Object becomes a thin adapter. The alternative is to ship the engine as a library of pieces and let each host own the lifecycle. Recommendation: in the engine. It is the hardest code to get right and it is host-independent.
2. **The browser voice link ships with the engine**, including the poll protocol, with React hooks optional. The alternative is to document the protocol and let the host app write its own client. Recommendation: ship it.
3. **Authorization is split**: host owns identity and the right to start; engine owns the per-session capability. Recommendation: keep both, do not let the host's login replace the capability.
4. **The archive row shape is defined by the engine**, and the host only stores it. The alternative is for the engine to hand the host a snapshot and let it decide what to keep. Recommendation: engine defines it, because the privacy story in section 6 depends on knowing exactly what is persisted.
5. **Reporting is a separate component with no session, storage or alarm dependency**, and `session.summary()` moves to host composition with a shared `ReportRunner`. Recommendation: yes. Transcript plus template is the guaranteed path; map, coverage and research facts are optional enrichment.
6. **Role branching waits for a probe** before the spec type is final. Recommendation: build the spec without `branches`, probe, then add.
7. **The host app has no durable wake.** Wake jobs are idempotent and also run on the next touch, so the host app's tidy-up is lazy rather than scheduled; Cloudflare's alarm makes the same jobs prompt. Recommendation: yes; no queue, Functions app or sweep is added.
8. **SessionStore and Archive stay two interfaces over one Postgres database on the host app.** Recommendation: yes; the recovery contract, optionality and read patterns differ, and the cost is one more Drizzle table.
9. **The engine adopts the host app's file conventions now** (`.server.ts`, camelCase, no `index.ts`, `*.prompt.ts`). Recommendation: yes, so the move is a copy.
10. **Essential and optional are separated.** The engine demands one writer, serialization, successor safety, durable checkpoints and the capability check on every host. Continuity without browser action and timers without a process are optional and differ by host as documented policy, with no capability flags. Recommendation: yes.
11. **The host app scopes ownership to the browser's WebSocket and guards writes with a segment number**, instead of a lease runtime. A deploy or crash ends the live connection and the browser reconnects from the persisted transcript, automatically once. Recommendation: yes. Sticky routing and instance count are not relied on; the segment guard is the one mechanism that remains, and it is two SQL statements.
12. **Cloudflare keeps its richer behaviour** (durable alarm, silent restore, orphan retries, GC) because the runtime gives it, and the host app does not emulate it. Recommendation: yes; the engine's only concession is that every wake job also runs on the next touch.
