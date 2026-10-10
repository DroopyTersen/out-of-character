/** The part of a WebSocket the engine uses: Cloudflare's upgraded socket, Bun's and the browser's all fit. */
export type WebSocketLike = {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'close' | 'error', listener: () => void): void;
};

/**
 * Turns the provider's answer to an upgrade request into an open socket, or null when the response carries none.
 * Cloudflare: `response.webSocket` after `accept()`. The platform difference is an argument, not a seam.
 */
export type SocketOpener<Socket extends WebSocketLike = WebSocketLike> = (response: Response) => Socket | null;

/** Provider events in the engine's names, independent of the wire protocol. */
export type VoiceEvent =
  | { type: 'transcript'; id?: string; speaker: 'participant' | 'interviewer'; text: string; startMs: number; endMs: number }
  | { type: 'closed'; reason: string | null; usageSeconds: number | null }
  | { type: 'acknowledged'; id: string; startMs?: number; endMs?: number }
  | { type: 'delegation'; id: string; target: string | null }
  | { type: 'error'; id?: string };

export type VoiceInput = { kind: 'instruction' | 'context'; id: string; content: string; delegationId?: string };
export type VoiceHandlers = { event(event: VoiceEvent): void; dropped(): void };
export type VoiceConnection = {
  readonly connected: boolean;
  send(input: VoiceInput): boolean;
  /** Confirms provider closure, reattaching if needed; incoming transcript is still delivered while closing. */
  close(): Promise<void>;
  /** Drops this owner's control connection without ending the provider session. */
  detach(): void;
};

/** The voice model: one provider session per media connection, steered over its control connection. */
export type VoiceProvider = {
  create(input: { sdp: string; voice: string; instructions: string }): Promise<{ id: string; sdp: string }>;
  attach(id: string, handlers?: VoiceHandlers): Promise<VoiceConnection>;
  /** Closes a provider session by id. A session that no longer exists is closed. */
  close(id: string, handlers?: VoiceHandlers): Promise<void>;
};
