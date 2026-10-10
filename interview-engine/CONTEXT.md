# Interview engine glossary

The Markdown companions in `docs/solutioning/` (`interview-engine-api-design.md`, the refactor and extraction plans) use older names such as `conducting/`, `reporting/`, `ArchiveRow` and `ControlSocket`. Where they disagree with `interview-engine-api-design.html` or with the code, the HTML design and the code win.

**Attempt**: one participant's interview from start to finish, identified by the id the browser chose when it started. An attempt survives dropped connections and host restarts until it ends or its pause hold runs out.

**Segment**: one voice-provider session within an attempt. Starting opens the first; each resume after a drop opens a new one. Provider events and closures are bound to their segment, so a superseded session can never pause or end its successor. Segments restart their own clock at zero, and an offset keeps the attempt's transcript clock monotonic.

**Checkpoint**: the durable record a replacement owner needs to hold an attempt for resume or finish it with what was captured. Saved through `SessionStore`; in-flight paid work is not kept. A finished conversation keeps a terminal checkpoint until its final archive row is acknowledged.

**Lease**: the small record saved at start, before any checkpoint: the capability, the provider sessions not yet confirmed closed, a deadline, and whether the attempt has closed. It lets a later owner close a provider session the attempt opened even if the conversation never went live.

**Checkpoint fencing**: how the engine keeps one writer per attempt. A store whose owner has been superseded (on a store with segments, when a newer owner has claimed the next one) throws `FencedError` from `save`, `wake` or `clear`; the actor then stops, closes its provider socket and never writes again. On Cloudflare a Durable Object owns its attempt, so nothing is ever fenced; the memory store fences by segment, as a database-backed store would.

**Seams**: the three things a host implements over its platform, in `interview/seams.server.ts`: `SessionStore` (lease, checkpoint, wake hint, clear), `Background` (work that outlives a reply) and `Archive` (archive row upserts). Everything else the engine needs arrives as providers.

**Archive row**: the attempt's record for later reading: transcript, snapshot, conversation map, producer log and prompt versions. Written through `Archive` as a partial row while live (best effort) and a final row at the end (retried from the terminal checkpoint until acknowledged); each write is an upsert by attempt id, and a partial never replaces a final.

**Capability**: the bearer secret the browser receives at start and sends with every command. It is the only proof of ownership the engine checks; identity is the host's business.

**Wake**: a time at which the attempt has due work (pause-hold expiry, idle timeout, limit, partial archive, final archive retry, provider close retry, post-finish clear). The engine asks the store for a wake as a hint; a host with durable timers calls `wake()` then. Due work also runs on restore, and with `lazyWake` before each command, so a host without timers can ignore the hint.

**Interview phase**: the live conversation that produces a transcript, coverage and readings. Lives in `interview/`.

**Narrative phase**: writing Markdown from a canonical transcript, approved report format and optional explicit context. Needs only a language model. Lives in `narrative/`.

**Debrief setup**: the step before an attempt where the topics are decided. An organizer edits a template's draft or a model's draft from a description (`draftDebrief`); approval (`approveDebrief`) turns the record into a spec the engine runs. Lives in `setup/`; the live actor never sees setup concerns.

**Approved debrief**: readable learning goals, recursive topics, optional interviewing guidance and report requirements. Approval validates this content and produces a version. Runtime voices, persona, reading rubrics and limits come from the host; prompt construction belongs to the engine.

**Catalog**: the host lookup used when a new attempt starts. The host pins the full accepted plan, configuration and context before opening the voice session. Checkpoints preserve these inputs, so later owners do not depend on a mutable catalog.

**Accepted definition**: `InterviewPlan`, `InterviewConfig`, and optional `InterviewContext`. Context is explicit background, not participant evidence. The engine parses and copies these values and compiles its internal brief, framing and judging criteria.

**Judged spec**: a spec that carries the criteria and rubrics, so Jev can grade from it (`JudgedSpec`, in `interview/conversation/rubric.prompt.ts`).

**Briefed spec**: a spec that carries the interviewer's brief text, so the engine can render Sam's instructions and opening line (`BriefedSpec`, in `interview/voice/brief.server.ts`).

**Framing**: what kind of interview a spec is, in the words Sol's map and Jev's grade use (`InterviewFraming`): the occasion, the name for one topic, the purpose and setting that open Sol's seed, the thread Sol keeps open by default, what the spec's terms mean, and whose words count toward a topic.

**Techniques**: the engine’s conversational guide, including grounding and finding useful lessons. Organizers supply guidance in the plan rather than writing technique prompt fragments.

**Brief**: Sam's instructions for one voice: the spec's persona, orientation and boundaries around the engine's own turn-taking, technique and note-handling guidance.

