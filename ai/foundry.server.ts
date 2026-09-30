import { createAzure } from '@ai-sdk/azure';

type FoundryEnvironment = {
  AZURE_OPENAI_API_INSTANCE_NAME?: string;
  AZURE_OPENAI_API_KEY?: string;
  AZURE_OPENAI_AGENT_MODEL?: string;
  AZURE_OPENAI_FAST_MODEL?: string;
  AZURE_OPENAI_LIVE_MODEL?: string;
} | Record<string, string | undefined>;
export type FoundryConfig = { resourceName: string; apiKey: string; agentModel: string; fastModel: string; liveModel: string };

export function foundryConfigured(env: FoundryEnvironment): boolean {
  return !!(env.AZURE_OPENAI_API_INSTANCE_NAME && env.AZURE_OPENAI_API_KEY && env.AZURE_OPENAI_AGENT_MODEL && env.AZURE_OPENAI_FAST_MODEL);
}

export function foundryConfig(env: FoundryEnvironment): FoundryConfig {
  if (!foundryConfigured(env)) throw new Error('Azure Foundry is not configured.');
  return {
    resourceName: env.AZURE_OPENAI_API_INSTANCE_NAME!, apiKey: env.AZURE_OPENAI_API_KEY!,
    agentModel: env.AZURE_OPENAI_AGENT_MODEL!, fastModel: env.AZURE_OPENAI_FAST_MODEL!,
    liveModel: env.AZURE_OPENAI_LIVE_MODEL || 'gpt-live-1',
  };
}

export const foundryUrl = (config: FoundryConfig, path: string) => `https://${config.resourceName}.openai.azure.com/openai/v1${path}`;
export const foundryProvider = (config: FoundryConfig, request?: typeof fetch) => createAzure({
  resourceName: config.resourceName, apiKey: config.apiKey, fetch: request,
});
