# Interview engine refactor: coding plan

Written 2026-10-06. Status: plan only. Nothing here has been implemented, committed, merged or deployed. The `interview-quality` branch keeps its uncommitted listening-hold work; section 8 says how this plan stays out of its way.

This is the actionable plan for refactoring Out of Character so that the interview engine ("The Debrief") is a self-contained folder that the host application can later copy, adding only host adapters and an interview specification. It is grounded in the current code on `interview-quality` (`2a5fce6` plus the working tree) and in two design documents that remain authoritative for *why*:

- [interview-engine-api-design.md](interview-engine-api-design.md): seams, contracts, the Cloudflare and the host app hosts, essential versus optional guarantees (its section 8.4), the simplified ownership model.
- [interview-engine-extraction-plan.md](interview-engine-extraction-plan.md): the current-state assessment and the original six-phase sketch. This document supersedes its section 4 with file-level phases and commit boundaries.

Where this document and the API design differ on a contract, the API design wins and this document should be corrected.

Scope split, stated once: **sections 1 to 11 are work for this repository now.** Section 12 lists what is deferred to the host app integration, including infrastructure tests and orphan-session cleanup, which Andrew has asked to treat as future the host app acceptance tasks rather than blockers here.

---

## 1. Outcome and non-goals

When the plan is complete:

- `interview-engine/` contains everything needed to conduct an interview and to report on a transcript, imports nothing from `app/`, `core/` or `ai/`, uses no `cloudflare:workers`, React Router, Vite or Bun-only API, and depends on `ai`, `@ai-sdk/azure`, `@ai-sdk/typesafe-ai` and `zod` only.
- A script proves that by copying the folder to an empty directory and type-checking it there.
- Conducting (live interview to transcript) and reporting (transcript plus specification to document) are two components. Reporting runs without a session: from a finished attempt, from a transcript file, or from an HTTP request carrying a transcript.
- The Cloudflare host is about a hundred lines of Durable Object plus a route file, and keeps alarms, silent restore, orphan provider retries and storage GC exactly as today.
- The browser voice behaviour, resume and authorization semantics, transcripts, conversation maps, reporting, navigation and the practice simulator behave as they do today, checked by the existing acceptance scripts.
- The project-closeout interview is a specification object in `interviews/project-closeout/`, and a second small specification exercises the engine without any engine change.

Non-goals for this plan: touching the host application; any shared lease or ownership runtime (the API design section 8.4 settles this: Cloudflare keeps its native Durable Object capabilities, the host app uses connection-scoped ownership and a segment guard, the engine demands only the essential guarantees); role branching in the specification (API design decision 6: probe first); changing the practice simulator beyond removing interview dispatch from it; prompt wording changes.

---

## 2. Ground truth: what exists and what happens to it

Line counts are from the working tree today. "Fate" uses four verbs: **move** (git mv, same content, imports fixed), **extract** (part of a file becomes a new file), **replace** (new implementation of the same behaviour), **delete**.

### 2.1 Server: conducting and the host

| File | Lines | Today | Fate |
|---|---|---|---|
| `app/server/simulator/session.ts` | 1035 | `SimulatorSession` Durable Object shared by practice and interview; ~34 `interview` branches; lease, checkpoint, alarm, pause/resume, grading, report, archive | **extract** the interview lifecycle into `interview-engine/conducting/session/*`; **delete** the interview branches afterwards; the practice simulator keeps the class |
| `app/server/simulator/interview-producer.ts` | 728 | `InterviewProducer`, `producerServices` (map, turn, traits, research) | **move** to `interview-engine/conducting/conversation/producer.server.ts` |
| `app/server/simulator/live.server.ts` | 52 | `createLive`, `attachLive`, `transcriptEvent`, `LiveSessionGone`, `liveConfiguration` reading the scenario catalog | **extract** the provider calls into `interview-engine/conducting/voice/gptLive.server.ts` taking brief and voice as arguments; the practice simulator keeps `liveConfiguration` and imports the moved functions |
| `app/server/simulator/report.ts` | 85 | `SessionReport` (bounded run, retry, re-attachable stream), `within` | **move** to `interview-engine/reporting/reportRun.server.ts`; the practice simulator imports it from there (the alternative, a second copy, is listed in section 13) |
| `app/server/simulator/api.ts` | 68 | `/api/simulator/...` router, `startSchema` refine for interviews, `liveAvailable` | **replace** the interview parts with `app/server/interview/routes.ts`; remove the interview refine |
| `app/server/simulator/archive.server.ts` | 94 | practice archive and report writers, `archiveProvenance` | keep; interview provenance moves with the interview archive |
| `app/server/interview/archive.server.ts` | 54 | `writeInterviewArchive(db, write)` upsert into D1 `interview_attempts` | **replace** with `app/server/interview/archiveD1.server.ts` implementing the engine's `Archive` seam over the same table |
| `app/server/simulator/contextual-director.ts` | 194 | practice only | keep |
| `app/workers/app.ts` | 18 | worker entry, exports `SimulatorSession` | add the `InterviewObject` export and the interview route dispatch |
| `wrangler.jsonc` | | one DO binding `SIMULATOR_SESSIONS`, migration `simulator-v1` | add binding `INTERVIEW_SESSIONS` class `InterviewObject`, migration tag `interview-v1` with `new_sqlite_classes`, in both envs |

### 2.2 Server: reporting and model calls

| File | Lines | Today | Fate |
|---|---|---|---|
| `ai/interview/summary.server.ts` | 61 | `summarizeInterview(input, finish)` streaming Markdown document, `SUMMARY_VERSION` | **move** to `interview-engine/reporting/summarize.server.ts`; the system prompt moves to `summary.prompt.ts` unchanged |
| `ai/interview/evaluate.server.ts` | 108 | `evaluateInterview` (Jev coverage and readings), `dialogueState`, `readInterviewAnswers` | **move** to `interview-engine/reporting/evaluate.server.ts`; stop importing `scenario.server.ts` for the interviewer list (pass the spec) |
| `ai/interview/rubric.ts` | 91 | `interviewQuestions`, `INTERVIEW_RUBRIC_VERSION` | **move** to `interview-engine/reporting/rubric.prompt.ts` |
| `ai/interview/map.server.ts` | 225 | Sol map prompt and `generateMap`, `settledPrefix`, `MAP_PROMPT_VERSION` | **move** to `interview-engine/conducting/conversation/map.server.ts` and `map.prompt.ts`, *after* interview-quality lands (section 8) |
| `ai/interview/ranking.server.ts` | 213 | Jev turn and trait ranking | **move** to `conducting/conversation/ranking.server.ts` |
| `ai/interview/research.server.ts` | 93 | public-background lookup | **move** to `conducting/conversation/research.server.ts` |
| `ai/interview/scenario.server.ts` | 110 | `interviewers`, `interviewScenario` typed as a practice `Scenario`, `interviewerBrief`, `interviewOpening` | **extract**: voices and brief text into `interviews/project-closeout/spec.ts`; brief assembly into `conducting/voice/interviewer.prompt.ts`; the practice `Scenario` typing is deleted. After interview-quality lands |
| `ai/interview/diagnostics.server.ts` | 14 | call failure shaping | **move** to `interview-engine/providers/diagnostics.server.ts` |
| `ai/interview/fixtures.ts`, `recordings.json`, `run.ts`, `record-synthetic.ts` | | Jev fixture corpus and runner | **move** to `interviews/project-closeout/fixtures/` (the corpus is closeout-specific) |
| `ai/foundry.server.ts` | | `FoundryConfig`, `foundryConfig(env)`, `foundryProvider`, `foundryUrl` | **extract** `FoundryConfig`, `foundryProvider`, `foundryUrl` into `interview-engine/providers/foundry.server.ts`; `foundryConfig(env)` stays in `ai/` because it reads `Env` |
| `ai/simulator/sol.server.ts` | | `requestSol`, `DirectorOutputError`, `DirectorHttpError`, `SolMessage` | **copy** into `interview-engine/providers/structured.server.ts` (the practice simulator keeps its own, see section 13) |
| `ai/judging.ts` `JEV_MODEL`; `ai/simulator/rubric.ts` `evidenceBatches` | | shared constants and a helper | **copy** the constant and the helper into `interview-engine/providers/judge.server.ts` |
| `ai/simulator/scenarios.server.ts` | | dispatches `interviewScenario` and `interviewers` by id in `getScenario`, `getClient`, `actorBrief`, opening | **delete** the interview dispatch once the host no longer routes interviews through the practice simulator |

