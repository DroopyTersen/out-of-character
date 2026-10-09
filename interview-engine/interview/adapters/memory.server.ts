import { FencedError, type Archive, type Background, type InterviewArchiveRow, type SessionStore, type StoredSession } from '../seams.server';

/**
 * In-memory seams: the reference host's and the tests'. One record holds an attempt; every store opened on it claims
 * the next segment, so an older owner's writes throw FencedError, as a segment-guarded database row would.
 */
export type MemoryRecord = StoredSession & { segment: number; wakeAt: number | null; clears: number };
export const memoryRecord = (): MemoryRecord => ({ segment: 0, wakeAt: null, clears: 0 });

export type MemoryStore = SessionStore & { readonly record: MemoryRecord; readonly segment: number };

/** `onWake` lets a host with timers schedule `actor.wake()`; without it the hint is only recorded. */
export function memoryStore(record: MemoryRecord = memoryRecord(), options: { onWake?: (at: number | null) => void } = {}): MemoryStore {
  const segment = ++record.segment;
  const guard = () => { if (record.segment !== segment) throw new FencedError(); };
  return {
    record, segment,
    async load() {
      return structuredClone({ ...(record.lease ? { lease: record.lease } : {}), ...(record.checkpoint ? { checkpoint: record.checkpoint } : {}) });
    },
    async save(patch) {
      guard();
      if (patch.lease) record.lease = structuredClone(patch.lease);
      if (patch.checkpoint === null) delete record.checkpoint;
      else if (patch.checkpoint) record.checkpoint = structuredClone(patch.checkpoint);
    },
    async wake(at) {
      guard();
      record.wakeAt = at;
      options.onWake?.(at);
    },
    async clear() {
      guard();
      delete record.lease;
      delete record.checkpoint;
      record.wakeAt = null;
      record.clears++;
    },
  };
}

export type InlineBackground = Background & {
  readonly pending: Promise<unknown>[];
  /** Waits for tracked work, including work started by other tracked work. */
  settle(): Promise<void>;
};

/** Runs tracked work in this process. A failure is swallowed, as a platform's background queue would. */
export function inlineBackground(): InlineBackground {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    track(work) { pending.push(work.then(() => {}, () => {})); },
    async settle() {
      for (let seen = -1; seen !== pending.length;) {
        seen = pending.length;
        await Promise.all(pending);
      }
    },
  };
}

export type MemoryArchive = Archive & { readonly rows: Map<string, InterviewArchiveRow>; readonly writes: InterviewArchiveRow[] };

const narrative = (row: InterviewArchiveRow) => row.narrative?.status ?? null;

/** Keeps rows by id with the archive's upsert rules: a partial row never replaces a final one, nor an older row a newer one. */
export function memoryArchive(): MemoryArchive {
  const rows = new Map<string, InterviewArchiveRow>();
  const writes: InterviewArchiveRow[] = [];
  return {
    rows, writes,
    async write(row) {
      const copy = structuredClone(row);
      writes.push(copy);
      const stored = rows.get(row.id);
      if (stored) {
        const finishing = stored.state === 'partial' && copy.state === 'final';
        if (stored.state === 'final' && copy.state === 'partial') return;
        if (copy.capturedAt < stored.capturedAt && !finishing) return;
        if (['ready', 'unavailable'].includes(narrative(stored)!) && narrative(copy) === 'pending') return;
      }
      rows.set(row.id, copy);
    },
  };
}
