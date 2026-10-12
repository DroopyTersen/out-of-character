# Interview engine

The interview engine runs a spoken interview and captures its transcript and topic coverage. Reports are a separate host module. Sam asks the questions over a realtime voice model. Sol keeps the conversation map. The host's judge reads coverage and grades the result. Luna looks up public background.

The engine is one folder that knows nothing about the app around it. A host gives it three things:

- an approved plan, explicit context and runtime configuration
- ready-made model clients (the providers)
- three small adapters over its own platform (the seams)

`InterviewContext.background` is the full reference for the producer and report. A host may also supply `voiceBackground` as a compact view for the voice interviewer. Both views share the participant's name and background and are frozen in the accepted definition for resume. When a host supplies only `background`, the voice interviewer uses that background too. Neither view establishes participant testimony.

The host then forwards the browser's commands. This repository hosts the engine on Cloudflare and in a Bun reference host. The host app plans to copy the same folder in as `app/playback/interview/engine/`.

Terms used here are defined in [CONTEXT.md](CONTEXT.md). For why the design looks like this, see `docs/solutioning/interview-engine-api-design.html`.

## Conversation runtime

`SessionTranscript` owns canonical passages, revision, event deduplication, freezing, settlement and capacity. The coordinator admits commands and applies lifecycle effects. `SessionPersistence` orders checkpoint writes and removal, tracks the next wake, and stops writes when ownership is lost. `sessionLifetime` calculates contact, warning, pause and resume decisions without effects.

The voice, turn and map loops run independently. Sam listens and chooses when to respond; the producer sends no hold, cancel, turn-permission or finish-offer instructions. The participant can always redirect or end the interview.

Jev reads each settled participant turn and scores the open gaps for natural next questions. The current thread stays unless another score is more than 0.1 higher; a thread Sol marked related can win a near-tie. Answered, declined and stalled gaps stay out until the next applied map. A transcript correction replaces only that turn's holds. New or rewritten gaps get a reading against the latest answer, without a separate trait-scoring call.

Sol alone edits the map. The first call needs participant speech. New information or interview feedback (probability at least 0.8 by default, with independent host-selected judge thresholds), useful public research, or a change in topic level or applicability wakes Sol, with one call in flight and a 20-second start-to-start floor. After a minute, new participant speech or a failed unapplied update also triggers a call. Coverage changes can wake a call after the latest speech was already logged; changes to coverage probability or evidence alone do not. Topic lists stay in Sol's seed. Project facts must cite participant speech; web findings retain their separate source and lookup citation.

Sam receives a short thread note only when the lead or its wording changes, or a named alternative becomes unavailable. Map notes go when their content changes. Both use `session.thinking.append`; they are optional context, not instructions to speak. They are sent immediately, without another delivery timer. This intentionally changes production v22's held-note behavior; unit tests and archived replay cannot establish live interruption quality.

A participant may type an answer instead of speaking. After its required save, the coordinator forwards it once to the same voice session as `session.thinking.append`, with `event_id: typed-<id>`, `delegation_id: null`, and content from `typedAnswerCue` in `voice/voice.prompt.ts`. Unlike a note, it asks Sam to respond. If the voice session changed or paused before the save completed, the answer reaches Sam through the resume context instead. The passage is frozen, so later speech starts a new passage rather than extending it. A provider `error` naming a `typed-` event pauses the attempt through the ordinary provider pause, with the message “Your answer is saved. Reconnect to continue.” When the last participant passage is typed, the resume instruction tells Sam it is a completed answer, not speech that may have been cut off.

`composing` follows sequenced poll and `ready` reports and clears when a durably saved typed answer is forwarded. The browser keeps its microphone track disabled while composing (`track.enabled = !muted && !composing && !autoMuted`), so clearing or sending restores the participant's own mute choice. While the coordinator holds `composing`, the silence check does not run, and entering composition aborts a check already in flight. Leaving composition starts a fresh four-second silence interval. Idle and duration limits, coverage, producer work and Sam's own replies continue; an utterance already underway is not cancelled. While composing, the producer continues updating its map and ranking but emits no notes or delivery records. When composition ends or just before a typed answer is forwarded, it sends only the current changed notes. A resumed session receives the current notes even when the ordinary note cap was already reached.

