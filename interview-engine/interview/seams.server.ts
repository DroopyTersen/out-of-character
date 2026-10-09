import type { Passage } from '../shared/transcript';
import type { ProducerLogRecord, ProducerSummary } from './conversation/records';
import type { Checkpoint, ConnectionLog, Lease, NarrativeStatus, PublicSnapshot } from './session/checkpoint';
import type { NarrativeProvenance } from '../shared/narrative';

export type { Checkpoint, Lease } from './session/checkpoint';
export type { NarrativeProvenance } from '../shared/narrative';

/** A save was refused because a newer owner of the attempt has taken over. The superseded owner stops. */
export class FencedError extends Error {
  constructor(message = 'Another owner has taken over this attempt.') {
    super(message);
    this.name = 'FencedError';
  }
}

/** What an attempt has stored: the closure lease from the start, and a checkpoint once the conversation has gone live. */
export type StoredSession = { lease?: Lease; checkpoint?: Checkpoint };

/**
 * The attempt's durable state, bound by the host to one attempt. A patch is durable before `save` returns;
 * `checkpoint: null` removes the checkpoint. `wake` is a hint: a host with timers calls `wake()` on the actor at
 * that time, a host without them ignores it and the actor runs its due work on the next command.
 */
export type SessionStore = {
  load(): Promise<StoredSession>;
  /** Throws FencedError if this owner has been superseded. */
  save(patch: { lease?: Lease; checkpoint?: Checkpoint | null }): Promise<void>;
  wake(at: number | null): Promise<void>;
  /** Forgets the attempt once its hold has passed. */
  clear(): Promise<void>;
};
/** Keeps work running after the request that started it has been answered: grading, map updates, archive writes. */
export type Background = { track(work: Promise<unknown>): void };
/** Upserts the attempt's archive row by id. Best effort: a failed write is logged, never retried. */
export type Archive = { write(row: InterviewArchiveRow): Promise<void> };
export type Seams = { store: SessionStore; background: Background; archive: Archive };

/**
 * One archived attempt. A partial row is written every 30 seconds while live; the final row once the attempt ends,
 * and again when the narrative settles. A partial row never replaces a final one.
 */
export type InterviewArchiveRow = {
  id: string;
  specId: string;
  specVersion: string;
  voiceId: string;
  state: 'partial' | 'final';
  capturedAt: number;
  /** The public snapshot as the browser saw it at `capturedAt`. */
  snapshot: PublicSnapshot;
  transcript: Passage[];
  narrative: NarrativeStatus | null;
  /** Sol, Jev and Luna calls with timings, then the coverage grades. The host trims it to its byte budget. */
  producerLog: ProducerLogRecord[];
  provenance: {
    /** The voice provider's voice name. */
    voice: string;
    rubricVersion: string;
    /** The first 12 hex digits of the SHA-256 of the interviewer's brief, and of the opening instruction. */
    actorDigest: string;
    openingDigest: string;
    producer: ProducerSummary | null;
    connection: ConnectionLog;
    narrative?: NarrativeProvenance;
  };
};
