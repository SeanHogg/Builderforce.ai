/**
 * `builderforce.knowledge.retryAnalyzers` — the escape hatch of the L3 crash guard (`l3CrashGuard.ts`): a root quarantined
 * because a pass took the extension host down (or failed permanently) is analysed again only when its commit moves or the
 * window passes; this lifts the quarantine NOW, for the root the person names, and asks for its analyzers' pass — forced
 * (`explicit`): it runs even when the analysis looks current, and no view closing drops it. The guard's one output-channel
 * line names this command and the root.
 *
 * The root: the `rootId` argument, else the QUARANTINED roots (folder and sub-folder ones; the only one is taken without
 * asking, several are offered in a pick list), else — nothing quarantined — the active editor's workspace folder, the only
 * folder, or the one the person picks. Also registers the clean-shutdown clear of every in-flight sentinel.
 */

import * as vscode from "vscode";
import { requestL3 } from "./indexLevels";
import { beforeKnowledgeShutdown } from "./folderKnowledge";
import { clearL3InFlight, l3CrashGuard, l3GuardIds, quarantinedL3Roots, L3_RETRY_COMMAND } from "./l3CrashGuard";
import { rootById, rootForPath, type KnowledgeRoot } from "./knowledgeRoots";
import { log, workspaceFolders } from "./knowledgeService";

/** What the command acts on: the root id, its name for people, and — for a sub-folder root — its path inside its folder. */
interface Target { rootId: string; title: string; rel?: string }

const targetOf = (root: KnowledgeRoot): Target => ({ rootId: root.rootId, title: root.title, ...(root.rel ? { rel: root.rel } : {}) });

/** A workspace folder, from the active editor, the only folder, or the person's pick. */
async function folderTarget(): Promise<Target | undefined> {
  const folders = workspaceFolders();
  const active = vscode.window.activeTextEditor?.document.uri;
  const holder = active ? vscode.workspace.getWorkspaceFolder(active) : undefined;
  const pickedPath = holder?.uri.fsPath ?? (folders.length === 1 ? folders[0]!.path : (await vscode.window.showQuickPick(
    folders.map((f) => ({ label: f.path.replace(/\\/g, "/").split("/").pop() || f.path, description: f.path, path: f.path })),
    { placeHolder: vscode.l10n.t("Choose the folder whose code analyzers should run again") },
  ))?.path);
  const root = pickedPath ? rootForPath(pickedPath, folders) : undefined;
  return root ? targetOf(root) : undefined;
}

/** The root the command acts on, or undefined when the person picked none. */
async function chosenTarget(args: unknown): Promise<Target | undefined> {
  const folders = workspaceFolders();
  const named = (args as { rootId?: unknown } | undefined)?.rootId;
  if (typeof named === "string") {
    const root = rootById(named, folders);
    return root ? targetOf(root) : { rootId: named, title: named };
  }
  // The quarantined roots: what the guard's output line told the person to retry.
  const held = (await quarantinedL3Roots()).map((q) => {
    const root = rootById(q.rootId, folders);
    return { target: root ? targetOf(root) : { rootId: q.rootId, title: q.where ?? q.rootId }, where: q.where ?? root?.rootPath ?? q.rootId, reason: q.reason };
  });
  if (held.length === 1) return held[0]!.target;
  if (held.length > 1) {
    const picked = await vscode.window.showQuickPick(
      held.map((h) => ({ label: h.target.title, description: h.where, detail: h.reason, target: h.target })),
      { placeHolder: vscode.l10n.t("Choose the folder whose code analyzers were skipped") },
    );
    return picked?.target;
  }
  return folderTarget();
}

export function registerL3RetryCommand(context: Pick<vscode.ExtensionContext, "subscriptions">): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(L3_RETRY_COMMAND, async (args?: unknown) => {
      const target = await chosenTarget(args);
      if (!target) return;
      // The root's own quarantine and, for a sub-folder root, its folder's: either would refuse the pass.
      await Promise.all(l3GuardIds(target.rootId, target.rel).map((id) => l3CrashGuard(id).lift()));
      // Forced: the person asked, so a pass runs even when the analysis looks current; no view's close drops it.
      const ran = await requestL3(target.rootId, { explicit: true }).catch((error: unknown) => { log("L3 retry", error); return false; });
      void vscode.window.showInformationMessage(ran
        ? vscode.l10n.t("The code analyzers ran again for {0}.", target.title)
        : vscode.l10n.t("The code analyzers will run again for {0} when the folder is free, or when you next review it.", target.title));
    }),
  );
  // A reload, a close or an update mid-pass is not a crash: the sentinels go (awaited) before the stores close. Registered
  // for the process, never removed by a dispose: whichever runs first, the shutdown still clears them.
  beforeKnowledgeShutdown(clearL3InFlight);
}
