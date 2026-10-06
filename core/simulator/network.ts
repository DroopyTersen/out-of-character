/** Media quality over one sampling window, read from the browser's WebRTC stats. For diagnostics only. */
export type NetworkSample = {
  /** The window's length. */
  ms: number;
  /** Sam's audio packets the browser received and lost in the window. */
  received: number; lost: number;
  /** The share of Sam's audio the browser filled in for missing packets, 0 to 1. */
  concealed: number | null;
  jitterMs: number | null;
  /** The participant's packets the provider reported lost in the window; null until it reports. */
  sentLost: number | null;
  rttMs: number | null;
};
export type NetworkRecord = NetworkSample & { at: number };
/** Cumulative counters from the previous read; a sample is the difference. */
export type NetworkCounters = { at: number; received: number; lost: number; concealed: number; samples: number; sentLost: number | null };

export const NETWORK_SAMPLE_MS = 5000;
/** One media connection's samples: an hour at five seconds. */
export const NETWORK_SAMPLES = 720;

type Stat = { type?: unknown; kind?: unknown; [key: string]: unknown };
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const ms = (seconds: unknown) => count(seconds) == null ? null : Math.round((seconds as number) * 1000);

/**
 * Reads one RTCStatsReport. Counters that went backwards belong to a new connection: they become the baseline and no sample is made.
 */
export function readNetwork(stats: Iterable<Stat>, previous: NetworkCounters | undefined, at: number): { counters: NetworkCounters; sample?: NetworkSample } {
  let inbound: Stat | undefined, remote: Stat | undefined, pair: Stat | undefined;
  for (const stat of stats) {
    if (stat.type === 'inbound-rtp' && stat.kind === 'audio') inbound = stat;
    else if (stat.type === 'remote-inbound-rtp' && stat.kind === 'audio') remote = stat;
    else if (stat.type === 'candidate-pair' && stat.nominated && stat.state === 'succeeded') pair = stat;
  }
  const counters: NetworkCounters = {
    at, received: count(inbound?.packetsReceived) ?? 0, lost: count(inbound?.packetsLost) ?? 0,
    concealed: count(inbound?.concealedSamples) ?? 0, samples: count(inbound?.totalSamplesReceived) ?? 0, sentLost: count(remote?.packetsLost),
  };
  if (!previous || !inbound || counters.received < previous.received || counters.samples < previous.samples) return { counters };
  const samples = counters.samples - previous.samples;
  return { counters, sample: {
    ms: at - previous.at, received: counters.received - previous.received, lost: Math.max(0, counters.lost - previous.lost),
    concealed: samples > 0 ? Math.round(Math.min(1, Math.max(0, counters.concealed - previous.concealed) / samples) * 1000) / 1000 : null,
    jitterMs: ms(inbound.jitter),
    sentLost: counters.sentLost != null && previous.sentLost != null ? Math.max(0, counters.sentLost - previous.sentLost) : null,
    rttMs: ms(remote?.roundTripTime) ?? ms(pair?.currentRoundTripTime),
  } };
}
