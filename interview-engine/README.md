# Interview engine

The interview engine runs a spoken interview and turns its transcript into a written narrative. Sam asks the questions over a realtime voice model. Sol keeps the conversation map. Jev reads coverage and grades the result. Luna looks up public background.

The engine is one folder that knows nothing about the app around it. A host gives it three things:

- an interview spec
- ready-made model clients (the providers)
- three small adapters over its own platform (the seams)

The host then forwards the browser's commands. This repository hosts the engine on Cloudflare and in a Bun reference host. The host app plans to copy the same folder in as `app/debrief/engine/`.

Terms used here are defined in [CONTEXT.md](CONTEXT.md). For why the design looks like this, see `docs/solutioning/interview-engine-api-design.html`.

## Conversation runtime

The voice, turn and map loops run independently. Sam listens and chooses when to respond; the producer sends no hold, cancel, turn-permission or finish-offer instructions. The participant can always redirect or end the interview.

Jev reads each settled participant turn and scores the open gaps for natural next questions. The current thread stays unless another score is more than 0.1 higher; a thread Sol marked related can win a near-tie. Answered, declined and stalled gaps stay out until the next applied map. A transcript correction replaces only that turn's holds. New or rewritten gaps get a reading against the latest answer, without a separate trait-scoring call.

Sol alone edits the map. The first call needs participant speech. New information (Jev probability at least 0.8) or useful public research wakes Sol, with one call in flight and a 20-second start-to-start floor. After a minute, new participant speech or a failed unapplied update also triggers a call. Topic lists stay in Sol's seed. Project facts must cite participant speech; web findings retain their separate source and lookup citation.

Sam receives a short thread note only when the lead or its wording changes, or a named alternative becomes unavailable. Map notes go when their content changes. Both use `session.thinking.append`; they are optional context, not instructions to speak. They are sent immediately, without another delivery timer. This intentionally changes production v22's held-note behavior; unit tests and archived replay cannot establish live interruption quality.

A shared 400-call cap includes failed and interrupted producer calls. Sol, Jev and research deadlines are 50 seconds, 3 seconds and 90 seconds. Research is limited to three calls; ordinary notes to 100. A replacement voice session can receive its existing context beyond the ordinary note cap. Checkpoints retain the map, append-only input log, audit records and transcript cursor; transient ranking is re-read after a restart. Historical trait records remain readable for archived interviews.

## Layout and import rules

| Folder | What it holds | May import |
| --- | --- | --- |
| `shared/` | Types, zod schemas and constants that are safe in a browser: the spec, the protocol, transcripts, snapshots, timing | `zod` only |
| `client/` | The browser side: `LiveConnection`, the transport, audio levels | `shared/` |
| `providers/` | How the engine talks to models: voice, language, judge, and `foundryProviders` | `shared/`, the AI SDK |
| `interview/` | The Interview phase: the session actor, the seams, the conversation (Sol, Jev, Luna) and Sam's brief | `shared/`, `providers/` |
| `narrative/` | The Narrative phase: writing a document from a transcript | `shared/`, `providers/` |
| `setup/` | Debrief setup: drafting and approving the topics an attempt runs under | `shared/`, `providers/` |

Rules:

- `interview/` and `narrative/` never import each other. A transcript from anywhere can be written up.
- `client/` imports no `.server.ts` file.
- Nothing in the folder imports from the host.
- The only packages allowed are `ai`, `@ai-sdk/azure`, `@ai-sdk/typesafe-ai` and `zod`.
- Server-only files end in `.server.ts` and prompts live in `*.prompt.ts`.
- Filenames are camelCase.
- There is no barrel `index.ts`. Hosts import the file they need.

The entry points a host uses are:

- `interview/interview.server.ts`: `SessionActor`, the seam types and the checkpoint types
- `interview/adapters/memory.server.ts`
- `providers/providers.server.ts`
- `narrative/write.server.ts` and `narrative/narrativeRun.server.ts`
- `setup/approve.server.ts` and `setup/draft.server.ts`
- `shared/*` and `client/*`

## The three seams

The host implements these for its platform. They are defined in `interview/seams.server.ts`.

