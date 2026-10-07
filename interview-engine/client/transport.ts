/** What a reloaded page needs to rejoin its attempt. */
export type Attempt = { id: string; capability: string };

export type ProtocolAction = 'start' | 'ready' | 'poll' | 'pause' | 'resume' | 'end';
export type RequestOptions = {
  /** The attempt the command belongs to; its capability authorizes every command. */
  attempt: Attempt;
  timeoutMs: number;
  /** Outlives the page, for a closure sent while it unloads. A keepalive request ignores `signal`. */
  keepalive?: boolean;
  signal?: AbortSignal;
};
/** How the browser sends protocol commands to the host. Rejects with `SessionUnanswered` or `SessionRequestError`. */
export type ProtocolTransport = { request(action: ProtocolAction, body: unknown, options: RequestOptions): Promise<unknown> };

export class SessionRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
/** No reply arrived: the network failed, or the server took too long. */
export class SessionUnanswered extends Error {}

/** One HTTP POST per command: `baseUrl` starts an attempt and `baseUrl/:id/:action` carries the rest, each with the Bearer capability. */
export function pollTransport(baseUrl: string): ProtocolTransport {
  return {
    async request(action, body, { attempt, timeoutMs, keepalive = false, signal }) {
      const response = await fetch(action === 'start' ? baseUrl : `${baseUrl}/${attempt.id}/${action}`, {
        method: 'POST', headers: { Authorization: `Bearer ${attempt.capability}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), keepalive,
        signal: keepalive || !signal ? AbortSignal.timeout(timeoutMs) : AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      }).catch((error: unknown) => {
        if (error instanceof TypeError) throw new SessionUnanswered(navigator.onLine ? 'The server could not be reached.' : 'This browser is offline.');
        if (error instanceof DOMException && error.name === 'TimeoutError') throw new SessionUnanswered('The server took too long to answer.');
        throw error;
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok || !result) throw new SessionRequestError(result?.error || 'The simulator connection is unavailable.', response.status);
      return result;
    },
  };
}

/** Where a poll-transport host serves an attempt's other routes, such as its report, and the headers that authorize them. */
export function pollTarget(baseUrl: string, attempt: Attempt) {
  return { id: attempt.id, url: `${baseUrl}/${attempt.id}`, headers: { Authorization: `Bearer ${attempt.capability}` } };
}
