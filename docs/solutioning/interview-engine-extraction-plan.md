# Interview engine extraction plan

Written 2026-10-06, revised twice the same day: once after review, once to align with the host-grounded API design. Status: proposal, not started.

The authoritative statement of the seams, the two components and the host app mapping is now [interview-engine-api-design.md](interview-engine-api-design.md); where the two documents differ, that one wins. The actionable, file-level plan with commit boundaries, acceptance checks and release gates is [interview-engine-refactor-plan.md](interview-engine-refactor-plan.md), which supersedes section 4 below. This document keeps the current-state assessment (section 2) and the target structure (section 3).

The Debrief (`/interview`) is a proof of concept for a feature inside the host application. This document restates that goal, assesses how the current code is laid out against it, and proposes a target structure and a phased plan to get there.

Vocabulary follows the `improve-codebase-architecture` skill: a **module** has an **interface** and an **implementation**; a **seam** is where an interface lives; an **adapter** is a concrete thing satisfying an interface at a seam; a module is **deep** when a lot of behaviour sits behind a small interface. A seam is only real once two adapters exist for it.

## 1. The goal, restated

**The host application needs an interview engine, not a project-closeout feature.** What this repo has proven is a way to conduct a good spoken interview and turn it into a clean written document. Project closeout is the first subject that engine was pointed at. It should not be the only one.

The engine has two halves, and they should stay separable:

1. **Conducting the conversation.** A realtime voice interviewer (Sam) who is good at interviewing, backed by a slower map keeper (Sol) that tracks what has been said as entities, edges and threads, a judge (Jev) that reads each turn and grades coverage, a researcher (Luna) that looks up names the participant mentions, and code that ranks threads and feeds Sam short private notes. This half is responsible for one thing: a really good interview.
2. **Writing the document.** Take the finished interview (transcript, and ideally the map and coverage grades too) and produce a clean, well-attributed summary in a shape the consuming application wants.

**The engine must be subject-agnostic.** Its inputs are an interview specification, not a code change:

- **Topics to cover**, each with a criterion for what "explored" means, so Sol can find gaps and Jev can grade coverage.
- **An output template**, describing the document the summary half should write (sections, ordering, what belongs in each, what to leave out).
- **Framing**: who the participant is, what the conversation is for, and what Sam should and should not assume. Today this is prose inside Sam's brief and Sol's seed.

**The engine must be hosting-agnostic.** It should not know it runs on Cloudflare. Durable Object storage, alarms, `waitUntil`, D1 and the Workers WebSocket upgrade are adapters behind seams the engine defines. The same engine should run in a plain Bun process with in-memory adapters, which is also how it gets tested.

**The voice link is part of the engine.** The WebRTC audio path and the GPT-Live control socket are provider-specific, not cloud-specific, and the host app needs exactly the same thing. The browser half (`LiveConnection`: media, pause and resume holds, heartbeat, auto-mute, capability token) and the server half (session creation, attach, event translation) both travel with the engine. Only the React hooks and the URL layout of the HTTP routes stay in the host.

**Known future subjects** that the spec must be able to express:

- Project closeout, as today, with process-improvement output.
- Sales win/loss: why a deal did or did not close. Different topics, different document shape.
- Role-dependent closeouts: a developer, an infrastructure engineer, a PM and a BA should trigger different topics, so the topic list needs to vary with facts learned during the interview (a dynamic conversation map), not only with a fixed list chosen up front.

**Portability is the test.** The engine's source sits in one folder, with no imports reaching outside it, so that it can be copied into the host app repository and hosted there. Everything specific to this repo (the Cloudflare host, React Router pages, the party game, the sales simulator) stays outside the folder and plugs in through the engine's seams.

## 2. Where the engine lives today

### 2.1 Layout

The interview is spread across four layers and shares a lot with the sales simulator it was built on top of.