### 2.3 Pure core

| File | Lines | Today | Fate |
|---|---|---|---|
| `core/interview.ts` | 133 | closeout constants (`INTERVIEW_SCENARIO_ID`, `INTERVIEWER_NAME`, `interviewVoices`, `interviewReadings`, `interviewTopics`, `COVERAGE_LEVELS`), types (`InterviewEvaluation`, `InterviewSummary`, `interviewSummarySchema`, `InterviewBackground`, `InterviewSession`), turn heuristics (`isBackchannel`, `yieldsTurn`, `finishesTurn`, `asksToEnd`), `mergeCoverage`, `coverageConfidence` | **extract** three ways: closeout constants to `interviews/project-closeout/spec.ts`; types and schemas to `interview-engine/shared/spec.ts`, `shared/snapshot.ts`, `shared/transcript.ts`; turn heuristics to `conducting/transcript/turns.ts` |
| `core/interview-map.ts` | 197 | `ConversationMap`, `applyMapUpdate`, `renderMapForSol`, `MAP_TOPIC_IDS` derived from `interviewTopics` | **move** to `conducting/conversation/map.ts`; `MAP_TOPIC_IDS` becomes `mapTopicIds(spec)` |
| `core/interview-notes.ts` | 191 | producer note selection, `ListState`, `nextListNote` (**being edited by interview-quality**) | **move** to `conducting/conversation/notes.ts` after it lands |
| `core/interview-ranking.ts` | 195 | thread states and ranking (**test being edited by interview-quality**) | **move** to `conducting/conversation/ranking.ts` after it lands |
| `core/interview-producer.ts` | 180 | record types, `PRODUCER_VERSION`, `fitRecords`, `gradeObjectives` | **move** to `conducting/conversation/records.ts` |
| `core/interview-timeline.ts` | 151 | producer timeline for the storybook and scripts | **move** to `conducting/replay/timeline.ts` |
| `core/simulator/types.ts` | | `SessionSnapshot` carries `interview?: InterviewSession` (the reverse import from the practice simulator into the interview) | **delete** the `interview?` field once `InterviewSnapshot` exists |
| `core/simulator/state.ts` (`TRANSCRIPT_LIMIT`, `transcriptCharacters`, `findEvidence`), `core/simulator/network.ts` | | shared by both | **copy** the three transcript helpers into `shared/transcript.ts`; **move** `network.ts` to `shared/network.ts` and have the practice simulator import it from there |

### 2.4 Browser

| File | Lines | Today | Fate |
|---|---|---|---|
| `app/simulator/live-connection.ts` | 513 | `LiveConnection` with WebRTC, polling, pause, heartbeat, resume, mute, end; builds `/api/simulator/sessions` URLs itself | **move** to `interview-engine/client/liveConnection.ts`; URL building becomes a `Transport` passed in; the practice simulator imports it with a transport pointing at `/api/simulator/sessions` |
| `app/simulator/audio-levels.ts` | | analyser read | **move** to `client/audioLevels.ts` |
| `app/simulator/use-simulator.ts` | 148 | phases and the `ooc-attempt-${kind}` sessionStorage claim | keep in the app; it is React and app-specific. The claim gains a `route` field for the cutover (section 9, Phase 5) |
| `app/simulator/use-report.ts` | | `useStreamedReport(schema, hasContent)` over `@ai-sdk/react useObject` | keep; `client/reportStream.ts` is the non-React core it calls |
| `app/interview/screens.tsx`, `summary-markdown.client.tsx`, `interview.css`, `app/routes/interview.tsx` | | the React screens | keep; imports change from `core/interview` and `app/simulator/*` to `interview-engine/shared/*`, `client/*` and the spec |
| `app/storybook/interview-stories.tsx`, `interview-judging-story.tsx`, `interview-timeline-story.tsx` | | stories | keep; imports change |

### 2.5 Scripts, tests, migrations

| Item | Fate |
|---|---|
| `scripts/interview-closeout-rehearsal.mjs`, `interview-turn-probe.mjs`, `interview-delivery-probe.mjs`, `sol-map-probe.ts`, `ranking-probe.ts`, `interview-replay.ts`, `interview-timeline.ts`, `interview-research-smoke.ts` | **move** to `interviews/project-closeout/probes/`, imports updated; they are the replay net for the conversation-runtime moves |
| `scripts/interview-live-acceptance.mjs`, `interview-summary-acceptance.mjs`, `interview-workshop-acceptance.mjs`, `simulator-connection-acceptance.mjs` (interview modes), `navigation-acceptance.mjs` | keep in `scripts/`; the live and summary scripts switch to `/api/interview/...` in Phase 5 |
| `scripts/simulator-bundle-check.ts` | keep; add two marker strings from `interview-engine/conducting/*.prompt.ts` |
| new `scripts/engine-boundary-check.ts`, `scripts/engine-copy-check.ts`, `scripts/interview-reference-host.ts`, `scripts/interview-report.ts`, `tsconfig.engine.json` | section 10 |
| `app/server/simulator/session*.test.ts`, `session-fixture.ts` | the interview cases (greeting, reconnect, report, producer) are **ported** to `interview-engine/conducting/session/*.test.ts` against memory adapters; practice cases stay |
| `app/server/interview/archive.test.ts` | **replace** with `archiveD1.test.ts` over bun:sqlite as today |
| `app/simulator/live-connection.test.ts` | **move** with the class |
| `core/interview*.test.ts`, `ai/interview/*.test.ts` | **move** with their subjects |
| `migrations/0004_interview_attempts_spec.sql` (new) | adds `spec_id TEXT`, `spec_version TEXT`, `checkpoint_json TEXT` is **not** added (checkpoints stay in Durable Object storage, section 6) |

---

## 3. Target folder structure

Three top-level places. The engine folder is the only one that moves to the host app.

