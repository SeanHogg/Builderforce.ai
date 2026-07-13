/**
 * provider — the swappable clone-synthesis backend seam (PRD §3's capability
 * rename: a `clone` engine with a pluggable provider, not the hardcoded
 * `vibevoice` flag).
 *
 * The studio ships one provider: `ssm-webgpu`, the in-browser SSM engine above.
 * The npm package registers a second, `tts-server`, that calls the gateway for
 * devices without WebGPU. Both satisfy {@link VoiceProvider}; callers resolve a
 * provider through {@link resolveVoiceProvider} and never branch on the id
 * themselves — the same DRY discipline as the device-router. `resolve` is also
 * the single source of truth for the honesty/fallback contract: it returns the
 * chosen provider AND, when nothing is available, the reason to show the user
 * *before* any silent fallback.
 */

import { hasWebGPUSupport } from '../device-router';
import { VoiceCloneEngine, type VoiceCloneEngineOptions } from './voice-clone-engine';
import type { CloneSynthesisResult, SynthesizeOptions, VoiceProvider } from './types';

/**
 * The built-in client-side provider: runs the full Phase 1 + Phase 2 pipeline on
 * the user's device. Always "available" because the SSM recurrence has a
 * weight-free CPU fallback — WebGPU only makes it faster. ($0 marginal infra,
 * per project_nle_decision.md.)
 */
export class SSMVoiceProvider implements VoiceProvider {
  readonly id = 'ssm-webgpu' as const;
  private readonly engine: VoiceCloneEngine;

  constructor(options?: VoiceCloneEngineOptions) {
    this.engine = new VoiceCloneEngine(options);
  }

  /** Expose the engine for enrolment (`provider.engine.enroll(...)`). */
  get cloneEngine(): VoiceCloneEngine {
    return this.engine;
  }

  async isAvailable(): Promise<boolean> {
    return true; // CPU fallback guarantees coverage; WebGPU is an accelerator.
  }

  async unavailableReason(): Promise<string | null> {
    return null;
  }

  synthesize(options: SynthesizeOptions): Promise<CloneSynthesisResult> {
    return this.engine.synthesize(options);
  }
}

export interface ResolveProviderResult {
  /** The chosen provider, or null when none is available. */
  provider: VoiceProvider | null;
  /** Why none was available (null when one was). Surface this BEFORE falling
   *  back to a non-cloned voice — never swap silently. */
  reason: string | null;
}

/**
 * Pick the first available provider from `providers`, in preference order.
 * Prefers `ssm-webgpu` when the device has WebGPU (free + private), otherwise
 * falls through to a server provider. This is the one place "which clone backend
 * runs right now" is decided.
 */
export async function resolveVoiceProvider(
  providers: VoiceProvider[],
): Promise<ResolveProviderResult> {
  if (providers.length === 0) {
    return { provider: null, reason: 'No clone provider is configured.' };
  }

  const ordered = [...providers].sort((a, b) => preferenceRank(a) - preferenceRank(b));

  const reasons: string[] = [];
  for (const provider of ordered) {
    if (await provider.isAvailable()) {
      return { provider, reason: null };
    }
    const reason = await provider.unavailableReason();
    reasons.push(`${provider.id}: ${reason ?? 'unavailable'}`);
  }
  return {
    provider: null,
    reason: `Cloning unavailable — ${reasons.join('; ')}`,
  };
}

/** WebGPU-capable client ⇒ prefer the on-device provider; else the server. */
function preferenceRank(provider: VoiceProvider): number {
  if (provider.id === 'ssm-webgpu') return hasWebGPUSupport() ? 0 : 2;
  if (provider.id === 'tts-server') return 1;
  return 3;
}
