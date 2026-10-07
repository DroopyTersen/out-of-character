import type { FoundryConfig } from './foundry.server';

/** A synthetic Foundry resource for provider tests. Mirrors ai/foundry-fixture.ts, which the engine cannot import. */
export const testFoundry: FoundryConfig = { resourceName: 'fixture-foundry', apiKey: 'fixture-secret', agentModel: 'agent-deployment', fastModel: 'fast-deployment', liveModel: 'live-deployment' };
