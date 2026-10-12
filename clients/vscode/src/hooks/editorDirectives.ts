/**
 * The editor's assembly of a run's workspace directives: read `.builderforce/`, gate its
 * commands on the person's approval, and hand back the run's {@link RunDirectives}. The
 * ONE entry both chat surfaces call — the panel's run host (`brainRunHostPorts.ts`) and
 * the native chat participant (`chatParticipant.ts`).
 */

import * as vscode from "vscode";
import { createLocalShell } from "../localShell";
import { HOOKS_FILE, STARTER_HOOKS_FILE } from "./hookConfig";
import { hookCommandsAllowed } from "./hookTrust";
import { createRunHooks, NO_RUN_HOOKS, type RunDirectives } from "./runHooks";
import { directivesPath, loadWorkspaceDirectives } from "./workspaceDirectives";

/** Problem sets already reported — a broken file is flagged once, not on every run. */
const reported = new Set<string>();

function reportProblems(root: string, problems: readonly string[]): void {
  const key = problems.join("\n");
  if (!problems.length || reported.has(key)) return;
  reported.add(key);
  const open = vscode.l10n.t("Open hooks.json");
  void vscode.window
    .showWarningMessage(vscode.l10n.t("Some entries in .builderforce/hooks.json were skipped: {0}", problems.join("; ")), open)
    .then((choice) => {
      if (choice === open) void vscode.window.showTextDocument(vscode.Uri.file(directivesPath(root, HOOKS_FILE)));
    });
}

/** A run's rules + hooks, or undefined when the workspace defines neither. */
export async function editorRunDirectives(
  state: vscode.Memento,
  root: string,
  scope: "run" | "subagent",
): Promise<RunDirectives | undefined> {
  const loaded = await loadWorkspaceDirectives(root);
  reportProblems(root, loaded.problems);
  if (!loaded.rules && loaded.hooks.length === 0) return undefined;
  if (loaded.hooks.length === 0) return { rules: loaded.rules, hooks: NO_RUN_HOOKS };
  const shell = createLocalShell(root);
  return {
    rules: loaded.rules,
    hooks: createRunHooks({
      hooks: loaded.hooks,
      scope,
      commandsAllowed: await hookCommandsAllowed(state, loaded.digest, loaded.hooks),
      shell: (command, options) => shell.run(command, options),
    }),
  };
}

/** Open the workspace's hooks file, creating it from the starter when there is none. */
export async function editWorkspaceHooks(root: string): Promise<void> {
  if (!root) {
    void vscode.window.showInformationMessage(vscode.l10n.t("Open a folder to add workspace hooks."));
    return;
  }
  const uri = vscode.Uri.file(directivesPath(root, HOOKS_FILE));
  try {
    await vscode.workspace.fs.stat(uri);
  } catch {
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(STARTER_HOOKS_FILE));
  }
  await vscode.window.showTextDocument(uri);
}
