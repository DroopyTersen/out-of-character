import { expect, test } from 'bun:test';
import { fixtureFoundry, fixtureFoundryEnv } from '../../../ai/foundry-fixture';
import { foundryProviders } from '../../../interview-engine/providers/providers.server';
import { spec } from '../../../interviews/project-closeout/spec';
import { archiveDatabase } from '../simulator/session-fixture';
import { importedNarrative, narrateWith } from './narrative';
import { handleInterview, routeInterview } from './routes';

const id = 'c49f7954-7aab-47f9-a269-752932556c37';
const capability = `Bearer ${'a'.repeat(64)}`;
function fixture() {
  const calls: Request[] = [];
  const simulator: Request[] = [];
  const namespace = (into: Request[]) => ({ idFromName: (value: string) => value, get: () => ({ fetch: async (request: Request) => { into.push(request); return Response.json({ accepted: true }); } }) });
  const env = {
    SIMULATOR_ENABLED: 'true', PAID_SERVICES_ENABLED: 'true', ...fixtureFoundryEnv, TYPESAFE_API_KEY: 'not-a-real-key',
    RATE_SIMULATOR: { limit: async () => ({ success: true }) },
    INTERVIEW_SESSIONS: namespace(calls), SIMULATOR_SESSIONS: namespace(simulator), SIMULATOR_ARCHIVE: archiveDatabase().d1,
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

const passages = [
  { id: 'p1', speaker: 'interviewer', text: 'What did you deliver?', startMs: 0, endMs: 900 },
  { id: 'p2', speaker: 'participant', text: 'We shipped the permit intake portal.', startMs: 1000, endMs: 2500 },
];
const narrativeBody = { specId: 'project-closeout', passages };
const sse = (events: unknown[]) => new Response(new ReadableStream({ start(controller) {
  for (const value of events) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`));
  controller.close();
} }), { headers: { 'Content-Type': 'text/event-stream' } });
/** Foundry's Responses stream for one narrative document, as the language provider reads it. */
const narrativeEvents = (document: { text: string }) => [
  { type: 'response.created', response: { id: 'narrative-fixture', created_at: 1, model: fixtureFoundry.agentModel } },
  { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg-1' } },
  { type: 'response.output_text.delta', item_id: 'msg-1', delta: JSON.stringify(document) },
  { type: 'response.completed', response: { usage: { input_tokens: 10, output_tokens: 8, total_tokens: 18 } } },
];

test('an imported transcript passes the interview gates and needs participant speech', async () => {
  const f = fixture();
  const keys: string[] = [];
  f.env.RATE_JUDGE = { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: true }; } } as unknown as RateLimit;
  expect((await handleInterview(f.request('narratives', narrativeBody, { Origin: 'https://elsewhere.example' }), f.env))!.status).toBe(403);
  expect((await handleInterview(f.request('narratives', narrativeBody, { Authorization: '' }), f.env))!.status).toBe(401);
  expect((await handleInterview(f.request('narratives', narrativeBody), { ...f.env, SIMULATOR_ENABLED: 'false' }))!.status).toBe(503);
  expect((await handleInterview(f.request('narratives', { ...narrativeBody, extra: true }), f.env))!.status).toBe(400);
  expect((await handleInterview(f.request('narratives', { ...narrativeBody, passages: [{ ...passages[0], speaker: 'trainee' }] }), f.env))!.status).toBe(400);
  expect((await handleInterview(f.request('narratives', { ...narrativeBody, passages: [{ ...passages[1], text: 'x'.repeat(300_000) }] }), f.env))!.status).toBe(413);
  expect((await handleInterview(f.request('narratives', { ...narrativeBody, specId: 'no-such-debrief' }), f.env))!.status).toBe(404);
  const empty = await handleInterview(f.request('narratives', { ...narrativeBody, passages: passages.slice(0, 1) }), f.env);
  expect(empty!.status).toBe(422);
  expect(await empty!.json() as unknown).toEqual({ error: 'There is not enough conversation to write about.' });
  expect(keys.every(key => key === 'narrative:local')).toBe(true);
  f.env.RATE_JUDGE = { limit: async () => ({ success: false }) } as unknown as RateLimit;
  expect((await handleInterview(f.request('narratives', narrativeBody), f.env))!.status).toBe(429);
  // Nothing reached an attempt.
  expect(f.calls).toHaveLength(0);
});

test('an imported transcript streams its narrative from the language provider, with no attempt involved', async () => {
  const f = fixture();
  const document = { text: 'The team shipped the permit intake portal.' };
  let prompt = '';
  const providers = foundryProviders(fixtureFoundry, { fetch: (async (_url, init) => {
    prompt = JSON.parse(String(init?.body)).input.find((item: { role: string }) => item.role === 'user').content[0].text;
    return sse(narrativeEvents(document));
  }) as typeof fetch });
  const response = await routeInterview(f.request('narratives', narrativeBody), {
    available: () => true, limit: async () => true,
    session: async () => { throw new Error('No attempt is involved.'); },
    narrative: (input, signal) => importedNarrative(input, async id => id === spec.id ? spec : null, narrateWith(providers), signal),
  });
  expect(response!.status).toBe(200);
  expect(response!.headers.get('Content-Type')).toContain('text/plain');
  expect(JSON.parse(await response!.text())).toEqual(document);
  expect(JSON.parse(prompt).transcript).toEqual([{ speaker: 'INTERVIEWER', text: 'What did you deliver?' }, { speaker: 'PARTICIPANT', text: 'We shipped the permit intake portal.' }]);
});

test('the socket upgrade reaches the attempt object only when the deployment opts in', async () => {
  const f = fixture();
  const upgrade = () => new Request(`https://practice.example/api/interview/sessions/${id}/socket`, { headers: { Origin: 'https://practice.example', Upgrade: 'websocket' } });
  expect((await handleInterview(upgrade(), f.env))!.status).toBe(404);
  expect(f.calls).toHaveLength(0);
  expect((await handleInterview(upgrade(), { ...f.env, INTERVIEW_SOCKET_ENABLED: 'true' } as Env))!.status).toBe(200);
  expect(f.calls.map(call => new URL(call.url).pathname)).toEqual([`/api/interview/sessions/${id}/socket`]);
});