```
interview-engine/                    portable; copied into the host app as app/debrief/engine/
  README.md                          what it is, how to host it, the boundary rules
  CONTEXT.md                         glossary: attempt, segment, checkpoint, archive, capability, wake
  shared/                            types + zod only; imported by browser and server
    spec.ts                          InterviewSpec, Topic, Objective, Voice, OutputTemplate, validateSpec
    transcript.ts                    Passage, Speaker, transcriptCharacters, findEvidence, TRANSCRIPT_LIMIT
    snapshot.ts                      InterviewSnapshot, SessionStatus, SessionPause, Coverage types
    protocol.ts                      Command/Reply zod schemas for start|ready|poll|pause|resume|end|report, socket framing
    network.ts                       NetworkSample, readNetwork (from core/simulator/network.ts)
  client/                            browser only; no React
    liveConnection.ts                LiveConnection(callbacks, transport, existing?)
    transports.ts                    pollTransport(baseUrl, fetch), socketTransport(url) (socket: Phase 6)
    audioLevels.ts
    reportStream.ts                  read a streamed document and its final state (non-React core of use-report)
  reporting/                         COMPONENT 2. Imports shared/ and providers/ only.
    reporting.server.ts              public: summarizeInterview, evaluateInterview, ReportRun
    summarize.server.ts  summary.prompt.ts
    evaluate.server.ts   rubric.prompt.ts
    reportRun.server.ts              from app/server/simulator/report.ts
  conducting/                        COMPONENT 1. May import reporting/ (final coverage grade).
    conducting.server.ts             public: SessionActor, FencedError, createCapability, verifyCapability
    seams.server.ts                  SessionStore, Background, Archive, ControlSocket, Providers
    adapters/memory.server.ts        in-memory SessionStore (with optional segment guard), Background, Archive, scripted ControlSocket
    session/                         actor.server.ts (mailbox), lifecycle.server.ts (state machine from session.ts),
                                     checkpoint.ts (shape + migration), capability.ts, timing.ts (constants from core/simulator/types.ts),
                                     archiveRow.ts (ArchiveRow builder), *.test.ts
    voice/                           gptLive.server.ts (createLive, attachLive, transcriptEvent, LiveSessionGone),
                                     interviewer.prompt.ts (brief + opening from the spec)
    conversation/                    producer.server.ts, map.ts, map.server.ts, map.prompt.ts, notes.ts,
                                     ranking.ts, ranking.server.ts, ranking.prompt.ts, research.server.ts, research.prompt.ts, records.ts
    transcript/                      turns.ts (isBackchannel, yieldsTurn, finishesTurn, asksToEnd)
    replay/                          timeline.ts (producer timeline for tools)
  providers/                         shared by both components
    foundry.server.ts                FoundryConfig, foundryProvider, foundryUrl (no env reading)
    structured.server.ts             requestSol and its errors (copied from ai/simulator/sol.server.ts)
    judge.server.ts                  JEV_MODEL, evidenceBatches
    diagnostics.server.ts

interviews/                          consumer specifications; the second thing the host app writes
  project-closeout/
    spec.ts                          the InterviewSpec, lifted verbatim from core/interview.ts, scenario.server.ts, summary.server.ts
    fixtures/                        fixtures.ts, recordings.json, run.ts, record-synthetic.ts (from ai/interview/)
    probes/                          rehearsal and probe scripts (from scripts/)
  sales-win-loss/
    spec.ts                          Phase 7: a tiny second spec proving the engine is spec-driven

app/server/interview/                this repo's Cloudflare host; the host app writes its own equivalent
  durableObject.ts                   InterviewObject: Cloudflare adapters + SessionActor, ~100 lines
  archiveD1.server.ts                Archive over D1 interview_attempts
  routes.ts                          /api/interview/... : identity-free start gate, rate limit, capability header, report routes
app/interview/                       React screens, as now
```

Conventions follow the host app's (`AGENTS.md`, `docs/code-conventions.md` there): `.server.ts` suffix for server-only files, camelCase filenames, prompts in `*.prompt.ts`, no barrel `index.ts`. Public surface: `shared/*`, `client/*`, `reporting/reporting.server.ts`, `conducting/conducting.server.ts`, `conducting/seams.server.ts`, `conducting/adapters/memory.server.ts`. Everything else is private collaboration and the boundary check does not protect it.

Expected size after the move: `conducting/session/` about 700 lines (the interview half of `session.ts` plus the mailbox), `conducting/conversation/` about 1,600, `reporting/` about 350, `client/` about 600, `shared/` about 300, `providers/` about 150. The host folder should be under 250 lines in total; if it grows past that, something that belongs in the engine has leaked into the host.

---

## 4. Public interfaces

Signatures below are the target. Where the API design (section 5) already states a contract, this restates it in the form the code will take; where it differs in a name, the API design is corrected in the same commit that introduces the code.

### 4.1 `shared/`

```ts
// shared/transcript.ts
export type Speaker = 'participant' | 'interviewer';
export type Passage = { id: string; speaker: Speaker; text: string; at: number; final: boolean };
export const TRANSCRIPT_LIMIT: number;                 // from core/simulator/state.ts
export function transcriptCharacters(passages: Passage[]): number;
export function findEvidence(passages: Passage[], ids: string[]): Passage[];

// shared/spec.ts
export type Objective = { id: string; label: string; criteria: string };
export type Topic = { id: string; label: string; objectives: Objective[] };
export type Voice = { id: string; name: string; voice: string; image: string; behavior: string };
export type OutputTemplate = { id: string; version: string; system: string; schema: z.ZodType<{ text: string }> };
export type InterviewSpec = {
  id: string; version: string; interviewerName: string;
  framing: string;                                      // what the interview is for, used by brief and map prompts
  topics: Topic[]; readings: ReadingSpec[]; voices: Voice[];
  limits: { limitSeconds: number; maxResumes: number; pauseHoldMs: number };
  template: OutputTemplate;                             // the summary document template
};
export function validateSpec(spec: InterviewSpec): InterviewSpec;   // zod parse; throws on duplicates or empty topics

// shared/snapshot.ts
export type SessionStatus = 'connecting' | 'live' | 'paused' | 'ending' | 'ended' | 'interrupted';
export type SessionPause = { reason: 'browser' | 'provider' | 'restart'; pausedAt: number; resumeBy: number; resumes: number; maxResumes: number };
export type InterviewSnapshot = {
  id: string; specId: string; voiceId: string; status: SessionStatus; revision: number;
  startedAt: number; limitSeconds: number; warning: SessionWarning | null; pause?: SessionPause | null;
  transcript: Passage[]; coverage: InterviewEvaluation | null; background: InterviewBackground[];
  message: string | null; finalization: 'pending' | 'confirmed' | 'unconfirmed'; usageSeconds: number | null;
  clientEnded?: ClientEnding | null; report: ReportStatus;    // status only; the document streams separately
};

// shared/protocol.ts
export const commandSchemas: { start, ready, poll, pause, resume, end, report };    // zod, one per action
export type Command = { action: 'start'; ... } | { action: 'poll'; ... } | ...;
export type Reply = { status: number; body: unknown; stream?: ReadableStream<string> };
export const CAPABILITY_HEADER = 'authorization';   // Bearer 64-hex, as today
```

`Passage` replaces `TranscriptEntry` with `speaker: 'trainee' | 'client'`. The rename is mechanical but touches the conversation runtime, so it happens in the same phase as that move (Phase 3), not before.

