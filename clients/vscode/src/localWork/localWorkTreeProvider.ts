/**
 * The native `builderforce.localWork` tree (G05 UI): projects, then their tickets, read from the
 * local store through `localWorkModel`. It never calls the platform, so it lists the same rows
 * with the platform denied. Each row shows its presented sync status as an icon and in its
 * description.
 *
 * The tree repaints from the store: a commit touching a project, a ticket or the sync state
 * (receipts, queued events) schedules one debounced refresh.
 */

import * as vscode from "vscode";
import type { LocalFirstStore } from "@builderforce/local-first";
import type { PresentedSyncStatus } from "../syncStatusPresenter";
import { createLocalWorkModel, type LocalWorkFacts, type LocalWorkModel, type LocalWorkNode } from "./localWorkModel";
import type { LocalWorkRepository } from "../localWorkRepository";

const REFRESH_DELAY_MS = 150;

function syncText(status: PresentedSyncStatus): string {
  switch (status) {
    case "synced": return vscode.l10n.t("Synced");
    case "syncing": return vscode.l10n.t("Syncing");
    case "conflict": return vscode.l10n.t("Conflict");
    case "dead-letter": return vscode.l10n.t("Failed to sync");
    default: return vscode.l10n.t("Not synced yet");
  }
}

function syncIcon(status: PresentedSyncStatus | undefined): vscode.ThemeIcon {
  switch (status) {
    case "synced": return new vscode.ThemeIcon("check", new vscode.ThemeColor("testing.iconPassed"));
    case "syncing": return new vscode.ThemeIcon("sync", new vscode.ThemeColor("charts.blue"));
    case "conflict": return new vscode.ThemeIcon("warning", new vscode.ThemeColor("editorWarning.foreground"));
    case "dead-letter": return new vscode.ThemeIcon("error", new vscode.ThemeColor("errorForeground"));
    default: return new vscode.ThemeIcon("circle-outline");
  }
}

export function localWorkTreeItem(node: LocalWorkNode): vscode.TreeItem {
  if (node.kind === "unfiled") {
    const item = new vscode.TreeItem(vscode.l10n.t("Unfiled"), vscode.TreeItemCollapsibleState.Expanded);
    item.contextValue = "localWork.unfiled";
    item.iconPath = new vscode.ThemeIcon("inbox");
    return item;
  }
  const item = new vscode.TreeItem(
    node.label,
    node.kind === "project" ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
  );
  item.id = node.key;
  item.contextValue = node.kind === "project" ? "localWork.project" : "localWork.ticket";
  item.iconPath = syncIcon(node.sync);
  const parts = [node.workStatus, node.sync ? syncText(node.sync) : undefined].filter((part): part is string => !!part);
  item.description = parts.join(" · ");
  item.tooltip = `${node.label}\n${parts.join("\n")}`;
  return item;
}

export class LocalWorkTreeProvider implements vscode.TreeDataProvider<LocalWorkNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<LocalWorkNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly model: LocalWorkModel;
  private readonly stop: () => void;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    store: LocalFirstStore,
    repo: LocalWorkRepository,
    facts: () => Promise<LocalWorkFacts>,
  ) {
    this.model = createLocalWorkModel({ repo, facts });
    this.stop = store.subscribe((change) => {
      const touched = !change
        || change.events
        || change.syncState
        || (["project", "ticket"] as const).some((type) => (change.records.get(type)?.size ?? 0) > 0);
      if (touched) this.refresh();
    });
  }

  refresh(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; this.changed.fire(undefined); }, REFRESH_DELAY_MS);
  }

  getTreeItem(node: LocalWorkNode): vscode.TreeItem {
    return localWorkTreeItem(node);
  }

  getChildren(node?: LocalWorkNode): Promise<LocalWorkNode[]> {
    return node ? this.model.children(node) : this.model.roots();
  }

  dispose(): void {
    this.stop();
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.changed.dispose();
  }
}