A shared 400-call cap includes failed and interrupted producer calls. Sol, Jev and research deadlines are 50 seconds, 3 seconds and 90 seconds. Research is limited to three calls; ordinary notes to 100. A replacement voice session can receive its existing context beyond the ordinary note cap. Checkpoints retain the map, append-only input log, audit records, transcript cursor and the coverage consumed by the last map call; transient ranking is re-read after a restart. Historical trait records remain readable for archived interviews.

## Layout and import rules

| Folder | What it holds | May import |
| --- | --- | --- |
| `shared/` | Types, zod schemas and constants that are safe in a browser: the plan, the protocol, transcripts, snapshots, timing | `zod` only |
| `client/` | The browser side: `LiveConnection`, the transport, audio levels | `shared/` |
| `providers/` | How the engine talks to models: voice, language, judge, and `foundryProviders` | `shared/`, the AI SDK |
| `session/` | Attempt lifecycle, transcript, checkpoints, persistence and archive capture | `shared/`, the conversation modules and the host seams |
| `voice/` | Voice sessions, interviewer briefs and voice recovery | `shared/`, `providers/` |
| `judging/` | Topic coverage and judgments of turns and silence | `shared/`, `providers/` |
| `reasoning/` | Conversation map, research, thread selection and interviewer notes | `shared/`, `providers/`, `judging/` |
| `replay/` | Pure transcript and audit-log timeline reconstruction | The engine record types |
| `adapters/` | In-memory implementations for tests and the reference host | The host seams |

Rules:

- Report generation and organizer setup live in the host; the engine imports neither.
- `client/` imports no `.server.ts` file.
- Nothing in the folder imports from the host.
- The only packages allowed are `ai`, `@ai-sdk/azure`, `@ai-sdk/typesafe-ai` and `zod`.
- Server-only files end in `.server.ts` and prompts live in `*.prompt.ts`.
- Filenames are camelCase.
- There is no barrel `index.ts`. Hosts import the file they need.

The entry points a host uses are:

- `session/sessionCoordinator.server.ts`: `SessionCoordinator`
- `seams.server.ts`, `definition.server.ts` and `session/sessionCheckpoint.ts`: host contracts and accepted input
- `adapters/memory.server.ts`
- `providers/providers.server.ts`
- `shared/*` and `client/*`

## Conversation roles and session coordination

Conversation work is organized by role, with session lifecycle and persistence kept together:

| Folder | Owner | Responsibility |
| --- | --- | --- |
| `voice/` | `VoiceInterviewer`, with `VoiceRecovery` | Provider sessions, briefs, receipts, usage, greeting recovery and transcript-silence recovery |
| `judging/` | `TopicGrading` and individual judgments | Coverage cadence and final grading; typed judgments of topic coverage, turns and silence |
| `reasoning/` | `InterviewProducer` | Conversation map, turn-reading schedule, research, thread selection and current interviewer notes |
| `session/` | `SessionCoordinator` | Attempt lifecycle, transcript acceptance, typed answers and archives |

`SessionPersistence` wraps the host store. A checkpoint is an autosave used to resume or finish an interrupted attempt. Its in-process write queue ensures that an older save cannot overwrite the final checkpoint or recreate a removed one. The coordinator still builds checkpoint contents and decides when to save. If the host reports that a replacement owner has taken over, persistence rejects further writes and tells the coordinator to stop its timer, voice connection and paid work.

`VoiceInterviewer` receives a voice provider, a narrow conversation view and a bound silence judgment. It registers a new provider ID through the coordinator's required persistence callback before attaching. Captured-segment events return through a typed output callback; the coordinator decides which transcript and lifecycle changes to accept. Closure still delivers the participant's last words before its required save completes. Fencing detaches the connection without closing a successor's provider session.

`VoiceRecovery` owns greeting and silence policy, including cancellation and stale-result checks. A provider receipt does not establish speech. Browser playback postpones greeting recovery, while transcript inactivity drives the silence judgment.

`InterviewProducer` receives provider-bound callbacks, model labels and thresholds. Its map, turn and research calls retain one scheduler, cancellation scope and shared 400-call cap. Judging functions live together without creating a second scheduler for these calls. The coordinator binds model clients and mediates notes, provider receipts and committed transcript.

`TopicGrading` owns coverage cadence, deduplication, its separate call budget, cancellation, retries, smoothing and final grade. Each module can be tested with concrete input/output callbacks; none receives the coordinator or a store. Checkpoint fields and host/browser contracts remain unchanged by this organization.