### 4.2 `conducting/`

```ts
// conducting/seams.server.ts
export class FencedError extends Error {}               // thrown by save when another writer has taken over
export type SessionStore = {
  load(): Promise<{ checkpoint?: Checkpoint }>;
  save(patch: { checkpoint?: Checkpoint | null }): Promise<void>;   // may throw FencedError
  wake(at: number | null): Promise<void>;               // a hint; Cloudflare sets the alarm, the host app ignores it
  clear(): Promise<void>;
};
export type Background = { track(task: Promise<unknown>): void };   // waitUntil today; fire-and-forget on the host app
export type Archive = { write(row: ArchiveRow): Promise<void> };    // partial and final rows; idempotent upsert
export type ControlSocket = { connect(url: string, headers: Record<string, string>): Promise<WebSocket> };
export type Providers = { foundry: FoundryConfig; typesafeApiKey: string; fetch?: typeof fetch };
export type Seams = { store: SessionStore; background: Background; archive: Archive; socket: ControlSocket };

// conducting/conducting.server.ts
export type SessionContext = { id: string; now?: () => number };
export class SessionActor {
  static restore(spec: InterviewSpec, context: SessionContext, providers: Providers, seams: Seams): Promise<SessionActor>;
  handle(command: Command): Promise<Reply>;             // enqueued; one at a time
  wake(): Promise<void>;                                // run every due wake job; idempotent; also run inside restore and before the first command
  close(reason: 'connection' | 'drain' | 'fenced'): Promise<void>;
  idle(): boolean;                                      // nothing live, nothing pending: a host may evict
  snapshot(): InterviewSnapshot;
  transcript(): Passage[];
}
export function createCapability(): { secret: string; hash: string };
export function verifyCapability(header: string | null, hash: string): boolean;
```

Behaviour the actor keeps verbatim from `session.ts`: one-shot start (409 on reuse), 401/403 capability checks, pause holds and resume limits (`SESSION_PAUSE_HOLD_MS`, `SESSION_MAX_RESUMES`), idle and limit warnings, greeting, unanswered-turn handling, segment binding of provider sockets, `closeProvider` with `session.closed` wait and `LiveSessionGone` tolerance, partial archive every 30 seconds while live, provider close retries, `recovered` to `interrupted` with 410, finish with final archive, storage clear after the hold. The one behavioural change: the browser secret is stored as a hash inside the checkpoint instead of a separate `lease` key, so a checkpoint is the single durable record (API design section 8.1).

Wake jobs, each idempotent, each run on `wake()`, on `restore` and before the first command: pause-hold expiry, idle timeout, lifetime limit, partial archive, provider close retry, post-finish clear. This is what lets the host app skip `wake` (API design 8.3).

### 4.3 `reporting/`

```ts
// reporting/reporting.server.ts
export type ReportInput = { transcript: Passage[]; template: OutputTemplate; foundry: FoundryConfig; signal: AbortSignal; fetch?: typeof fetch };
export type ReportResult<T> = { usage: ReportUsage | null } & ({ report: T; failure: null } | { report: null; failure: ReportFailure });
export function summarizeInterview(input: ReportInput): { stream: ReadableStream<string>; result: Promise<ReportResult<InterviewSummaryContent>> };
export function evaluateInterview(input: { transcript: Passage[]; spec: InterviewSpec; apiKey: string; signal: AbortSignal; revision: number }): Promise<InterviewEvaluation & { model: string; usage: unknown }>;
export class ReportRun<T> {                             // from SessionReport: one bounded run plus one retry, re-attachable stream
  constructor(run: (signal: AbortSignal) => { stream: ReadableStream<string>; result: Promise<ReportResult<T>> }, limits?: { starts: number; deadlineMs: number });
  start(): ReadableStream<string>; read(): Promise<ReportState<T>>; cancel(): void;
}
```

Reporting has no `Seams`, no session and no storage. Its only inputs are a transcript, a template, provider configuration and a signal. That is what makes imported transcripts free (section 5).

### 4.4 `client/`

```ts
// client/transports.ts
export type Transport = { send(command: Command, attempt?: Attempt): Promise<Response> };
export function pollTransport(baseUrl: string, request?: typeof fetch): Transport;   // POST baseUrl[/id/action] with Bearer header, as today
// client/liveConnection.ts
export class LiveConnection { constructor(callbacks: Callbacks, transport: Transport, existing?: Attempt); /* start, reattach, poll, pause, resume, mute, end, dispose, detach unchanged */ }
```

The practice simulator constructs `new LiveConnection(callbacks, pollTransport('/api/simulator/sessions'))`; the interview screens construct one with `pollTransport('/api/interview/sessions')`. Nothing else in the class changes.

### 4.5 Host-owned integration points

The host, this repo's `app/server/interview/` today and the host app's `app/debrief/` later, owns exactly these:

1. **Identity and the right to start.** Today: no login; `liveAvailable(env)` flags and the `RATE_SIMULATOR` limiter. The host app: its session user. The engine never sees identity; it sees a capability.
2. **Instantiating the actor.** Build `Seams` and `Providers` from the host's resources, call `SessionActor.restore`, forward commands and wakes. Cloudflare: a Durable Object. The host app: one actor per browser WebSocket.
3. **Routing** `shared/protocol.ts` actions onto URLs and the report routes.
4. **Archive storage and reads.** D1 here; Postgres on the host app. The engine defines `ArchiveRow`; the host maps it to columns.
5. **Report composition.** Which transcript to read (the live actor, the archive row, or a request body), where to write the document, and who may ask.
6. **Screens.** React here, the host app's own there.

---

## 5. Conducting versus reporting

```
 conducting                                     reporting
 ───────────────────────────────────────        ───────────────────────────────────────────
 in:  spec, capability, browser commands,       in:  Passage[] + OutputTemplate (+ spec for coverage)
      GPT-Live events                           out: streamed Markdown document, ReportResult, coverage
 out: Passage[] (the transcript), InterviewSnapshot,
      ArchiveRow (partial, final)
 needs: SessionStore, Background, Archive,      needs: FoundryConfig, TypeSafe key, a signal. Nothing else.
        ControlSocket, Providers
 imports reporting/ for the end-of-interview    imports shared/ and providers/ only
 coverage grade (evaluateInterview)
```

Three ways a report starts, all through the same `ReportRun` over `summarizeInterview`:

| Source | Route or entry | Transcript comes from | Document goes to |
|---|---|---|---|
| Finished live attempt | `POST /api/interview/sessions/:id/report` (capability required) | the live actor if still resident, else the D1 row | D1 `summary_text`, `summary_status` as today |
| Imported transcript over HTTP | `POST /api/interview/reports` with `{ transcript: Passage[], specId }` | request body | streamed back only; not persisted in this repo (a host decision) |
| Imported transcript from a file | `bun scripts/interview-report.ts path.json` | file | stdout or a file |

The report lifecycle leaves the session: the actor no longer owns `startReport`, `saveReport` or `summaryArchive`. The snapshot keeps a `report` status field so the screens can show "compiling" without a second poll, and the host updates it by writing the archive row. This is API design section 7.2, "host composition".

Imported transcripts must be `Passage[]`. A one-line adapter from today's `TranscriptEntry` lives in the host for archived rows written before the rename.

