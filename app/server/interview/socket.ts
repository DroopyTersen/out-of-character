import type { WebSocketLike } from '../../../interview-engine/providers/voice.server';
import { SOCKET_MESSAGE_LIMIT, socketRequestSchema, type SocketReply } from '../../../interview-engine/shared/protocol';

/** Where a socket's commands came from: its attempt, the page's origin (checked at the upgrade) and the client's address. */
export type SocketContext = { attemptId: string; origin: string; ip: string | null };
/** The host's HTTP handler for `/api/interview/...`, which every socket command goes through. */
export type SocketRoute = (request: Request) => Promise<Response | null>;

const reply = (value: SocketReply) => JSON.stringify(value);

/**
 * Answers one socket message by handing its command to the HTTP route as the request the poll transport would have
 * sent, so the same gates run and the reply is the route's own status and body.
 */
export async function answerSocket(data: unknown, context: SocketContext, route: SocketRoute): Promise<string> {
  if (typeof data !== 'string') return reply({ id: null, status: 400, body: { error: 'Send a JSON message.' } });
  if (data.length > SOCKET_MESSAGE_LIMIT) return reply({ id: null, status: 413, body: { error: 'Request body is too large.' } });
  let message: unknown;
  try { message = JSON.parse(data); } catch { return reply({ id: null, status: 400, body: { error: 'Send a JSON message.' } }); }
  const parsed = socketRequestSchema.safeParse(message);
  const id = typeof (message as { id?: unknown } | null)?.id === 'number' ? (message as { id: number }).id : null;
  if (!parsed.success) return reply({ id, status: 400, body: { error: 'Invalid interview request.' } });
  const { action, capability, body } = parsed.data;
  // A socket belongs to one attempt; a start for another would be a second attempt on this socket.
  if (action === 'start' && (body as { id?: unknown } | undefined)?.id !== context.attemptId) return reply({ id, status: 400, body: { error: 'Invalid interview request.' } });
  const path = action === 'start' ? '/api/interview/sessions' : `/api/interview/sessions/${context.attemptId}/${action}`;
  const headers = new Headers({ Origin: context.origin, Authorization: `Bearer ${capability}`, 'Content-Type': 'application/json' });
  if (context.ip) headers.set('CF-Connecting-IP', context.ip);
  try {
    const response = await route(new Request(new URL(path, context.origin), { method: 'POST', headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }));
    if (!response) return reply({ id, status: 404, body: { error: 'Unknown interview route.' } });
    return reply({ id, status: response.status, body: await response.json().catch(() => null) });
  } catch {
    return reply({ id, status: 502, body: { error: 'The interview connection is unavailable. Please try again.' } });
  }
}

/** Serves an accepted socket: every message is answered through `route`, in whatever order the replies are ready. */
export function serveSocket(socket: WebSocketLike, context: SocketContext, route: SocketRoute) {
  socket.addEventListener('message', event => {
    void answerSocket(event.data, context, route).then(answer => { if (socket.readyState === 1) socket.send(answer); });
  });
}

/** The upgrade request's attempt and context, or null when it is not a socket upgrade for an attempt. */
export function socketContext(request: Request): SocketContext | null {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/interview\/sessions\/([0-9a-f-]{36})\/socket$/i);
  if (!match || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return null;
  return { attemptId: match[1]!, origin: url.origin, ip: request.headers.get('CF-Connecting-IP') };
}
