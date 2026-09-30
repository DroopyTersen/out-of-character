import { expect, test } from 'bun:test';
import { foundryConfig, foundryConfigured } from './foundry.server';
import { fixtureFoundryEnv } from './foundry-fixture';

test('Foundry uses configured deployment names and defaults only the Live deployment', () => {
  expect(foundryConfig({ ...fixtureFoundryEnv, AZURE_OPENAI_AGENT_MODEL: 'agent-deployment', AZURE_OPENAI_FAST_MODEL: 'fast-deployment' }))
    .toMatchObject({ agentModel: 'agent-deployment', fastModel: 'fast-deployment', liveModel: 'gpt-live-1' });
  expect(foundryConfig({ ...fixtureFoundryEnv, AZURE_OPENAI_LIVE_MODEL: 'live-deployment' }).liveModel).toBe('live-deployment');
});

test('missing Foundry configuration fails closed even when legacy provider keys remain', () => {
  const legacy = { OPENAI_API_KEY: 'unused-openai', OPENROUTER_API_KEY: 'unused-openrouter' };
  expect(foundryConfigured(legacy)).toBe(false);
  for (const key of Object.keys(fixtureFoundryEnv)) {
    const env = { ...legacy, ...fixtureFoundryEnv, [key]: '' };
    expect(foundryConfigured(env)).toBe(false);
    expect(() => foundryConfig(env)).toThrow('Azure Foundry is not configured.');
  }
});
