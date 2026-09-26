import { z } from 'zod';
import { actorBrief, getClient, getScenario } from '../../../ai/simulator/scenarios.server';

export const LIVE_MODEL = 'gpt-live-1';
export const NO_EXTERNAL_TASK = 'No external task is available or necessary in this meeting. Continue as the client using your existing facts, interests, and authority limits. Make no claims about work being done outside this conversation.';
export class LiveSessionGone extends Error {}
const creation = z.object({ session: z.object({ id: z.string().min(1) }), transport: z.object({ type: z.literal('webrtc'), sdp: z.string().min(1) }) });
export const transcriptEvent = z.object({
  type: z.enum(['session.input_transcript.delta', 'session.output_transcript.delta']),
  event_id: z.string().optional(), delta: z.string().max(8000),
  start_ms: z.number().finite().nonnegative(), end_ms: z.number().finite().nonnegative(),
}).refine(event => event.end_ms >= event.start_ms);

export function liveConfiguration(scenarioId: string, clientId: string) {
  const client = getClient(clientId);
  return {
    model: LIVE_MODEL, instructions: actorBrief(getScenario(scenarioId), client),
    delegation: { type: 'client' }, store: false,
    audio: { output: { voice: client.voice } },
    // Config snapshots (including session.closed) contain the actor brief. The
    // browser gets only audio; our capability-protected API supplies public state.
    client: { data_channel: { allowed_client_events: ['session.close'], allowed_server_events: [] } },
  };
}

export async function createLive(input: { scenarioId: string; clientId: string; sdp: string }, apiKey: string) {
  const response = await fetch('https://api.openai.com/v1/live/sessions', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: liveConfiguration(input.scenarioId, input.clientId), transport: { type: 'webrtc', sdp: input.sdp } }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Live creation failed (${response.status}).`);
  return creation.parse(await response.json());
}

export async function attachLive(id: string, apiKey: string): Promise<WebSocket> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`https://api.openai.com/v1/live/sessions/${encodeURIComponent(id)}/attach`, {
      headers: { Upgrade: 'websocket', Authorization: `Bearer ${apiKey}` }, signal: controller.signal,
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
