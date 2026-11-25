/**
 * The cost-lever gate for the editor host — the one place the VSIX reads a lever.
 *
 * The extension has no Worker env and no tenant on the local path, so a partial rollout
 * is bucketed by this install's stable id (`vscode.env.machineId`, handed in at
 * activation by {@link setHostInstallId}) through the SAME on-device resolver the on-prem
 * runtime uses (`isOnDeviceCostLeverOn`). Before activation hands it in (a unit test, the
 * headless harness) there is no id, and a lever is on only when fully rolled out — the
 * answer this gate always gave.
 *
 * Pure (no `vscode` import) so the capability provider and its tests can read it.
 */
import { isOnDeviceCostLeverOn, type CostLeverId } from "@builderforce/cost-levers";

/** VS Code's placeholder when it cannot report a machine id (some web/remote hosts). */
const PLACEHOLDER_MACHINE_ID = "someValue.machineId";

let installId: string | null = null;

/** Called once at activation with `vscode.env.machineId`. A placeholder or blank is no id. */
export function setHostInstallId(id: string | null | undefined): void {
  const trimmed = (id ?? "").trim();
  installId = trimmed && trimmed !== PLACEHOLDER_MACHINE_ID ? trimmed : null;
}

export function hostCostLeverOn(id: CostLeverId): boolean {
  return isOnDeviceCostLeverOn(undefined, id, installId);
}
