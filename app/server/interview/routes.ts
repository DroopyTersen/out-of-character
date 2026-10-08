import { activitySchema, CAPABILITY, resumeSchema, startSchema } from '../../../interview-engine/shared/protocol';
import { BodyError, boundedJson } from '../http';
import { liveAvailable, simulatorJson } from '../simulator/api';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a host supplies to the routes: whether paid sessions may start, its rate limiter, and the attempt's session. */
export type InterviewGates = {
  available(): boolean;
  limit(key: string): Promise<boolean>;
  /** Delivers `https://session/<action>` to the attempt's session and returns its reply. */
  session(id: string, command: Request): Promise<Response>;
};

/** The Worker's gates: the practice simulator's kill switch and limiter, and one InterviewObject per attempt. */
export const handleInterview = (request: Request, env: Env) => routeInterview(request, {
  available: () => liveAvailable(env),
  limit: async key => (await env.RATE_SIMULATOR.limit({ key })).success,
  session: (id, command) => env.INTERVIEW_SESSIONS.get(env.INTERVIEW_SESSIONS.idFromName(id)).fetch(command),
});

/**
 * `/api/interview/...`: the same gates as the practice simulator's routes (same origin, capability header, kill switch,
 * rate limits, bounded bodies), forwarding each command to the attempt's session. The spec and voice checks happen in
 * the session itself. Imported-transcript reports (`/api/interview/reports`) arrive with independent reporting.
 */
export async function routeInterview(request: Request, gates: InterviewGates): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/interview/')) return null;
  if (request.method !== 'POST') return simulatorJson({ error: 'Method not allowed.' }, 405);
  if (request.headers.get('Origin') !== url.origin) return simulatorJson({ error: 'Same-origin requests are required.' }, 403);
  if (!CAPABILITY.test(request.headers.get('Authorization') ?? '')) return simulatorJson({ error: 'Session capability is required.' }, 401);
  const forward = (id: string, action: string, body?: string, signal?: AbortSignal) =>
    gates.session(id, new Request(`https://session/${action}`, { method: 'POST', headers: request.headers, body, ...(signal ? { signal } : {}) }));
  try {
    if (url.pathname === '/api/interview/sessions') {
      if (!gates.available()) return simulatorJson({ error: 'Live practice is currently unavailable. You can explore the workshop.' }, 503);
      if (!(await gates.limit(request.headers.get('CF-Connecting-IP') || 'local'))) return simulatorJson({ error: 'Please wait a minute before starting another practice.' }, 429);
      const parsed = startSchema.safeParse(await boundedJson(request, 64 * 1024));
      if (!parsed.success) return simulatorJson({ error: 'Invalid simulator request.' }, 400);
      return forward(parsed.data.id, 'start', JSON.stringify(parsed.data));
    }
    const match = url.pathname.match(/^\/api\/interview\/sessions\/([^/]+)\/(poll|ready|end|report|pause|resume)$/);
    if (!match || !UUID.test(match[1]!)) return simulatorJson({ error: 'Unknown simulator route.' }, 404);
    const [, id, action] = match as unknown as [string, string, string];
    if (action === 'report' && !gates.available()) return simulatorJson({ error: 'Final reviews are currently unavailable.' }, 503);
    let body: string | undefined;
    if (action === 'poll' && request.body) {
      const activity = activitySchema.safeParse(await boundedJson(request, 384));
      if (!activity.success) return simulatorJson({ error: 'Invalid activity report.' }, 400);
      body = JSON.stringify(activity.data);
    }
    if (action === 'resume') {
      // Each resume creates a paid voice session; a flapping network must not loop creation.
      if (!gates.available()) return simulatorJson({ error: 'Live practice is currently unavailable. End this attempt to keep what was captured.' }, 503);
      if (!(await gates.limit(`resume:${id}`))) return simulatorJson({ error: 'Please wait a minute before reconnecting again.' }, 429);
      const resume = resumeSchema.safeParse(await boundedJson(request, 64 * 1024));
      if (!resume.success) return simulatorJson({ error: 'Invalid simulator request.' }, 400);
      body = JSON.stringify(resume.data);
    }
    // Poll, end and pause pass the kill switch so running attempts can still close.
    return forward(id, action, body, action === 'report' ? request.signal : undefined);
  } catch (error) {
    return simulatorJson({ error: error instanceof BodyError ? error.message : 'The simulator connection is unavailable. Please try again.' }, error instanceof BodyError ? error.status : 502);
  }
}
