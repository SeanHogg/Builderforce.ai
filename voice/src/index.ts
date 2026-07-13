/**
 * @seanhogg/builderforce-voice — voice-cloning + LLM-narration client for
 * Builderforce.ai Studio.
 *
 * One seam, `resolveNarrationEngine` (and the `VoiceClient` wrapper around it),
 * turns a `voiceId` + text into audio, choosing the on-device SSM clone engine
 * (WebGPU, $0) when available, else the metered gateway synthesize endpoint, and
 * degrading to a named non-cloned voice with an honest reason when neither can
 * run. Every studio LLM flow — AI script → narration, dubbing, the
 * value-prop/pitch builder — routes through it, so none re-implements provider
 * selection, licensing, or the fallback contract.
 */

export { VoiceClient } from './client';
export type { VoiceClientOptions, ResolveOptions } from './client';

export { resolveNarrationEngine, getEngineUnavailableReason } from './resolve';
export type { ResolveNarrationOptions } from './resolve';

export { ServerCloneProvider, isEntitlementError } from './server-provider';
export type { ServerProviderOptions } from './server-provider';

export { ClientCloneProvider } from './client-provider';
export type {
  ClientProviderOptions,
  StudioCloneEngine,
  StudioSpeakerEmbedding,
} from './client-provider';

export { FallbackVoiceProvider } from './fallback-provider';
export type { FallbackProviderOptions } from './fallback-provider';

export { VoiceApiError } from './http';

export type {
  NarrationEngine,
  NarrationEngineId,
  NarrationProvider,
  NarrationResult,
  SynthesizeRequest,
  WordTimestamp,
} from './types';
