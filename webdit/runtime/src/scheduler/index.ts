import type { MutableTensor, SchedulerKind } from "../types";
import { DdimVPredZsnrScheduler } from "./ddim-vpred-zsnr";
import { EulerScheduler } from "./euler";
import { FlowMatchScheduler } from "./flow-match";

export interface Scheduler {
  /** Timestep at integer step index — sigma scale (continuous schedulers) or
   *  a discrete 0..999 train-timestep (`ddim-vpred-zsnr`), monotonically
   *  decreasing either way. */
  timestepAt(stepIdx: number): number;
  /** Mutates `latent` in place using the predicted velocity/noise for this step. */
  step(latent: MutableTensor, prediction: MutableTensor, stepIdx: number): void;
}

export function makeScheduler(kind: SchedulerKind, steps: number): Scheduler {
  switch (kind) {
    case "flow-match-rect":
      return new FlowMatchScheduler(steps);
    case "euler":
      return new EulerScheduler(steps);
    case "ddim-vpred-zsnr":
      return new DdimVPredZsnrScheduler(steps);
    case "dpm++-2m":
      throw new Error(`Scheduler '${kind}' not yet implemented`);
  }
}
