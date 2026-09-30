import { describe, expect, test } from 'bun:test';
import { handleApi, type ApiServices } from './api';
import { fixtureFoundryEnv } from '../../ai/foundry-fixture';
import { CAST_VERSION, characters } from '../../core/characters';
import { JUDGING_VERSION } from '../../ai/judging';
import { transcriptPassages } from '../../core/highlights';
import { openSpeech } from './speech';

// Provider calls and Cloudflare rate bindings are the narrow external boundary:
// real network tests would cost money and vary; HTTP parsing/gates remain real.
function fixture() {
  const calls: { service: string; input: unknown }[] = [];
  const env = {
    PAID_SERVICES_ENABLED: 'true', TYPESAFE_API_KEY: 'private-judge-key', ...fixtureFoundryEnv,
    RATE_JUDGE: { limit: async () => ({ success: true }) },
    RATE_SCENE: { limit: async () => ({ success: true }) },
    RATE_SPEECH: { limit: async () => ({ success: true }) },
    AI: {},
  } as unknown as Env;
  const services: ApiServices = {
    highlights: async input => { calls.push({ service: 'highlights', input }); return { exists: .95, passages: transcriptPassages(input.transcript).map(passage => ({ ...passage, relevance: 1 })) }; },
    judge: async input => { calls.push({ service: 'judge', input }); return { readings: Object.fromEntries(characters.map(({ id }) => [id, .5])), model: 'fixture', durationMs: 10, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }; },
    scene: async input => { calls.push({ service: 'scene', input }); return 'The client wants the old portal replaced by Friday, but the demo already works. Your team asks whether to polish it or switch frameworks tonight. What do you recommend?'; },
    speech: async (request, env) => { calls.push({ service: 'speech', input: request }); return openSpeech(request, env); },
  };
  const request = (path: string, body?: unknown, headers: Record<string, string> = {}) => new Request(`https://game.example${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: 'https://game.example', 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const judge = { attemptId: 'round-1', snapshotId: 3, castVersion: CAST_VERSION, judgingVersion: JUDGING_VERSION, transcript: 'Let us rewrite the working portal in a brand new framework.', fullTranscript: 'We already have a working portal. Let us rewrite the working portal in a brand new framework.' };
  const scene = { attemptId: 'round-1', requestId: 'scene-2', characterId: 'graybeard', history: [] };
  return { calls, env, services, request, judge, scene };
}

describe('paid HTTP boundaries', () => {
  test('health discloses configuration booleans and versions without keys', async () => {
    const f = fixture();
    const response = await handleApi(f.request('/api/health'), f.env, f.services);
    const text = await response!.text();
    expect(JSON.parse(text)).toMatchObject({ castCount: 42, castVersion: CAST_VERSION, judgingVersion: JUDGING_VERSION, configured: { judging: true, scenes: true, speech: true }, speech: 'cloudflare-flux' });
    expect(text).not.toContain('private-');
    expect(f.calls).toHaveLength(0);
  });
  test('missing or different origins never reach any paid provider', async () => {
    const f = fixture();
    for (const path of ['/api/judge', '/api/scene', '/api/speech', '/api/highlights']) {
      const request = f.request(path, f.judge);
      request.headers.delete('Origin');
      expect((await handleApi(request, f.env, f.services))!.status).toBe(403);
      expect((await handleApi(f.request(path, f.judge, { Origin: 'https://attacker.example' }), f.env, f.services))!.status).toBe(403);
    }
    expect(f.calls).toHaveLength(0);
  });
  test('kill switch and exhausted rate limit prevent provider calls', async () => {
    const f = fixture();
    const disabled = { ...f.env, PAID_SERVICES_ENABLED: 'false' } as unknown as Env;
    expect((await handleApi(f.request('/api/judge', f.judge), disabled, f.services))!.status).toBe(503);
    f.env.RATE_JUDGE = { limit: async () => ({ success: false }) };
    const response = await handleApi(f.request('/api/judge', f.judge), f.env, f.services);
    expect(response!.status).toBe(429);
    expect(response!.headers.get('Retry-After')).toBe('60');
    expect(f.calls).toHaveLength(0);
  });
  test('speech requires a WebSocket, honors kill switch and is rate limited before connecting', async () => {
    const f = fixture();
    expect((await handleApi(f.request('/api/speech'), f.env, f.services))!.status).toBe(426);
    f.calls.length = 0;
    expect((await handleApi(f.request('/api/speech'), { ...f.env, PAID_SERVICES_ENABLED: 'false' } as unknown as Env, f.services))!.status).toBe(503);
    f.env.RATE_SPEECH = { limit: async () => ({ success: false }) };
    expect((await handleApi(f.request('/api/speech'), f.env, f.services))!.status).toBe(429);
    expect(f.calls).toHaveLength(0);
  });
  test('judge evaluates both contexts and returns a 70% full / 30% recent score for every character', async () => {
    const f = fixture();
    const recent = Object.fromEntries(characters.map(({ id }, index) => [id, index === 0 ? .95 : .2]));
    const full = Object.fromEntries(characters.map(({ id }, index) => [id, index === 0 ? .55 : .9]));
    const originalJudge = f.services.judge;
    f.services.judge = async input => ({ ...await originalJudge(input), readings: input.transcript === f.judge.transcript ? recent : full });
    const response = await handleApi(f.request('/api/judge', f.judge), f.env, f.services);
    const body = await response!.json() as { readings: Record<string, number> };
    expect(body).toMatchObject({ attemptId: 'round-1', snapshotId: 3, castVersion: CAST_VERSION, judgingVersion: JUDGING_VERSION, recentReadings: recent, fullReadings: full });
    for (const [index, character] of characters.entries()) expect(body.readings[character.id]).toBeCloseTo(index === 0 ? .67 : .69, 10);
    expect(f.calls.map(call => (call.input as { transcript: string }).transcript).sort()).toEqual([f.judge.transcript, f.judge.fullTranscript].sort());
    expect(f.calls.every(call => (call.input as { mode: string; signal: AbortSignal }).mode === 'noul' && (call.input as { signal: AbortSignal }).signal instanceof AbortSignal)).toBe(true);
  });
  test('full history can exceed the recent-window cap without truncation', async () => {
    const f = fixture();
    const fullTranscript = 'Earlier performance. '.repeat(1000);
    expect((await handleApi(f.request('/api/judge', { ...f.judge, fullTranscript }), f.env, f.services))!.status).toBe(200);
    expect(f.calls.some(call => (call.input as { transcript: string }).transcript === fullTranscript.trim())).toBe(true);
  });
  test('a failed or incomplete context cannot produce a composite from the other context', async () => {
    const f = fixture();
    const originalJudge = f.services.judge;
    f.services.judge = async input => {
      if (input.transcript === f.judge.fullTranscript) throw new Error('private provider failure');
      return originalJudge(input);
    };
    const failure = await handleApi(f.request('/api/judge', f.judge), f.env, f.services);
    expect(failure!.status).toBe(502);
    expect(await failure!.text()).not.toContain('private');
    f.services.judge = async input => ({ ...await originalJudge(input), readings: {} });
    expect((await handleApi(f.request('/api/judge', f.judge), f.env, f.services))!.status).toBe(502);
  });
  test('stale versions and invalid judge requests are rejected before inference', async () => {
    const f = fixture();
    expect((await handleApi(f.request('/api/judge', { ...f.judge, castVersion: 'old' }), f.env, f.services))!.status).toBe(409);
    expect((await handleApi(f.request('/api/judge', { ...f.judge, judgingVersion: 'portrayal-v4-grounded-composite' }), f.env, f.services))!.status).toBe(409);
    for (const body of [{ ...f.judge, transcript: ' ' }, { ...f.judge, transcript: 'x'.repeat(8001) }, { ...f.judge, fullTranscript: undefined }, { ...f.judge, fullTranscript: ' ' }, { ...f.judge, fullTranscript: 'x'.repeat(80001) }, { ...f.judge, mode: 'score' }, { ...f.judge, snapshotId: -1 }]) {
      expect((await handleApi(f.request('/api/judge', body), f.env, f.services))!.status).toBe(400);
    }
    expect(f.calls).toHaveLength(0);
  });
  test('scene correlates ids and checks cast/history bounds', async () => {
    const f = fixture();
    expect(await (await handleApi(f.request('/api/scene', f.scene), f.env, f.services))!.json()).toMatchObject({ attemptId: 'round-1', requestId: 'scene-2' });
    for (const body of [{ ...f.scene, characterId: 'invented' }, { ...f.scene, history: Array.from({ length: 21 }, () => ({ characterId: 'graybeard', scene: 'old' })) }, { ...f.scene, currentScene: 'x'.repeat(1001) }]) {
      expect((await handleApi(f.request('/api/scene', body), f.env, f.services))!.status).toBe(400);
    }
    expect(f.calls).toHaveLength(1);
  });
  test('highlights preserve the frozen transcript and correlate its exact spans and attempt', async () => {
    const f = fixture();
    const transcript = '  We need fourteen services before writing code.\n\nThe working prototype can wait for my architecture review.  ';
    const body = { attemptId: 'finished-round', characterId: 'architecture-astronaut', transcript, castVersion: CAST_VERSION, judgingVersion: JUDGING_VERSION };
    const response = await handleApi(f.request('/api/highlights', body), f.env, f.services);
    expect(response!.status).toBe(200);
    expect(await response!.json()).toMatchObject({ attemptId: 'finished-round', characterId: 'architecture-astronaut', review: { exists: .95, passages: transcriptPassages(transcript) } });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toMatchObject({ service: 'highlights', input: { transcript, characterId: 'architecture-astronaut' } });
    for (const change of [{ transcript: ' ' }, { transcript: 'x'.repeat(80001) }, { characterId: '__proto__' }, { characterId: 'invented' }]) {
      expect((await handleApi(f.request('/api/highlights', { ...body, ...change }), f.env, f.services))!.status).toBe(400);
    }
    expect((await handleApi(f.request('/api/highlights', { ...body, judgingVersion: 'old' }), f.env, f.services))!.status).toBe(409);
    expect(f.calls).toHaveLength(1);
  });
  test('highlights obey paid-service controls and reject incomplete provider reviews', async () => {
    const f = fixture();
    const body = { attemptId: 'finished', characterId: 'graybeard', transcript: 'The old system works and we should keep it.', castVersion: CAST_VERSION, judgingVersion: JUDGING_VERSION };
    expect((await handleApi(f.request('/api/highlights', body), { ...f.env, PAID_SERVICES_ENABLED: 'false' } as unknown as Env, f.services))!.status).toBe(503);
    f.env.RATE_SCENE = { limit: async () => ({ success: false }) };
    expect((await handleApi(f.request('/api/highlights', body), f.env, f.services))!.status).toBe(429);
    expect(f.calls).toHaveLength(0);
    f.env.RATE_SCENE = { limit: async () => ({ success: true }) };
    f.services.highlights = async () => ({ exists: .9, passages: [] });
    expect((await handleApi(f.request('/api/highlights', body), f.env, f.services))!.status).toBe(502);
    f.services.highlights = async () => { throw new Error('private provider detail'); };
    const response = await handleApi(f.request('/api/highlights', body), f.env, f.services);
    expect(response!.status).toBe(502);
    expect(await response!.text()).not.toContain('private');
  });
  test('inherited object keys are rejected in character and history IDs before paid calls', async () => {
    const f = fixture();
    for (const characterId of ['constructor', '__proto__', 'toString']) {
      for (const body of [
        { ...f.scene, characterId },
        { ...f.scene, history: [{ characterId, scene: 'An earlier scene.' }] },
      ]) {
        expect((await handleApi(f.request('/api/scene', body), f.env, f.services))!.status).toBe(400);
      }
    }
    expect(f.calls).toHaveLength(0);
  });
  test('chunked body is capped without trusting Content-Length', async () => {
    const f = fixture();
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(9000).fill(32)); }, cancel() { canceled = true; } });
    const request = new Request('https://game.example/api/judge', { method: 'POST', headers: { Origin: 'https://game.example', 'Content-Type': 'application/json' }, body });
    expect((await handleApi(request, f.env, f.services))!.status).toBe(413);
    expect(canceled).toBe(true);
    expect(f.calls).toHaveLength(0);
  });
  test('invalid JSON and provider failures expose sanitized errors', async () => {
    const f = fixture();
    const request = new Request('https://game.example/api/judge', { method: 'POST', headers: { Origin: 'https://game.example', 'Content-Type': 'application/json' }, body: '{bad' });
    expect((await handleApi(request, f.env, f.services))!.status).toBe(400);
    f.services.scene = async () => { throw new Error('Authorization: private-secret provider detail'); };
    const response = await handleApi(f.request('/api/scene', f.scene), f.env, f.services);
    expect(response!.status).toBe(502);
    expect(await response!.text()).not.toContain('private-secret');
  });
  test('unknown routes and ordinary pages retain appropriate routing', async () => {
    const f = fixture();
    expect(await handleApi(f.request('/play'), f.env, f.services)).toBeNull();
    expect((await handleApi(f.request('/api/other'), f.env, f.services))!.status).toBe(404);
    expect((await handleApi(f.request('/api/judge'), f.env, f.services))!.status).toBe(405);
    expect(f.calls).toHaveLength(0);
  });
});
