/**
 * LcmResidency — the residency wiring one lcm-diffusion VideoEngine shares
 * across its draft and refinement DiffusionEngines.
 *
 *   • one SessionResidency: budget accounting of the live ORT sessions
 *     (0.8 × the device memory hint — probed VRAM when the device reports it,
 *     else navigator.deviceMemory / a 4 GiB default). Sessions are never
 *     evicted; the refinement pass disposes the draft engine before building
 *     the refinement one, which is what keeps memory at max(draft, refinement);
 *   • one EngineActivity: VideoEngine runs every generation through
 *     {@link LcmResidency.run}, so background work knows when it is busy;
 *   • one WeightPrefetch (only when a distinct refinementModel is configured),
 *     started once the draft engine's init has resolved. It warms the weight
 *     store one file at a time and only while the engine is idle — cancelling
 *     a warm when generation starts, pausing while the budget is pressured and
 *     skipping a file larger than half the budget headroom — and the
 *     refinement engine's weight fetches then read the store.
 *
 * It is also the single place a DiffusionEngine is constructed for a
 * VideoEngine, so the draft and refinement engines cannot drift apart in how
 * they are wired. Internal: not exported from the package entry.
 */

import type { DiffusionModelId } from '../../types';
import type { ProbedDevice } from '../device-router';
import { DiffusionEngine } from '../diffusion-engine';
import { EngineActivity } from './engine-activity';
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
  private readonly activity = new EngineActivity();
  private readonly prefetch: WeightPrefetch | null;

  constructor(private readonly opts: LcmResidencyOptions) {
    this.sessions = new SessionResidency(opts.probed);
    const refinement = opts.refinementModel;
    // No refinement model ⇒ no WeightPrefetch ⇒ no warm downloads / IDB reads.
    this.prefetch =
      refinement && refinement !== opts.model
        ? new WeightPrefetch(refinement, opts, {
            activity: this.activity,
            headroomBytes: () => this.sessions.headroomBytes(),
            isPressured: () => this.sessions.isPressured(),
          })
        : null;
  }

  /** A DiffusionEngine for `model`, wired to the shared residency (and, for the
   *  refinement model, to the weight warm). */
  createEngine(model: DiffusionModelId, view: LcmEngineView): DiffusionEngine {
    const { probed, apiKey, weightSources, r2Base } = this.opts;
    return new DiffusionEngine({
      model,
      probed,
      apiKey,
      weightSources,
      r2Base,
      ...view,
      residency: this.sessions,
      weightPrefetch: this.prefetch && model === this.opts.refinementModel ? this.prefetch : undefined,
    });
  }

  /** Run one generation with the engine marked busy — the weight warm yields to it. */
  run<T>(work: () => Promise<T>): Promise<T> {
    return this.activity.run(work);
  }

  /** Begin warming the refinement model's weights while idle. Call only after
   *  the draft engine's init has resolved. */
  prefetchRefinement(): void {
    this.prefetch?.start();
  }

  /** Stop background warms and drop their records. Idempotent. */
  dispose(): void {
    this.prefetch?.dispose();
  }
}
