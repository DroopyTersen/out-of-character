import { DirectorOutputError } from './structured.server';

/** What a failed model call leaves in the log: names, status and support IDs only, never request or response content. */
export type CallFailure = { name: string; status?: number; requestId?: string; detail?: string };

/** What the engine reports to the host's log: transcripts, timings and provider failures. */
export type EngineEvent =
  | { type: 'provider.failure'; provider: 'voice' | 'language' | 'judge'; operation: string; failure: CallFailure }
  | { type: 'timing'; operation: string; durationMs: number }
  | { type: 'transcript'; id: string; speaker: string; text: string }
  /** A checkpoint or archive write that failed, or an owner that found itself superseded. Ids only, never content. */
  | { type: 'session'; event: 'checkpoint.failed' | 'archive.failed' | 'fenced'; id: string; category?: 'partial' | 'final' };

const token = (value: unknown): string | undefined => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value) ? value : undefined;

/** Select metadata from native and AI SDK errors without retaining private request/response content. */
export function callFailure(error: unknown): CallFailure {
  if (!(error instanceof Error)) return { name: 'UnknownError' };
  const provider = error as Error & { statusCode?: unknown; requestId?: unknown; responseHeaders?: Record<string, string> };
  const status = typeof provider.statusCode === 'number' && Number.isInteger(provider.statusCode) && provider.statusCode >= 400 && provider.statusCode <= 599 ? provider.statusCode : undefined;
  const requestId = token(provider.requestId ?? provider.responseHeaders?.['apim-request-id'] ?? provider.responseHeaders?.['x-request-id']);
  const detail = error instanceof DirectorOutputError ? token(error.detail) : undefined;
  return { name: token(error.name) ?? 'Error', ...(status ? { status } : {}), ...(requestId ? { requestId } : {}), ...(detail ? { detail } : {}) };
}
