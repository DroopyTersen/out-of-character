import type { Experimental_EvaluationModel, LanguageModel, TelemetryOptions } from 'ai';
import type { EngineEvent } from './diagnostics.server';
import { foundryProvider, type FoundryConfig } from './foundry.server';
import { gptLiveProvider } from './gptLive.server';
import { judgeModel } from './judge.server';
import type { SocketOpener, VoiceProvider } from './voice.server';

export type { FoundryConfig } from './foundry.server';
export type { EngineEvent } from './diagnostics.server';
export type { SocketOpener, VoiceProvider, WebSocketLike } from './voice.server';

/** How the engine talks to models. The host configures; the engine uses the clients identically on any platform. */
export type Providers = {
  /** Sam: the GPT-Live deployment. */
  voice: VoiceProvider;
  /** Sol, Luna and the narrative. */
  language: { agent: LanguageModel; fast: LanguageModel };
  /** Jev: readings during the interview and the final grade. */
  judge: Experimental_EvaluationModel;
  /** AI SDK telemetry, such as Langfuse or Application Insights. */
  telemetry?: TelemetryOptions;
  /** Transcripts, timings and provider failures. */
  log?: (event: EngineEvent) => void;
};

/** The platform differences, as arguments rather than seams. */
export type FoundryPlatform = {
  fetch?: typeof fetch;
  /** Opens the voice control socket from an upgrade response. Without one, attaching to a voice session fails. */
  socket?: SocketOpener;
  telemetry?: TelemetryOptions;
};

/**
 * Builds every provider from one Foundry resource and a TypeSafe key. The key is read when Jev is first called,
 * so a host that only writes narratives may leave it out.
 */
export function foundryProviders(config: FoundryConfig & { typesafeKey?: string }, platform: FoundryPlatform = {}): Providers {
  const language = foundryProvider(config, platform.fetch);
  return {
    voice: gptLiveProvider(config, { fetch: platform.fetch, socket: platform.socket ?? (() => null) }),
    language: { agent: language.responses(config.agentModel), fast: language.responses(config.fastModel) },
    judge: judgeModel({ apiKey: config.typesafeKey, fetch: platform.fetch }),
    ...(platform.telemetry ? { telemetry: platform.telemetry } : {}),
  };
}