## The three seams

The host implements these for its platform. They are defined in `seams.server.ts`.

```ts
export class FencedError extends Error {}
export type StoredSession = { lease?: Lease; checkpoint?: Checkpoint };

export type SessionStore = {
  load(): Promise<StoredSession>;
  /** Throws FencedError if this owner has been superseded. */
  save(patch: { lease?: Lease; checkpoint?: Checkpoint | null }): Promise<void>;
  /** Schedule coordinator.wake() at `at`; null cancels the wake. */
  wake(at: number | null): Promise<void>;
  clear(): Promise<void>;
};
export type Background = { track(work: Promise<unknown>): void };
export type Archive = { write(row: InterviewArchiveRow): Promise<void> };
```

| Seam | The engine relies on | Cloudflare | Bun reference host |
| --- | --- | --- | --- |
| `SessionStore` | One writer per attempt. A superseded writer's `save` throws `FencedError`, and the coordinator then closes its provider socket and stops. | Durable Object storage. Writes are never stale, because one object owns its attempt. `wake` sets the alarm. | `memoryStore`. Each store opened on a record claims the next segment. `wake` sets a timer. |
| `Background` | Work keeps running after a reply has been sent. | `ctx.waitUntil` | `inlineBackground()` |
| `Archive` | Rows are upserts by attempt id, a partial row never replaces a final one, and a resolved `write` is durable. A final row can arrive more than once. | D1 `interview_attempts` | `memoryArchive()`, plus JSON files when `INTERVIEW_ARCHIVE_DIR` is set |

While the attempt is live, the coordinator writes a partial archive row every 30 seconds; a failed one is logged and dropped. At the end it saves the closed lease and a terminal checkpoint in one patch, so a store should commit them together, then writes the final row. The terminal checkpoint stays until `write` resolves for that row. A failed write is retried on the next wake, and a later owner restores the terminal checkpoint even beside a closed lease and writes the same row again: the end time, transcript and grades are frozen, so a retry never closes a voice session or grades again. `closing` resolves after the first attempt at the final row.

A host that deliberately has no timers can pass `lazyWake: true`; each command then first runs any work that has come due. Such a host cannot retire an attempt without another command. Cloudflare alarms and the Bun host's timers run due work without a browser follow-up. Every wake job also runs on restore. Restoring a lease without a checkpoint schedules its remaining work: closed leases retain receipts for the hold window, while open leases retry provider closure promptly. Once `coordinator.retired` is true, the owner has been fenced, its store has been cleared after final work, or it holds neither a lease nor a conversation, so the host may release that coordinator.

`adapters/memory.server.ts` provides in-memory versions of all three seams (`memoryRecord`, `memoryStore`, `inlineBackground`, `memoryArchive`). The tests and the reference host use them.

## Providers

The host builds ready model clients and passes them in. The engine never sees a key or a resource name. The type is in `providers/providers.server.ts`.

```ts
export type Providers = {
  voice: VoiceProvider;                                  // Sam: the realtime voice model
  language: { agent: LanguageModel; fast: LanguageModel }; // Sol and Luna
  webSearch: Tool;                                        // Luna's research: the fast model's deployment's search tool
  structured: StructuredRequest;                          // Sol's strict-JSON call to the agent model
  judge: Judge;                                          // model + calibrated thresholds
  telemetry?: TelemetryOptions;                           // AI SDK telemetry
};

export type VoiceProvider = {
  create(input: { sdp: string; voice: string; instructions: string }): Promise<{ id: string; sdp: string }>;
  attach(id: string, handlers?: VoiceHandlers): Promise<VoiceConnection>; // normalized events and typed commands
  close(id: string, handlers?: VoiceHandlers): Promise<void>;
};
```

`foundryProviders` builds the voice and language clients and the search tool from one Azure AI Foundry resource. The host supplies its judge with credentials already bound. A host with its own model registry can build `Providers` directly instead: any AI SDK language models, that provider's `tools.webSearch(...)` (the lookup and the fast model must share a deployment), and `structuredWith(config, fetch)` for Sol.

