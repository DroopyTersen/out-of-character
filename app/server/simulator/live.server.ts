import type { FoundryConfig } from '../../../ai/foundry.server';
import { actorBrief, getClient, getScenario } from '../../../ai/simulator/scenarios.server';
import { attachGptLiveSocket, gptLiveProvider, LIVE_MODEL } from '../../../interview-engine/providers/gptLive.server';
import type { ControlOpener } from '../../../interview-engine/providers/voice.server';

export { LIVE_MODEL, LiveSessionGone, transcriptEvent } from '../../../interview-engine/providers/gptLive.server';
export { NO_EXTERNAL_TASK } from '../../../interview-engine/voice/voice.prompt';

/** A resumed session appends the rebuilt conversation after the unchanged actor brief. */
export function liveConfiguration(scenarioId: string, clientId: string, context?: string) {
  const client = getClient(clientId);
  return {
    model: LIVE_MODEL, instructions: [actorBrief(getScenario(scenarioId), client), context].filter(Boolean).join('\n\n'),
    store: false,
    audio: { output: { voice: client.voice } },
  };
}

/** Cloudflare opens control with an authenticated upgrade and accepts the socket before use. */
export const cloudflareControl = (request: typeof fetch = fetch): ControlOpener<WebSocket> => async ({ url, headers, signal }) => {
  const response = await request(url, { headers: { ...headers, Upgrade: 'websocket' }, signal });
  if (response.status === 404 || response.status === 410) return { status: 'gone' };
  const socket = response.webSocket;
  if (response.status !== 101 || !socket) return { status: 'failed' };
  socket.accept();
  return { status: 'open', socket };
};
const live = (foundry: FoundryConfig, request: typeof fetch) => gptLiveProvider<WebSocket>(foundry, { fetch: request, openControl: cloudflareControl(request) });

export async function createLive(input: { scenarioId: string; clientId: string; sdp: string; context?: string }, foundry: FoundryConfig, request: typeof fetch = fetch) {
  const { instructions, audio } = liveConfiguration(input.scenarioId, input.clientId, input.context);
  const { id, sdp } = await live(foundry, request).create({ sdp: input.sdp, voice: audio.output.voice, instructions });
  return { session: { id }, transport: { type: 'webrtc' as const, sdp } };
}

export async function attachLive(id: string, foundry: FoundryConfig, request: typeof fetch = fetch): Promise<WebSocket> {
  return attachGptLiveSocket(id, foundry, { openControl: cloudflareControl(request) });
}
