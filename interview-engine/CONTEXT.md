# Interview engine glossary

**Attempt**: one participant's interview from start to finish, identified by the id the browser chose when it started. An attempt survives dropped connections and host restarts until it ends or its pause hold runs out.

**Segment**: one voice-provider session within an attempt. Starting opens the first; each resume after a drop opens a new one. Provider events and closures are bound to their segment, so a superseded session can never pause or end its successor. Segments restart their own clock at zero, and an offset keeps the attempt's transcript clock monotonic.

**Checkpoint**: the durable record a replacement owner needs to hold an attempt for resume or finish it with what was captured. Saved through `SessionStore`; in-flight paid work is not kept.

**Archive row**: the attempt's record for later reading: transcript, snapshot, conversation map, producer log and prompt versions. Written through `Archive` as a partial row while live and a final row at the end; each write is an upsert by attempt id, and a partial never replaces a final.

**Capability**: the bearer secret the browser receives at start and sends with every command. It is the only proof of ownership the engine checks; identity is the host's business.

**Wake**: a time at which the attempt has due work (pause-hold expiry, idle timeout, limit, partial archive, provider close retry, post-finish clear). The engine asks the store for a wake as a hint; a host with durable timers calls `wake()` then, and the engine also runs due work on restore and before each command.

**Interview phase**: the live conversation that produces a transcript, coverage and readings. Lives in `interview/`.

**Narrative phase**: writing a document from a transcript and a `NarrativeTemplate`. Needs only a language model. Lives in `narrative/`.

**Server-only spec fields**: the parts of an `InterviewSpec` the browser never sees: each objective's `criterion` (and optional `creditRule` and `explored`), each reading's `rubric`, and the interviewer's `role`, `persona`, `orientation`, `boundaries` and `opening`. A spec's public file stays label-only; its `*.prompt.ts` files hold this text.

**Judged spec**: a spec that carries the criteria and rubrics, so Jev can grade from it (`JudgedSpec`, in `interview/conversation/rubric.prompt.ts`).

**Briefed spec**: a spec that carries the interviewer's brief text, so the engine can render Sam's instructions and opening line (`BriefedSpec`, in `interview/voice/brief.server.ts`).

**Brief**: Sam's instructions for one voice: the spec's persona, orientation and boundaries around the engine's own turn-taking, technique and note-handling guidance.

**Note channel**: how Sol's notes reach Sam during the conversation. The live session appends them to Sam's thinking; the delivery probe compares appending them to the instructions. The brief names the channel so its wording matches.

**Final grade**: Jev's single evaluation of a finished transcript against the judged spec: coverage of every objective and the readings, with evidence by passage id.

**Narrative run**: one attempt at writing the narrative: the text as it streams and a `Narrative` result that settles once. `writeNarrative` starts one from a `NarrativeInput` (the template and the passages).

## The cast

- **Sam**: the interviewer the participant hears, a realtime voice model.
- **Sol**: the producer with the notepad; keeps the conversation map of what has been said and what is still open, and writes Sam's notes.
- **Jev**: the producer's instincts; a judge model that reads coverage, readings and which thread to follow, and gives the final grade.
- **Luna**: the research assistant; looks up public background on organizations, products and terms the participant mentions.
