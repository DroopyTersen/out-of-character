import { z } from 'zod';
import { foundryUrl, type FoundryConfig } from './foundry.server';
import type { SocketOpener, VoiceConnection, VoiceEvent, VoiceHandlers, VoiceProvider, WebSocketLike } from './voice.server';

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

/** Raw upgrade for the separate simulator, which owns its own control protocol. */
export async function attachGptLiveSocket<Socket extends WebSocketLike>(id: string, config: FoundryConfig, { fetch: request = fetch, socket: open }: GptLiveOptions<Socket>): Promise<Socket> {
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
    // Bound only the handshake: aborting an established sideband can close the conversation.
    clearTimeout(timeout);
  }
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function decode(data: unknown): VoiceEvent | undefined {
  if (typeof data !== 'string') return;
  let event;
  try { event = JSON.parse(data); } catch { return; }
  if (!event || typeof event !== 'object') return;
  const transcript = transcriptEvent.safeParse(event);
  if (transcript.success) {
    const delta = transcript.data;
    return { type: 'transcript', id: delta.event_id, speaker: delta.type === 'session.input_transcript.delta' ? 'participant' : 'interviewer',
      text: delta.delta, startMs: delta.start_ms, endMs: delta.end_ms };
  }
  if (event.type === 'session.closed') return { type: 'closed', reason: typeof event.reason === 'string' ? event.reason : null,
    usageSeconds: finite(event.usage?.seconds) ? event.usage.seconds : null };
  if ((event.type === 'session.thinking.appended' || event.type === 'session.instructions.appended') && typeof event.client_event_id === 'string') {
    return { type: 'acknowledged', id: event.client_event_id,
      ...(finite(event.start_ms) ? { startMs: event.start_ms } : {}), ...(finite(event.end_ms) ? { endMs: event.end_ms } : {}) };
  }
  if (event.type === 'session.delegation.created' && typeof event.delegation?.id === 'string') return { type: 'delegation',
    id: event.delegation.id, target: typeof event.delegation.target === 'string' ? event.delegation.target : null };
  if (event.type === 'error') return { type: 'error', ...(typeof event.error?.client_event_id === 'string' ? { id: event.error.client_event_id } : {}) };
}

/** GPT-Live on Azure AI Foundry: owns protocol decoding, commands and closure confirmation. */
export function gptLiveProvider<Socket extends WebSocketLike = WebSocketLike>(config: FoundryConfig, options: GptLiveOptions<Socket>): VoiceProvider {
  const request = options.fetch ?? fetch;
  async function attach(id: string, handlers?: VoiceHandlers): Promise<VoiceConnection> {
    let socket = await attachGptLiveSocket(id, config, options);
    let closed = false;
    let detached = false;
    let confirm: (() => void) | undefined;
    let rejectClose: (() => void) | undefined;
    const dropped = () => { rejectClose?.(); handlers?.dropped(); };
    function listen(control = socket) {
      const current = () => !detached && control === socket;
      control.addEventListener('close', () => { if (current()) dropped(); });
      control.addEventListener('error', () => { if (current()) dropped(); });
      control.addEventListener('message', message => {
        if (!current()) return;
        const event = decode(message.data);
        if (!event) return;
        if (event.type === 'closed') { closed = true; confirm?.(); }
        // Application exceptions must never be classified as malformed JSON.
        handlers?.event(event);
      });
    }
    listen();
    const connection: VoiceConnection = {
      get connected() { return !detached && socket.readyState === 1; },
      send({ kind, id, content, delegationId = null }) {
        if (!connection.connected) return false;
        try { socket.send(JSON.stringify({ type: kind === 'instruction' ? 'session.instructions.append' : 'session.thinking.append', event_id: id, delegation_id: delegationId, content })); return true; }
        catch { return false; }
      },
      detach() { if (detached) return; detached = true; rejectClose?.(); socket.close(); },
      async close() {
        try {
          if (closed) return;
          if (detached) throw new Error('Closure not confirmed.');
          if (!connection.connected) {
            const replacement = await attachGptLiveSocket(id, config, options);
            if (detached) { replacement.close(); throw new Error('Closure not confirmed.'); }
            socket = replacement; listen();
          }
          if (!connection.connected) throw new Error('Closure not confirmed.');
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Closure not confirmed.')), 10_000);
            const settle = (done: () => void) => { clearTimeout(timeout); done(); };
            confirm = () => settle(resolve);
            rejectClose = () => settle(() => reject(new Error('Closure not confirmed.')));
            try { socket.send(JSON.stringify({ type: 'session.close' })); } catch { rejectClose(); }
          });
        } catch (error) { if (!(error instanceof LiveSessionGone)) throw error; }
        finally { confirm = rejectClose = undefined; connection.detach(); }
      },
    };
    return connection;
  }
  async function close(id: string, handlers?: VoiceHandlers) {
    try { await (await attach(id, handlers)).close(); }
    catch (error) { if (!(error instanceof LiveSessionGone)) throw error; }
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
    close,
  };
}