```ts
export type FoundryConfig = { resourceName: string; apiKey: string; agentModel: string; fastModel: string; liveModel: string };
export type FoundryPlatform = { fetch?: typeof fetch; openControl?: ControlOpener };
export type ControlOpening = { status: 'open'; socket: WebSocketLike } | { status: 'gone' } | { status: 'failed' };
export type ControlOpener = (request: { url: string; headers: Record<string, string>; signal: AbortSignal }) => Promise<ControlOpening>;
export type Judge = {
  model: Experimental_EvaluationModel;
  thresholds: { silenceContinue: number; coverageExplored: number };
};

export function foundryProviders(config: FoundryConfig & { judge?: Judge }, platform?: FoundryPlatform): Providers;
```

```ts
import { createDecisionJudge } from './providers/decisionJudge.server';

const judge = createDecisionJudge({ apiKey: openaiKey });
// Jev stays available for evaluation: createJevJudge({ apiKey: typesafeKey }) from './providers/jevJudge.server'
const providers = foundryProviders({ ...foundry, judge }, platform);
```

The factories bind the measured defaults: Decisions uses 0.70 for silence continuation and 0.50 for explored coverage; Jev uses 0.85 for both. The engine applies those thresholds to the returned probabilities and retains its participant-evidence, observability and boundary rules. Questions, turn ranking and session behavior use the same model contract. Each factory accepts an optional `fetch` for the host's HTTP transport.

The voice control channel is a WebSocket upgrade, and each platform completes the upgrade differently. `FoundryPlatform` takes those differences as arguments:

- **Cloudflare:** `openControl` fetches with `Upgrade: websocket`, accepts a successful `response.webSocket`, and returns the opened socket. A 404 or 410 returns `gone`; any other unsuccessful upgrade returns `failed`.
- **Bun:** `openControl` opens a `WebSocket` with the supplied headers. If the handshake fails, a plain request with those same headers distinguishes an ended session (404 or 410) from a failed connection. Ordinary HTTP creation still uses `fetch`.

The engine bounds only the control handshake with its abort signal; it does not close an established socket when that handshake finishes. Without an opener, voice attachment is unavailable. The simulator may use `attachGptLiveSocket` to obtain a raw socket and keep its independent protocol.

The turn, coverage and silence builders attach a typed `InterviewJudgeInput` through `providerOptions.interviewJudge`. `turnRequest` captures the latest participant turn and its preceding interviewer while canonical passage timing is available; `coverageRequest` returns `{ state, questions, providerOptions }` with objective and evidence semantics. A calibrated host recipe reads this input with `readInterviewJudgeInput`; it does not infer purpose from question names or prompt wording. The ordinary SDK state and questions remain unchanged for generic judges, including Jev. Consumers that need only coverage questions use `coverageRequest(spec, passages).questions`.

Creating a judge makes no provider call. Narrative-only callers can omit `judge`; the helper then supplies an unconfigured judge whose only behavior is to fail a judging call with a clear message. The repository's Cloudflare and Bun hosts inject `createDecisionJudge` with `OPENAI_API_KEY`; `providers/jevJudge.server.ts` is the only file that imports `@ai-sdk/typesafe-ai`, so a host that never copies it needs no TypeSafe dependency.

## Approved input

The organizer supplies readable content. The host supplies runtime choices and any explicit background. `SessionCoordinator.restore` validates and copies these inputs; the engine builds voice, producer and judging prompts.

```ts
const plan = {
  id: 'handoff-review', version: 'approved-1', title: 'Customer handoff review',
  goals: 'Learn what made customer handoffs effective or difficult and what to change next time.',
  topics: [{
    id: 'handoff', label: 'Customer handoff', learn: 'Understand the handoff to the customer.',
    appliesWhen: 'The participant personally handled a customer handoff.',
    topics: [{ id: 'access', label: 'Access', learn: 'Describe access problems and their effect.' }],
  }],
  guidance: 'Follow the participant’s actual responsibilities, including changes during the project.',
};
const context = { background: 'Atlas is the project name.', participant: { name: 'Jordan' } };
const config = {
  interviewer: { name: 'Sam', persona: 'Warm and direct.', voices: [
    { id: 'cedar', voice: 'cedar', label: 'Cedar', presentation: 'Neutral', image: '/sam.png' },
  ] },
};
const coordinator = await SessionCoordinator.restore({ plan, config, context, providers, store, background, archive });
```