| Layer | Files | Portable today? |
|---|---|---|
| Pure core | `core/interview.ts`, `core/interview-map.ts`, `core/interview-notes.ts`, `core/interview-ranking.ts`, `core/interview-producer.ts`, `core/interview-timeline.ts` | Mostly. Generic logic, but imports `Speaker`, `TranscriptEntry`, `ObjectiveReading`, `SkillReading` from `core/simulator/types` and `DirectorUsage` from `core/simulator/director`. `core/interview.ts` also holds the closeout topic list. |
| Prompts and model calls | `ai/interview/scenario.server.ts`, `map.server.ts`, `rubric.ts`, `evaluate.server.ts`, `ranking.server.ts`, `research.server.ts`, `summary.server.ts`, `diagnostics.server.ts` | No. This is where the closeout content is hard-coded (see 2.2). Also imports `requestSol` from `ai/simulator/sol.server`, `evidenceBatches` from `ai/simulator/rubric`, and the `Scenario` type from `ai/simulator/scenarios.server`. |
| Orchestrator | `app/server/simulator/interview-producer.ts` (728 lines) | Nearly. `InterviewProducer` already takes an `Options` object of closures (`settled()`, `coverage()`, `send()`, `talking()`, `heard()`, `pauses()`, `waitUntil`) and a `services` record (`generateMap`, `evaluateTurn`, `evaluateTraits`, `lookupInterviewBackground`). That is already a port-shaped interface. It lives in the wrong folder and uses simulator transcript types. |
| Session lifecycle and host | `app/server/simulator/session.ts` (1035 lines), `live.server.ts`, `api.ts`, `app/server/interview/archive.server.ts` | No. `SimulatorSession` is one module doing three jobs: the Cloudflare Durable Object adapter, the session lifecycle state machine (lease, pause and resume holds, idle and limit warnings, transcript append, checkpoint and restore, archive timing), and the practice-versus-interview dispatch with about fifteen `if (interview)` branches. The lifecycle is engine-grade and should move. The Cloudflare calls should become adapters. |
| Voice link | `app/simulator/live-connection.ts` (browser), `live.server.ts` (server), `app/simulator/audio-levels.ts`, `core/simulator/network.ts` | Nearly. `LiveConnection` is framework-free and has no interview or simulator branches. `live.server.ts` is generic apart from importing `actorBrief` and `getScenario` from the simulator catalog. The Workers-only part is `attachLive`, which upgrades a `fetch` response to a WebSocket and calls `socket.accept()`. |
| UI | `app/routes/interview.tsx`, `app/interview/screens.tsx`, `app/simulator/use-simulator.ts`, `use-report.ts`, `conversation.tsx`, `voice-display.tsx` | No, and should not be. The host app will have its own screens. The React hooks are thin wrappers over `LiveConnection` and the report stream and can be offered as an optional React entry. |
| Evaluation | `ai/interview/fixtures.ts`, `run.ts`, `record-synthetic.ts`, `recordings.json`, `scripts/interview-*`, `scripts/sol-map-probe.ts`, `scripts/ranking-probe.ts`, storybook stories | Partly. Replay tools (`interview-replay.ts`, `interview-timeline.ts`) are engine-level. Fixtures and probes are closeout-specific and should travel with the closeout spec, not the engine. |

### 2.2 Where project closeout is hard-coded

This is the list the spec has to absorb. Each item is a place where swapping to a sales win/loss interview would require editing engine source.

| Where | What |
|---|---|
| `core/interview.ts` `interviewTopics` | The three topic groups and fourteen objectives. |
| `core/interview-map.ts` `MAP_TOPIC_IDS` | Flattened from `interviewTopics` and baked into Sol's output schema as an enum (`map.server.ts` `threads[].topics`). The schema itself is subject-specific. |
| `ai/interview/scenario.server.ts` | `topicCriteria` per objective; `interviewScenario.opening`; `interviewerBrief` prose (purpose, early orientation on project, client and team, boundaries); `interviewOpening`. The thirteen techniques are generic and stay in the engine. |
| `ai/interview/map.server.ts` | `PURPOSE`, the SETTING line in `mapSeed`, the CLOSEOUT TOPICS block, and in `mapInstructions` the "real project closeout", "client or delivery team", and "the team, by default" default-thread rules. |
| `ai/interview/rubric.ts` | `sourceRule` ("client means the project customer"), the `project-role` special case, coverage questions built from closeout criteria. The three readings (engagement, openness, specificity) are generic. |
| `ai/interview/ranking.server.ts` | `sourceRule` again; "closeout interview" wording in trait rules. The turn and thread questions are generic. |
| `ai/interview/summary.server.ts` | The entire system prompt: "internal project-closeout summary", the three pillar headings, the optional sections. |
| `app/interview/screens.tsx` | Setup copy and the example. UI, so out of scope for the engine, but it reads `interviewTopics` directly. |
| `app/server/simulator/api.ts` `startSchema` | A refine that ties `project-closeout` to the Sam voices. |

