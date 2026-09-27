import { z } from 'zod';
import { INTERVIEW_SCENARIO_ID, interviewVoices } from '../../../core/interview';
import { getClient, getScenario, publicCatalog } from '../../../ai/simulator/scenarios.server';
import { BodyError, boundedJson } from '../http';

const uuid = z.string().uuid();
export const activitySchema = z.object({ active: z.boolean(), audio: z.boolean() }).strict();
export const startSchema = z.object({
  id: uuid,
  scenarioId: z.string().refine(id => { try { getScenario(id); return true; } catch { return false; } }),
  clientId: z.string().refine(id => { try { getClient(id); return true; } catch { return false; } }),
  sdp: z.string().min(20).max(60_000).startsWith('v=0'),
}).strict().refine(input => (input.scenarioId === INTERVIEW_SCENARIO_ID) === interviewVoices.some(voice => voice.id === input.clientId), 'Choose an interviewer for an interview.');
const liveAvailable = (env: Env) => String(env.SIMULATOR_ENABLED) === 'true' && env.PAID_SERVICES_ENABLED === 'true' && !!env.OPENAI_API_KEY && !!env.TYPESAFE_API_KEY;
export const simulatorJson = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export async function handleSimulator(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/simulator/')) return null;
  if (url.pathname === '/api/simulator/catalog' && request.method === 'GET') {
    return simulatorJson({ ...publicCatalog(), enabled: liveAvailable(env) });
  }
  if (request.method !== 'POST') return simulatorJson({ error: 'Method not allowed.' }, 405);
  if (request.headers.get('Origin') !== url.origin) return simulatorJson({ error: 'Same-origin requests are required.' }, 403);
  if (!/^Bearer [a-f0-9]{64}$/.test(request.headers.get('Authorization') ?? '')) return simulatorJson({ error: 'Session capability is required.' }, 401);
  try {
    if (url.pathname === '/api/simulator/sessions') {
      if (!liveAvailable(env)) return simulatorJson({ error: 'Live practice is currently unavailable. You can explore the workshop.' }, 503);
      if (!(await env.RATE_SIMULATOR.limit({ key: request.headers.get('CF-Connecting-IP') || 'local' })).success) return simulatorJson({ error: 'Please wait a minute before starting another practice.' }, 429);
      const parsed = startSchema.safeParse(await boundedJson(request, 64 * 1024));
      if (!parsed.success) return simulatorJson({ error: 'Invalid simulator request.' }, 400);
      return env.SIMULATOR_SESSIONS.get(env.SIMULATOR_SESSIONS.idFromName(parsed.data.id)).fetch(new Request('https://session/start', { method: 'POST', headers: request.headers, body: JSON.stringify(parsed.data) }));
    }
    const match = url.pathname.match(/^\/api\/simulator\/sessions\/([^/]+)\/(poll|ready|end)$/);
    if (!match || !uuid.safeParse(match[1]).success) return simulatorJson({ error: 'Unknown simulator route.' }, 404);
    let body: string | undefined;
    if (match[2] === 'poll' && request.body) {
      const activity = activitySchema.safeParse(await boundedJson(request, 256));
      if (!activity.success) return simulatorJson({ error: 'Invalid activity report.' }, 400);
      body = JSON.stringify(activity.data);
    }
    // Poll/end continue through a kill switch so already-running sessions can close.
    return env.SIMULATOR_SESSIONS.get(env.SIMULATOR_SESSIONS.idFromName(match[1]!)).fetch(new Request(`https://session/${match[2]}`, { method: 'POST', headers: request.headers, body }));
  } catch (error) {
    return simulatorJson({ error: error instanceof BodyError ? error.message : 'The simulator connection is unavailable. Please try again.' }, error instanceof BodyError ? error.status : 502);
  }
}
