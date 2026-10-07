// Stays until Sol moves into the engine: it recognises this app's DirectorOutputError, which the engine's copy in providers/diagnostics.server.ts cannot.
import type { CallFailure } from '../../core/interview-producer';
import { DirectorOutputError } from '../simulator/sol.server';

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
