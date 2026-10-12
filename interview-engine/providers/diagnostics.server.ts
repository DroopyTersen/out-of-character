import { DirectorOutputError } from './structured.server';

/** What a failed model call leaves in the log: names, status, safe failure categories and support IDs only, never request or response content. */
export type CallFailure = { name: string; status?: number; requestId?: string; detail?: string };

/** What the engine reports to the host's log: transcripts, timings and provider failures. */
export type EngineEvent =
  | { type: 'provider.failure'; provider: 'voice' | 'language' | 'judge'; operation: string; failure: CallFailure }
  | { type: 'timing'; operation: string; durationMs: number }
  | { type: 'transcript'; id: string; speaker: string; text: string }
  /** A checkpoint or archive write that failed, or an owner that found itself superseded. Ids only, never content. */
  | { type: 'session'; event: 'checkpoint.failed' | 'archive.failed' | 'fenced' | 'closure.abandoned'; id: string; category?: 'partial' | 'final' };

/** Provider text may echo private input. Retain only recognized categories, never its message or values. */
function requestFailure(provider: Error & { responseBody?: unknown }, status: number | undefined): string | undefined {
  let code: unknown;
  try {
    const body = typeof provider.responseBody === 'string' ? JSON.parse(provider.responseBody) : null;
    code = body?.error?.code ?? body?.code;
  } catch { /* Malformed provider text is deliberately discarded. */ }
  if (status === 413 || ['context_length_exceeded', 'request_too_large', 'input_too_long'].includes(String(code))) return 'input_too_large';
  if (status === 422) return 'request_validation';
  if (status === 400) return 'invalid_request';
  return undefined;
}

const token = (value: unknown): string | undefined => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value) ? value : undefined;

/** Select metadata from native and AI SDK errors without retaining private request/response content. */
export function callFailure(error: unknown): CallFailure {
  if (!(error instanceof Error)) return { name: 'UnknownError' };
  const provider = error as Error & { statusCode?: unknown; responseBody?: unknown; requestId?: unknown; responseHeaders?: Record<string, string> };
  const status = typeof provider.statusCode === 'number' && Number.isInteger(provider.statusCode) && provider.statusCode >= 400 && provider.statusCode <= 599 ? provider.statusCode : undefined;
  const requestId = token(provider.requestId ?? provider.responseHeaders?.['apim-request-id'] ?? provider.responseHeaders?.['x-request-id']);
  const detail = error instanceof DirectorOutputError ? token(error.detail) : requestFailure(provider, status);
  return { name: token(error.name) ?? 'Error', ...(status ? { status } : {}), ...(requestId ? { requestId } : {}), ...(detail ? { detail } : {}) };
}
