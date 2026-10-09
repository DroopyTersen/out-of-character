import type { FoundryConfig } from '../../../ai/foundry.server';
import { actorBrief, getClient, getScenario } from '../../../ai/simulator/scenarios.server';
import { gptLiveProvider, LIVE_MODEL } from '../../../interview-engine/providers/gptLive.server';

export { LIVE_MODEL, LiveSessionGone, transcriptEvent } from '../../../interview-engine/providers/gptLive.server';
export { NO_EXTERNAL_TASK } from '../../../interview-engine/interview/session/voice.prompt';

/** A resumed session appends the rebuilt conversation after the unchanged actor brief. */
export function liveConfiguration(scenarioId: string, clientId: string, context?: string) {
  const client = getClient(clientId);
  return {
    model: LIVE_MODEL, instructions: [actorBrief(getScenario(scenarioId), client), context].filter(Boolean).join('\n\n'),
    store: false,
    audio: { output: { voice: client.voice } },
  };
}

/** The Cloudflare upgrade: the socket arrives on the response and must be accepted before use. */
export const cloudflareSocket = (response: Response) => {
  const socket = response.webSocket;
  if (!socket) return null;
  socket.accept();
  return socket;
};
const live = (foundry: FoundryConfig, request: typeof fetch) => gptLiveProvider<WebSocket>(foundry, { fetch: request, socket: cloudflareSocket });

export async function createLive(input: { scenarioId: string; clientId: string; sdp: string; context?: string }, foundry: FoundryConfig, request: typeof fetch = fetch) {
  const { instructions, audio } = liveConfiguration(input.scenarioId, input.clientId, input.context);
  const { id, sdp } = await live(foundry, request).create({ sdp: input.sdp, voice: audio.output.voice, instructions });
  return { session: { id }, transport: { type: 'webrtc' as const, sdp } };
}

export async function attachLive(id: string, foundry: FoundryConfig, request: typeof fetch = fetch): Promise<WebSocket> {
  return live(foundry, request).attach(id);
}
