/** Keep Cloudflare credentials server-side and bound every public audio stream. */
export async function openSpeech(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return Response.json({ error: 'A speech WebSocket is required.' }, { status: 426 });
  }
  const upstream = await env.AI.run('@cf/deepgram/flux', {
    encoding: 'linear16', sample_rate: '16000', eot_timeout_ms: '1000',
  }, { websocket: true });
  if (!upstream.webSocket) throw new Error('Speech service did not open a stream.');
  const provider = upstream.webSocket;
  const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
  server.binaryType = 'arraybuffer';
  provider.accept();
  server.accept();
  let closed = false;
  let bytes = 0;
  const startedAt = Date.now();
  const close = (code = 1000, reason = 'Listening ended') => {
    if (closed) return;
    closed = true;
    clearTimeout(timeout);
    try { server.close(code, reason); } catch { /* Already closed. */ }
    try { provider.close(code, reason); } catch { /* Already closed. */ }
  };
  const timeout = setTimeout(() => close(1008, 'Listening reached the ten-minute limit'), 10 * 60 * 1000);
  const fail = () => {
    try {
      if (!closed) server.send(JSON.stringify({ type: 'Error', message: 'Speech recognition was interrupted. Try listening again.' }));
    } catch { /* The client may have disconnected first. */ }
    finally { close(1011, 'Speech service interrupted'); }
  };
  server.addEventListener('message', event => {
    if (closed) return;
    if (!(event.data instanceof ArrayBuffer) || event.data.byteLength < 2 || event.data.byteLength > 32000 || event.data.byteLength % 2) {
      close(1008, 'Send short PCM audio frames');
      return;
    }
    bytes += event.data.byteLength;
    // 16 kHz mono PCM16, with two seconds of delivery jitter allowance.
    if (bytes > 32000 * ((Date.now() - startedAt) / 1000 + 2)) { close(1008, 'Audio arrived too quickly'); return; }
    try { provider.send(event.data); } catch { fail(); }
  });
  provider.addEventListener('message', event => {
    if (closed || typeof event.data !== 'string') return;
    try {
      const message = JSON.parse(event.data) as { type?: string };
      if (message.type === 'Error') { fail(); return; }
      if (message.type === 'Connected' || message.type === 'TurnInfo') server.send(event.data);
    } catch { fail(); }
  });
  server.addEventListener('close', () => close());
  provider.addEventListener('close', () => close(1011, 'Speech service ended'));
  server.addEventListener('error', fail);
  provider.addEventListener('error', fail);
  return new Response(null, { status: 101, webSocket: client });
}
