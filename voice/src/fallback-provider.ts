/**
 * fallback-provider — the honest non-cloned voice.
 *
 * When neither clone backend can run, the resolver falls back HERE — a named,
 * non-cloned voice (the consumer's existing Kokoro / Piper / Web Speech). The
 * point of the type is the contract: results are flagged `cloned: false` and the
 * resolver carries a human reason, so the UI says "Cloning unavailable — using
 * <name>" instead of silently swapping (PRD §7).
 *
 * It delegates to a consumer-supplied `synthesize`; with none provided it is
 * "unavailable" (with a reason) rather than pretending — the resolver then
 * exposes the reason and throws on use, never emitting fake audio.
 */

import type { NarrationProvider, NarrationResult, SynthesizeRequest } from './types';

export interface FallbackProviderOptions {
  /** Display name of the fallback voice, e.g. "Narrator (Kokoro)". */
  voiceName: string;
  /** The consumer's named-voice synthesizer. Omit to mark the fallback
   *  unavailable (resolver surfaces the reason instead of guessing). */
  synthesize?: (req: SynthesizeRequest) => Promise<Omit<NarrationResult, 'engineId' | 'cloned'>>;
}

export class FallbackVoiceProvider implements NarrationProvider {
  readonly id = 'fallback' as const;
  readonly voiceName: string;
  private readonly delegate?: FallbackProviderOptions['synthesize'];

  constructor(opts: FallbackProviderOptions) {
    this.voiceName = opts.voiceName;
    this.delegate = opts.synthesize;
  }

  async isAvailable(): Promise<boolean> {
    return typeof this.delegate === 'function';
  }

  async unavailableReason(): Promise<string | null> {
    return this.delegate ? null : `No fallback voice ("${this.voiceName}") synthesizer configured.`;
  }

  async synthesize(req: SynthesizeRequest): Promise<NarrationResult> {
    if (!this.delegate) {
      throw new Error(`Fallback voice "${this.voiceName}" has no synthesizer.`);
    }
    const base = await this.delegate(req);
    return { ...base, engineId: this.id, cloned: false };
  }
}
