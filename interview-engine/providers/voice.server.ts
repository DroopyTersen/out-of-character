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

/** The voice model: one provider session per media connection, steered over its control socket. */
export type VoiceProvider<Socket extends WebSocketLike = WebSocketLike> = {
  /** Creates a provider session for the browser's SDP offer and returns its id and SDP answer. */
  create(input: { sdp: string; voice: string; instructions: string }): Promise<{ id: string; sdp: string }>;
  /** Opens the session's control socket: provider events in, instructions out. */
  attach(id: string): Promise<Socket>;
  /** Closes a provider session by id and waits for the provider to confirm. A session that no longer exists is closed. */
  close(id: string): Promise<void>;
};