`InterviewPlan`, `InterviewTopic`, `InterviewContext` and their schemas live in `shared/plan.ts`; runtime configuration and compilation live in `interview/definition.server.ts`. Goals express learning intent in prose. Context holds situation and participant background; both context fields are optional. Report requirements contain an audience and format in prose. No business-system identifiers are required.

Every topic uses the same recursive shape: `id`, `label`, `learn`, optional `appliesWhen`, optional child `topics`. IDs are unique throughout the tree and use letters, numbers, underscores or hyphens. Only leaves receive independent coverage readings. Ancestor learning intent scopes the leaves, and ancestor conditions apply to the whole subtree. A parent is an organizing group; its children provide the assessments a host can roll up.

Conditional leaves carry `applicability: applicable | not-applicable | unknown` and supporting participant evidence, separately from depth (`not-yet`, `touched`, `explored`, `set-aside`). Unconditional leaves omit applicability. Unknown relevance earns no coverage and is not a failure. A relevant topic can still be set aside because the participant declines or cannot answer. Supplied context cannot establish the participant’s experience or grant coverage.

The coordinator exposes a copied `definition` and persists it in checkpoints. On restore, accepted plan, configuration and context take precedence over replacement caller inputs, including an originally absent context. The Cloudflare host also stores the complete accepted definition before opening a voice session, covering restarts before the first checkpoint. A new attempt resolves its plan once; later catalog edits or removal cannot alter it.

The shipped closeout and win/loss templates assemble their existing learning criteria and organizer guidance into this input; their report layouts stay alongside it in host-owned setup data. `resolveInterview` compiles it for lower-level replay and evaluation tools; hosts starting sessions pass the plain input directly.

The voice model composes the opening from that same accepted title, goals, guidance and context. It introduces itself, explains the purpose, names the subject when supplied, and asks for the first missing grounding detail. The title describes the interview type; it is never substituted for an unknown project or organization name. The opening has a short preamble before the usual concise follow-ups. No separate model call delays startup, and Sol starts its evidence-based map after participant speech using the approved plan as its seed.

## Protocol

The browser and the session exchange these actions (`shared/protocol.ts`):

```ts
export const PROTOCOL_ACTIONS = ['start', 'poll', 'ready', 'end', 'pause', 'resume', 'submitText'] as const;
export const CAPABILITY = /^Bearer [a-f0-9]{64}$/;   // the bearer secret returned by start
// startSchema { id, planId, voiceId, sdp }, resumeSchema { sdp }, activitySchema (the poll body; readySchema: optional, the ready body)
// submitTextSchema { id, text }, TYPED_TEXT_LIMIT = 2000, SUBMIT_TEXT_BODY_LIMIT = 16 KiB, SubmitTextReply { acceptedId, snapshot }
```

On the server, a host turns each request into a `Command` and returns the `Reply`:

```ts
type Command =
  | { action: 'start'; input: StartInput }
  | { action: 'poll' | 'ready' | 'end' | 'pause'; activity?: Activity }
  | { action: 'resume'; input: ResumeInput }
  | { action: 'submitText'; input: SubmitTextInput };
type Reply = { status: number; body: unknown; terminal?: true };
```

`terminal` marks a reply to an attempt that has ended.

The transport owns authentication, content type, encoding and byte bounds. Pass its parsed JSON value to `decodeCommand(action, body)` (`undefined` when no body was sent), return 400 for an invalid command, then call `coordinator.handle(command, capability)` with the capability separately. Poll, ready, end and pause accept an absent activity report; a present malformed activity shape is invalid for all four. Only unreadable optional media/network diagnostics are discarded. The coordinator receives validated domain input and checks the capability and accepted spec rather than parsing transport JSON.

On the client, `LiveConnection` (`client/liveConnection.ts`) sends its requests through a `ProtocolTransport`:

```ts
export type ProtocolAction = 'start' | 'ready' | 'poll' | 'pause' | 'resume' | 'end' | 'submitText';
export type RequestOptions = { attempt: Attempt; timeoutMs: number; keepalive?: boolean; signal?: AbortSignal };   // Attempt = { id, capability }
export type ProtocolTransport = { request(action: ProtocolAction, body: unknown, options: RequestOptions): Promise<unknown> };

export function pollTransport(baseUrl: string): ProtocolTransport;   // HTTP POSTs to <baseUrl>/<action>
export function socketTransport(baseUrl: string): ProtocolTransport; // one WebSocket per attempt at <baseUrl>/<id>/socket
```

