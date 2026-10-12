import type { ControlOpener } from '../../../interview-engine/providers/voice.server';

/** Bun hides failed WebSocket handshake statuses, so a plain request distinguishes ended sessions. */
export const openControl: ControlOpener<WebSocket> = async ({ url, headers, signal }) => {
  const target = new URL(url);
  target.protocol = target.protocol === 'http:' ? 'ws:' : 'wss:';
  // Bun accepts headers as the second argument instead of subprotocols.
  const socket = new WebSocket(target, { headers } as unknown as string[]);
  const opened = await new Promise<boolean>(resolve => {
    socket.addEventListener('open', () => resolve(true), { once: true });
    socket.addEventListener('error', () => resolve(false), { once: true });
    socket.addEventListener('close', () => resolve(false), { once: true });
    signal.addEventListener('abort', () => { socket.close(); resolve(false); }, { once: true });
  });
  if (opened) return { status: 'open', socket };
  const { status } = await fetch(url, { headers, signal });
  return { status: status === 404 || status === 410 ? 'gone' : 'failed' };
};
