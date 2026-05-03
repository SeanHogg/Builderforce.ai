import type { MutableTensor, SchedulerKind } from "../types";
import { FlowMatchScheduler } from "./flow-match";

export interface Scheduler {
  /** Continuous timestep at integer step index (1.0 = pure noise, 0.0 = clean). */
  timestepAt(stepIdx: number): number;
  /** Mutates `latent` in place using the predicted velocity/noise for this step. */
  step(latent: MutableTensor, prediction: MutableTensor, stepIdx: number): void;
}

export function makeScheduler(kind: SchedulerKind, steps: number): Scheduler {
  switch (kind) {
    case "flow-match-rect":
      return new FlowMatchScheduler(steps);
    case "euler":
    case "dpm++-2m":
      throw new Error(`Scheduler '${kind}' not yet implemented`);
  }
}
