/**
 * Where the editor keeps Hybrid's `run.local-success` predictor — the extension's GLOBAL
 * storage, so what this machine learned about its local models follows the person across
 * workspaces (the models are the machine's, not the folder's).
 *
 * The predictor itself is brain-embedded's (`createHostModelStream({ localSuccess })`);
 * this is only the host's half of its one store port. Unbound (tests, or a turn before
 * activation finished) it reads as empty and saves nothing — the cold start, which is
 * exactly the behaviour without a predictor.
 */

import type * as vscode from "vscode";
import type { LocalSuccessStore } from "@seanhogg/builderforce-brain-embedded";

const STORAGE_KEY = "builderforce.ml.run.local-success";

let memento: vscode.Memento | null = null;

/** Bind the Memento the predictor persists in. Call once from activation. */
export function bindLocalSuccessStorage(context: Pick<vscode.ExtensionContext, "globalState">): void {
  memento = context.globalState;
}

/** The ONE store the editor lends every routed stream (one object, so one trained history). */
export const localSuccessStore: LocalSuccessStore = {
  load: () => memento?.get<unknown>(STORAGE_KEY),
  save: async (snapshot) => {
    await memento?.update(STORAGE_KEY, snapshot);
  },
};