```ts
export class FencedError extends Error {}
export type StoredSession = { lease?: Lease; checkpoint?: Checkpoint };

export type SessionStore = {
  load(): Promise<StoredSession>;
  /** Throws FencedError if this owner has been superseded. */
  save(patch: { lease?: Lease; checkpoint?: Checkpoint | null }): Promise<void>;
  /** A hint: the attempt has due work at `at` (null: none). */
  wake(at: number | null): Promise<void>;
  clear(): Promise<void>;
};
export type Background = { track(work: Promise<unknown>): void };
export type Archive = { write(row: InterviewArchiveRow): Promise<void> };
export type Seams = { store: SessionStore; background: Background; archive: Archive };
```

| Seam | The engine relies on | Cloudflare | Bun reference host |
| --- | --- | --- | --- |
| `SessionStore` | One writer per attempt. A superseded writer's `save` throws `FencedError`, and the actor then closes its provider socket and stops. | Durable Object storage. Writes are never stale, because one object owns its attempt. `wake` sets the alarm. | `memoryStore`. Each store opened on a record claims the next segment. `wake` sets a timer. |
| `Background` | Work keeps running after a reply has been sent. | `ctx.waitUntil` | `inlineBackground()` |
| `Archive` | Rows are upserts by attempt id, and a partial row never replaces a final one. | D1 `interview_attempts` | `memoryArchive()`, plus JSON files when `INTERVIEW_ARCHIVE_DIR` is set |

While the attempt is live, the actor writes a partial archive row every 30 seconds. It writes a final row at the end.

A host without timers can ignore `wake` and pass `lazyWake: true`. Each command then first runs any work that has come due. Every wake job also runs on restore.

`interview/adapters/memory.server.ts` provides in-memory versions of all three seams (`memoryRecord`, `memoryStore`, `inlineBackground`, `memoryArchive`). The tests and the reference host use them.

## Providers

The host builds ready model clients and passes them in. The engine never sees a key or a resource name. The type is in `providers/providers.server.ts`.

```ts
export type Providers = {
  voice: VoiceProvider;                                  // Sam: the realtime voice model
  language: { agent: LanguageModel; fast: LanguageModel }; // Sol, Luna and the narrative
  structured: StructuredRequest;                          // Sol's strict-JSON call to the agent model
  judge: Experimental_EvaluationModel;                    // Jev: readings, ranking, the final grade
  telemetry?: TelemetryOptions;                           // AI SDK telemetry
  log?: (event: EngineEvent) => void;                     // transcripts, timings, provider failures
};

export type VoiceProvider = {
  create(input: { sdp: string; voice: string; instructions: string }): Promise<{ id: string; sdp: string }>;
  attach(id: string): Promise<WebSocketLike>;             // the control socket: events in, instructions out
  close(id: string): Promise<void>;
};
```

`foundryProviders` builds every provider from a single Azure AI Foundry resource and a TypeSafe key:

```ts
export type FoundryConfig = { resourceName: string; apiKey: string; agentModel: string; fastModel: string; liveModel: string };
export type FoundryPlatform = { fetch?: typeof fetch; socket?: SocketOpener; telemetry?: TelemetryOptions };
export type SocketOpener = (response: Response) => WebSocketLike | null;

export function foundryProviders(config: FoundryConfig & { typesafeKey?: string }, platform?: FoundryPlatform): Providers;
```

The voice control channel is a WebSocket upgrade, and each platform completes the upgrade differently. `FoundryPlatform` takes those differences as arguments:

- **Cloudflare:** `fetch` already performs the upgrade. The `socket` opener only calls `accept()` on `response.webSocket`.
- **Bun:** `fetch` does not upgrade. The reference host's `fetch` opens a `WebSocket` instead, and its `socket` opener collects that socket from the stand-in response.

The TypeSafe key is read the first time Jev is called. A host that only writes narratives can leave it out.

## Writing a spec

A spec is plain data, checked by `validateSpec` in `shared/spec.ts`. Each spec lives in its own folder under `interviews/`, split so that the browser never receives the judging text:

| File | Contents | Imported by |
| --- | --- | --- |
| `public.ts` | Id, version, interviewer name, voices, topic and objective labels, readings, limits | Browser and server |
| `brief.prompt.ts` | Sam's `persona`, `role`, `orientation`, `boundaries`, `opening`, and two `techniques` | Server |
| `framing.prompt.ts` | The `InterviewFraming`: what kind of interview this is, in the words Sol and Jev use | Server |
| `rubric.prompt.ts` | Each objective's `criterion` (plus an optional `creditRule` or `explored`), and each reading's `rubric` | Server |
| `narrative.prompt.ts` | The `NarrativeTemplate`: a system prompt and a zod schema | Server |
| `spec.ts` | Joins the files above with `validateSpec` | Server |

