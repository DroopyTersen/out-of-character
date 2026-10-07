# Interview engine glossary

**Attempt**: one participant's interview from start to finish, identified by the id the browser chose when it started. An attempt survives dropped connections and host restarts until it ends or its pause hold runs out.

**Segment**: one voice-provider session within an attempt. Starting opens the first; each resume after a drop opens a new one. Provider events and closures are bound to their segment, so a superseded session can never pause or end its successor. Segments restart their own clock at zero, and an offset keeps the attempt's transcript clock monotonic.

**Checkpoint**: the durable record a replacement owner needs to hold an attempt for resume or finish it with what was captured. Saved through `SessionStore`; in-flight paid work is not kept.

**Archive row**: the attempt's record for later reading: transcript, snapshot, conversation map, producer log and prompt versions. Written through `Archive` as a partial row while live and a final row at the end; each write is an upsert by attempt id, and a partial never replaces a final.

**Capability**: the bearer secret the browser receives at start and sends with every command. It is the only proof of ownership the engine checks; identity is the host's business.

**Wake**: a time at which the attempt has due work (pause-hold expiry, idle timeout, limit, partial archive, provider close retry, post-finish clear). The engine asks the store for a wake as a hint; a host with durable timers calls `wake()` then, and the engine also runs due work on restore and before each command.

**Interview phase**: the live conversation that produces a transcript, coverage and readings. Lives in `interview/`.

**Narrative phase**: writing a document from a transcript and a `NarrativeTemplate`. Needs only a language model. Lives in `narrative/`.

## The cast

- **Sam**: the interviewer the participant hears, a realtime voice model.
- **Sol**: the producer with the notepad; keeps the conversation map of what has been said and what is still open, and writes Sam's notes.
- **Jev**: the producer's instincts; a judge model that reads coverage, readings and which thread to follow, and gives the final grade.
- **Luna**: the research assistant; looks up public background on organizations, products and terms the participant mentions.
