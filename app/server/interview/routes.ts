import { foundryConfig, foundryConfigured } from '../../../ai/foundry.server';
import { foundryProviders } from '../../../interview-engine/providers/providers.server';
import { activitySchema, CAPABILITY, narrativeRequestSchema, resumeSchema, startSchema, type NarrativeRequest } from '../../../interview-engine/shared/protocol';
import { routeDebriefs, workerDebriefs, type DebriefGates } from './debriefs';
import { BodyError, boundedJson } from '../http';
import { liveAvailable, simulatorJson } from '../simulator/api';
import { importedNarrative, narrateWith } from './narrative';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a host supplies to the routes: whether paid sessions may start, its rate limiters, the attempt's session and imported narratives. */
export type InterviewGates = {
  available(): boolean;
  /** `session`: starts and resumes, which create paid voice sessions. `narrative`: imported transcripts. */
  limit(key: string, kind?: 'session' | 'narrative'): Promise<boolean>;
  /** Delivers `https://session/<action>` to the attempt's session and returns its reply. */
  session(id: string, command: Request): Promise<Response>;
  /** Streams the narrative of an imported transcript; no attempt is involved. See `importedNarrative`. */
  narrative(input: NarrativeRequest, signal: AbortSignal): Response | Promise<Response>;
  /**
   * Accepts the attempt's socket upgrade and answers its commands through these routes (see `serveSocket`). Opt-in:
   * a host without it serves HTTP only, and its socket path is unknown.
   */
  socket?(id: string, upgrade: Request): Response | Promise<Response>;
  /** Debrief setup: templates, drafts and approvals, and the catalog imported narratives resolve their spec from. Opt-in: without it the setup routes are unknown. */
  debriefs?: DebriefGates;
};

/** Whether this deployment accepts the socket transport. Off unless `INTERVIEW_SOCKET_ENABLED` is "true". */
export const socketsEnabled = (env: Env) => (env as Env & { INTERVIEW_SOCKET_ENABLED?: string }).INTERVIEW_SOCKET_ENABLED === 'true';
const attemptObject = (env: Env, id: string) => env.INTERVIEW_SESSIONS.get(env.INTERVIEW_SESSIONS.idFromName(id));

/** Narratives are 128 KiB of transcript at most (TRANSCRIPT_LIMIT), with room for the JSON around it. */
const NARRATIVE_BODY_LIMIT = 256 * 1024;

/**
 * The Worker's gates: the practice simulator's kill switch and limiters, one InterviewObject per attempt, Foundry for
 * narratives, and the attempt's object for its socket when sockets are enabled.
 */
export function workerGates(env: Env): InterviewGates {
  const debriefs = workerDebriefs(env);
  return {
    available: () => liveAvailable(env),
    limit: async (key, kind = 'session') => (await (kind === 'narrative' ? env.RATE_JUDGE : env.RATE_SIMULATOR).limit({ key })).success,
    session: (id, command) => attemptObject(env, id).fetch(command),
    narrative: (input, signal) => foundryConfigured(env)
      ? importedNarrative(input, id => debriefs.catalog.resolve(id), narrateWith(foundryProviders(foundryConfig(env))), signal)
      : simulatorJson({ error: 'Narratives are currently unavailable.' }, 503),
    debriefs,
    ...(socketsEnabled(env) ? { socket: (id: string, upgrade: Request) => attemptObject(env, id).fetch(upgrade) } : {}),
  };
}

export const handleInterview = (request: Request, env: Env) => routeInterview(request, workerGates(env));

/**
 * `/api/interview/...`: the same gates as the practice simulator's routes (same origin, capability header, kill switch,
 * rate limits, bounded bodies), forwarding each command to the attempt's session. The spec and voice checks happen in
 * the session itself. `/api/interview/narratives` writes an imported transcript's narrative with no attempt involved.
 */
export async function routeInterview(request: Request, gates: InterviewGates): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/interview/')) return null;
  // Setup happens before any attempt exists, so it has no attempt capability; the paid gates still apply to drafting.
  if (url.pathname.startsWith('/api/interview/debriefs')) return routeDebriefs(request, url, gates.debriefs, { available: gates.available, limit: key => gates.limit(key, 'narrative') });
  const socket = url.pathname.match(/^\/api\/interview\/sessions\/([^/]+)\/socket$/);
  if (socket) {
    // The browser cannot set headers on a WebSocket, so each command carries its capability instead.
    if (!gates.socket || !UUID.test(socket[1]!)) return simulatorJson({ error: 'Unknown simulator route.' }, 404);
    if (request.method !== 'GET') return simulatorJson({ error: 'Method not allowed.' }, 405);
    if (request.headers.get('Origin') !== url.origin) return simulatorJson({ error: 'Same-origin requests are required.' }, 403);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return simulatorJson({ error: 'Expected a WebSocket upgrade.' }, 426);
    return gates.socket(socket[1]!, request);
  }
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
    if (url.pathname === '/api/interview/narratives') {
      if (!gates.available()) return simulatorJson({ error: 'Narratives are currently unavailable.' }, 503);
      if (!(await gates.limit(`narrative:${request.headers.get('CF-Connecting-IP') || 'local'}`, 'narrative'))) return simulatorJson({ error: 'Please wait a minute before requesting another narrative.' }, 429);
      const parsed = narrativeRequestSchema.safeParse(await boundedJson(request, NARRATIVE_BODY_LIMIT));
      if (!parsed.success) return simulatorJson({ error: 'Invalid transcript.' }, 400);
      return await gates.narrative(parsed.data, request.signal);
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
