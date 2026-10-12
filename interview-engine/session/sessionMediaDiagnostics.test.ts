import { expect, test } from 'bun:test';
import { MediaActivityCapture } from '../client/mediaActivity';
import { activitySchema } from '../shared/protocol';
import { SessionMediaDiagnostics } from './sessionMediaDiagnostics';

test('failed and out-of-order polls retain each audio transition exactly once, including across recovery', () => {
  const browser = new MediaActivityCapture();
  const server = new SessionMediaDiagnostics();
  browser.connect();
  browser.synchronize(100, 140, 10_000);
  browser.observe(true, false, 150);
  browser.observe(true, false, 160);
  const first = browser.batch();
  browser.observe(true, true, 200);
  const second = browser.batch();
  server.append(second, 10_100);
  server.append(first, 10_120);
  expect(server.snapshot.events.map(event => [event.atMs, event.inputActive, event.outputActive])).toEqual([[150, true, false], [200, true, true]]);
  browser.acknowledge(first);
  expect(browser.batch().events.map(event => event.atMs)).toEqual([200]);
  const restored = new SessionMediaDiagnostics();
  restored.restore(server.snapshot);
  restored.append(browser.batch(), 10_150);
  expect(restored.snapshot.events).toHaveLength(2);
  expect(restored.snapshot.captures[0]).toMatchObject({ received: 2, observed: 2, dropped: 0, clocks: [{ atMs: 120, serverAt: 10_000, roundTripMs: 40 }] });
  browser.acknowledge(second);
  expect(browser.batch().events).toEqual([]);
});

test('reconnect refreshes the clock estimate and keeps connection epochs distinct', () => {
  const browser = new MediaActivityCapture();
  const server = new SessionMediaDiagnostics();
  browser.connect(); browser.synchronize(100, 120, 1000); browser.observe(false, false, 130);
  const first = browser.batch(); server.append(first, 1010); browser.acknowledge(first);
  browser.connect(); browser.synchronize(500, 540, 5000); browser.observe(false, false, 550);
  server.append(browser.batch(), 5010);
  expect(server.snapshot.events.map(event => event.epoch)).toEqual([1, 2]);
  expect(server.snapshot.captures[0]!.clocks.at(-1)).toEqual({ epoch: 2, atMs: 520, serverAt: 5000, roundTripMs: 40 });
});

test('bounded capture accounts for missing and discarded events instead of claiming full coverage', () => {
  const browser = new MediaActivityCapture();
  const server = new SessionMediaDiagnostics();
  browser.connect();
  for (let i = 0; i < 300; i++) browser.observe(i % 2 === 0, false, i);
  expect(browser.batch()).toMatchObject({ dropped: 44, observed: 300 });
  expect(browser.batch().events).toHaveLength(32);
  while (browser.batch().events.length) { const batch = browser.batch(); server.append(batch, 1000); browser.acknowledge(batch); }
  for (let i = 300; i < 2200; i++) {
    browser.observe(i % 2 === 0, false, i);
    const batch = browser.batch(); server.append(batch, i + 1000); browser.acknowledge(batch);
  }
  expect(server.snapshot.events).toHaveLength(2048);
  expect(server.snapshot.discarded).toBe(108);
  expect(server.snapshot.captures[0]).toMatchObject({ observed: 2200, received: 2156, dropped: 44 });
  const copy = server.snapshot;
  copy.events.length = 0;
  expect(server.snapshot.events).toHaveLength(2048);
});

test('invalid optional diagnostics never invalidate a valid activity report', () => {
  expect(activitySchema.parse({ active: false, audio: true, media: { events: 'broken' } })).toMatchObject({ active: false, audio: true, media: undefined });
});
