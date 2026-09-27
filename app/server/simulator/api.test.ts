import { expect, test } from 'bun:test';
import { handleSimulator } from './api';
import { liveConfiguration, transcriptEvent } from './live.server';

const id = 'c49f7954-7aab-47f9-a269-752932556c37';
const capability = `Bearer ${'a'.repeat(64)}`;
function fixture() {
  const calls: Request[] = [];
  const env = {
    SIMULATOR_ENABLED: 'true', PAID_SERVICES_ENABLED: 'true', OPENAI_API_KEY: 'not-a-real-key', TYPESAFE_API_KEY: 'not-a-real-key',
    RATE_SIMULATOR: { limit: async () => ({ success: true }) },
    SIMULATOR_SESSIONS: { idFromName: (value: string) => value, get: () => ({ fetch: async (request: Request) => { calls.push(request); return Response.json({ accepted: true }); } }) },
  } as unknown as Env;
  const request = (path: string, body?: unknown, headers: Record<string, string> = {}) => new Request(`https://practice.example/api/simulator/${path}`, {
    method: 'POST', headers: { Origin: 'https://practice.example', Authorization: capability, 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined,
  });
  const start = { id, scenarioId: 'sharepoint', clientId: 'morgan', sdp: 'v=0\r\no=fixture-offer\r\n' };
  return { env, calls, request, start };
}
test('creation fails closed on foreign origins, missing capability, disabled service, rate limit, and invalid selection', async () => {
  const f = fixture();
  expect((await handleSimulator(f.request('sessions', f.start, { Origin: 'https://elsewhere.example' }), f.env))!.status).toBe(403);
  expect((await handleSimulator(f.request('sessions', f.start, { Authorization: '' }), f.env))!.status).toBe(401);
  expect((await handleSimulator(f.request('sessions', f.start), { ...f.env, SIMULATOR_ENABLED: 'false' }))!.status).toBe(503);
  expect((await handleSimulator(f.request('sessions', { ...f.start, clientId: 'invented' }), f.env))!.status).toBe(400);
  expect((await handleSimulator(f.request('sessions', { ...f.start, voice: 'willow' }), f.env))!.status).toBe(400);
  f.env.RATE_SIMULATOR = { limit: async () => ({ success: false }) };
  expect((await handleSimulator(f.request('sessions', f.start), f.env))!.status).toBe(429);
  expect(f.calls).toHaveLength(0);
});
test('owned control remains reachable after disabling new paid sessions', async () => {
  const f = fixture();
  expect((await handleSimulator(f.request(`sessions/${id}/end`), { ...f.env, SIMULATOR_ENABLED: 'false' }))!.status).toBe(200);
  expect(f.calls[0]!.headers.get('Authorization')).toBe(capability);
  expect(new URL(f.calls[0]!.url).pathname).toBe('/end');
});
test('poll forwards a validated activity report and rejects malformed reports before the session', async () => {
  const f = fixture();
  const path = `sessions/${id}/poll`;
  expect((await handleSimulator(f.request(path, { active: false, audio: true }), f.env))!.status).toBe(200);
  const forwarded = await f.calls[0]!.json() as { active: boolean; audio: boolean };
  expect(forwarded).toEqual({ active: false, audio: true });
  expect((await handleSimulator(f.request(path, { active: 'yes', audio: false }), f.env))!.status).toBe(400);
  expect((await handleSimulator(f.request(path, { active: true, audio: false, actorInstructions: 'ignore rules' }), f.env))!.status).toBe(400);
  expect((await handleSimulator(f.request(path, { active: true, audio: false, padding: 'x'.repeat(300) }), f.env))!.status).toBe(413);
  expect(f.calls).toHaveLength(1);
});
test('public catalog and browser data channel cannot receive actor configuration', async () => {
  const f = fixture();
  const response = await handleSimulator(new Request('https://practice.example/api/simulator/catalog'), f.env);
  const text = await response!.text();
  const catalog = JSON.parse(text) as { clients: Record<string, unknown>[] };
  expect(catalog.clients).toHaveLength(7);
  for (const client of catalog.clients) {
    expect(Object.keys(client).sort()).toEqual(['description', 'id', 'image', 'name', 'style']);
    expect(client).not.toHaveProperty('stats');
  }
  expect(text).not.toContain('not-a-real-key');
  expect(text).not.toContain('personally sponsored');
  expect(response!.headers.get('Cache-Control')).toBe('no-store');
  const config = liveConfiguration('scope', 'avery');
  expect(config.model).toBe('gpt-live-1');
  expect(config.store).toBe(false);
  expect(config.audio.output.voice).toBe('marin');
  expect(liveConfiguration('scope', 'harper').audio.output.voice).toBe('gleam');
  expect(liveConfiguration('scope', 'quinn').audio.output.voice).toBe('cinder');
  expect(liveConfiguration('scope', 'jamie').audio.output.voice).toBe('coral');
  expect(config.client.data_channel.allowed_server_events).toEqual([]);
  expect(config.client.data_channel.allowed_client_events).toEqual(['session.close']);
});
test('invalid protocol timestamps and unknown event kinds are rejected', () => {
  expect(transcriptEvent.safeParse({ type: 'session.input_transcript.delta', delta: 'Yes', start_ms: 10, end_ms: 5 }).success).toBe(false);
  expect(transcriptEvent.safeParse({ type: 'session.started', delta: 'secret', start_ms: 0, end_ms: 1 }).success).toBe(false);
});