A poll carries an activity report. A sequenced report (one with a `sequence`) may also carry `composing`, whether the browser holds an unsent typed draft; the draft itself never travels. `ready` may carry the browser's current activity report, which the coordinator applies before the attempt goes live, so a composer opened during a reconnect is still protected. Activity changes `composing` only through sequenced reports; durable typed acceptance also clears it. A report whose sequence is not greater than the last one seen is dropped. The client numbers reports `Math.max(previous + 1, Date.now())`, so a reloaded page never repeats a number the server has already seen.

`submitText` sends one typed participant answer. The body is `{ id, text }`: `id` is a UUID, and `text` is nonblank and at most `TYPED_TEXT_LIMIT` (2,000) characters. The text is kept exactly as typed; it is trimmed only to reject a blank answer. The host bounds the request body at `SUBMIT_TEXT_BODY_LIMIT` (16 KiB, including JSON escaping). The replies are:

| Status | When |
| --- | --- |
| 200 | `{ acceptedId, snapshot }`, after a checkpoint holding the answer has been saved |
| 400 | The body is not a valid `{ id, text }` |
| 409 | The interview is not live (“The interview is not live.”), the transcript is full, or the id was already sent with different text |
| 413 | The body is larger than `SUBMIT_TEXT_BODY_LIMIT` |
| 503 | The required save failed (“Your answer could not be saved. Try again.”) |

The coordinator appends the answer as an immutable participant passage with id `typed-<id>`, then waits for a checkpoint holding it before it replies. A 200 means the answer was saved, not that the interviewer has spoken. A retry with the same id and text returns the same receipt without adding or forwarding the answer twice; a retry whose earlier save failed runs the save again. New answers are accepted only while the attempt is live, and a generic snapshot is never a receipt.

`LiveConnection` exposes the two calls a host's composer needs:

```ts
connection.setComposing(value: boolean): void;            // a nonempty draft: mutes the microphone and reports at once
connection.submitText(answer: SubmitTextInput): Promise<SubmitTextReply>; // resolves once the answer is saved
```

`ParticipantIntent` belongs to the host attempt and retains mute, composing, and the identity of one deliberately submitted answer. The host calls `intent.answer(text)` and passes that `SubmitTextInput` to `submitText`; an unchanged answer keeps its id across transport retries and a later manual retry. On receipt, `intent.acknowledged(acceptedId)` releases that identity, so edited text or the same words after acceptance are a new answer. Apply the intent to every replacement connection before starting or reattaching media. A fresh attempt starts with fresh intent; the unsent draft stays in the host. `submitText` retries the supplied id while the server is unanswered or replies 503, backing off for up to 30 seconds. Other failures reject with the server's message. The host keeps the draft until the promise resolves and clears it only then. A host bounds the body at `SUBMIT_TEXT_BODY_LIMIT`, decodes its parsed value with `decodeCommand('submitText', body)`, and passes the validated command and separate capability to `coordinator.handle`.

`closed` reports, once per connection, how the attempt closed for this page, so a host never infers it from snapshots:

```ts
type Closure = { outcome: 'ended' | 'unconfirmed' | 'lost'; reachedLive: boolean };
```

`ended` means the server ended the attempt or confirmed this page's `end`, or the attempt never reached the server (a denied microphone, for example). `unconfirmed` means this page's `end` went unanswered, so the server may still hold the attempt: the host reconciles it by reattaching a new `LiveConnection` with the same `Attempt`, which rejoins paused (as after a reload) and finds the attempt ended if the `end` did arrive. `lost` means the server no longer has the attempt. `reachedLive` says whether the conversation had started. `detach()` and `dispose()` report nothing. `error` carries only messages to show.

Two transports exist. The browser uses `pollTransport`. `socketTransport` (`client/socketTransport.ts`) is opt-in: a host enables it with `INTERVIEW_SOCKET_ENABLED=true`. It sends the same requests over one WebSocket per attempt and correlates each reply by id. When the socket closes, whatever was waiting fails with `SessionUnanswered`, and the next request reconnects for the same attempt. Keepalive requests still go over HTTP. The errors are the poll transport's.

