import { expect, test } from 'bun:test';
import { readNetwork } from './network';

const report = (received: number, lost: number, concealed: number, samples: number, remote?: { lost: number; rtt: number }) => [
  { type: 'inbound-rtp', kind: 'audio', packetsReceived: received, packetsLost: lost, concealedSamples: concealed, totalSamplesReceived: samples, jitter: .0125 },
  { type: 'inbound-rtp', kind: 'video', packetsReceived: 9999 },
  ...(remote ? [{ type: 'remote-inbound-rtp', kind: 'audio', packetsLost: remote.lost, roundTripTime: remote.rtt }] : []),
  { type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: .2 },
];

test('a stats read is a baseline; the next is the change since, with concealment as a share of the audio', () => {
  const first = readNetwork(report(100, 2, 0, 96_000), undefined, 0);
  expect(first.sample).toBeUndefined();
  const second = readNetwork(report(350, 7, 4800, 336_000, { lost: 3, rtt: .081 }), first.counters, 5000);
  expect(second.sample).toEqual({ ms: 5000, received: 250, lost: 5, concealed: .02, jitterMs: 13, sentLost: null, rttMs: 81 });
  const third = readNetwork(report(600, 7, 4800, 576_000, { lost: 4, rtt: .09 }), second.counters, 10_000);
  expect(third.sample).toMatchObject({ received: 250, lost: 0, concealed: 0, sentLost: 1, rttMs: 90 });
});

test('without the provider’s report the round trip comes from the candidate pair; counters that restart make a new baseline', () => {
  const first = readNetwork(report(500, 0, 0, 480_000), undefined, 0);
  expect(readNetwork(report(750, 0, 0, 720_000), first.counters, 5000).sample).toMatchObject({ rttMs: 200, sentLost: null });
  const restarted = readNetwork(report(10, 0, 0, 9600), first.counters, 5000);
  expect(restarted.sample).toBeUndefined();
  expect(restarted.counters.received).toBe(10);
  expect(readNetwork([], undefined, 0).sample).toBeUndefined();
});
