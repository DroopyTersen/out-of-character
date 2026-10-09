import type { FoundryConfig } from '../interview-engine/providers/foundry.server';
import { LIVE_MODEL } from '../interview-engine/providers/gptLive.server';

export { foundryProvider, foundryUrl, type FoundryConfig } from '../interview-engine/providers/foundry.server';

type FoundryEnvironment = {
  AZURE_OPENAI_API_INSTANCE_NAME?: string;
  AZURE_OPENAI_API_KEY?: string;
  AZURE_OPENAI_AGENT_MODEL?: string;
  AZURE_OPENAI_FAST_MODEL?: string;
  AZURE_OPENAI_LIVE_MODEL?: string;
} | Record<string, string | undefined>;

export function foundryConfigured(env: FoundryEnvironment): boolean {
  return !!(env.AZURE_OPENAI_API_INSTANCE_NAME && env.AZURE_OPENAI_API_KEY && env.AZURE_OPENAI_AGENT_MODEL && env.AZURE_OPENAI_FAST_MODEL);
}

export function foundryConfig(env: FoundryEnvironment): FoundryConfig {
  if (!foundryConfigured(env)) throw new Error('Azure Foundry is not configured.');
  return {
    resourceName: env.AZURE_OPENAI_API_INSTANCE_NAME!, apiKey: env.AZURE_OPENAI_API_KEY!,
    agentModel: env.AZURE_OPENAI_AGENT_MODEL!, fastModel: env.AZURE_OPENAI_FAST_MODEL!,
    liveModel: env.AZURE_OPENAI_LIVE_MODEL || LIVE_MODEL,
  };
}