`interviews/sales-win-loss/` is the worked example: a buyer's debrief after a B2B purchase decision. Its `spec.ts` is the whole assembly:

```ts
export const spec = validateSpec({
  id: SALES_WIN_LOSS_ID,
  version: SALES_WIN_LOSS_VERSION,
  interviewer: { name: salesInterviewerName, voices: salesVoices, role, persona, opening, orientation, boundaries, techniques },
  framing,
  topics: salesTopics.map(topic => ({ ...topic, objectives: topic.objectives.map(objective => ({ ...objective, criterion: salesCriteria[objective.id], ...salesRules[objective.id] })) })),
  readings: salesReadings.map(reading => ({ ...reading, rubric: salesRubrics[reading.id] })),
  limits: salesLimits,
  narrative: { id: 'sales-win-loss-debrief', version: salesNarrativeVersion, system: salesNarrativeSystem, schema: salesNarrativeSchema },
});
```

What each server-only piece feeds:

- **The brief:** `role` completes "You are Sam, …". `opening` is Sam's first line. `orientation` and `boundaries` are the ground rules. The two techniques bracket the engine's own interviewing guide: `grounding` comes first ("Anchor on the decision") and `lesson` comes eleventh ("Rewind the decision"). Turn-taking, note handling and the other techniques belong to the engine.
- **The framing** (`InterviewFraming`):
  - `occasion` completes "an AI voice interviewer in …".
  - `topic` names a single topic ("debrief topic").
  - `purpose` and `setting` open Sol's seed.
  - `defaultThread` is the thread Sol keeps open from the first call ("The outcome, by default").
  - `terms` tells Jev what "the vendor" and "competitors" mean.
  - `party` says whose words count toward a topic.
- **The rubric:** every objective needs a `criterion`. A `creditRule` narrows whose words count. In the sales spec, `vendor-team` credits only the vendor's people. Every reading needs a `task` and five criteria, one for each point on Jev's 0–4 scale.

The engine checks a spec through its types, so a spec missing any of these does not compile:

```ts
type SessionSpec = Pick<InterviewSpec, 'id' | 'version' | 'limits'> & BriefedSpec & JudgedSpec & MappedSpec;
```

- `BriefedSpec` (`interview/voice/brief.server.ts`) needs the brief.
- `JudgedSpec` (`interview/conversation/rubric.prompt.ts`) needs the criteria, the rubrics, and `framing.topic`, `terms` and `party`.
- `MappedSpec` (`interview/conversation/map.prompt.ts`) needs the rest of the framing.

`interviews/sales-win-loss/spec.test.ts` shows the smoke tests worth copying. Each rendered prompt is non-empty, mentions the spec's own topics, and carries no wording from another interview. `interviews/project-closeout/prompts.test.ts` freezes the closeout prompts byte for byte against `fixtures/`.

## Protocol

The browser and the session exchange these actions (`shared/protocol.ts`):

```ts
export const PROTOCOL_ACTIONS = ['start', 'poll', 'ready', 'end', 'report', 'pause', 'resume'] as const;
export const CAPABILITY = /^Bearer [a-f0-9]{64}$/;   // the bearer secret returned by start
// startSchema { id, scenarioId, clientId, sdp }, resumeSchema { sdp }, activitySchema (the ready/poll body)
```

On the server, a host turns each request into a `Command` and returns the `Reply`:

```ts
type Command = { action: string; capability: string; body?: string };
type Reply = { status: number; body: unknown; terminal?: true; report?: true };
```

`terminal` marks a reply to an attempt that has ended. `report` asks the host to start the narrative.

On the client, `LiveConnection` (`client/liveConnection.ts`) sends its requests through a `ProtocolTransport`:

```ts
export type ProtocolAction = 'start' | 'ready' | 'poll' | 'pause' | 'resume' | 'end';
export type RequestOptions = { attempt: Attempt; timeoutMs: number; keepalive?: boolean; signal?: AbortSignal };   // Attempt = { id, capability }
export type ProtocolTransport = { request(action: ProtocolAction, body: unknown, options: RequestOptions): Promise<unknown> };

export function pollTransport(baseUrl: string): ProtocolTransport;   // HTTP POSTs to <baseUrl>/<action>
export function socketTransport(baseUrl: string): ProtocolTransport; // one WebSocket per attempt at <baseUrl>/<id>/socket
```