### 2.3 Where Cloudflare is hard-coded

Every call below is in `app/server/simulator/session.ts` unless noted. These are the seams the engine has to define.

| Cloudflare primitive | Used for | Engine seam |
|---|---|---|
| `class extends DurableObject<Env>`, `ctx.blockConcurrencyWhile` | One owner per session id; restore before first request | Host invariant, documented on the interface: exactly one live `InterviewSession` per id, restored from the store before it handles input. |
| `ctx.storage.get/put/delete/deleteAll` of `lease` and `checkpoint` | Surviving isolate restarts; holding a paused attempt | `SessionStore` (the browser secret moves into the checkpoint as `capability`) |
| `ctx.storage.setAlarm`, `alarm()` | Closing orphans, ending paused attempts, retrying provider close, periodic partial archive, storage GC | `SessionStore.wake`, a hint; every job also runs on the next touch so hosts without timers stay correct |
| `ctx.waitUntil` (about twenty call sites) | Background grading, directing, archiving, pausing | `Background` (track work past the request) |
| `env.SIMULATOR_ARCHIVE` with `D1Database.prepare` (`archive.server.ts`) | Partial and final archive rows | `Archive` |
| `env.TYPESAFE_API_KEY`, `foundryConfig(env)` | Provider configuration | Already a plain object; passes through `Providers`. |
| `response.webSocket` and `socket.accept()` (`live.server.ts` `attachLive`) | GPT-Live control socket | `ControlSocket` (connect a WebSocket with headers) |

The rule that a seam is only real with two adapters is satisfied for every row from the start: the Cloudflare adapter, and an in-memory or Bun adapter used by the engine's tests and by the reference host in Phase 5.

### 2.4 Coupling to the simulator

These are the imports the engine folder has to stop making.

- **Speaker naming.** `Speaker = 'trainee' | 'client'`. In the interview the participant is `trainee` and Sam is `client`, so every consumer relabels. The engine owns `participant | interviewer`.
- **Transcript and evidence types.** `TranscriptEntry`, `Evidence`, `ObjectiveReading`, `SkillReading` from `core/simulator/types`; `findEvidence`, `settledTranscript`, `appendTranscript`, `TRANSCRIPT_LIMIT` from `core/simulator/state`.
- **Scenario and cast types.** `Scenario`, `Client`, `ClientStats` are sales-simulator shapes. Sam is squeezed into a `Client` with assertiveness and bargaining stats he does not use. `live.server.ts` reaches into the catalog for the brief.
- **Model transport.** `requestSol` (Foundry Responses API with strict JSON schema and cache breakpoints) is generic and moves into the engine. `evidenceBatches` likewise.
- **Reverse coupling.** `core/simulator/types.ts` imports `InterviewSession` from `core/interview.ts`, and `ai/simulator/scenarios.server.ts` dispatches `getScenario`, `getClient`, `actorBrief`, `openingInstruction` and `otherSpeaker` to the interview module. Once the engine is separate, the simulator must not know it exists.
- **Report lifecycle.** `SessionReport<T>`, `ReportState`, `useStreamedReport` are shared with the coaching report. The engine's summary half exposes a stream and a small retry state; the host persists it.

### 2.5 What is already right

- The core/prompt split is clean: ranking, notes, map validation and producer bookkeeping have no model calls and are well tested.
- `InterviewProducer` is already written against closures and an injectable `services` record. Extraction is mostly moving it and changing types.
- `LiveConnection` is already framework-free and product-agnostic.
- Sol is the only writer of the map, Sam never sees the topic list, and notes are code-filled templates. Those design decisions carry over unchanged and are what make the engine subject-agnostic in principle. The work is making them subject-agnostic in fact.
- Prompt versions (`sol-map-v11`, `interview-rubric-v8`, `ranking-rubric-v2`, `interview-summary-v1`, `interview-producer-v19`) are recorded on archive rows, so replays stay comparable across the refactor.