---

## 6. Checkpoints versus archives, and who guarantees what

| | Checkpoint | Archive |
|---|---|---|
| What | the actor's full mutable state: snapshot, segments, pauses, grades, producer state, capability hash, `savedAt` | append-only rows: transcript, coverage, document, provenance, usage, producer records trimmed to `ROW_BYTES` |
| Written | every 30 seconds while live, on every lifecycle transition, on finish | partial every 30 seconds while live, final on finish, document on report completion |
| Read by | the actor on `restore`, and nothing else | the report route, the storybook, analysis scripts, the host app's the host application views |
| Lives | `SessionStore`: Durable Object storage here, the `interview_attempts.checkpoint` column on the host app | `Archive`: D1 `interview_attempts` here, the same Postgres row on the host app |
| Cleared | after the post-finish hold | never by the engine |
| Shape owned by | engine (`conducting/session/checkpoint.ts`, with a `version` and a migration function) | engine (`ArchiveRow`); the host maps it to columns |

Guarantees, from API design section 8.4, restated as who must prove what:

| Guarantee | Engine proves (memory adapters, unit tests) | Cloudflare host proves | The host app host proves (deferred, section 12) |
|---|---|---|---|
| E1 one writer per attempt | actor serializes its own mailbox; `FencedError` moves it to `fenced` and closes the provider socket | Durable Object identity | one actor per socket plus `segment` guard |
| E2 commands serialized | mailbox test: interleaved `poll` and provider events apply in order | `blockConcurrencyWhile` on restore, single-threaded object | the actor's mailbox |
| E3 a superseded writer stops touching the provider | fenced test with a segment-guarded memory store | n/a (no second writer can exist) | fenced test against Postgres |
| E4 durable checkpoints before replying | every transition awaits `store.save` before `Reply` | storage write semantics | Postgres commit |
| E5 capability on every command | 401/403 tests | passes the header through | passes the header through |
| O1 continuity without browser action | not required | silent restore, `+1s` alarm after restart | not offered: browser reconnects, automatically once |
| O2 timers without a process | not required; every wake job also runs on touch | `setAlarm` | not offered: lazy |
| O3 orphan provider cleanup | `closeProvider` retry logic unit-tested | alarm retries | the future acceptance task |

---

## 7. Diagrams

Dependencies (arrows point at what is imported):

```
 app/interview/screens.tsx ──▶ interview-engine/client ──▶ interview-engine/shared
          │                                                        ▲
          └──▶ interviews/project-closeout/spec.ts ────────────────┘
 app/server/interview/{durableObject,routes,archiveD1} ──▶ conducting ──▶ reporting ──▶ providers
          │                                                   │              │
          └──▶ interviews/project-closeout/spec.ts            └──▶ shared ◀──┘
 app/server/simulator/* (practice) ──▶ client/liveConnection, conducting/voice/gptLive, reporting/reportRun, shared/network
 (nothing in interview-engine/ imports app/, core/, ai/ or interviews/)
```

Runtime, one live attempt on Cloudflare:

```
 browser LiveConnection ──POST /api/interview/sessions/:id/poll──▶ routes.ts ──▶ InterviewObject.fetch
                                                                                   │ actor.handle(command)
                                                                                   ├─ store.save(checkpoint)  → ctx.storage
                                                                                   ├─ store.wake(at)          → ctx.storage.setAlarm
                                                                                   ├─ archive.write(row)      → D1 (background.track)
                                                                                   └─ socket.connect(...)     → GPT-Live control WebSocket
 alarm() ──▶ actor.wake()   (every job idempotent; the same jobs run on restore and first command)
```

The same boundaries three ways:

| Boundary | Generalized (engine contract) | Cloudflare (this repo, now) | The host app (future, deferred) |
|---|---|---|---|
| Who runs the actor | `SessionActor` in-process; host instantiates | `InterviewObject` Durable Object, one per attempt | one actor per browser WebSocket, `interviewSocket.server.ts` |
| SessionStore | `load/save/wake/clear`, `FencedError` | `ctx.storage` + `setAlarm`; never fenced | `interview_attempts.checkpoint` + `segment` guard; `wake` no-op |
| Background | `track(promise)` | `ctx.waitUntil` | fire-and-forget with a drain on `SIGTERM` |
| Archive | `write(ArchiveRow)` | D1 `interview_attempts` | same Postgres row (`archive`, `document` columns) |
| ControlSocket | `connect(url, headers)` | Workers `fetch` upgrade | Bun `WebSocket` |
| Browser transport | `Transport` | `pollTransport('/api/interview/sessions')` | `socketTransport` (poll as fallback) |
| Wake | hint | durable alarm | none; lazy on touch |
| Identity and start gate | host | flags + rate limit | The host app session user |
| Report persistence | host | D1 `summary_text` | `document` jsonb |

---

## 8. Working alongside the interview-quality session

The other session is editing, uncommitted, on `interview-quality`: `ai/interview/map.server.ts` (`MAP_PROMPT_VERSION` to `sol-map-v11`, instruction wording), `ai/interview/scenario.server.ts` (brief wording), `core/interview-notes.ts` (new `Done` type, `listNote(..., done)`, `ListState.on` and `told`, `nextListNote` computing `finish()`), `core/interview-ranking.test.ts`. The behaviour it is after lives entirely in the conversation runtime and prompts.

Rules for this plan:

1. **Phases 1, 2, 4, 5 and 6 do not touch** `ai/interview/map.server.ts`, `scenario.server.ts`, `core/interview-notes.ts`, `core/interview-ranking.ts` or their tests. They touch session, host, client, archive, reporting and shared types only. Those phases can start now on a branch off `interview-quality`.
2. **Phase 3 (the conversation runtime move) waits** until the listening-hold work is committed on `interview-quality`. Then rebase the refactor branch, and do the move as pure `git mv` commits with import fixes only, so `git log --follow` and `git blame` carry the other session's history. No wording changes and no prompt-version bumps in those commits; `MAP_PROMPT_VERSION`, `PRODUCER_VERSION` and `SUMMARY_VERSION` keep whatever values the other session left.
3. **If the other session is still running when Phase 3 is due**, do Phase 4 (host split) first. The split needs the producer's `Options` shape, not its file location: `session.ts` keeps importing `InterviewProducer` from `app/server/simulator/interview-producer.ts` until the move.
4. **Shared touch points to coordinate explicitly:** `core/interview.ts` (Phase 1 extracts constants out of it; the other session reads `interviewTopics` from it) and `core/simulator/types.ts` (Phase 1 removes `interview?`). Both edits are additive-then-remove: add the new modules and re-export the old names from the old paths first, remove the old paths in Phase 3. That way the other session's uncommitted changes still compile after a rebase.
5. **Prompt versions are the other session's.** The replay probes (`sol-map-probe.ts`, `ranking-probe.ts`, `interview-replay.ts`) are run before and after each move commit against the archived closeout interviews; identical output is the pass condition, since nothing in the prompts should have changed.

---

## 9. Phases, commits, checks and gates

Every phase ends with `bun run check` green (typecheck, `bun test`, build, bundle check, `wrangler deploy --dry-run`), the `/interview` route working against `bun run dev`, and the acceptance scripts named in the phase passing. Commits are small enough to review in one sitting; each is listed with what it touches. Phases 1, 2, 4 and 5 can begin now; Phase 3 and Phase 7's prompt part wait for interview-quality (section 8).

