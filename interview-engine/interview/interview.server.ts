// The Interview phase's public surface: the session a host owns per attempt, and the shapes it stores and archives.
// The seams live in seams.server.ts and the in-memory adapters in adapters/memory.server.ts.

export { SessionActor, type Command, type Reply, type SessionEvaluation, type SessionOptions, type SessionServices, type SessionSpec } from './session/session.server';
export type { Checkpoint, ConnectionLog, InterviewState, Lease, NarrativeStatus, PublicSnapshot, WireSnapshot } from './session/checkpoint';
export { FencedError, type Archive, type Background, type InterviewArchiveRow, type NarrativeProvenance, type Seams, type SessionStore, type StoredSession } from './seams.server';
