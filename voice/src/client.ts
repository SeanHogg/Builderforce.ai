/**
 * VoiceClient — the ergonomic entry point hired.video Studio constructs once and
 * reuses. It assembles the right providers for a `voiceId` (server always; the
 * on-device clone engine when one is supplied) and resolves them through the
 * shared seam, so callers write `client.narrate(voiceId, { text })` and get the
 * best available path with the honesty contract intact.
 */

import { ClientCloneProvider, type StudioCloneEngine, type StudioSpeakerEmbedding } from './client-provider';
import { FallbackVoiceProvider } from './fallback-provider';
import { resolveNarrationEngine } from './resolve';
import { ServerCloneProvider } from './server-provider';
import type { NarrationEngine, NarrationProvider, NarrationResult, SynthesizeRequest } from './types';

export interface VoiceClientOptions {
  /** Builderforce gateway API key. */
  apiKey: string;
  /** Gateway base URL. Defaults to https://api.builderforce.ai. */
  baseUrl?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  /** Optional on-device clone engine (`@seanhogg/builderforce-studio`'s
   *  VoiceCloneEngine). When provided AND a speaker embedding is supplied per
   *  resolve, the free WebGPU path is preferred over the metered server. */
  clientEngine?: StudioCloneEngine;
  /** Optional named non-cloned voice used when no clone backend is available. */
  fallback?: FallbackVoiceProvider;
}

export interface ResolveOptions {
  /** Skip cloning and use the fallback voice (e.g. free tier). Default true. */
  preferClone?: boolean;
  /** Enrolled speaker embedding — enables the on-device path for this voice. */
  speaker?: StudioSpeakerEmbedding;
}

export class VoiceClient {
  constructor(private readonly options: VoiceClientOptions) {
    if (!options.apiKey?.trim()) {
      throw new Error('VoiceClient requires a non-empty apiKey');
    }
  }

  /** Build the candidate providers for a voice + resolve the best available. */
  resolve(voiceId: string, opts: ResolveOptions = {}): Promise<NarrationEngine> {
    const providers: NarrationProvider[] = [];

    if (this.options.clientEngine && opts.speaker) {
      providers.push(
        new ClientCloneProvider({ engine: this.options.clientEngine, speaker: opts.speaker }),
      );
    }

    providers.push(
      new ServerCloneProvider({
        apiKey: this.options.apiKey,
        voiceId,
        ...(this.options.baseUrl ? { baseUrl: this.options.baseUrl } : {}),
        ...(this.options.fetchFn ? { fetchFn: this.options.fetchFn } : {}),
        ...(this.options.timeoutMs ? { timeoutMs: this.options.timeoutMs } : {}),
      }),
    );

    return resolveNarrationEngine({
      voiceId,
      providers,
      ...(this.options.fallback ? { fallback: this.options.fallback } : {}),
      preferClone: opts.preferClone ?? true,
    });
  }

  /** One-shot: resolve then synthesize. The convenience the LLM flows call. */
  async narrate(
    voiceId: string,
    req: SynthesizeRequest,
    opts: ResolveOptions = {},
  ): Promise<NarrationResult> {
    const engine = await this.resolve(voiceId, opts);
    return engine.synthesize(req);
  }
}