## 3. Target structure

One folder, `interview-engine/`, with three subtrees and a boundary check enforcing that `client/` never imports `server/`, `server/` never touches the DOM, and nothing imports from outside the folder. Dependencies limited to `ai`, `@ai-sdk/azure`, `@ai-sdk/typesafe-ai` and `zod`. No `cloudflare:workers`, no React Router, no Bun-only APIs.

The tree below is the one in the API design, section 3. It follows the host app's file conventions (`.server.ts` suffix, camelCase names, no barrel `index.ts`, `*.prompt.ts`) so the move into the host app is a copy.

```
interview-engine/
  README.md  CONTEXT.md  adr/
  shared/        spec.ts  transcript.ts  snapshot.ts  protocol.ts  network.ts
  client/        liveConnection.ts  audioLevels.ts  reportStream.ts  react.ts
  reporting/     reporting.server.ts  summarize.server.ts  evaluate.server.ts  reportRun.server.ts  summary.prompt.ts  rubric.prompt.ts
  conducting/    conducting.server.ts  seams.server.ts  adapters/memory.server.ts
                 session/  voice/  conversation/  transcript/  replay/
                 interviewer.prompt.ts  map.prompt.ts  ranking.prompt.ts  research.prompt.ts
  providers/     foundry.server.ts  structured.server.ts  judge.server.ts  diagnostics.server.ts
```

Two components: `conducting/` turns a live interview into a transcript; `reporting/` turns a transcript and a template into a document and has no dependency on sessions, storage or wakes. `conducting/` imports `reporting/` for the final coverage grade; nothing imports the other way. Full file-level detail, the Cloudflare and the host app adapters per seam, and the Postgres tables the host app adds are in the API design, sections 3, 8 and 9.


Outside the engine, in this repo:

```
interviews/
  project-closeout/
    spec.ts                    the InterviewSpec: topics, criteria, framing, voices, summary template
    fixtures.ts                synthetic transcripts and expectations (from ai/interview/fixtures.ts)
    recordings.json
    probes/                    closeout rehearsal and probe scripts
  sales-win-loss/              Phase 5
app/server/interview/
  durable-object.ts            Cloudflare adapters: SessionStore over ctx.storage (wake over setAlarm), Background over waitUntil, ControlSocket over fetch upgrade; HTTP poll transport
  archive-d1.ts                Archive over D1
  routes.ts                    mounts protocol.ts onto /api/interview/...; capability check; rate limits
app/interview/                 React screens, as now, importing from interview-engine/client
```

### 3.1 The spec

The spec is a plain object. Everything in section 2.2 becomes a field on it.

```ts
type InterviewSpec = {
  id: string;                               // 'project-closeout'
  version: string;                          // bumped with content changes, recorded on archives
  purpose: string;                          // one paragraph, shared by Sam's brief and Sol's seed
  participant: { role: string; setting: string }; // "a member of the delivery team on a real client project"
  interviewer: {
    name: string;                           // 'Sam'
    persona: string;
    voices: { id: string; voice: string; behavior: string }[];
    opening: string;                        // what Sam says first
    orientation: string[];                  // what to establish early (project, client, team)
    boundaries: string[];                   // what not to assume or probe
    vocabulary: Record<string, string>;     // 'client' -> 'the project customer', fed to Jev source rules
  };
  topics: TopicGroup[];                     // { id, label, objectives: { id, label, criterion, hint }[] }
  defaultThreads: { id: string; label: string; rule: string }[];  // "the team, by default"
  branches?: RoleBranch[];                  // see 3.2
  research?: { enabled: boolean; kinds: ResearchKind[] };
  pace?: { offerAfterMs: number; offerSpacingMs: number };
  limits?: { durationSeconds: number; idleWarningMs: number; pauseHoldMs: number; maxResumes: number };
  summary: OutputTemplate;
};

type OutputTemplate = {
  title: string;                            // 'Internal project-closeout summary'
  audience: string;
  sections: { heading: string; purpose: string; required: boolean }[];
  rules: string[];                          // attribution, what to omit, diagrams allowed
  format: 'markdown';
};
```

