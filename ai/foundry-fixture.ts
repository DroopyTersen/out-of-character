import type { FoundryConfig } from './foundry.server';

/** Synthetic credentials for tests that substitute the paid HTTP boundary. */
export const fixtureFoundry: FoundryConfig = {
  resourceName: 'fixture-foundry', apiKey: 'fixture-secret',
  agentModel: 'gpt-6.1-sol', fastModel: 'gpt-6-luna', liveModel: 'gpt-live-1',
};
export const fixtureFoundryEnv = {
  AZURE_OPENAI_API_INSTANCE_NAME: fixtureFoundry.resourceName,
  AZURE_OPENAI_API_KEY: fixtureFoundry.apiKey,
  AZURE_OPENAI_AGENT_MODEL: fixtureFoundry.agentModel,
  AZURE_OPENAI_FAST_MODEL: fixtureFoundry.fastModel,
};
