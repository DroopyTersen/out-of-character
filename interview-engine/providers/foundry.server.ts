import { createAzure } from '@ai-sdk/azure';

/** One Azure AI Foundry resource and the deployments the engine calls on it. */
export type FoundryConfig = { resourceName: string; apiKey: string; agentModel: string; fastModel: string; liveModel: string };

export const foundryUrl = (config: FoundryConfig, path: string) => `https://${config.resourceName}.openai.azure.com/openai/v1${path}`;
export const foundryProvider = (config: FoundryConfig, request?: typeof fetch) => createAzure({
  resourceName: config.resourceName, apiKey: config.apiKey, fetch: request,
});
