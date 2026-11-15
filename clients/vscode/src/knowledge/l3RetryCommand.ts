/**
 * `builderforce.knowledge.retryAnalyzers` — the escape hatch of the L3 crash guard (`l3CrashGuard.ts`): a root quarantined
 * because a pass took the extension host down (or failed permanently) is analysed again only when its commit moves or the
 * window passes; this lifts the quarantine NOW, for the root the person names, and asks for its analyzers' pass. The guard's
 * one output-channel line names this command.
 *
 * The root: the `rootId` argument (the knowledge view's), else the active editor's workspace folder, else the only folder,
 * else the one the person picks. Also registers the clean-shutdown clear of every in-flight sentinel.
 */

import * as vscode from "vscode";
import { requestL3 } from "./indexLevels";
import { beforeKnowledgeShutdown } from "./folderKnowledge";
import { clearL3InFlight, l3CrashGuard, l3GuardIds, L3_RETRY_COMMAND } from "./l3CrashGuard";
import { rootById, rootForPath, type KnowledgeRoot } from "./knowledgeRoots";
import { log, workspaceFolders } from "./knowledgeService";

/** The root the command acts on, or undefined when the person picked none. */
async function chosenRoot(args: unknown): Promise<KnowledgeRoot | undefined> {
  const folders = workspaceFolders();
  const named = (args as { rootId?: unknown } | undefined)?.rootId;
  if (typeof named === "string") return rootById(named, folders);
  const active = vscode.window.activeTextEditor?.document.uri;
  const holder = active ? vscode.workspace.getWorkspaceFolder(active) : undefined;
  if (holder) return rootForPath(holder.uri.fsPath, folders);
  if (folders.length === 1) return rootForPath(folders[0]!.path, folders);
  const picked = await vscode.window.showQuickPick(
    folders.map((f) => ({ label: f.path.replace(/\\/g, "/").split("/").pop() || f.path, description: f.path, path: f.path })),
    { placeHolder: vscode.l10n.t("Choose the folder whose code analyzers should run again") },
  );
  return picked ? rootForPath(picked.path, folders) : undefined;
}

export function registerL3RetryCommand(context: Pick<vscode.ExtensionContext, "subscriptions">): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(L3_RETRY_COMMAND, async (args?: unknown) => {
      const root = await chosenRoot(args);
      if (!root) return;
      // The root's own quarantine and, for a sub-folder root, its folder's: either would refuse the pass.
      await Promise.all(l3GuardIds(root.rootId, root.rel || undefined).map((id) => l3CrashGuard(id).lift()));
      const ran = await requestL3(root.rootId, { looking: false }).catch((error: unknown) => { log("L3 retry", error); return false; });
      void vscode.window.showInformationMessage(ran
        ? vscode.l10n.t("The code analyzers ran again for {0}.", root.title)
        : vscode.l10n.t("The code analyzers will run again for {0} when the folder is free, or when you next review it.", root.title));
    }),
  );
  // A reload, a close or an update mid-pass is not a crash: the sentinels go (awaited) before the stores close. Registered
  // for the process, never removed by a dispose: whichever runs first, the shutdown still clears them.
  beforeKnowledgeShutdown(clearL3InFlight);
}
