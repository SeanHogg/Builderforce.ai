/**
 * client-provider — Option A: on-device synthesis via the studio SSM clone
 * engine (WebGPU when present, CPU fallback otherwise). $0 marginal infra — the
 * model runs on the user's GPU, nothing is billed.
 *
 * Structurally typed against the studio engine (not a hard import) so
 * @seanhogg/builderforce-studio stays an OPTIONAL peer: a consumer that only
 * uses the server path never has to install it. The shapes below match
 * VoiceCloneEngine.synthesize / SpeakerEmbedding exactly.
 */

import type { NarrationProvider, NarrationResult, SynthesizeRequest, WordTimestamp } from './types';

/** Minimal view of @seanhogg/builderforce-studio's SpeakerEmbedding. */
export interface StudioSpeakerEmbedding {
  data: number[];
  dim: number;
  sampleRate: number;
}

/** Minimal view of @seanhogg/builderforce-studio's VoiceCloneEngine / provider. */
export interface StudioCloneEngine {
  synthesize(opts: {
    text: string;
    speaker: StudioSpeakerEmbedding;
    speed?: number;
    signal?: AbortSignal;
  }): Promise<{
    pcm: Float32Array;
    sampleRate: number;
    durationMs: number;
    wordTimestamps: WordTimestamp[];
  }>;
}

export interface ClientProviderOptions {
  /** A constructed studio clone engine (e.g. `new VoiceCloneEngine()` or
   *  `new SSMVoiceProvider().cloneEngine`). */
  engine: StudioCloneEngine;
  /** The enrolled speaker embedding for the voice being cloned. Enrol once
   *  (`engine.enroll(referencePcm)`) and persist it — it's just numbers. */
  speaker: StudioSpeakerEmbedding;
}

export class ClientCloneProvider implements NarrationProvider {
  readonly id = 'clone-client' as const;
  private readonly engine: StudioCloneEngine;
  private readonly speaker: StudioSpeakerEmbedding;

  constructor(opts: ClientProviderOptions) {
    this.engine = opts.engine;
    this.speaker = opts.speaker;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.engine) && Array.isArray(this.speaker?.data) && this.speaker.data.length > 0;
  }

  async unavailableReason(): Promise<string | null> {
    if (await this.isAvailable()) return null;
    return 'On-device clone engine or speaker embedding not provided.';
  }

  async synthesize(req: SynthesizeRequest): Promise<NarrationResult> {
    const result = await this.engine.synthesize({
      text: req.text,
      speaker: this.speaker,
      ...(req.speed !== undefined ? { speed: req.speed } : {}),
      ...(req.signal ? { signal: req.signal } : {}),
    });
    return {
      engineId: this.id,
      cloned: true,
      pcm: result.pcm,
      sampleRate: result.sampleRate,
      durationMs: result.durationMs,
      wordTimestamps: result.wordTimestamps ?? [],
    };
  }
}
