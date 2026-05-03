import type { MutableTensor, SchedulerKind } from "../types";
import { EulerScheduler } from "./euler";
import { FlowMatchScheduler } from "./flow-match";

export interface Scheduler {
  /** Continuous timestep at integer step index. Sigma scale, monotonically decreasing. */
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
    case "dpm++-2m":
      throw new Error(`Scheduler '${kind}' not yet implemented`);
  }
}
