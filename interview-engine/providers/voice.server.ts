/** The part of a WebSocket the engine uses: Cloudflare's upgraded socket, Bun's and the browser's all fit. */
export type WebSocketLike = {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'close' | 'error', listener: () => void): void;
};

/** What opening the control socket came to: an open socket, a session the provider no longer has, or a failure. */
export type ControlOpening<Socket extends WebSocketLike = WebSocketLike> = { status: 'open'; socket: Socket } | { status: 'gone' } | { status: 'failed' };

/**
 * Opens the provider's control WebSocket at `url` with the provider's `headers`, which fetch cannot do. The platform
 * supplies it: Bun's WebSocket client, or Cloudflare's upgrade fetch and `response.webSocket`. `signal` bounds the
 * handshake only. `gone` is a 404 or 410: the session ended; any other failed handshake is `failed`.
 */
export type ControlOpener<Socket extends WebSocketLike = WebSocketLike> = (request: { url: string; headers: Record<string, string>; signal: AbortSignal }) => Promise<ControlOpening<Socket>>;

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
  /** Exact deployment identity when the adapter can provide it. */
  modelId?: string;
  create(input: { sdp: string; voice: string; instructions: string }): Promise<{ id: string; sdp: string }>;
  attach(id: string, handlers?: VoiceHandlers): Promise<VoiceConnection>;
  /** Closes a provider session by id. A session that no longer exists is closed. */
  close(id: string, handlers?: VoiceHandlers): Promise<void>;
};
