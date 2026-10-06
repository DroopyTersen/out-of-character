import { z } from 'zod';
import { foundryUrl, type FoundryConfig } from '../../../ai/foundry.server';
import { actorBrief, getClient, getScenario } from '../../../ai/simulator/scenarios.server';

export const LIVE_MODEL = 'gpt-live-1';
export const NO_EXTERNAL_TASK = 'No external task is available or necessary in this conversation. Continue in your assigned role using the information you actually have. Make no claims about work being done outside this conversation.';
export class LiveSessionGone extends Error {}
const creation = z.object({ session: z.object({ id: z.string().min(1) }), transport: z.object({ type: z.literal('webrtc'), sdp: z.string().min(1) }) });
export const transcriptEvent = z.object({
  type: z.enum(['session.input_transcript.delta', 'session.output_transcript.delta']),
  event_id: z.string().optional(), delta: z.string().max(8000),
  start_ms: z.number().finite().nonnegative(), end_ms: z.number().finite().nonnegative(),
}).refine(event => event.end_ms >= event.start_ms);

/** A resumed session appends the rebuilt conversation after the unchanged actor brief. */
export function liveConfiguration(scenarioId: string, clientId: string, context?: string) {
  const client = getClient(clientId);
  return {
    model: LIVE_MODEL, instructions: [actorBrief(getScenario(scenarioId), client), context].filter(Boolean).join('\n\n'),
    store: false,
    audio: { output: { voice: client.voice } },
  };
}

export async function createLive(input: { scenarioId: string; clientId: string; sdp: string; context?: string }, foundry: FoundryConfig, request: typeof fetch = fetch) {
  const response = await request(foundryUrl(foundry, '/live/sessions'), {
    method: 'POST', headers: { 'api-key': foundry.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: { ...liveConfiguration(input.scenarioId, input.clientId, input.context), model: foundry.liveModel }, transport: { type: 'webrtc', sdp: input.sdp } }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Live creation failed (${response.status}).`);
  return creation.parse(await response.json());
}

export async function attachLive(id: string, foundry: FoundryConfig, request: typeof fetch = fetch): Promise<WebSocket> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await request(foundryUrl(foundry, `/live/sessions/${encodeURIComponent(id)}/attach`), {
      headers: { Upgrade: 'websocket', 'api-key': foundry.apiKey }, signal: controller.signal,
    });
    if (response.status === 404 || response.status === 410) throw new LiveSessionGone('The voice session has already ended.');
    if (!response.webSocket) throw new Error('Live control connection is unavailable.');
    const socket = response.webSocket;
    socket.accept();
    return socket;
  } finally {
    // An AbortSignal.timeout would keep running after the upgrade and close the
    // live sideband. Bound only the handshake, not the established conversation.
    clearTimeout(timeout);
  }
}
