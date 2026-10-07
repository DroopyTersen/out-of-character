import { expect, test } from 'bun:test';
import { fixtureFoundry } from '../../../ai/foundry-fixture';
import { attachLive, createLive, LiveSessionGone } from './live.server';

test('WebRTC creation uses Foundry and the configured Live deployment with private server context', async () => {
  const result = await createLive({ scenarioId: 'project-closeout', clientId: 'sam-cedar', sdp: 'v=0\r\nsynthetic offer' }, { ...fixtureFoundry, liveModel: 'live-deployment' }, (async (url, options) => {
    expect(url).toBe('https://fixture-foundry.openai.azure.com/openai/v1/live/sessions');
    expect(new Headers(options?.headers).get('api-key')).toBe('fixture-secret');
    expect(new Headers(options?.headers).has('Authorization')).toBe(false);
    const body = JSON.parse(String(options?.body));
    expect(body).toMatchObject({
      session: { model: 'live-deployment', store: false, audio: { output: { voice: 'cedar' } } },
      transport: { type: 'webrtc', sdp: 'v=0\r\nsynthetic offer' },
    });
    expect(body.session.instructions.length).toBeGreaterThan(0);
    // Neither role runs outside work, so the session offers no delegation target.
    expect(body.session).not.toHaveProperty('delegation');
    expect(JSON.stringify(body)).not.toContain('fixture-secret');
    return Response.json({ session: { id: 'session-fixture' }, transport: { type: 'webrtc', sdp: 'v=0\r\nanswer' } });
  }) as typeof fetch);
  expect(result).toEqual({ session: { id: 'session-fixture' }, transport: { type: 'webrtc', sdp: 'v=0\r\nanswer' } });
});

test('the listening hold reaches the provider session as Sam’s turn-taking brief', async () => {
  const instructions: string[] = [];
  for (const listening of [false, true]) {
    await createLive({ scenarioId: 'project-closeout', clientId: 'sam-cedar', sdp: 'v=0', ...(listening ? { listening } : {}) }, fixtureFoundry, (async (_url, options) => {
      instructions.push(JSON.parse(String(options?.body)).session.instructions);
      return Response.json({ session: { id: 'session-fixture' }, transport: { type: 'webrtc', sdp: 'v=0\r\nanswer' } });
    }) as typeof fetch);
  }
  const [legacy, listening] = instructions;
  expect(legacy).not.toContain('turn note');
  expect(listening).toContain('say nothing yet: no sound and no word');
  expect(listening).toContain('Speak only when a turn note says it is your turn.');
});

test('the control WebSocket attaches to Foundry with server-only authentication', async () => {
  let accepted = false;
  const socket = { accept: () => { accepted = true; } };
  // The Cloudflare upgrade response is the only substituted runtime boundary.
  const result = await attachLive('session/id', fixtureFoundry, (async (url, options) => {
    expect(url).toBe('https://fixture-foundry.openai.azure.com/openai/v1/live/sessions/session%2Fid/attach');
    expect(new Headers(options?.headers).get('api-key')).toBe('fixture-secret');
    expect(new Headers(options?.headers).get('Upgrade')).toBe('websocket');
    return { status: 101, webSocket: socket } as unknown as Response;
  }) as typeof fetch);
  expect(result).toBe(socket as unknown as WebSocket);
  expect(accepted).toBe(true);
});

test('expired Live sessions and provider failures preserve safe error handling', async () => {
  for (const status of [404, 410]) {
    await expect(attachLive('gone', fixtureFoundry, (async () => new Response(null, { status })) as unknown as typeof fetch)).rejects.toBeInstanceOf(LiveSessionGone);
  }
  await expect(createLive({ scenarioId: 'proposal', clientId: 'morgan', sdp: 'v=0' }, fixtureFoundry,
    (async () => new Response('private provider detail', { status: 429 })) as unknown as typeof fetch)).rejects.toThrow('Live creation failed (429).');
});
