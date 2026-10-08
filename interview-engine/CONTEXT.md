# Interview engine glossary

The Markdown companions in `docs/solutioning/` (`interview-engine-api-design.md`, the refactor and extraction plans) use older names such as `conducting/`, `reporting/`, `ArchiveRow` and `ControlSocket`. Where they disagree with `interview-engine-api-design.html` or with the code, the HTML design and the code win.

**Attempt**: one participant's interview from start to finish, identified by the id the browser chose when it started. An attempt survives dropped connections and host restarts until it ends or its pause hold runs out.

**Segment**: one voice-provider session within an attempt. Starting opens the first; each resume after a drop opens a new one. Provider events and closures are bound to their segment, so a superseded session can never pause or end its successor. Segments restart their own clock at zero, and an offset keeps the attempt's transcript clock monotonic.

**Checkpoint**: the durable record a replacement owner needs to hold an attempt for resume or finish it with what was captured. Saved through `SessionStore`; in-flight paid work is not kept.

**Lease**: the small record saved at start, before any checkpoint: the capability, the provider sessions not yet confirmed closed, a deadline, and whether the attempt has closed. It lets a later owner close a provider session the attempt opened even if the conversation never went live.

**Checkpoint fencing**: how the engine keeps one writer per attempt. A store whose owner has been superseded (on a store with segments, when a newer owner has claimed the next one) throws `FencedError` from `save`, `wake` or `clear`; the actor then stops, closes its provider socket and never writes again. On Cloudflare a Durable Object owns its attempt, so nothing is ever fenced; the memory store fences by segment, as a database-backed store would.

**Seams**: the three things a host implements over its platform, in `interview/seams.server.ts`: `SessionStore` (lease, checkpoint, wake hint, clear), `Background` (work that outlives a reply) and `Archive` (archive row upserts). Everything else the engine needs arrives as providers.

**Archive row**: the attempt's record for later reading: transcript, snapshot, conversation map, producer log and prompt versions. Written through `Archive` as a partial row while live and a final row at the end; each write is an upsert by attempt id, and a partial never replaces a final.

**Capability**: the bearer secret the browser receives at start and sends with every command. It is the only proof of ownership the engine checks; identity is the host's business.

**Wake**: a time at which the attempt has due work (pause-hold expiry, idle timeout, limit, partial archive, provider close retry, post-finish clear). The engine asks the store for a wake as a hint; a host with durable timers calls `wake()` then. Due work also runs on restore, and with `lazyWake` before each command, so a host without timers can ignore the hint.

**Interview phase**: the live conversation that produces a transcript, coverage and readings. Lives in `interview/`.

**Narrative phase**: writing a document from a transcript and a `NarrativeTemplate`. Needs only a language model. Lives in `narrative/`.

**Debrief setup**: the step before an attempt where the topics are decided. An organizer edits a template's draft or a model's draft from a description (`draftDebrief`); approval (`approveDebrief`) turns the record into a spec the engine runs. Lives in `setup/`; the live actor never sees setup concerns.

**Approved debrief**: the spec `approveDebrief` builds from a base template and an approved record: the template's cast, persona, boundaries, techniques, readings and limits under the record's role, opening, orientation, framing and topics, with the generic topic-sectioned narrative. Its id is the record's (by default the title's slug); its version is the id plus a digest of the record and the base's id and version, so an attempt's archive row names exactly what it ran under.

**Catalog**: the host's lookup from a spec id (and optionally a version) to a runnable spec: the shipped templates by id, then stored approvals, re-approved against their base template. The attempt object pins the id and version it started under and resolves the same spec on restore; a start that names a spec the catalog cannot resolve is rejected.

**Server-only spec fields**: the parts of an `InterviewSpec` the browser never sees: each objective's `criterion` (and optional `creditRule` and `explored`), each reading's `rubric`, the interviewer's `role`, `persona`, `orientation`, `boundaries`, `opening` and `techniques`, and the spec's `framing`. A spec's public file stays label-only; its `*.prompt.ts` files hold this text.

