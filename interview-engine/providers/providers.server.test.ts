import { expect, test } from 'bun:test';
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