Two transports exist. The browser uses `pollTransport`. `socketTransport` (`client/socketTransport.ts`) is opt-in: a host enables it with `INTERVIEW_SOCKET_ENABLED=true`. It sends the same requests over one WebSocket per attempt and correlates each reply by id. When the socket closes, whatever was waiting fails with `SessionUnanswered`, and the next request reconnects for the same attempt. Keepalive requests still go over HTTP. The errors are the poll transport's.

Each socket message is one command, `{ id, action, capability, body? }`, where `capability` is the 64 hex digits without `Bearer ` (`socketRequestSchema` in `shared/protocol.ts`). Each reply is `{ id, status, body }`: the status and JSON body that the command's HTTP route returns. The host builds the HTTP request the poll transport would have sent and passes it to the same route handler (`answerSocket` in `app/server/interview/socket.ts`), so the gates and the replies are the same. The report streams, so it stays on HTTP.

## The Narrative phase

The Narrative phase turns a transcript into a document. It needs only a language model.

```ts
export type NarrativeInput = { template: Pick<NarrativeTemplate<NarrativeDocument>, 'system' | 'schema'>; passages: Passage[] };
export type NarrativeRun = { stream: ReadableStream<string>; result: Promise<Narrative> };

export function writeNarrative(input: NarrativeInput, providers: Pick<Providers, 'language' | 'telemetry'>, signal?: AbortSignal): NarrativeRun;
```

`writeNarrative` streams the text as it is written. `result` settles exactly once, with the document and its usage, or with a failure (`provider`, `invalid`, `cancelled` or `timeout`). It throws if the participant said nothing.

`NarrativeRunner` (`narrative/narrativeRun.server.ts`) puts the rules a report route needs around one run:

```ts
new NarrativeRunner(start: (signal: AbortSignal) => NarrativeRun, options?: { deadlineMs?: number; onSettled?: (narrative: SettledNarrative) => void; track?: (work: Promise<unknown>) => void });
runner.attach(signal): Response;   // start a run, rejoin the running one, or return the stored document or "retry used"
runner.state(); runner.read(); runner.cancel();
```

The runner allows two starts at most (`NARRATIVE_MAX_STARTS`), with a 120-second deadline (`NARRATIVE_DEADLINE_MS`). After a run settles, the host passes the result to `actor.settleNarrative(status, provenance)` so the archive records it. A request made while a run is writing rejoins it: it receives everything written so far, then the rest as it is written, so a reloaded page picks up where it was. Dropping a request detaches it without stopping the run. Only the deadline or `runner.cancel()` stops a run, and `track` keeps it alive on a platform that would otherwise stop it (Cloudflare: `waitUntil`).

## Debrief setup

A spec file is one way to define a debrief. `setup/` is the other: an organizer picks a template and edits its topics, or describes the debrief in words and edits what the model drafts. Both paths end in the same record, and the live actor only ever sees the approved spec.

```ts
export type DebriefDraft = { title: string; role: string; opening: string; orientation: string[]; framing: Omit<InterviewFraming, 'topic'>; topics: DebriefTopic[] };

export function templateDraft(spec: InterviewSpec): DebriefDraft;                       // a template's topics as an editable draft
export function draftDebrief(input: { description: string; interviewer: { name: string }; model: LanguageModel; signal?; telemetry? }): Promise<{ draft: DebriefDraft; model: string; usage }>;
export function approveDebrief<S extends InterviewSpec>(base: S, record: DebriefDraft & { id?: string; base?: string }): Promise<ApprovedSpec<S>>;
```

`approveDebrief` builds a runnable spec: the base template's cast, persona, boundaries, techniques, readings and limits under the record's brief, framing and topics, with the engine's topic-sectioned narrative. Its id comes from the title (or the record's `id`) and its version is a digest of the record and the base, so the same approval always yields the same version and any edit yields a new one. Starting, resume, grading, the narrative and the archive all use that id and version; a host resolves them through a catalog of templates and stored approvals.

## How this repository hosts it

Both hosts share `app/server/interview/routes.ts` and `app/server/interview/hosted.ts`.

**Routes.** `routeInterview(request, gates)` serves `/api/interview/sessions/...`. It checks the origin, the capability header, body sizes and the start gates. It then forwards each command to the attempt's session as `https://session/<action>`. A host supplies the gates:

```ts
type InterviewGates = {
  available(): boolean;
  limit(key: string, kind?: 'session' | 'narrative'): Promise<boolean>;
  session(id: string, command: Request): Promise<Response>;
  narrative(input: NarrativeRequest, signal: AbortSignal): Response | Promise<Response>;
};
```

**Narrative route.** `POST /api/interview/narratives` writes the narrative for a transcript that did not come from a live attempt. The body is `{ specId, passages }` (`narrativeRequestSchema` in `shared/protocol.ts`, at most 256 KiB), behind the same origin, capability, kill-switch and limiter gates as the session routes. The reply streams the narrative's JSON text, as the report route does, and nothing is stored. An unknown spec answers 404, and a transcript in which the participant said nothing answers 422.

**Hosted session.** `HostedSession` wraps a `SessionActor`:

- It turns the request into a `Command` and sends it to `actor.handle`.
- It answers with the practice simulator's reply shapes, so the browser does not change.
- On a `report` reply, it runs `writeNarrative` over the ended transcript through a `NarrativeRunner`, the same runner the narrative route uses (`app/server/interview/narrative.ts`). A second report request rejoins the running narrative.

**Cloudflare** (`app/server/interview/durableObject.ts`, routed from `app/workers/app.ts`):

- There is one `InterviewObject` per attempt.
- Inside `blockConcurrencyWhile`, it calls `SessionActor.restore` with `durableStore(ctx.storage)`, `durableBackground(ctx)`, the D1 archive and `foundryProviders(..., { socket: acceptSocket })`.
- `fetch` goes to the hosted session. `alarm()` calls `actor.wake()`.
- With `INTERVIEW_SOCKET_ENABLED=true`, the Worker forwards the attempt's socket upgrade to its object. The object accepts it through `WebSocketPair` and answers each message through the Worker's routes with its own session.

**Bun reference host** (`scripts/interview-host.ts`):

```sh
bun --env-file=.dev.vars scripts/interview-host.ts   # PORT (default 8788), HOST (default 127.0.0.1)
```

The reference host serves the same routes and replies as the Worker, from a single process:

- It keeps one `memoryRecord` and `memoryStore` per attempt, and schedules each wake with `setTimeout`.
- Background work runs inline.
- The rate limit is held in memory.
- The upgrading `fetch` described under Providers handles the voice socket.
- With `INTERVIEW_SOCKET_ENABLED=true`, it accepts the socket transport through `server.upgrade` and answers each message through the same routes.

It shows how little a host needs to write.

**Narrative from a file** (`scripts/interview-narrative.ts`) runs `writeNarrative` over a transcript without any host:

```sh
bun --env-file=.dev.vars scripts/interview-narrative.ts transcript.json [--spec sales-win-loss] [--out result.json]
```

The file can be a passages array, `{ specId, passages }`, an archive row from `INTERVIEW_ARCHIVE_DIR`, or a D1 interview row. The text streams to stdout; the result, with its failure and usage, goes to `--out` or follows on stdout.

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

1. **Copy the folder.** Copy `interview-engine/` to the host as `app/debrief/engine/`, and add any of the four packages the host lacks. Per the design, the host app is missing only `@ai-sdk/typesafe-ai`. The copy check above is the evidence that this compiles.
2. **Write a spec.** Add a folder like `interviews/sales-win-loss/`, with a `public.ts` for the screens and `*.prompt.ts` files for the server.
3. **Implement the seams.**
   - A `SessionStore` over the host's database. The design calls for an attempts row with a `segment` column and guarded writes that throw `FencedError` when the segment has moved on.
   - A `Background` for fire-and-forget work.
   - An `Archive` that upserts `InterviewArchiveRow`.
   - A host without durable timers makes `wake` a no-op and passes `lazyWake: true`.
4. **Build providers.** Call `foundryProviders(config, platform)`. Pass a `fetch` and `socket` opener if the platform's fetch cannot complete a WebSocket upgrade, as the Bun host does.
5. **Own an actor per attempt.** Call `SessionActor.restore({ spec, providers, foundry, typesafeKey, store, background, archive })`. Forward each command to `actor.handle`, and call `actor.close('connection')` when the host drops the attempt.
6. **Serve the report.** Wrap `writeNarrative` in a `NarrativeRunner`, and pass the settled result to `actor.settleNarrative`.
7. **Keep the browser on the engine's client.** Use `LiveConnection` with `pollTransport`, with `socketTransport`, or with a transport the host writes against `ProtocolTransport`.

Identity, the right to start, archive reads and the screens stay with the host. The engine checks only the capability.
