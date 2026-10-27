/**
 * Where the editor keeps Hybrid's `run.local-success` predictor — the extension's GLOBAL
 * storage, so what this machine learned about its local models follows the person across
 * workspaces (the models are the machine's, not the folder's).
 *
 * The predictor itself is brain-embedded's (`createHostModelStream({ localSuccess })`);
 * this is only the host's half of its one store port. Unbound (tests, or a turn before
 * activation finished) it reads as empty and saves nothing — the cold start, which is
 * exactly the behaviour without a predictor.
 *
 * Its head FEDERATES with the turn's project (`localSuccessFederation` below, built by
 * brain-embedded's shared `createLocalSuccessFederation` over the extension's authed
 * transport `bfApiRequest`). brain-embedded lends it only to a signed-in Hybrid turn;
 * unbound, every call refuses and the head stays on this machine.
 *
 * WHEN a confident "fails" verdict skips local is the person's to tune
 * (`builderforce.localModels.skipConfidence` / `.explore`, `localSuccessTuning` below),
 * read per turn so a change applies to the next one.
 */

import * as vscode from "vscode";
import {
  createLocalSuccessFederation,
  type HostModelStreamInput,
  type LocalSuccessFederation,
  type LocalSuccessStore,
  type ProjectMemoryRequest,
} from "@seanhogg/builderforce-brain-embedded";

const STORAGE_KEY = "builderforce.ml.run.local-success";

let memento: vscode.Memento | null = null;
let federationRequest: ProjectMemoryRequest | null = null;

/** Bind the Memento the predictor persists in, and the authed transport its head federates over. Call once from activation. */
export function bindLocalSuccessStorage(context: Pick<vscode.ExtensionContext, "globalState">, request?: ProjectMemoryRequest): void {
  memento = context.globalState;
  federationRequest = request ?? null;
}

/** The ONE store the editor lends every routed stream (one object, so one trained history). */
export const localSuccessStore: LocalSuccessStore = {
  load: () => memento?.get<unknown>(STORAGE_KEY),
  save: async (snapshot) => {
    await memento?.update(STORAGE_KEY, snapshot);
  },
};

/** The ONE federation port the editor lends every routed stream, over the bound transport. */
export const localSuccessFederation: LocalSuccessFederation = createLocalSuccessFederation(
  <T>(path: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
    federationRequest ? federationRequest<T>(path, init) : Promise.reject(new Error("local-success federation: the extension has not activated")),
);

/** A `builderforce.localModels.*` share setting, read live; undefined (⇒ the predictor's
 *  default) when unset or out of [0, 1]. */
function shareSetting(key: string): number | undefined {
  const v = vscode.workspace.getConfiguration("builderforce.localModels").get<number>(key);
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : undefined;
}

/** The ONE tuning the editor lends every routed stream — the person's two settings. */
export const localSuccessTuning: NonNullable<HostModelStreamInput["localSuccessTuning"]> = {
  skipConfidence: () => shareSetting("skipConfidence"),
  explore: () => shareSetting("explore"),
};
