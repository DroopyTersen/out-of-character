import type { Experimental_EvaluationModel } from 'ai';
import type { FoundryConfig } from './foundry.server';
import type { Providers } from './providers.server';
import type { VoiceProvider } from './voice.server';

/** A synthetic Foundry resource for provider tests. Mirrors ai/foundry-fixture.ts, which the engine cannot import. */
export const testFoundry: FoundryConfig = { resourceName: 'fixture-foundry', apiKey: 'fixture-secret', agentModel: 'agent-deployment', fastModel: 'fast-deployment', liveModel: 'live-deployment' };

/**
 * Providers for tests that replace every paid service: the models are deployment names only, and the structured call
 * and judge fail loudly if anything reaches them.
 */
export function unpaidProviders(voice: unknown, models: { agent: string; fast: string } = { agent: testFoundry.agentModel, fast: testFoundry.fastModel }): Providers {
  return {
    voice: voice as VoiceProvider, language: { agent: models.agent, fast: models.fast },
    structured: () => Promise.reject(new Error('The test providers make no structured call.')),
    judge: { modelId: 'test-judge' } as unknown as Experimental_EvaluationModel,
  };
}
