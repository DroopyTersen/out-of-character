import { expect, test } from 'bun:test';
import type { InterviewArchiveRow } from '../seams.server';
import { SessionMediaDiagnostics } from '../session/sessionMediaDiagnostics';
import { practiceEvidence } from './practiceEvidence';

test('missing historical measurements remain unavailable', () => {
  const evidence = practiceEvidence([], []);
  expect(evidence.measurements).toMatchObject({ serverTranscriptArrival: 0, browserMediaEvents: 0, clockSamples: 0, renderedInstructions: false, models: null });
  expect(evidence.browserClockOverlapCandidates).toEqual([]);
});

test('overlap requires consecutive events from the same connection clock', () => {
  const media = new SessionMediaDiagnostics();
  media.append({ captureId: 'browser', dropped: 1, observed: 7, events: [
    { sequence: 1, epoch: 1, atMs: 100, inputActive: true, outputActive: true },
    { sequence: 2, epoch: 1, atMs: 240, inputActive: false, outputActive: true },
    { sequence: 3, epoch: 1, atMs: 300, inputActive: true, outputActive: true },
    { sequence: 5, epoch: 1, atMs: 700, inputActive: true, outputActive: true },
    { sequence: 6, epoch: 2, atMs: 900, inputActive: false, outputActive: false },
  ] }, 1000);
  const provenance: InterviewArchiveRow['provenance'] = { voice: 'test', rubricVersion: 'test', actorDigest: 'test', openingDigest: 'test', producer: null, connection: { segments: [], pauses: [] }, media: media.snapshot };
  const evidence = practiceEvidence([], [], provenance);
  expect(evidence.browserClockOverlapCandidates).toEqual([{ captureId: 'browser', epoch: 1, atMs: 100, durationMs: 140 }]);
  expect(evidence.measurements).toMatchObject({ browserDiscarded: 1, browserUnreceived: 2, browserMediaEvents: 5 });
});
