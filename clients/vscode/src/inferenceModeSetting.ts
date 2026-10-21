/**
 * The editor's INFERENCE MODE — Hybrid · Local only · Specific — the one setting people
 * see for where models run (`builderforce.inferenceMode`). What a mode DERIVES is the
 * shared rule (`@builderforce/local-first` `resolveInferencePolicy`, read by
 * `platformPolicy.ts`); this module owns only the editor's state behind it:
 *
 *   - the CHOSEN mode — the setting, or null while the person never chose (the default
 *     is then derived: Hybrid signed in, Local only signed out);
 *   - SIGNED-IN — an editor key in SecretStorage, tracked as it changes, so signing in
 *     moves an undecided person onto Hybrid at once;
 *   - a pick applies IN MEMORY before it is persisted, so the very next turn (the one the
 *     first-run question held) already runs in the chosen mode.
 */
import * as vscode from "vscode";
import { defaultInferenceMode, isInferenceMode, type InferenceMode } from "@builderforce/local-first";

export const INFERENCE_MODE_SETTING = "builderforce.inferenceMode";

export interface InferenceModeState {
  /** The mode in force: the chosen one, else the derived default. */
  mode: InferenceMode;
  /** Whether the person chose it (false ⇒ the first-run question is still owed). */
  chosen: boolean;
  signedIn: boolean;
}

// A plain listener set rather than a `vscode.EventEmitter`: the platform policy reads
// this module at load, and the policy's own tests run against a minimal `vscode` stub.
const listeners = new Set<(state: InferenceModeState) => void>();
/** Called when the mode in force (or signed-in state) may have changed. */
export function onDidChangeInferenceMode(listener: (state: InferenceModeState) => void): { dispose(): void } {
  listeners.add(listener);
  return { dispose: () => listeners.delete(listener) };
}

let signedIn = false;
/** A pick applied ahead of its config write; cleared once the write lands. */
let pending: InferenceMode | undefined;

/**
 * The person's USER-scope choice, and only that. The setting is `"scope": "application"`
 * and is read through `inspect().globalValue` on top: a `.vscode/settings.json` a cloned
 * repository ships must never move someone off Local only (a workspace value is ignored,
 * whatever it says).
 */
function configuredMode(): InferenceMode | null {
  const value = vscode.workspace.getConfiguration("builderforce").inspect?.<unknown>("inferenceMode")?.globalValue;
  return isInferenceMode(value) ? value : null;
}

export function inferenceModeState(): InferenceModeState {
  const chosen = pending ?? configuredMode();
  return { mode: chosen ?? defaultInferenceMode({ signedIn }), chosen: chosen !== null, signedIn };
}

/** The mode as the chat webview's `init` frame carries it (`signedIn` rides there already). */
export function inferenceModeInit(): { inferenceMode: InferenceMode; inferenceModeChosen: boolean } {
  const { mode, chosen } = inferenceModeState();
  return { inferenceMode: mode, inferenceModeChosen: chosen };
}

/** The mode in force for this turn. */
export function currentInferenceMode(): InferenceMode {
  return inferenceModeState().mode;
}

function fire(): void {
  const state = inferenceModeState();
  for (const listener of [...listeners]) listener(state);
}

/** Choose a mode: it applies now, then persists (user scope). */
export async function setInferenceMode(mode: InferenceMode): Promise<void> {
  pending = mode;
  fire();
  try {
    await vscode.workspace.getConfiguration("builderforce").update("inferenceMode", mode, vscode.ConfigurationTarget.Global);
  } finally {
    pending = undefined;
    fire();
  }
}

/**
 * Track the setting and the signed-in state. `secretKey` is the editor key's
 * SecretStorage name; a context without SecretStorage (a test host) reads as signed out.
 *
 * Resolves once the FIRST signed-in read has landed: until then a signed-in person would
 * read as signed out (Local only), so the platform policy waits on it before it resolves
 * (`bindPlatformPolicy`) — never computing Local only for someone who is signed in.
 */
export function bindInferenceMode(context: vscode.ExtensionContext, secretKey?: string): Promise<void> {
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(INFERENCE_MODE_SETTING)) fire();
  }));
  const secrets = context.secrets as vscode.SecretStorage | undefined;
  if (!secretKey || !secrets) return Promise.resolve();
  const read = async (): Promise<void> => {
    const next = !!(await secrets.get(secretKey));
    if (next === signedIn) return;
    signedIn = next;
    fire();
  };
  context.subscriptions.push(secrets.onDidChange((event) => {
    if (event.key === secretKey) void read();
  }));
  // A failed read leaves the person signed out (Local only) — the safe side.
  return read().catch(() => undefined);
}
