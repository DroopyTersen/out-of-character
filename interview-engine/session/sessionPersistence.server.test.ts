import { expect, test } from 'bun:test';
import { memoryStore } from '../adapters/memory.server';
import { FencedError, type SessionStore } from '../seams.server';
import type { Checkpoint } from './sessionCheckpoint';
import { SessionPersistence } from './sessionPersistence.server';

const checkpoint = (savedAt: number, status: 'live' | 'ended' = 'live'): Checkpoint => ({
  savedAt, reachedLive: true, epoch: 1, resumes: 0, segments: [], pauses: [], grades: [], gradeCalls: 0,
  snapshot: {
    id: 'attempt', planId: 'project', voiceId: 'riley', status, startedAt: 0, limitSeconds: 3600,
    warning: null, message: null, finalization: 'pending', usageSeconds: null, transcript: [], revision: 0,
    feedbackStatus: 'waiting',
  },
});

/** Keep real storage semantics; delay only its first save to exercise overlapping requests. */
function holdFirstSave(store: SessionStore) {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let first = true;
  const delayed: SessionStore = {
    ...store,
    async save(patch) {
      if (first) {
        first = false;
        entered.resolve();
        await release.promise;
      }
      await store.save(patch);
    },
  };
  return { store: delayed, entered: entered.promise, release: () => release.resolve() };
}

test('a terminal checkpoint follows an in-flight answer save and captures the latest state', async () => {
  const store = memoryStore();
  const held = holdFirstSave(store);
  const persistence = new SessionPersistence(held.store, () => {});
  let current = checkpoint(10);
  const answer = persistence.saveCheckpoint(() => current);
  await held.entered;
  const terminal = persistence.saveCheckpoint(() => current);
  current = checkpoint(20, 'ended');
  held.release();
  await Promise.all([answer, terminal]);
  expect(await store.load()).toEqual({ checkpoint: checkpoint(20, 'ended') });
});

test('a failed save rejects its caller while a later checkpoint can still become durable', async () => {
  const store = memoryStore();
  let fail = true;
  const persistence = new SessionPersistence({ ...store, async save(patch) {
    if (fail) { fail = false; throw new Error('Storage unavailable'); }
    await store.save(patch);
  } }, () => {});
  const failed = persistence.saveCheckpoint(() => checkpoint(10));
  const retried = persistence.saveCheckpoint(() => checkpoint(20));
  await expect(failed).rejects.toThrow('Storage unavailable');
  await retried;
  expect(await store.load()).toEqual({ checkpoint: checkpoint(20) });
  expect(persistence.ownershipLost).toBe(false);
});

test('removal waits for the in-flight checkpoint and immediately consumes the local wake', async () => {
  const store = memoryStore();
  const held = holdFirstSave(store);
  const persistence = new SessionPersistence(held.store, () => {});
  await persistence.setWake(100);
  const saving = persistence.saveCheckpoint(() => checkpoint(10));
  await held.entered;
  const clearing = persistence.clear();
  expect(persistence.wakeAt).toBeNull();
  held.release();
  await Promise.all([saving, clearing]);
  expect(await store.load()).toEqual({});
  expect(store.record.wakeAt).toBeNull();
});

test('a replacement owner stops old queued writes, wake changes and removal', async () => {
  const store = memoryStore();
  const held = holdFirstSave(store);
  let stops = 0;
  const persistence = new SessionPersistence(held.store, () => { stops++; });
  const saving = persistence.saveCheckpoint(() => checkpoint(10));
  await held.entered;
  const queued = persistence.saveCheckpoint(() => checkpoint(20));
  const successor = memoryStore(store.record);
  await successor.save({ checkpoint: checkpoint(30) });
  await successor.wake(300);
  held.release();
  await expect(saving).rejects.toBeInstanceOf(FencedError);
  await expect(queued).rejects.toBeInstanceOf(FencedError);
  await expect(persistence.setWake(100)).rejects.toBeInstanceOf(FencedError);
  await expect(persistence.clear()).rejects.toBeInstanceOf(FencedError);
  persistence.loseOwnership();
  expect(stops).toBe(1);
  expect(persistence.ownershipLost).toBe(true);
  expect(await successor.load()).toEqual({ checkpoint: checkpoint(30) });
  expect(store.record.wakeAt).toBe(300);
});

test('a refused wake also stops the owner, while consuming a wake only changes the local hint', async () => {
  const store = memoryStore();
  let stops = 0;
  const persistence = new SessionPersistence(store, () => { stops++; });
  await persistence.setWake(100);
  persistence.consumeWake();
  expect(persistence.wakeAt).toBeNull();
  expect(store.record.wakeAt).toBe(100);
  memoryStore(store.record);
  await expect(persistence.setWake(200)).rejects.toBeInstanceOf(FencedError);
  expect(stops).toBe(1);
  expect(persistence.ownershipLost).toBe(true);
});
