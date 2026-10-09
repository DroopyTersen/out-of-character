// The Interview phase's public surface: the session a host owns per attempt, and the shapes it stores and archives.
// The seams live in seams.server.ts and the in-memory adapters in adapters/memory.server.ts.

export { SessionActor, type Command, type Reply, type SessionOptions, type SessionServices } from './session/session.server';
export type { Checkpoint, ConnectionLog, InterviewState, Lease, NarrativeStatus, SessionSnapshot } from './session/checkpoint';
export { FencedError, type Archive, type Background, type InterviewArchiveRow, type NarrativeProvenance, type SessionStore, type StoredSession } from './seams.server';

export { resolveInterview, interviewConfigSchema, type InterviewConfig, type InterviewDefinition } from './definition.server';
export { interviewPlanSchema, interviewTopicSchema, interviewContextSchema, type InterviewPlan, type InterviewTopic, type InterviewContext } from '../shared/plan';
