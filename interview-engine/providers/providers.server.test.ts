import { expect, test } from 'bun:test';
import { z } from 'zod';
import { evidenceBatches, JEV_MODEL } from './judge.server';
import { foundryProviders } from './providers.server';
import { testFoundry } from './testFoundry.server';

test('foundryProviders builds every client from one resource without calling any of them', async () => {
  const calls: string[] = [];
  const providers = foundryProviders({ ...testFoundry, typesafeKey: 'typesafe-secret' }, {
    fetch: (async (url: string) => { calls.push(url); return Response.json({ session: { id: 's' }, transport: { type: 'webrtc', sdp: 'answer' } }); }) as unknown as typeof fetch,
  });
  expect(calls).toEqual([]);
  expect(providers.language.agent).toMatchObject({ modelId: 'agent-deployment' });
  expect(providers.language.fast).toMatchObject({ modelId: 'fast-deployment' });
  expect(providers.judge).toMatchObject({ modelId: JEV_MODEL });
  expect(providers).not.toHaveProperty('telemetry');
  // The voice provider shares the platform fetch.
  expect(await providers.voice.create({ sdp: 'offer', voice: 'cedar', instructions: 'x' })).toEqual({ id: 's', sdp: 'answer' });
  expect(calls).toEqual(['https://fixture-foundry.openai.azure.com/openai/v1/live/sessions']);
  // Without a socket opener the control socket is unavailable rather than guessed.
  await expect(providers.voice.attach('s')).rejects.toThrow('Live control connection is unavailable.');
});

test('telemetry passes through to the providers', () => {
  const telemetry = { isEnabled: true, functionId: 'interview' };
  expect(foundryProviders(testFoundry, { telemetry }).telemetry).toBe(telemetry);
});

test('evidence batches never exceed one question’s choices and an empty transcript is one empty batch', () => {
  expect(evidenceBatches([])).toEqual([[]]);
  const entries = Array.from({ length: 600 }, (_, index) => index);
  expect(evidenceBatches(entries).map(batch => batch.length)).toEqual([254, 254, 92]);
  expect(evidenceBatches(entries).flat()).toEqual(entries);
});

test('the structured call reaches the agent deployment on the resource with its key, and nothing else crosses the seam', async () => {
  const requests: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const providers = foundryProviders(testFoundry, {
    fetch: (async (url: string, init: RequestInit) => {
      requests.push({ url, headers: Object.fromEntries(new Headers(init.headers).entries()), body: JSON.parse(init.body as string) });
      return Response.json({ id: 'resp', status: 'completed', model: 'agent-deployment', output: [{ type: 'message', status: 'completed', content: [{ type: 'output_text', text: '{"ok":true}' }] }], usage: { input_tokens: 3, output_tokens: 2 } });
    }) as unknown as typeof fetch,
  });
  const result = await providers.structured({
    signal: new AbortController().signal, instructions: 'Answer with ok.', name: 'probe', schema: z.object({ ok: z.boolean() }),
    context: [{ role: 'user', content: 'Go.' }],
  } as Parameters<typeof providers.structured>[0]);
  expect(result).toMatchObject({ value: { ok: true }, model: 'agent-deployment' });
  expect(requests).toHaveLength(1);
  expect(requests[0]!.url).toBe('https://fixture-foundry.openai.azure.com/openai/v1/responses');
  expect(requests[0]!.headers['api-key']).toBe('fixture-secret');
  expect(requests[0]!.body.model).toBe('agent-deployment');
});