The three prompts that today embed closeout prose (`interviewerBrief`, `mapSeed` and `mapInstructions`, the summary system prompt) become template functions over this object. Sol's output schema is built per spec so the `topics` enum reflects the spec's objective ids. Jev's coverage questions are built from each objective's criterion; its source rules from `spec.interviewer.vocabulary`.

### 3.2 Role-dependent topics

Sol already decides which threads exist and reports `vantage` (who the participant is). Branching fits there without a new mechanism:

- A `RoleBranch` is `{ id, when: string; add: TopicGroup[]; remove?: string[] }`, where `when` is prose Sol can judge ("the participant did hands-on development").
- Sol's output schema gains `activeBranches: string[]`. Sol declares which branches apply, with a citation, under the same participant-fact rules `applyMapUpdate` already enforces.
- Code resolves the active topic set from `spec.topics` plus active branches and feeds it to the coverage tail, Jev's coverage questions and the summary. Branch topic ids are in Sol's `topics` enum from the start so no schema rebuild is needed mid-interview.
- Sam never sees any of it, as now.

### 3.3 The seams

`conducting/seams.server.ts` is the whole hosting contract for the conducting component; the reporting component has none beyond model credentials.

```ts
type SessionStore = {                                   // bound by the host to one attempt (on the host app, to one segment of it)
  load(): Promise<{ checkpoint?: Checkpoint }>;
  save(patch: { checkpoint?: Checkpoint | null }): Promise<void>;   // durable before it returns; throws FencedError when this writer was superseded
  wake(at: number | null): Promise<void>;                            // a hint; hosts with durable timers call actor.wake(), others ignore it
  clear(): Promise<void>;
};
type Background = { track(work: Promise<unknown>): void };                          // must outlive the current request
type Archive = { write(row: InterviewArchiveRow): Promise<void> };                   // upsert by id; best effort
type ControlSocket = { connect(url: string, headers: Record<string, string>): Promise<WebSocketLike> };
type Seams = { store: SessionStore; background: Background; archive: Archive; socket: ControlSocket };
```

The earlier `Alarm` and `Clock` seams are gone, and so is the shared `SessionHost` type from the previous revision. The wake is a hint on `SessionStore`; the API design, section 8.3, lists each alarm job's lazy equivalent, and the engine requirement that makes ignoring the hint correct: every wake job is idempotent and also runs on `restore` and the first command after it.

Ownership is split into what is essential everywhere and what is optional. The API design, section 8.4, names five essential guarantees (one writer, serialized inside the writer, successor safety, durable before acknowledged, capability checked in the actor) and three optional ones that differ by host (continuity without browser action, timers without a process, provider re-attach) as documented host policy, not capability flags. The browser's *capability* and the host's *ownership* are different things and are named differently everywhere.

Adapters:

- Engine: `adapters/memory.server.ts` (tests, reference host); both browser transports, `pollTransport` and `socketTransport`, in `client/`.
- This repo: `app/server/interview/durable-object.ts` (the runtime is the owner guarantee; mailbox still used; HTTP polling) and `archive-d1.ts`.
- The host app: `app/debrief/attemptStore.server.ts` over Drizzle (one `interview_attempts` row serving `SessionStore` and `Archive`; `save` is a conditional `UPDATE ... WHERE segment = $segment`), `interviewSocket.server.ts` (the `upgradeWebSocket` route that owns one actor per live socket), and a `SIGTERM` drain in `app/server.ts`.

The engine never imports `Env`.

### 3.4 Public surface

