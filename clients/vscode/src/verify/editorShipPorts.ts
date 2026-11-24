/**
 * The ONE editor binding of the ship-gate ports (`shipPorts.ts`) — the live `vscode` module and
 * the host's git. Module-level, so the panel's run host and the native participant share one
 * verifier (and its cache) per workspace root for the life of the extension host.
 */

import * as vscode from "vscode";
import { gitRunner } from "./execRunner";
import { getModels } from "../gateway";
import { isServableLocalModel } from "@builderforce/local-inference";
import { currentInferenceMode } from "../inferenceModeSetting";
import { localWindowProbes } from "../modelRouting";
import { createShipPorts, type ShipPortsRun } from "./shipPorts";

/**
 * The ONE editor binding of the ship-gate ports (`shipPorts.ts`) — the live `vscode` module and
 * the host's git. Module-level, so the panel's run host and the native participant share one
 * verifier (and its cache) per workspace root for the life of the extension host.
 *
 * The reviewer's OD-1 auto-switch reads the account model catalog (BYO + plan pool + premium)
 * from `SecretStorage`, which only exists once the extension has activated. `activate` passes its
 * `context.secrets` to {@link setShipCatalogSecrets} once; until then (or if it is never called),
 * a catalog read fails and the reviewer falls back to its refusal — no auto-switch.
 */
const bindShipPorts = createShipPorts({
  vscode,
  git: gitRunner,
  getCatalog: () => getModels(shipCatalogSecrets()).catch(() => undefined),
  getLocalCatalog: async () => (await localWindowProbes()).flatMap(({ models }) =>
    models.filter(isServableLocalModel).map(({ ref }) => ref)),
});

export function editorShipPorts(run: ShipPortsRun) {
  return bindShipPorts({ ...run, localOnly: currentInferenceMode() === "local-only" });
}

/** The SecretStorage the auto-switch catalog is read from, set once by `activate`. */
let shipCatalogSecretsRef: vscode.SecretStorage | undefined;

/** Called once by `activate(context)` so the auto-switch can read the model catalog. */
export function setShipCatalogSecrets(secrets: vscode.SecretStorage): void {
  shipCatalogSecretsRef = secrets;
}

function shipCatalogSecrets(): vscode.SecretStorage {
  if (!shipCatalogSecretsRef) throw new Error("ship catalog secrets not initialised");
  return shipCatalogSecretsRef;
}
