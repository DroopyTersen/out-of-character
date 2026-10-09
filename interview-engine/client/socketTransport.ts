import type { SocketReply, SocketRequest } from '../shared/protocol';
import { pollTransport, SessionRequestError, SessionUnanswered, type Attempt, type ProtocolTransport } from './transport';

/** The part of the browser's WebSocket this transport uses. */
export type ClientSocket = {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'open' | 'close' | 'error', listener: () => void): void;
};
export type SocketTransportOptions = { open?: (url: string) => ClientSocket };

type Pending = { resolve: (value: unknown) => void; reject: (error: unknown) => void };
type Connection = { attempt: Attempt; socket: ClientSocket; opened: Promise<void>; pending: Map<number, Pending> };

const OPEN = 1;
const unreachable = () => new SessionUnanswered(globalThis.navigator?.onLine === false ? 'This browser is offline.' : 'The server could not be reached.');

/** The attempt's socket URL beside the poll transport's routes: `baseUrl/:id/socket`, over ws or wss. */
export function socketUrl(baseUrl: string, attempt: Attempt) {
  const url = new URL(`${baseUrl}/${attempt.id}/socket`, globalThis.location?.href);
  url.protocol = url.protocol === 'http:' || url.protocol === 'ws:' ? 'ws:' : 'wss:';
  return url.toString();
}

/**
 * The poll transport's requests over one WebSocket per attempt, at `baseUrl/:id/socket`. Each command carries the
 * attempt's capability and an id its reply echoes; replies are the HTTP routes' own status and body, so the errors are
 * the poll transport's. A closed socket fails what was waiting with `SessionUnanswered`, and the next request opens a
 * new one for the same attempt. A keepalive request, sent while the page unloads, goes over HTTP.
 */
export function socketTransport(baseUrl: string, options: SocketTransportOptions = {}): ProtocolTransport {
  const open: (url: string) => ClientSocket = options.open ?? (url => new WebSocket(url));
  const http = pollTransport(baseUrl);
  let connection: Connection | undefined;
  let next = 0;

  const connect = (attempt: Attempt): Connection => {
    if (connection && connection.attempt.id === attempt.id && connection.socket.readyState <= OPEN) return connection;
    connection?.socket.close();
    const socket = open(socketUrl(baseUrl, attempt));
    const pending = new Map<number, Pending>();
    const current: Connection = { attempt, socket, pending, opened: new Promise((resolve, reject) => {
      socket.addEventListener('open', () => resolve());
      socket.addEventListener('close', () => reject(unreachable()));
    }) };
    current.opened.catch(() => {});
    socket.addEventListener('message', event => {
      let reply: SocketReply;
      try { reply = JSON.parse(String(event.data)); } catch { return; }
      const waiting = reply.id == null ? undefined : pending.get(reply.id);
      if (!waiting) return;
      pending.delete(reply.id!);
      const body = reply.body as { error?: string } | null;
      if (reply.status >= 200 && reply.status < 300 && body) waiting.resolve(body);
      else waiting.reject(new SessionRequestError(body?.error || 'The interview connection is unavailable.', reply.status));
    });
    socket.addEventListener('close', () => {
      for (const waiting of pending.values()) waiting.reject(unreachable());
      pending.clear();
      if (connection === current) connection = undefined;
    });
    return connection = current;
  };

  return {
    async request(action, body, requestOptions) {
      const { attempt, timeoutMs, keepalive = false, signal } = requestOptions;
      if (keepalive) return http.request(action, body, requestOptions);
      signal?.throwIfAborted();
      const current = connect(attempt);
      const id = next++;
      return new Promise((resolve, reject) => {
        const settle = (finish: () => void) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); current.pending.delete(id); finish(); };
        const timer = setTimeout(() => settle(() => reject(new SessionUnanswered('The server took too long to answer.'))), timeoutMs);
        const abort = () => settle(() => reject(signal!.reason));
        signal?.addEventListener('abort', abort, { once: true });
        current.pending.set(id, { resolve: value => settle(() => resolve(value)), reject: error => settle(() => reject(error)) });
        current.opened.then(() => {
          if (!current.pending.has(id)) return;
          const message: SocketRequest = { id, action, capability: attempt.capability, ...(body ? { body } : {}) };
          try { current.socket.send(JSON.stringify(message)); }
          catch { current.pending.get(id)?.reject(unreachable()); }
        }, error => current.pending.get(id)?.reject(error));
      });
    },
  };
}