```ts
// conducting/conducting.server.ts
export class SessionActor {       // one per owned attempt; every entry point is enqueued on a mailbox
  static restore(spec, context, providers, seams): Promise<SessionActor>;
  handle(command: Command): Promise<Reply>;   // start/ready/poll/pause/resume/end; capability checked inside
  wake();                                     // host's durable wake fired (Cloudflare only)
  close(reason: 'connection' | 'drain' | 'fenced');   // connection/drain: pause, close voice, checkpoint; fenced: close voice, write nothing
  idle(); snapshot(); transcript();           // transcript is the primary output
}
export class FencedError extends Error {}
// InterviewSession keeps its typed lifecycle methods but is reached only through the actor.

// reporting/reporting.server.ts  (no session, storage or wake dependency)
export function summarizeInterview(input: { transcript: Passage[]; template: OutputTemplate; enrichment?: { map?; coverage?; background?; known? } }, providers, signal?): { stream: ReadableStream<string>; result: Promise<ReportResult> };
export function evaluateInterview(spec, transcript: Passage[], providers, signal?): Promise<InterviewEvaluation>;
export class ReportRunner { attach(signal): Response; state(): ReportState }   // one run, one retry, deadline, re-attach

// client
export class LiveConnection { constructor(transport: ProtocolTransport, callbacks: Callbacks); start(voiceId); resume(); pause(); end(); dispose(); }   // transport: pollTransport(url) or socketTransport(url); resumes once on socket close
```

`session.summary()` no longer exists. The host composes report generation: read the transcript (from the session or the archive), run `summarizeInterview` through a `ReportRunner`, store the document on its own record. API design, section 7.2, explains why.

The host keeps: identity and routes, how it decides it owns an attempt (Durable Object identity, or one actor per WebSocket with a segment guard), process lifecycle (drain on termination), composing the report, and any UI.

### 3.5 Reporting gets more input

Today `summarizeInterview` sees only the transcript. The map (entities, threads, closed and declined items), coverage grades and research facts are available at finish and would ground the document better and let the template say "mark unexplored topics as open questions". Make them optional inputs so a transcript-only call still works, which is what lets the reporting component run over transcripts imported into the host application that never had a session.

## 4. Plan (superseded)

Superseded by [interview-engine-refactor-plan.md](interview-engine-refactor-plan.md), section 9, which splits these phases into eight with named commits, the files each one moves, and the gate for each. Kept here for the reasoning behind the order.

Each phase leaves `bun run check`, the unit tests and the acceptance scripts green and the `/interview` route working. Phases 1 through 3 are mechanical and low risk. Phase 4 splits the Durable Object and needs the connection acceptance scripts. Phase 5 changes prompt text and needs the replay probes.

### Phase 1. Neutral types and a spec object, in place

- Add `interview-engine/shared/transcript.ts` with `Passage` and `speaker: 'participant' | 'interviewer'`, plus the state helpers. Add a one-line adapter in the host from `TranscriptEntry`.
- Add `interview-engine/shared/spec.ts`. Write `interviews/project-closeout/spec.ts` by lifting the exact strings from `core/interview.ts`, `scenario.server.ts`, `map.server.ts` and `summary.server.ts`. No wording changes yet.
- Break the reverse import: remove `interview?: InterviewSession` from `SessionSnapshot` in favour of a host-level union, so `core/simulator/types.ts` no longer imports the interview.
- Record `spec.id` and `spec.version` on archive rows alongside the prompt versions.
- Add `scripts/engine-boundary-check.ts` now, even though the folder is nearly empty, so every later move is checked. `scripts/simulator-bundle-check.ts` is the model.

### Phase 2. Move the pure core and the voice link

- Move `core/interview-map.ts`, `-notes.ts`, `-ranking.ts`, `-producer.ts`, `-timeline.ts` and the turn heuristics into `server/conversation/` and `server/transcript/`. Switch imports to engine types. Tests move with them. `MAP_TOPIC_IDS` becomes a function of the spec.
- Move `app/simulator/live-connection.ts`, `audio-levels.ts` and `core/simulator/network.ts` into `client/` and `shared/`. `LiveConnection` takes a `ProtocolTransport` instead of building URLs itself; the app passes one that targets `/api/simulator/sessions` for now. The simulator keeps using the moved class through the app's transport, so there is one copy.
- Move `live.server.ts` into `server/voice/gpt-live.ts`, taking the brief and voice as arguments instead of reading the catalog, and `attachLive` taking a `ControlSocket`. Add the Workers `ControlSocket` adapter in `app/server/`. The simulator imports the moved functions for now.
- Move `requestSol`, `evidenceBatches`, `callFailure`, `foundry.server.ts` into `server/providers/`. The simulator keeps its own copies so it does not depend on the engine.

### Phase 3. Move the orchestrator

