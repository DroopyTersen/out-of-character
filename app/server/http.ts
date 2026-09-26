export class BodyError extends Error { constructor(readonly status: number, message: string) { super(message); } }

export async function boundedJson(request: Request, limit: number): Promise<unknown> {
  if (request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new BodyError(400, 'Send a JSON request.');
  const declared = request.headers.get('Content-Length');
  if (declared && Number(declared) > limit) throw new BodyError(413, 'Request body is too large.');
  if (!request.body) throw new BodyError(400, 'Request body is required.');
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new BodyError(413, 'Request body is too large.'); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    if (error instanceof BodyError) throw error;
    throw new BodyError(400, 'Request body must be valid JSON.');
  } finally { reader.releaseLock(); }
}