**Judged spec**: a spec that carries the criteria and rubrics, so Jev can grade from it (`JudgedSpec`, in `interview/conversation/rubric.prompt.ts`).

**Briefed spec**: a spec that carries the interviewer's brief text, so the engine can render Sam's instructions and opening line (`BriefedSpec`, in `interview/voice/brief.server.ts`).

**Framing**: what kind of interview a spec is, in the words Sol's map and Jev's grade use (`InterviewFraming`): the occasion, the name for one topic, the purpose and setting that open Sol's seed, the thread Sol keeps open by default, what the spec's terms mean, and whose words count toward a topic.

**Techniques**: the spec's two entries in Sam's numbered interviewing guide. `grounding` opens the guide (how to anchor the conversation); `lesson` turns a story into something the reader can act on. The other techniques belong to the engine.

**Brief**: Sam's instructions for one voice: the spec's persona, orientation and boundaries around the engine's own turn-taking, technique and note-handling guidance.

**Note channel**: how Sol's notes reach Sam during the conversation. The live session appends them to Sam's thinking. The delivery probe compares the current thread note with a no-note control.

**Silence check**: after five seconds of fresh, measured microphone and playback quiet with no transcript change, the session asks Jev who should speak next. A strong continue judgment sends one conditional reminder; waiting, uncertainty, sound, new transcript text or a changed session prevents it. Each unchanged exchange is checked once, with no retry and at most 120 checks per attempt. Decisions, receipts and the next observed speech stay in the private connection archive. Interview feedback is judged separately from new project facts in the producer's existing Jev request, so a new preference can wake Sol without another call.

**Final grade**: Jev's single evaluation of a finished transcript against the judged spec: coverage of every objective and the readings, with evidence by passage id.

**Narrative run**: one attempt at writing the narrative: the text as it streams and a `Narrative` result that settles once. `writeNarrative` starts one from a `NarrativeInput` (the template and the passages); `NarrativeRunner` allows a report two runs under a deadline and keeps the settled text.

**Rejoin**: a request that attaches to a narrative run already in progress. `NarrativeRunner.attach` replays what has been written so far and then streams the rest live; a request that drops only detaches, and the run continues until it settles, is cancelled or reaches its deadline. Once settled, a request gets the stored document instead. An imported transcript's run cannot be rejoined, so it is cancelled when its request drops.

**Transport**: how the browser client delivers its commands. The poll transport sends one HTTP request per command; the socket transport (`client/socketTransport.ts`) sends the same commands over one WebSocket per attempt, as `{ id, action, capability, body }`, and receives `{ id, status, body }` replies equal to the HTTP replies. The report, which streams, stays on HTTP; a socket start must name the socket's own attempt. The socket is opt-in on the host.

## Hosts

**Hosted session**: one attempt as a host serves it (`HostedSession`, in `app/server/interview/hosted.ts`): it turns each request into a `Command` for the actor, answers in the practice simulator's reply shapes, and runs the narrative when the actor asks for the report. Both of this repository's hosts use it.

**Narrative route**: `POST /api/interview/narratives`, which writes the narrative of an imported transcript (a spec id and its passages) with no attempt involved. The narrative streams back and is not stored.

**Socket path**: `GET /api/interview/sessions/:id/socket`, the attempt's WebSocket upgrade. A host accepts it only when `INTERVIEW_SOCKET_ENABLED` is "true", and answers each socket command by building the matching HTTP request and passing it through the same routes.

**Reference host**: `scripts/interview-host.ts`, the engine served by one Bun process over the in-memory seams, with timers for wakes. It proves the engine needs no Cloudflare, and is the smallest example of a host.

## The cast

- **Sam**: the interviewer the participant hears, a realtime voice model.
- **Sol**: the producer with the notepad; keeps the conversation map of what has been said and what is still open, and writes Sam's notes.
- **Jev**: the producer's instincts; a judge model that reads coverage, readings and which thread to follow, and gives the final grade.
- **Luna**: the research assistant; looks up public background on organizations, products and terms the participant mentions.
