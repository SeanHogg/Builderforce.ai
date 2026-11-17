/**
 * LcmResidency — the residency wiring one lcm-diffusion VideoEngine shares
 * across its draft and refinement DiffusionEngines.
 *
 *   • one SessionResidency, so refinement admissions evict + release draft
 *     sessions when both cannot fit (the max(draft, refinement) rule);
 *   • one WeightPrefetch (only when a distinct refinementModel is configured),
 *     started once the draft engine's init has resolved; it warms the weight
 *     store one file at a time (backing off while the SessionResidency is
 *     pressured), which the refinement engine's weight fetches then read.
 *
 * It is also the single place a DiffusionEngine is constructed for a
 * VideoEngine, so the draft and refinement engines cannot drift apart in how
 * they are wired. Internal: not exported from the package entry.
 */

import type { DiffusionModelId } from '../../types';
import type { ProbedDevice } from '../device-router';
import { DiffusionEngine } from '../diffusion-engine';
import { SessionResidency } from './session-residency';
import { WeightPrefetch, type WeightSourceConfig } from './weight-prefetch';

export interface LcmResidencyOptions extends WeightSourceConfig {
  probed: ProbedDevice;
  model: DiffusionModelId;
  refinementModel?: DiffusionModelId;
}

/** Per-engine output settings that differ between the create-time and the
 *  refinement-pass construction. */
export interface LcmEngineView {
  width: number;
  height: number;
  onProgress?: (label: string) => void;
}

export class LcmResidency {
  private readonly sessions: SessionResidency;
  private readonly prefetch: WeightPrefetch | null;

  constructor(private readonly opts: LcmResidencyOptions) {
    this.sessions = new SessionResidency(opts.probed);
    const refinement = opts.refinementModel;
    // No refinement model ⇒ no WeightPrefetch ⇒ no warm downloads / IDB reads.
    this.prefetch =
      refinement && refinement !== opts.model
        ? new WeightPrefetch(refinement, opts, { shouldThrottle: () => this.sessions.isPressured() })
        : null;
  }

  /** A DiffusionEngine for `model`, wired to the shared residency (and, for the
   *  refinement model, to the weight warm). */
  createEngine(model: DiffusionModelId, view: LcmEngineView): DiffusionEngine {
    const { probed, apiKey, weightSources, r2Base, refinementModel } = this.opts;
    return new DiffusionEngine({
      model,
      probed,
      apiKey,
      weightSources,
      r2Base,
      ...view,
      residency: this.sessions,
      weightPrefetch: model === refinementModel ? this.prefetch ?? undefined : undefined,
    });
  }

  /** Begin warming the refinement model's weights in the background. Call only
   *  after the draft engine's init has resolved. */
  prefetchRefinement(): void {
    this.prefetch?.start();
  }

  /** Stop background warms and drop their records. Idempotent. */
  dispose(): void {
    this.prefetch?.dispose();
  }
}
