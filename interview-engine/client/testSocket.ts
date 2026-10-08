/**
 * For tests: two connected in-memory WebSocket ends. What one sends arrives at the other as a message on a later
 * microtask, and closing either closes both. The browser end starts connecting; `accept()` opens both.
 */
type Listener = (event: { data: unknown }) => void;

export class TestSocket {
  readyState = 0;
  readonly sent: string[] = [];
  peer!: TestSocket;
  private listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...this.listeners.get(type) ?? [], listener]);
  }

  emit(type: string, data?: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }

  send(data: string) {
    if (this.readyState !== 1) throw new Error('The socket is not open.');
    this.sent.push(data);
    queueMicrotask(() => { if (this.peer.readyState === 1) this.peer.emit('message', data); });
  }

  close() {
    if (this.readyState >= 2) return;
    for (const end of [this, this.peer]) end.readyState = 3;
    queueMicrotask(() => { this.emit('close'); this.peer.emit('close'); });
  }
}

export function socketPair() {
  const browser = new TestSocket(), server = new TestSocket();
  browser.peer = server; server.peer = browser;
  server.readyState = 1;
  return {
    browser, server,
    /** Completes the handshake: the browser end opens. */
    accept() { browser.readyState = 1; queueMicrotask(() => browser.emit('open')); },
  };
}
