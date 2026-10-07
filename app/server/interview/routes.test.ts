import { expect, test } from 'bun:test';
import { fixtureFoundryEnv } from '../../../ai/foundry-fixture';
import { handleInterview } from './routes';

const id = 'c49f7954-7aab-47f9-a269-752932556c37';
const capability = `Bearer ${'a'.repeat(64)}`;
function fixture() {
  const calls: Request[] = [];
  const simulator: Request[] = [];
  const namespace = (into: Request[]) => ({ idFromName: (value: string) => value, get: () => ({ fetch: async (request: Request) => { into.push(request); return Response.json({ accepted: true }); } }) });
  const env = {
    SIMULATOR_ENABLED: 'true', PAID_SERVICES_ENABLED: 'true', ...fixtureFoundryEnv, TYPESAFE_API_KEY: 'not-a-real-key',
    RATE_SIMULATOR: { limit: async () => ({ success: true }) },
    INTERVIEW_SESSIONS: namespace(calls), SIMULATOR_SESSIONS: namespace(simulator),
  } as unknown as Env;
  const request = (path: string, body?: unknown, headers: Record<string, string> = {}) => new Request(`https://practice.example/api/interview/${path}`, {
    method: 'POST', headers: { Origin: 'https://practice.example', Authorization: capability, 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined,
  });
  const start = { id, scenarioId: 'project-closeout', clientId: 'sam-cedar', sdp: 'v=0\r\no=fixture-offer\r\n' };
  return { env, calls, simulator, request, start };
}

test('other paths are left to the rest of the worker', async () => {
  const f = fixture();
  expect(await handleInterview(new Request('https://practice.example/api/simulator/sessions', { method: 'POST' }), f.env)).toBeNull();
});

test('a start passes the same gates as the practice simulator and reaches the interview object', async () => {
  const f = fixture();
  expect((await handleInterview(new Request('https://practice.example/api/interview/sessions'), f.env))!.status).toBe(405);
  expect((await handleInterview(f.request('sessions', f.start, { Origin: 'https://elsewhere.example' }), f.env))!.status).toBe(403);
  expect((await handleInterview(f.request('sessions', f.start, { Authorization: '' }), f.env))!.status).toBe(401);
  expect((await handleInterview(f.request('sessions', f.start), { ...f.env, SIMULATOR_ENABLED: 'false' }))!.status).toBe(503);
  expect((await handleInterview(f.request('sessions', { ...f.start, voice: 'willow' }), f.env))!.status).toBe(400);
  const started = await handleInterview(f.request('sessions', f.start), f.env);
  expect(started!.status).toBe(200);
  expect(new URL(f.calls[0]!.url).pathname).toBe('/start');
  expect(await f.calls[0]!.json() as unknown).toEqual(f.start);
  f.env.RATE_SIMULATOR = { limit: async () => ({ success: false }) } as unknown as RateLimit;
  expect((await handleInterview(f.request('sessions', f.start), f.env))!.status).toBe(429);
  expect(f.calls).toHaveLength(1);
  expect(f.simulator).toHaveLength(0);
});

test('commands are validated, forwarded by attempt id, and control passes the kill switch', async () => {
  const f = fixture();
  expect((await handleInterview(f.request('sessions/not-a-uuid/poll'), f.env))!.status).toBe(404);
  expect((await handleInterview(f.request(`sessions/${id}/narrative`), f.env))!.status).toBe(404);
  expect((await handleInterview(f.request(`sessions/${id}/poll`, { active: true }), f.env))!.status).toBe(400);
  expect((await handleInterview(f.request(`sessions/${id}/poll`, { active: true, audio: false, outputQuietMs: 10 }), f.env))!.status).toBe(200);
  expect(await f.calls[0]!.json() as unknown).toEqual({ active: true, audio: false, outputQuietMs: 10 });
  const disabled = { ...f.env, SIMULATOR_ENABLED: 'false' };
  for (const action of ['end', 'pause', 'ready']) expect((await handleInterview(f.request(`sessions/${id}/${action}`), disabled))!.status).toBe(200);
  expect((await handleInterview(f.request(`sessions/${id}/report`), disabled))!.status).toBe(503);
  expect((await handleInterview(f.request(`sessions/${id}/resume`, { sdp: 'v=0\r\no=fixture-offer\r\n' }), disabled))!.status).toBe(503);
  expect((await handleInterview(f.request(`sessions/${id}/resume`, { sdp: 'v=0\r\no=fixture-offer\r\nm=application 9' }), f.env))!.status).toBe(400);
  expect((await handleInterview(f.request(`sessions/${id}/resume`, { sdp: 'v=0\r\no=fixture-offer\r\n' }), f.env))!.status).toBe(200);
  expect(f.calls.map(request => new URL(request.url).pathname)).toEqual(['/poll', '/end', '/pause', '/ready', '/resume']);
  expect(f.calls.every(request => request.headers.get('Authorization') === capability)).toBe(true);
});
