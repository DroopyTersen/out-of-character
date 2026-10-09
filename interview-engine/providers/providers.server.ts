import type { LanguageModel, TelemetryOptions } from 'ai';
import type { EngineEvent } from './diagnostics.server';
import { foundryProvider, type FoundryConfig } from './foundry.server';
import { gptLiveProvider } from './gptLive.server';
import { createJevJudge, type Judge } from './judge.server';
import { structuredWith, type StructuredRequest } from './structured.server';
import type { SocketOpener, VoiceProvider } from './voice.server';

export type { FoundryConfig } from './foundry.server';
export type { EngineEvent } from './diagnostics.server';
export type { StructuredInput, StructuredRequest, StructuredResult } from './structured.server';
export type { SocketOpener, VoiceProvider, WebSocketLike } from './voice.server';

/**
 * Everything paid the engine calls, with credentials bound inside: the voice provider, the agent and fast language
 * models, the strict-JSON structured call to the agent model, and the judge. No credential crosses the seam.
 */
export type Providers = {
  voice: VoiceProvider;
  language: { agent: LanguageModel; fast: LanguageModel };
  /** Sol's structured call to the agent model, with the prompt caching the deployment supports. */
  structured: StructuredRequest;
  judge: Judge;
  telemetry?: TelemetryOptions;
  log?: (event: EngineEvent) => void;
};

/** The deployment a language model names, for diagnostics records. */
export const modelName = (model: LanguageModel) => typeof model === 'string' ? model : model.modelId;

export type FoundryPlatform = {
  fetch?: typeof fetch;
  socket?: SocketOpener;
  telemetry?: TelemetryOptions;
};

export function foundryProviders(config: FoundryConfig & { judge?: Judge }, platform: FoundryPlatform = {}): Providers {
  const language = foundryProvider(config, platform.fetch);
  return {
    voice: gptLiveProvider(config, { fetch: platform.fetch, socket: platform.socket ?? (() => null) }),
    language: { agent: language.responses(config.agentModel), fast: language.responses(config.fastModel) },
    structured: structuredWith(config, platform.fetch ?? fetch),
    judge: config.judge ?? createJevJudge({ fetch: platform.fetch }),
    ...(platform.telemetry ? { telemetry: platform.telemetry } : {}),
  };
}
