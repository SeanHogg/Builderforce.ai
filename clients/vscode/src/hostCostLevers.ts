/**
 * The cost-lever gate for the editor host. The extension has no Worker env and no tenant
 * on the local path, so a lever is on here only when its manifest default is fully rolled
 * out (`isCostLeverOn(undefined, id, null)`) — the one place the VSIX reads a lever.
 */
import { isCostLeverOn, type CostLeverId } from "@builderforce/cost-levers";

export function hostCostLeverOn(id: CostLeverId): boolean {
  return isCostLeverOn(undefined, id, null);
}
