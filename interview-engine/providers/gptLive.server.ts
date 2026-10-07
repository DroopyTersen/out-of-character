import { z } from 'zod';
import { foundryUrl, type FoundryConfig } from './foundry.server';
import type { SocketOpener, VoiceProvider, WebSocketLike } from './voice.server';

export const LIVE_MODEL = 'gpt-live-1';
/** The provider no longer has the session: it ended or expired. */
export class LiveSessionGone extends Error {}
const creation = z.object({ session: z.object({ id: z.string().min(1) }), transport: z.object({ type: z.literal('webrtc'), sdp: z.string().min(1) }) });
export const transcriptEvent = z.object({
  type: z.enum(['session.input_transcript.delta', 'session.output_transcript.delta']),
  event_id: z.string().optional(), delta: z.string().max(8000),
  start_ms: z.number().finite().nonnegative(), end_ms: z.number().finite().nonnegative(),
}).refine(event => event.end_ms >= event.start_ms);

export type GptLiveOptions<Socket extends WebSocketLike> = {
  /** Substitutes the HTTP client; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Opens the control socket from the upgrade response, e.g. Cloudflare's `response.webSocket` after `accept()`. */
  socket: SocketOpener<Socket>;
};

/** GPT-Live on Azure AI Foundry: WebRTC media from the browser, a server-only control WebSocket per session. */
export function gptLiveProvider<Socket extends WebSocketLike = WebSocketLike>(config: FoundryConfig, { fetch: request = fetch, socket: open }: GptLiveOptions<Socket>): VoiceProvider<Socket> {
  async function attach(id: string): Promise<Socket> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await request(foundryUrl(config, `/live/sessions/${encodeURIComponent(id)}/attach`), {
        headers: { Upgrade: 'websocket', 'api-key': config.apiKey }, signal: controller.signal,
      });
      if (response.status === 404 || response.status === 410) throw new LiveSessionGone('The voice session has already ended.');
      const socket = open(response);
      if (!socket) throw new Error('Live control connection is unavailable.');
      return socket;
    } finally {
      // An AbortSignal.timeout would keep running after the upgrade and close the
      // live sideband. Bound only the handshake, not the established conversation.
      clearTimeout(timeout);
    }
  }

  return {
    async create({ sdp, voice, instructions }) {
      const response = await request(foundryUrl(config, '/live/sessions'), {
        method: 'POST', headers: { 'api-key': config.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: { model: config.liveModel, instructions, store: false, audio: { output: { voice } } }, transport: { type: 'webrtc', sdp } }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`Live creation failed (${response.status}).`);
      const created = creation.parse(await response.json());
      return { id: created.session.id, sdp: created.transport.sdp };
    },
    attach,
    /** Closes one provider session over a dedicated control socket. A session that no longer exists is closed. */
    async close(id) {
      let socket: Socket | undefined;
      try {
        socket = await attach(id);
        const control = socket;
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Closure not confirmed.')), 10_000);
          control.addEventListener('message', event => {
            if (typeof event.data !== 'string') return;
            try {
              if (JSON.parse(event.data).type === 'session.closed') { clearTimeout(timeout); resolve(); }
            } catch { /* Ignore unrelated protocol data. */ }
          });
          control.send(JSON.stringify({ type: 'session.close' }));
        });
      } catch (error) { if (!(error instanceof LiveSessionGone)) throw error; }
      finally { socket?.close(); }
    },
  };
}