Each socket message is one command, `{ id, action, capability, body? }`, where `capability` is the 64 hex digits without `Bearer ` (`socketRequestSchema` in `shared/protocol.ts`). Each reply is `{ id, status, body }`: the status and JSON body that the command's HTTP route returns. The host builds the HTTP request the poll transport would have sent and passes it to the same route handler (`answerSocket` in `app/server/interview/socket.ts`), so the gates and the replies are the same. The report streams, so it stays on HTTP.

## Reports and organizer setup

Reports live outside the runtime in `app/reports/`. They take plain `{ transcript, format, context? }` and a language model; no coordinator, voice provider, database, catalog or interview ID is required. The report writer, streaming runner, schemas and synthetic fixtures are described in `app/reports/README.md`.

Organizer drafting and approval live in `app/server/interview/setup/`. A hosted spec contains an engine plan and a separate report format. The host freezes both at approval and pins both before starting an attempt. Only the plan, runtime configuration and explicit interview context enter the engine.

## How this repository hosts it

Both hosts share `app/server/interview/routes.ts` and `app/server/interview/hosted.ts`.

**Routes.** `routeInterview(request, gates)` serves `/api/interview/sessions/...`. It checks the origin, the capability header, body sizes and the start gates. It then forwards each command to the attempt's session as `https://session/<action>`. A host supplies the gates:

```ts
type InterviewGates = {
  available(): boolean;
  limit(key: string, kind?: 'session' | 'narrative'): Promise<boolean>;
  session(id: string, command: Request): Promise<Response>;
  narrative(input: NarrativeRequest, signal: AbortSignal): Response | Promise<Response>;
  socket?(id: string, upgrade: Request): Response | Promise<Response>;   // opt-in socket transport
  debriefs?: DebriefGates;                                               // opt-in debrief setup routes
};
```

**Narrative route.** `POST /api/interview/narratives` writes the narrative for a transcript that did not come from a live attempt. The body is `{ transcript, format, context? }` (`narrativeRequestSchema` in `app/reports/report.types.ts`, at most 256 KiB), behind the same origin, capability, kill-switch and limiter gates as the session routes. The reply streams the narrative's JSON text, as the report route does, and nothing is stored. No catalog or live attempt is needed. A transcript in which the participant said nothing answers 422.

**Hosted session.** `HostedSession` wraps a `SessionCoordinator`:

- It decodes the parsed request value into a `Command` and calls `coordinator.handle(command, capability)`. A host `report` request first checks the actor through the decoded `poll` command.
- It returns the canonical `InterviewSnapshot`: `planId`, `voiceId`, `transcript`, `evaluation`, `background` and lifecycle fields. Transcript and evidence speakers are `participant` and `interviewer`. There is no coaching field or nested interview wrapper; the host adds report state separately.
- On an authenticated host `report` request, it runs `writeNarrative` over the ended transcript through a `NarrativeRunner`, the same runner the narrative route uses (`app/server/interview/narrative.ts`). A second report request rejoins the running narrative.

**Cloudflare** (`app/server/interview/durableObject.ts`, routed from `app/workers/app.ts`):

- There is one `InterviewObject` per attempt.
- Inside `blockConcurrencyWhile`, it calls `SessionCoordinator.restore` with `durableStore(ctx.storage)`, `durableBackground(ctx)`, the D1 archive and `foundryProviders(..., { openControl: cloudflareControl() })`.
- `fetch` goes to the hosted session. `alarm()` calls `coordinator.wake()`.
- With `INTERVIEW_SOCKET_ENABLED=true`, the Worker forwards the attempt's socket upgrade to its object. The object accepts it through `WebSocketPair` and answers each message through the Worker's routes with its own session.

**Bun reference host** (`scripts/interview-host.ts`):

```sh
bun --env-file=.dev.vars scripts/interview-host.ts   # PORT (default 8788), HOST (default 127.0.0.1)
```

The reference host serves the same routes and replies as the Worker, from a single process:

- It keeps one `memoryRecord` and `memoryStore` per attempt, and schedules each wake with `setTimeout`.
- Background work runs inline.
- The rate limit is held in memory.
- The explicit `openControl` described under Providers handles the voice socket and failed-handshake status probe.
- With `INTERVIEW_SOCKET_ENABLED=true`, it accepts the socket transport through `server.upgrade` and answers each message through the same routes.

It shows how little a host needs to write.