### Phase 0. Scaffolding and the boundary check (no behaviour change)

Commits:

1. `tsconfig.engine.json` (include `interview-engine/**`, `lib: ["ES2023","DOM","DOM.Iterable"]`, `types: []`, no `paths`), `interview-engine/README.md` stub, `interview-engine/CONTEXT.md` glossary.
2. `scripts/engine-boundary-check.ts`: walks `interview-engine/**/*.ts`, parses import specifiers, fails on: a relative import that resolves outside the folder; `~/`, `@/`, `cloudflare:workers`, `react-router`, `react`, `bun:*`, `node:*`, `virtual:*`; any package not in the allow list (`ai`, `@ai-sdk/azure`, `@ai-sdk/typesafe-ai`, `zod`); `client/*` importing a `.server.ts`; `reporting/*` importing `conducting/*`; the identifiers `Env`, `D1Database`, `DurableObject`, `ExecutionContext` anywhere in the folder. Prints the offending file and line.
3. `scripts/engine-copy-check.ts`: copies `interview-engine/` into the scratch directory with a generated `package.json` (the four dependencies at this repo's versions) and a copy of `tsconfig.engine.json`, runs `bun install` and `tsc --noEmit` there, deletes the copy. This is the proof of copyability and runs in `check`.
4. Add both scripts and `tsc -p tsconfig.engine.json --noEmit` to the `check` script in `package.json`.

Acceptance: both scripts pass on the empty folder; `check` is green. Gate: none to release; this phase deploys nothing new.

### Phase 1. Shared types and the closeout spec, in place

Commits:

1. `interview-engine/shared/transcript.ts` (`Passage`, helpers copied from `core/simulator/state.ts`), `shared/network.ts` (git mv from `core/simulator/network.ts`; practice simulator imports updated), `shared/snapshot.ts` (`InterviewSnapshot` as its own type; initially built from `SessionSnapshot` by a `toInterviewSnapshot` adapter in `app/interview/screens.tsx`).
2. `shared/spec.ts` and `interviews/project-closeout/spec.ts`: lift `interviewTopics`, `interviewReadings`, `interviewVoices`, `INTERVIEWER_NAME`, `INTERVIEW_SCENARIO_ID`, the summary system prompt and `interviewSummarySchema` verbatim. `core/interview.ts` keeps exporting the same names by re-exporting from the spec, so nothing else changes yet (section 8 rule 4).
3. Remove `interview?: InterviewSession` from `SessionSnapshot` in `core/simulator/types.ts`; `session.ts` carries interview state in a sibling field typed from `shared/snapshot.ts`; `publicSnapshot` composes it. Update `app/interview/screens.tsx`, the stories and `simulator-connection-acceptance.mjs` fixtures.
4. `migrations/0004_interview_attempts_spec.sql` adding nullable `spec_id`, `spec_version`; `writeInterviewArchive` writes them.

Dependencies: none. Migration: D1 column adds are additive; old rows have nulls. Regression risks: the snapshot shape crosses the wire, so `simulator-connection-acceptance.mjs` interview modes and `interview-live-acceptance.mjs` are the gate; the stories render `InterviewSnapshot`. Acceptance: those two scripts plus `navigation-acceptance.mjs`, `bun test`. Gate: deployable at any time; one preview deploy to the `previews` env recommended.

### Phase 2. Browser voice link, GPT-Live calls, report runner, providers

Commits:

1. git mv `app/simulator/live-connection.ts` and `audio-levels.ts` into `client/`; introduce `Transport` and `pollTransport`; the practice simulator and the interview both pass `pollTransport('/api/simulator/sessions')` for now; move `live-connection.test.ts`.
2. git mv `app/server/simulator/live.server.ts` into `conducting/voice/gptLive.server.ts` with `createLive({ brief, voice, sdp })`; `liveConfiguration(scenarioId, clientId)` stays in `app/server/simulator/` and calls it. `attachLive(id, foundry, socket: ControlSocket)`; a `fetchControlSocket` adapter in `app/server/simulator/` for Workers. Move `live.test.ts`.
3. git mv `app/server/simulator/report.ts` into `reporting/reportRun.server.ts` as `ReportRun`; `session.ts` imports it from there. Move `report.test.ts`.
4. `providers/foundry.server.ts` (extract `FoundryConfig`, `foundryProvider`, `foundryUrl`; `ai/foundry.server.ts` re-exports them and keeps `foundryConfig(env)`), `providers/structured.server.ts` (copy of `requestSol`), `providers/judge.server.ts`, `providers/diagnostics.server.ts`.
5. `client/reportStream.ts`: the non-React part of `use-report.ts` (`streamedReportView` and the status poll); `use-report.ts` calls it.

Dependencies: Phase 1 types. Regression risks: the voice link is the most behaviour-sensitive browser code; the transport change is the only edit, so `simulator-connection-acceptance.mjs` in all modes is the gate, plus `interview-live-acceptance.mjs` and the practice `simulator-*-acceptance.mjs` scripts that drive a live session. Acceptance: those, `bun test`, boundary check (the moved files must already satisfy it). Gate: deploy after the connection acceptance passes in every mode.

### Phase 3. Conversation runtime moves (after interview-quality lands)

Commits, each a `git mv` with import fixes only:

1. `core/interview-producer.ts` to `conducting/conversation/records.ts`; `core/interview-timeline.ts` to `conducting/replay/timeline.ts`; tests follow.
2. `core/interview-map.ts` to `conducting/conversation/map.ts` with `mapTopicIds(spec)` replacing `MAP_TOPIC_IDS`; `core/interview-notes.ts`, `core/interview-ranking.ts` to `conducting/conversation/`; turn heuristics from `core/interview.ts` to `conducting/transcript/turns.ts`.
3. `ai/interview/map.server.ts` (split into `map.server.ts` and `map.prompt.ts`, prompt text byte-identical), `ranking.server.ts`, `research.server.ts` to `conducting/conversation/`; `evaluate.server.ts` and `rubric.ts` to `reporting/`; `summary.server.ts` to `reporting/summarize.server.ts` with `summary.prompt.ts`.
4. `app/server/simulator/interview-producer.ts` to `conducting/conversation/producer.server.ts`; `Options.waitUntil` renamed to `background: Background`; `services` default to the real providers; test follows.
5. The `TranscriptEntry` to `Passage` rename inside the engine (`'trainee'` to `'participant'`, `'client'` to `'interviewer'`), with a `toPassages` adapter at the `session.ts` boundary until Phase 4 removes it. One commit, mechanical, reviewed with `git diff --color-words`.
6. `ai/interview/scenario.server.ts`: voices and brief text into the spec; `interviewerBrief(spec, voice)` and `interviewOpening(spec, voice)` into `conducting/voice/interviewer.prompt.ts`; `interviewScenario` stops being a practice `Scenario`. `ai/simulator/scenarios.server.ts` keeps dispatching by id for one more phase.
7. Move `ai/interview/fixtures.ts`, `recordings.json`, `run.ts`, `record-synthetic.ts` into `interviews/project-closeout/fixtures/`; the probe scripts into `interviews/project-closeout/probes/`. Remove the now-empty re-exports from `core/interview.ts`.

Dependencies: interview-quality committed; Phases 1 and 2. Regression risks: prompt bytes and ranking behaviour. Acceptance: before commit 3 and after commit 6, run `sol-map-probe.ts`, `ranking-probe.ts` and `interview-replay.ts` against the archived closeout interviews and diff the outputs: they must be identical. `ai/interview/run.ts` (now under fixtures) reproduces `recordings.json` within its existing tolerance. `bun test`, boundary check, bundle check (add a marker string from `map.prompt.ts` and `interviewer.prompt.ts`). Gate: identical replay output; otherwise the move changed something and the commit is wrong.

### Phase 4. Extract the session into the engine and write the thin Durable Object

This is the large step. Order matters: tests first, then the extraction, then the new host, with the old path still serving.

Commits:

1. `conducting/seams.server.ts`, `conducting/adapters/memory.server.ts` (memory `SessionStore` with an optional `segment` check that throws `FencedError`, `Background` that collects promises, `Archive` that keeps rows, a scripted `ControlSocket` that replays provider events), `conducting/session/capability.ts`, `checkpoint.ts` (today's `Checkpoint` shape plus `version: 1` and `capabilityHash`), `timing.ts` (the `SESSION_*` constants from `core/simulator/types.ts`, re-exported there for the practice simulator).
2. Port the interview cases of `session.test.ts`, `session-greeting.test.ts`, `session-reconnect.test.ts`, `session-report.test.ts` and `session-fixture.ts` to `conducting/session/*.test.ts` against the memory adapters. They fail at this point; commit them skipped with a note. This is the regression net written before the extraction, not after.
3. `conducting/session/lifecycle.server.ts`: the interview half of `SimulatorSession`, method for method (`start`, `openLive`, `listen`, `dropped`, `send`, `onEvent`, `tick`, `greet`, `unanswered`, `checkLifetime`, `pause`, `hold`, `suspend`, `resume`, `closeSegment`, `grade`, `direct`, `watchEnding`, `judgeEnding`, `end`, `finish`, `saveCheckpoint`, `restore`, `closeOrphan`, `closeProvider`, `retryClosures`, `saveArchive`), with `this.ctx.storage` replaced by `store`, `this.ctx.waitUntil` by `background.track`, `this.env` by `providers`, `setAlarm` by `store.wake`, `writeInterviewArchive` by `archive.write`, and the `lease` key folded into the checkpoint. `conducting/session/actor.server.ts`: the mailbox and `SessionActor` facade; `wake()` runs the six jobs. Un-skip the tests. `startReport` and `saveReport` do not move; the actor exposes `transcript()` and the snapshot's `report` status instead.
4. `app/server/interview/durableObject.ts` (`InterviewObject`: adapters over `ctx.storage`, `setAlarm`, `waitUntil`, D1, fetch upgrade; `blockConcurrencyWhile(restore)`; `fetch` to `actor.handle`; `alarm` to `actor.wake`), `archiveD1.server.ts` (`Archive` over `interview_attempts`, same columns plus `spec_id`, `spec_version`), `routes.ts` (`/api/interview/sessions`, `/sessions/:id/{ready,poll,pause,resume,end}`, `/sessions/:id/report`, `/reports`; `liveAvailable` and `RATE_SIMULATOR` reused). `wrangler.jsonc`: `INTERVIEW_SESSIONS` binding and `interview-v1` migration in both envs. `app/workers/app.ts`: export and dispatch. The interview screens still point at `/api/simulator/sessions`; nothing user-facing changes in this commit.
5. `scripts/interview-reference-host.ts`: a `Bun.serve` host of under two hundred lines using the memory adapters, mounting the protocol and the report routes, serving a bare page that uses `client/liveConnection.ts`. It lives in `scripts/`, not in the engine, because it uses Bun APIs. `interview-live-acceptance.mjs` already takes `ACCEPTANCE_URL`, so it runs against it unchanged apart from a `ROUTE` override for the API prefix.
6. Acceptance tests from API design section 8.9 as `conducting/session/ownership.test.ts` against the memory adapters with the segment guard and the scripted socket: one writer, serialization, connection scoping, drain, lazy wake jobs (a store whose `wake` is a no-op still reaches `ended` and `cleared` on the next command), transcript integrity, capability.

Dependencies: Phases 1 and 2; Phase 3 preferred but not required (section 8 rule 3). Migration and compatibility: the new Durable Object class is a new namespace, so the `interview-v1` migration creates it without touching `SimulatorSession`; existing interview attempts stay in the old object until Phase 5 cuts the browser over. Regression risks: the whole lifecycle; mitigated by porting tests first and by leaving the old path live. Acceptance: ported tests and ownership tests green; `interview-live-acceptance.mjs` against the reference host; `wrangler deploy --dry-run` accepts the new binding. Gate: deployable because nothing routes to the new object yet; deploy it to `previews` and drive one interview against `/api/interview/...` with the acceptance script's `ACCEPTANCE_URL` and the `ROUTE` override.

### Phase 5. Cut the browser over and remove the interview from the practice simulator

Commits:

1. `app/interview/screens.tsx` and `app/routes/interview.tsx` use `pollTransport('/api/interview/sessions')` and the new report route; the `ooc-attempt-interview` claim written by `use-simulator.ts` gains `route: '/api/interview/sessions'`. A claim with no `route` is legacy and resumes through `/api/simulator/sessions` once, so an attempt paused across the deploy still resumes. `interview-live-acceptance.mjs`, `interview-summary-acceptance.mjs` and the interview modes of `simulator-connection-acceptance.mjs` point at the new routes.
2. **Deploy A.** Both paths live. Wait at least one hold period plus the post-finish clear (under an hour) before the next commit is deployed; the practice simulator's `SimulatorSession` finishes any legacy interview attempts and clears them on its own alarms.
3. Remove the interview from `SimulatorSession`: the `interview` branches in `session.ts`, the `startSchema` refine and `INTERVIEW_SCENARIO_ID` import in `api.ts`, `interviewScenario` and `interviewers` dispatch in `ai/simulator/scenarios.server.ts`, `'Interview'` from `ScenarioSummary.category`, `writeInterviewArchive` and `app/server/interview/archive.server.ts`, the legacy `route` fallback in the claim. `session.ts` should lose roughly 350 lines; the practice tests stay green untouched.
4. **Deploy B.**

Dependencies: Phase 4 deployed. Compatibility: the two-deploy sequence is the migration; D1 rows are unaffected because both writers target the same table. Regression risks: the practice simulator (removal touches its file) and navigation. Acceptance: all `simulator-*-acceptance.mjs`, `interview-live-acceptance.mjs`, `interview-summary-acceptance.mjs`, `navigation-acceptance.mjs`, `bun test`. Gate: Deploy B only after Deploy A has been live for the hold window and the D1 `interview_attempts` table shows no `partial` row newer than the Deploy A time.

### Phase 6. Independent reporting

Commits:

1. `summarizeInterview` returns `{ stream, result }` and takes `template` from the spec instead of a hard-coded prompt; `reporting.server.ts` exports the public surface; `SUMMARY_VERSION` moves to `spec.template.version` with the same value.
2. `POST /api/interview/reports` (imported transcript, streamed document, `RATE_JUDGE` limiter, no persistence) and `scripts/interview-report.ts` (file in, Markdown out). Both are thin: parse `Passage[]`, build `ReportInput`, run `ReportRun`.
3. `client/socketTransport.ts` and the socket framing in `shared/protocol.ts`; the reference host mounts both transports; `interview-live-acceptance.mjs` runs against the reference host with `TRANSPORT=socket`. The Cloudflare host does not mount the socket. This is the one piece built here for the host app's benefit; it is small and the reference host proves it.

Dependencies: Phase 4. Regression risks: the summary route behaviour (`interview-summary-acceptance.mjs` is the gate). Acceptance: that script, a report produced from an archived transcript file by the CLI, `bun test`. Gate: deploy when the summary acceptance passes.

### Phase 7. Prove the spec is the only consumer input

Commits:

1. `interviews/sales-win-loss/spec.ts`: three topics, one voice, a short template. A storybook story renders its setup screen; the reference host conducts one scripted interview with it; `scripts/interview-report.ts` reports on its transcript. Any change needed inside `interview-engine/` to make this work is a leak, fixed in the same commit and noted in the README.
2. `interview-engine/README.md` final: how to host (the reference host as the worked example), the seams, the boundary rules, the essential and optional guarantees, how to write a spec. `CONTEXT.md` complete.

Dependencies: Phases 3 and 6. Acceptance: boundary check, copy check, both specs' stories, `bun test`. Gate: none; documentation and a second spec.

### Phase summary

| Phase | Can start | Deploys | Main gate |
|---|---|---|---|
| 0 scaffolding | now | no | checks green on empty folder |
| 1 shared types + spec | now | yes | connection + live acceptance |
| 2 voice link, GPT-Live, runner, providers | now | yes | connection acceptance, all modes |
| 3 conversation runtime moves | after interview-quality lands | yes | identical replay output |
| 4 session extraction + thin DO | now (prefers 3) | yes, dark | ported tests, ownership tests, reference host |
| 5 cutover + removal | after 4 deployed | two deploys | hold window, no stale partial rows |
| 6 independent reporting + socket transport | after 4 | yes | summary acceptance |
| 7 second spec + docs | after 3 and 6 | yes | boundary + copy checks |

---

## 10. Proving the folder is portable

Four checks, all in `bun run check` from Phase 0:

1. **`scripts/engine-boundary-check.ts`** rejects any import or identifier that ties the folder to this app or to Cloudflare (Phase 0 lists the rules). It is the fast, every-commit signal.
2. **`tsc -p tsconfig.engine.json --noEmit`** type-checks the folder with `types: []`, so `Env`, `D1Database` and the rest of `worker-configuration.d.ts` are simply undefined there.
3. **`scripts/engine-copy-check.ts`** copies the folder to an empty directory with only the four dependencies and type-checks it. If it passes, the folder can be copied into the host app and will compile once the host app has `@ai-sdk/typesafe-ai` (its one missing dependency, per the API design section 3).
4. **`scripts/interview-reference-host.ts`** is the second host. Every seam has two adapters once it exists (memory and Cloudflare), which is the test of whether a seam is real. `interview-live-acceptance.mjs` drives a full interview through it.

What these do not prove, and the host app dry-run (section 12) does: that the socket transport behaves on App Service, that the segment guard fences a stale writer against real Postgres, and that reconnect across two processes works.

---

## 11. Self-review: gaps closed and complexity removed

Gaps found while writing this and closed above:

- The report lifecycle was still inside the actor in the first draft of Phase 4. Moving it out (Phase 4 commit 3 and Phase 6) is what makes imported transcripts a route and a CLI rather than a special session.
- The cutover had no story for an attempt paused across the deploy. The `route` field on the sessionStorage claim and the two-deploy sequence in Phase 5 cover it without keeping legacy code for more than one release.
- `wake` jobs "also run on restore and first command" was a sentence in the API design; it is now a named test (lazy wake jobs, Phase 4 commit 6) with a no-op-wake memory store.
- The boundary check needed a positive allow list of packages, not just a deny list, or a stray `import { something } from 'react-router'` in a `.server.ts` would pass.

Complexity removed or refused:

- No `Clock` seam; `now` is an optional function on `SessionContext` for tests.
- No event emitter on the actor; the host polls `snapshot()` as the browser does.
- No capability flags or host-feature detection; essential versus optional is documentation plus the lazy-wake test.
- No second copy of `LiveConnection`, `gptLive.server.ts` or `ReportRun` for the practice simulator; it imports the engine's. That is a dependency from the simulator onto the engine, allowed because none of those files carry interview content (extraction plan section 5).
- No new D1 table for imported reports; this repo streams them back and does not store them.
- No `RoleBranch`; API design decision 6 stands.
- `ai/simulator/sol.server.ts` is copied, not shared, so the practice simulator's director does not depend on the engine (the one deliberate duplication; about 60 lines).

Remaining risk I could not remove: Phase 4 commit 3 is a 700-line extraction of code that works. The mitigations are the ported tests committed first, method-for-method correspondence with `session.ts`, and the old path staying live until Phase 5.

---

## 12. Deferred: the host app integration and infrastructure tests

Not part of this refactor. Listed so it is not lost, in the order the host app would do it.

1. **Copy** `interview-engine/` to `app/debrief/engine/` in a the host app worktree; add `@ai-sdk/typesafe-ai`; run the host app's typecheck.
2. **Schema**: `debrief.interview_attempts` with `segment integer default 0`, `checkpoint` and `archive` jsonb, `document` (API design 8.6); `attemptStore.server.ts` with the two guarded SQL statements.
3. **Socket host**: `interviewSocket.server.ts` with one actor per WebSocket, `useWebSocket: true`, SIGTERM drain, optionally `WEBSITES_CONTAINER_STOP_TIME_LIMIT=30`.
4. **Infrastructure tests** (future the host app acceptance tasks): two local processes against one Postgres, browser reconnect from one to the other, a fenced stale writer, the live acceptance script against `bun run dev` on PGlite.
5. **Orphan-session cleanup**: whether GPT-Live ends a session when its WebRTC transport drops, and whether orphaned sessions bill. Per Andrew: test when the host app is built; if sessions do not end on their own, add a small sweep by id. Documented as a the host app acceptance task, not a blocker here. The engine side (`closeProvider` with retries, run on wake and on touch) is already in Phase 4.
6. **The host application screens** on `client/`, and the host app report route writing `document`.

---

## 13. Open questions for Andrew

1. **Practice simulator importing the engine.** The plan has `SimulatorSession` import `LiveConnection`, `gptLive.server.ts`, `ReportRun` and `shared/network.ts` from `interview-engine/`. The alternative is copies, which keeps the two features fully independent at the cost of about 700 duplicated lines. Recommendation: import, as planned.
2. **Two deploys for the cutover (Phase 5)** versus a single deploy that interrupts any interview paused at that moment. Recommendation: two deploys; the cost is one wait of under an hour.
3. **Imported reports in this repo are not persisted.** Fine for a proof of concept; say if a stored history of imported reports is wanted here, which would add one D1 table.
4. **Phase 4 before Phase 3** if interview-quality is still open when the host split is ready. Recommendation: yes, the split does not depend on where the producer file lives.