- Move `InterviewProducer` to `server/conversation/producer.ts`. Its `Options` already matches the shape; rename `waitUntil` to `background.track`, make `services` default to the real providers.
- Delete `DirectorUsage` from the engine in favour of an engine-local `ModelUsage`.
- At this point every interview model call and all interview logic is inside the folder. `session.ts` still hosts it.

### Phase 4. Split the session

This is the largest step and the one that delivers hosting agnosticism.

- Write `conducting/seams.server.ts`, `conducting/host.server.ts` and `conducting/adapters/memory.server.ts`.
- Move `SessionReport` (`app/server/simulator/report.ts`) into `reporting/reportRun.server.ts` as `ReportRunner`, and make `summarizeInterview` return `{ stream, result }` with transcript, template and optional enrichment as plain inputs. This is the reporting component; it has no seams.
- Extract the lifecycle from `session.ts` into `conducting/session/` as `InterviewSession` behind a `SessionActor` mailbox, interview-only, against the seams. Every entry point (command, control-socket message, tick, wake, background completion) is enqueued; `FencedError` from the store moves the actor to `fenced` and closes the provider socket. Every alarm job becomes idempotent and also runs on `restore` and the first command, so a host that never calls `wake` is still correct (API design 8.3). Rename the stored browser secret from `lease` to `capability` (hashed, inside the checkpoint). Keep the current behaviour exactly: lease and checkpoint rules, pause holds and resume limits, idle and limit warnings, capacity deadline, partial archive cadence, provider close retries, orphan closing, and every alarm purpose in the API design's call-site table (section 8.2), now expressed as `store.wake(at)`. The summary lifecycle leaves the session. Port the relevant `session.test.ts` and `session-fixture.ts` cases to run against the memory adapters, which is the first time this logic is testable without `cloudflare:workers`.
- Write the acceptance tests from the API design section 8.9 against the memory adapters with a segment-guarded store and a scripted provider: one writer, serialization, connection scoping, drain, lazy wake jobs, transcript integrity, capability. Add `socketTransport` next to `pollTransport` in `client/` and the socket framing in `shared/protocol.ts`; the reference host in Phase 6 mounts both.
- Write `app/server/interview/durable-object.ts`: a Durable Object of about a hundred lines that builds the Cloudflare adapters (`ctx.storage` for `SessionStore` including `setAlarm` for `wake`, `waitUntil`, D1, fetch upgrade), restores a `SessionActor` under `blockConcurrencyWhile`, forwards `fetch` to `actor.handle` and `alarm()` to `actor.wake()`. Mount routes under `/api/interview/...` using `shared/protocol.ts`; keep `/api/simulator/sessions` serving only the practice simulator. The browser's `ProtocolTransport` for the interview points at the new routes.
- Write the report route in `app/server/interview/routes.ts`: `ReportRunner` over `summarizeInterview`, reading the transcript from the session or the D1 row, writing the document back to D1. The browser's `reportStream.ts` reads status from this route instead of the snapshot.
- Remove the interview from the simulator: the `if (interview)` branches in `session.ts`, the dispatch in `ai/simulator/scenarios.server.ts`, `'Interview'` from `ScenarioSummary.category`, the `startSchema` refine. The simulator's `SimulatorSession` keeps its Cloudflare calls as-is; it is not the subject of this plan.
- Run `scripts/simulator-connection-acceptance.mjs` in both interview modes, `interview-live-acceptance.mjs` and `interview-summary-acceptance.mjs`.

### Phase 5. Spec-driven prompts

- Rewrite `interviewerBrief`, `mapInstructions` plus `mapSeed`, the rubric source rules, the ranking trait rule, and the summary system prompt as functions of the spec. Build Sol's output schema per spec.
- Verify with the replay tools: `scripts/sol-map-probe.ts` and `scripts/ranking-probe.ts` against the archived closeout interviews, and the Jev fixture run (`ai/interview/run.ts`) must reproduce `recordings.json` within tolerance. Bump prompt versions.
- Add `OutputTemplate` handling to the summary and pass map, coverage and research into it.
- Add `RoleBranch` to the spec and `activeBranches` to Sol's schema. Ship the closeout spec with branches for developer, infrastructure, PM and BA.

### Phase 6. Prove portability