**Narrative from a file** (`scripts/interview-narrative.ts`) runs `writeNarrative` over a transcript without any host:

```sh
bun --env-file=.dev.vars scripts/interview-narrative.ts transcript.json [--spec sales-win-loss] [--out result.json]
```

The file can directly contain `{ transcript, format, context? }` without a catalog. For historical imports, a shipped default report format can be selected from a passages array, `{ specId, passages }`, an archive row from `INTERVIEW_ARCHIVE_DIR`, or a D1 interview row. The text streams to stdout; the result, with its failure and usage, goes to `--out` or follows on stdout.

## Checks

```sh
bun run check:engine   # the boundary, the engine-only type check, and the copy check
bun run check          # everything: typecheck, check:engine, bun test, build, bundle check, wrangler dry run
```

`check:engine` runs three steps:

1. `scripts/engine-boundary-check.ts` enforces the import rules and the package allow-list.
2. `tsc -p tsconfig.engine.json` type-checks the folder with no Cloudflare or DOM-only ambient types.
3. `scripts/engine-copy-check.ts` copies `interview-engine/` into an empty temporary directory that has only the four allowed packages (at this repo's versions) and TypeScript, installs them, and type-checks there. If this passes, the folder compiles anywhere those packages are present.

## Copying it into a host

The steps below use the host app as the example. They follow the plan in the design documents; none of this exists in the host app yet.

1. **Copy the folder.** Copy `interview-engine/` to the host as `app/playback/interview/engine/`, and add any of the four packages the host lacks. A host that judges with Decisions can leave `providers/jevJudge.server.ts` behind and skip `@ai-sdk/typesafe-ai`; `ai` must be new enough to export `experimental_evaluate`. The copy check above is the evidence that this compiles.
2. **Supply approved input.** Pass the approved `InterviewPlan`, runtime `InterviewConfig`, and explicit `InterviewContext` if available. Keep browser labels and host business identity outside the engine.
3. **Implement the seams.**
   - A `SessionStore` over the host's database. The design calls for an attempts row with a `segment` column and guarded writes that throw `FencedError` when the segment has moved on.
   - A `Background` for fire-and-forget work.
   - An `Archive` that upserts `InterviewArchiveRow`.
   - Schedule `coordinator.wake()` from each `wake(at)` hint to finish work and retire attempts without another command. A deliberate `lazyWake: true` fallback serves overdue work only when a command arrives.
4. **Build providers.** Build `createDecisionJudge({ apiKey })` (or `createJevJudge({ apiKey })` from `jevJudge.server.ts`), then call `foundryProviders({ ...config, judge }, platform)`. Supply the platform's explicit `openControl` for voice attachment and optionally its `fetch` for ordinary HTTP calls.
5. **Own a coordinator per attempt.** Call `SessionCoordinator.restore({ plan, config, context, providers, store, background, archive })`. Decode transport values with `decodeCommand`, forward valid commands through `coordinator.handle(command, capability)`, and call `coordinator.close('hold')` when the host drops the attempt. Release the owner when `coordinator.retired` reports that its store was cleared or ownership was lost.
6. **Serve the report separately.** Keep report instructions in the accepted host setup. Pass the saved transcript, those instructions and optional explicit context to the report module. The host owns report authorization, generation claims, storage and retries; reports never write back into the coordinator.
7. **Keep the browser on the engine's client.** Use `LiveConnection` with `pollTransport`, with `socketTransport`, or with a transport the host writes against `ProtocolTransport`.

Identity, the right to start, archive reads and the screens stay with the host. The engine checks only the capability.

## Contract cutover

This changes the previous start fields, snapshot shape and setup record shape. Update a host and its browser together. Old archived transcript exports remain readable through this repository’s host import adapter. Active attempts from before this contract change must finish before a deployment switches their owner; old identity-only pins cannot reconstruct a removed template version. No deployment or database migration is part of this change. New attempts pin their complete accepted definition and resume without catalog reconstruction.

The synthetic provider regression is `bun --env-file=.dev.vars scripts/interview-contract-probe.ts --paid`: four bounded judgments check unresolved relevance, non-applicability, relevant coverage and inherited parent scope; one report checks that an interviewer premise and background hypothesis stay separate from findings. Its generated report still requires semantic review. Local browser acceptance uses stubbed session and provider boundaries and does not prove a hosted voice integration.
