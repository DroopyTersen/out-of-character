import { describe, expect, test } from 'bun:test';
import { FencedError, type InterviewArchiveRow } from '../seams.server';
import type { Checkpoint } from '../session/checkpoint';
import { inlineBackground, memoryArchive, memoryRecord, memoryStore } from './memory.server';

const lease = { capability: 'Bearer x', deadline: 1000, closed: false };
const checkpoint = (savedAt: number) => ({ savedAt, epoch: 1 }) as unknown as Checkpoint;
const row = (state: 'partial' | 'final', capturedAt: number, summary: 'pending' | 'ready' | null = null) => ({
  id: 'a1', state, capturedAt,
  snapshot: { interview: { evaluation: null, summary: summary && { status: summary, text: null }, background: [] } },
}) as unknown as InterviewArchiveRow;

describe('memoryStore', () => {
  test('saves, loads copies and removes the checkpoint', async () => {
    const store = memoryStore();
    expect(await store.load()).toEqual({});
    await store.save({ lease, checkpoint: checkpoint(5) });
    const loaded = await store.load();
    expect(loaded).toEqual({ lease, checkpoint: checkpoint(5) });
    loaded.lease!.closed = true;
    expect(store.record.lease!.closed).toBe(false);
    await store.save({ checkpoint: null });
    expect(await store.load()).toEqual({ lease });
  });

  test('a newer owner fences the older one', async () => {
    const record = memoryRecord();
    const first = memoryStore(record);
    await first.save({ lease });
    const second = memoryStore(record);
    expect(second.segment).toBe(first.segment + 1);
    await expect(first.save({ checkpoint: checkpoint(1) })).rejects.toBeInstanceOf(FencedError);
    await expect(first.wake(10)).rejects.toBeInstanceOf(FencedError);
    await expect(first.clear()).rejects.toBeInstanceOf(FencedError);
    expect(record.checkpoint).toBeUndefined();
    expect((await first.load()).lease).toEqual(lease);
    await second.save({ checkpoint: checkpoint(2) });
    expect(record.checkpoint?.savedAt).toBe(2);
  });

  test('records wake hints and clears', async () => {
    const hints: (number | null)[] = [];
    const store = memoryStore(memoryRecord(), { onWake: at => hints.push(at) });
    await store.save({ lease, checkpoint: checkpoint(1) });
    await store.wake(30);
    await store.wake(null);
    expect(hints).toEqual([30, null]);
    await store.wake(40);
    await store.clear();
    expect(store.record).toMatchObject({ wakeAt: null, clears: 1 });
    expect(await store.load()).toEqual({});
  });
});

describe('inlineBackground', () => {
  test('settles nested work and swallows failures', async () => {
    const background = inlineBackground();
    const done: string[] = [];
    background.track(Promise.reject(new Error('lost')));
    background.track((async () => {
      await Promise.resolve();
      done.push('outer');
      background.track((async () => { await Promise.resolve(); done.push('inner'); })());
    })());
    await background.settle();
    expect(done).toEqual(['outer', 'inner']);
  });
});

describe('memoryArchive', () => {
  test('applies the upsert rules', async () => {
    const archive = memoryArchive();
    await archive.write(row('partial', 10));
    await archive.write(row('partial', 5));
    expect(archive.rows.get('a1')?.capturedAt).toBe(10);
    await archive.write(row('final', 8, 'pending'));
    expect(archive.rows.get('a1')?.state).toBe('final');
    await archive.write(row('partial', 20));
    expect(archive.rows.get('a1')?.state).toBe('final');
    await archive.write(row('final', 12, 'ready'));
    await archive.write(row('final', 13, 'pending'));
    expect(archive.rows.get('a1')).toMatchObject({ capturedAt: 12 });
    expect(archive.writes).toHaveLength(6);
  });
});