**Note channel**: how Sol's notes reach Sam during the conversation. The live session appends them to Sam's thinking. The delivery probe compares the current thread note with a no-note control.

**Silence check**: after four seconds without transcript growth from either side, the server's live timer asks Jev who should speak next. Microphone and playback levels do not gate this check. A strong continue judgment sends one conditional reminder; waiting, uncertainty, new transcript text or a changed session prevents it. Each unchanged exchange is checked once, with no retry and at most 120 checks per attempt. Decisions, receipts and the next observed speech stay in the private connection archive. Interview feedback is judged separately from new project facts in the producer's existing Jev request, so a new preference can wake Sol without another call.

**Typed answer**: a participant answer sent as text with `submitText` instead of spoken. It is participant evidence like speech and reaches the transcript, coverage, resume context, archive and narrative. The browser mints its id and retries with the same id until the server replies; the server acknowledges it only after a checkpoint holding it is saved, then forwards it once to the voice session.

**Typed passage**: the transcript passage a typed answer becomes, with id `typed-<id>` and the participant speaker. It is frozen when appended, so later speech starts a new passage. Its provider event uses the same `typed-` id, which is how a provider rejection of it is recognized.

**Composing**: the browser holds an unsent, nonempty typed draft. Only sequenced poll and `ready` reports change it on the server. While composing, the browser keeps the microphone track disabled, the silence check does not run, and producer notes to Sam are held until the typed answer is forwarded or composition ends; leaving composition starts a fresh four-second silence interval. The draft text stays in the browser.

**Final grade**: Jev's single evaluation of a finished transcript against the judged spec: coverage of every objective and the readings, with evidence by passage id.

**Narrative run**: one attempt at writing a report. `writeNarrative` receives only `transcript`, `format` and optional `context`; it streams a JSON envelope containing Markdown in `text`. `NarrativeRunner` provides bounded retry and rejoin behavior, and `run()` executes the same run headless for a host that persists the result itself.

**Rejoin**: a request that attaches to a narrative run already in progress. `NarrativeRunner.attach` replays what has been written so far and then streams the rest live; a request that drops only detaches, and the run continues until it settles, is cancelled or reaches its deadline. Once settled, a request gets the stored document instead. An imported transcript's run cannot be rejoined, so it is cancelled when its request drops.

**Closure**: how an attempt closed for one page, which `LiveConnection` reports once through `closed`: `ended` (the server ended it or confirmed the end, or it never reached the server), `unconfirmed` (the end went unanswered; the host reattaches with the same attempt to reconcile it) or `lost` (the server no longer has it), with whether the conversation had started.

**Transport**: how the browser client delivers its commands. The poll transport sends one HTTP request per command; the socket transport (`client/socketTransport.ts`) sends the same commands over one WebSocket per attempt, as `{ id, action, capability, body }`, and receives `{ id, status, body }` replies equal to the HTTP replies. The report, which streams, stays on HTTP; a socket start must name the socket's own attempt. The socket is opt-in on the host.

## Hosts

**Hosted session**: the host wrapper around one actor. It returns canonical interview snapshots and adds report state separately. Reports use the actor’s frozen format and explicit context with the final transcript; they receive no map or coverage.

**Narrative route**: `POST /api/interview/narratives`, an independent report from `{ transcript, format, context? }`. No catalog or live attempt is involved. The narrative streams back and is not stored.

**Socket path**: `GET /api/interview/sessions/:id/socket`, the attempt's WebSocket upgrade. A host accepts it only when `INTERVIEW_SOCKET_ENABLED` is "true", and answers each socket command by building the matching HTTP request and passing it through the same routes.

**Reference host**: `scripts/interview-host.ts`, the engine served by one Bun process over the in-memory seams, with timers for wakes. It proves the engine needs no Cloudflare, and is the smallest example of a host.

## The cast

- **Sam**: the interviewer the participant hears, a realtime voice model.
- **Sol**: the producer with the notepad; keeps the conversation map of what has been said and what is still open, and writes Sam's notes.
- **Jev**: the producer's instincts; a judge model that reads coverage, readings and which thread to follow, and gives the final grade.
- **Luna**: the research assistant; looks up public background on organizations, products and terms the participant mentions.

**Topic**: one recursive node with `id`, `label`, `learn`, optional `appliesWhen` and optional child `topics`. Only leaves are assessed. Parent learning intent scopes children, and parent conditions apply to descendants.

**Applicability**: whether a conditional leaf applies to this participant, based on participant evidence. `unknown` differs from `not-applicable`, coverage depth, and a participant’s refusal or uncertainty.