- Write `interviews/sales-win-loss/spec.ts` with a small topic list and a different template. Run it through the storybook and one rehearsal. Anything in `interview-engine/` that has to change to make it work is a leak to fix.
- Write the reference host: `interview-engine/README.md` plus a `Bun.serve` example of under two hundred lines using `adapters/memory.ts`, mounting `shared/protocol.ts`, and serving a bare HTML page that uses `client/live-connection.ts`. Run `interview-live-acceptance.mjs` against it. That host is also the host app integration guide, and it is the second adapter that makes every seam real.
- Write `CONTEXT.md` and the first ADRs into the engine folder so the glossary and the decisions travel with the code.
- Dry-run the host app landing without touching the host app's main branch: copy the folder to `app/debrief/engine/` in a the host app worktree, add `debrief.db.schema.ts` with the one table from the API design (section 8.6), the attempt store with the segment guard, `useWebSocket: true` and the socket route in `app/server.ts` with its `SIGTERM` drain, and the report route, run two local processes against one PGlite or Postgres to exercise a browser reconnect from one to the other and a fenced stale writer, and run the live acceptance script against `bun run dev` on PGlite. Anything the engine needs changed is a leak; anything the host app needs beyond the list in the API design's section 9.12 is a gap in this plan.

### What stays behind

- The React screens and React Router routes. The host app builds its own screens on `client/`.
- The Cloudflare adapters and the D1 archive, in `app/server/interview/`.
- The party game and the sales simulator, untouched except for the removal of interview dispatch and the shared voice-link import.
- Storybook stories, which keep working against the spec and the engine's exported types.

## 5. Risks and judgment calls

- **Phase 4 is a rewrite of a 1000-line file that works.** Mitigation: move the code, do not redesign it. Keep method names and the checkpoint shape so an in-flight paused attempt survives a deploy. The connection acceptance scripts are the regression net; add memory-adapter unit tests before extracting, not after.
- **Ownership was the most Cloudflare-shaped assumption, and it is now split in two.** The essential part, one writer per attempt with serialized writes and a superseded writer that stops touching the voice provider, holds on every host: Durable Objects give it from the runtime, the host app gets it from one actor per browser WebSocket plus a `segment` guard on every write. The optional part, continuity with no browser action and timers with no process, stays Cloudflare's. On the host app a deploy or crash ends the live connection and the browser reconnects from the persisted transcript, automatically once. The previous revision's lease runtime, forwarding and transfer protocol are gone (API design 8.4 to 8.11).
- **The host app has no background scheduling today**, and this design adds none: `wake` is a no-op there, every wake job runs on the next touch, and abandoned attempts are tidied lazily. Deploys need a `SIGTERM` drain, new to the host app, and optionally a 30-second container stop grace; neither is required for correctness.
- **Prompt regressions in Phase 5.** Rewriting prose as templates changes tokens even when meaning is the same, and Sol's cache keys reset. Do it as one versioned change, replay the archived interviews before and after, and keep the pre-refactor strings in the closeout spec so the diff is reviewable.
- **Sol's schema per spec.** Strict JSON schema with a per-spec enum means the schema hash is part of the cache key. Fine for one spec per deployment; worth noting if the host application runs several spec versions at once.
- **Branching may need Sol to re-seed.** If branch topics are only added to the enum up front, Sol needs their criteria in the seed too. Simplest: the seed lists all topics including branch topics, grouped by branch with their `when` condition, and the tail reports which branches are active. Confirm with a probe before committing to it.
- **Sharing the voice link with the simulator.** After Phase 2 the practice simulator imports `LiveConnection` and `gpt-live.ts` from the engine folder. That is a dependency from the simulator onto the engine, the reverse of the one being removed. It is acceptable because the voice link has no interview content, but it means the boundary check must allow imports *into* the engine's `client/` and `server/voice/` from outside while forbidding the other direction.
- **Browser and server in one folder.** Bundlers must never pull `server/` into the browser. The boundary check plus the existing `simulator-bundle-check.ts` strings (Sam's behaviour text, the Sol producer line) cover it; extend the latter with a marker string from `server/prompts/`.
- **The summary's extra inputs raise prompt size.** A late map can be several thousand tokens. Pass `renderMapForSol` output rather than the raw object, and make it optional so cost can be tuned per spec.
