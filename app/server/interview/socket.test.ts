import { afterEach, expect, setSystemTime, test } from 'bun:test';
import { socketTransport } from '../../../interview-engine/client/socketTransport';
import { SessionRequestError, type ProtocolAction } from '../../../interview-engine/client/transport';
import { interviewAttempt, objectFixture } from './durableObjectFixture';
import { routeInterview, type InterviewGates } from './routes';
import { answerSocket, socketContext } from './socket';

afterEach(() => setSystemTime());
const origin = 'https://practice.example';
const hex = 'a'.repeat(64);
const attempt = { id: interviewAttempt.id, capability: hex };
const context = { attemptId: attempt.id, origin, ip: '203.0.113.9' };

test('a socket message becomes the HTTP request the poll transport would send, and its reply is that response', async () => {
  const seen: Request[] = [];
  const route = async (request: Request) => { seen.push(request); return Response.json({ status: 'live', body: await request.text() }, { status: 202 }); };
  const reply = JSON.parse(await answerSocket(JSON.stringify({ id: 7, action: 'poll', capability: hex, body: { active: true } }), context, route));
  expect(reply).toEqual({ id: 7, status: 202, body: { status: 'live', body: '{"active":true}' } });
  expect(seen[0]!.url).toBe(`${origin}/api/interview/sessions/${attempt.id}/poll`);
  expect(seen[0]!.method).toBe('POST');
  expect(Object.fromEntries(seen[0]!.headers)).toMatchObject({ origin, authorization: `Bearer ${hex}`, 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' });
  await answerSocket(JSON.stringify({ id: 8, action: 'start', capability: hex, body: { ...interviewAttempt } }), context, route);
  expect(seen[1]!.url).toBe(`${origin}/api/interview/sessions`);
  expect(seen).toHaveLength(2);
  // Unreadable messages, the streamed report, a start for another attempt and an oversized message never reach the route.
  for (const [data, id, status] of [
    [new Uint8Array(1), null, 400], ['not json', null, 400], [JSON.stringify({ id: 9, action: 'report', capability: hex }), 9, 400],
    [JSON.stringify({ id: 10, action: 'poll', capability: `Bearer ${hex}` }), 10, 400],
    [JSON.stringify({ id: 11, action: 'start', capability: hex, body: { ...interviewAttempt, id: '00000000-0000-4000-8000-000000000000' } }), 11, 400],
    ['x'.repeat(200_000), null, 413],
  ] as const) expect(JSON.parse(await answerSocket(data, context, route))).toMatchObject({ id, status });
  expect(seen).toHaveLength(2);
});

test('the socket path is unknown without the opt-in gate, and otherwise needs a same-origin GET upgrade', async () => {
  const upgrades: string[] = [];
  const gates: InterviewGates = { available: () => true, limit: async () => true, session: async () => Response.json({}), narrative: () => Response.json({}) };
  const socketGates = { ...gates, socket: (id: string) => { upgrades.push(id); return new Response(null); } };
  const url = `${origin}/api/interview/sessions/${attempt.id}/socket`;
  const upgrade = (headers: Record<string, string> = {}, method = 'GET') => new Request(url, { method, headers: { Origin: origin, Upgrade: 'websocket', ...headers } });
  expect((await routeInterview(upgrade(), gates))!.status).toBe(404);
  expect((await routeInterview(new Request(`${origin}/api/interview/sessions/not-a-uuid/socket`, { headers: { Origin: origin, Upgrade: 'websocket' } }), socketGates))!.status).toBe(404);
  expect((await routeInterview(upgrade({}, 'POST'), socketGates))!.status).toBe(405);
  expect((await routeInterview(upgrade({ Origin: 'https://elsewhere.example' }), socketGates))!.status).toBe(403);
  expect((await routeInterview(upgrade({ Upgrade: '' }), socketGates))!.status).toBe(426);
  expect(upgrades).toEqual([]);
  expect((await routeInterview(upgrade(), socketGates))!.status).toBe(200);
  expect(upgrades).toEqual([attempt.id]);
  expect(socketContext(upgrade())).toEqual({ attemptId: attempt.id, origin, ip: null });
});

test('the interview object answers socket commands exactly as the HTTP routes do', async () => {
  const script: [ProtocolAction, unknown, string?][] = [
    ['poll', { active: false, audio: false }], ['start', interviewAttempt], ['start', interviewAttempt, 'b'.repeat(64)], ['ready', undefined],
    ['poll', { active: true, audio: false }], ['pause', undefined], ['poll', undefined], ['end', undefined], ['poll', undefined],
  ];
  const run = async (send: (action: ProtocolAction, body: unknown, capability: string) => Promise<{ status: number; body: unknown }>) => {
    setSystemTime(1_800_000_000_000);
    const replies = [];
    for (const [action, body, capability = hex] of script) replies.push(await send(action, body, capability));
    return replies;
  };

  const overHttp = await objectFixture();
  const gates: InterviewGates = { available: () => true, limit: async () => true, session: (_id, command) => overHttp.session.fetch(command), narrative: () => Response.json({}) };
  const http = await run(async (action, body, capability) => {
    const path = action === 'start' ? '/api/interview/sessions' : `/api/interview/sessions/${attempt.id}/${action}`;
    const response = (await routeInterview(new Request(`${origin}${path}`, {
      method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${capability}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
    }), gates))!;
    return { status: response.status, body: await response.json() };
  });

  const overSocket = await objectFixture();
  const transport = socketTransport(`${origin}/api/interview/sessions`, { open: url => overSocket.openSocket(url) });
  const socket = await run(async (action, body, capability) => {
    try { return { status: 200, body: await transport.request(action, body, { attempt: { id: attempt.id, capability }, timeoutMs: 5_000 }) }; }
    catch (error) { if (!(error instanceof SessionRequestError)) throw error; return { status: error.status, body: { error: error.message } }; }
  });

  expect(http.map(reply => reply.status)).toEqual([404, 200, 403, 200, 200, 200, 200, 200, 200]);
  expect(socket).toEqual(http);
});
