import * as vscode from "vscode";
import {
  detectPendingChanges,
  refreshPendingChanges,
  watchPendingChanges,
  EMPTY_CHANGE_SET,
  type PendingChange,
  type PendingChangeRepo,
  type PendingChangeSet,
  type PendingChangeStatus,
} from "./gitChanges";

/**
 * Changes (Activity Bar → BuilderForce → Changes) — the answer to "the agent said it
 * changed something; where is it?".
 *
 * A Brain turn edits the workspace through the local tools, so the code on disk moves
 * while the conversation is the only record that it did. Until this view, no
 * BuilderForce surface said so: the chat, the ticket rail and every sidebar section
 * rendered a finished turn with no hint that unreviewed edits were now sitting in the
 * working tree, and the only route to them was noticing the separate Source Control
 * view on your own.
 *
 * This view is the indicator AND the way in: a numeric badge on the section (which VS
 * Code also rolls up onto the BuilderForce activity-bar icon), one row per changed
 * file, and a click that opens the file's real diff in the editor's own diff viewer.
 * Reviewing, staging and committing stay with Source Control — the title actions hand
 * you straight to it, or to the Brain with a commit-and-open-a-PR job.
 *
 * Self-contained: it owns its tree, its badge, its commands and its git subscription,
 * so wiring it into `activate` is one line and nothing else has to know it exists.
 * The change set itself comes from {@link gitChanges} — the same read every other
 * surface uses, so this list and the chat's pending-changes bar cannot disagree.
 */

/** Rows past this per repository fold into a single "show the rest in Source Control"
 *  row. A tree is a review aid, not a file dump — a freshly-cloned repo with thousands
 *  of untracked files must not become thousands of tree items. */
const MAX_ROWS_PER_REPO = 200;

type ChangesNode =
  | { kind: "repo"; repo: PendingChangeRepo }
  | { kind: "change"; change: PendingChange }
  | { kind: "more"; hidden: number }
  | { kind: "empty" };

/** Status → a themed icon. Colors are theme tokens, so both themes stay legible. */
function statusIcon(status: PendingChangeStatus): vscode.ThemeIcon {
  switch (status) {
    case "added":
    case "untracked":
      return new vscode.ThemeIcon("diff-added", new vscode.ThemeColor("gitDecoration.untrackedResourceForeground"));
    case "deleted":
      return new vscode.ThemeIcon("diff-removed", new vscode.ThemeColor("gitDecoration.deletedResourceForeground"));
    case "renamed":
      return new vscode.ThemeIcon("diff-renamed", new vscode.ThemeColor("gitDecoration.renamedResourceForeground"));
    case "conflict":
      return new vscode.ThemeIcon("warning", new vscode.ThemeColor("gitDecoration.conflictingResourceForeground"));
    default:
      return new vscode.ThemeIcon("diff-modified", new vscode.ThemeColor("gitDecoration.modifiedResourceForeground"));
  }
}

/** Status → the word shown beside the path. */
function statusLabel(status: PendingChangeStatus): string {
  switch (status) {
    case "added":
      return vscode.l10n.t("added");
    case "untracked":
      return vscode.l10n.t("new");
    case "deleted":
      return vscode.l10n.t("deleted");
    case "renamed":
      return vscode.l10n.t("renamed");
    case "conflict":
      return vscode.l10n.t("conflict");
    case "typechange":
      return vscode.l10n.t("type changed");
    default:
      return vscode.l10n.t("modified");
  }
}

/** The directory part of a repo-relative path (empty at the repository root). */
function dirOf(relativePath: string): string {
  const cut = relativePath.lastIndexOf("/");
  return cut < 0 ? "" : relativePath.slice(0, cut);
}

/** The file name part of a repo-relative path. */
function fileOf(relativePath: string): string {
  const cut = relativePath.lastIndexOf("/");
  return cut < 0 ? relativePath : relativePath.slice(cut + 1);
}

/**
 * Open ONE changed file the way the editor already knows how: the Git extension's own
 * diff (working tree against HEAD). An untracked file has nothing to diff against, and
 * a host without the Git extension has no such command at all, so both fall back to
 * opening the file itself. A deleted file can only be shown as a diff — if that fails
 * there is nothing on disk to open, and we say so rather than failing silently.
 *
 * The ONE way any BuilderForce surface opens a pending change: the tree row, the
 * command palette and the chat's pending-changes bar all route here through
 * `builderforce.openChange`, so "open" cannot mean three different things.
 */
export async function openPendingChange(change: Pick<PendingChange, "path" | "status">): Promise<void> {
  const uri = vscode.Uri.file(change.path);
  if (change.status !== "untracked") {
    try {
      await vscode.commands.executeCommand("git.openChange", uri);
      return;
    } catch {
      // No Git extension, or it declined this resource — fall through to the file.
    }
  }
  try {
    await vscode.commands.executeCommand("vscode.open", uri);
  } catch {
    void vscode.window.showWarningMessage(
      vscode.l10n.t("Could not open {0} — it may already be deleted. Review it in Source Control.", change.path),
    );
  }
}

class PendingChangesTreeProvider implements vscode.TreeDataProvider<ChangesNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private set: PendingChangeSet = EMPTY_CHANGE_SET;

  /** Adopt a freshly-read change set and repaint. */
  apply(set: PendingChangeSet): void {
    this.set = set;
    this._onDidChangeTreeData.fire();
  }

  getChildren(node?: ChangesNode): ChangesNode[] {
    if (!node) {
      if (this.set.total === 0) return [{ kind: "empty" }];
      // One repository is the overwhelmingly common case — don't make the user expand
      // a group to see the only thing in it. Several, and the group IS the context.
      return this.set.repos.length === 1
        ? this.rowsFor(this.set.repos[0]!)
        : this.set.repos.map((repo) => ({ kind: "repo" as const, repo }));
    }
    return node.kind === "repo" ? this.rowsFor(node.repo) : [];
  }

  /** One repository's rows, capped, with a tail row when the cap bit. */
  private rowsFor(repo: PendingChangeRepo): ChangesNode[] {
    const shown = repo.changes.slice(0, MAX_ROWS_PER_REPO);
    const rows: ChangesNode[] = shown.map((change) => ({ kind: "change" as const, change }));
    const hidden = repo.changes.length - shown.length;
    if (hidden > 0) rows.push({ kind: "more", hidden });
    return rows;
  }

  getTreeItem(node: ChangesNode): vscode.TreeItem {
    if (node.kind === "empty") {
      const item = new vscode.TreeItem(vscode.l10n.t("No uncommitted changes"), vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon("check");
      item.tooltip = vscode.l10n.t("Everything the agent has changed is committed.");
      return item;
    }

    if (node.kind === "more") {
      const item = new vscode.TreeItem(
        vscode.l10n.t("{0} more changed files…", node.hidden),
        vscode.TreeItemCollapsibleState.None,
      );
      item.iconPath = new vscode.ThemeIcon("ellipsis");
      item.command = { command: "builderforce.openSourceControl", title: vscode.l10n.t("Open Source Control") };
      return item;
    }

    if (node.kind === "repo") {
      const item = new vscode.TreeItem(node.repo.name, vscode.TreeItemCollapsibleState.Expanded);
      item.id = `repo:${node.repo.root}`;
      item.iconPath = new vscode.ThemeIcon("repo");
      item.description = node.repo.branch
        ? vscode.l10n.t("{0} · {1} pending", node.repo.branch, node.repo.changes.length)
        : vscode.l10n.t("{0} pending", node.repo.changes.length);
      item.resourceUri = vscode.Uri.file(node.repo.root);
      item.contextValue = "builderforceChangeRepo";
      return item;
    }

    const { change } = node;
    const item = new vscode.TreeItem(fileOf(change.relativePath), vscode.TreeItemCollapsibleState.None);
    item.id = `change:${change.path}`;
    // The file's own icon + git decoration come free from the resource URI; the
    // explicit status icon in front of it says WHAT happened without needing colour
    // vision or a hover.
    item.resourceUri = vscode.Uri.file(change.path);
    item.iconPath = statusIcon(change.status);
    const dir = dirOf(change.relativePath);
    const state = change.staged ? vscode.l10n.t("{0} · staged", statusLabel(change.status)) : statusLabel(change.status);
    item.description = dir ? `${state} · ${dir}` : state;
    item.tooltip = vscode.l10n.t("{0} — {1}. Click to open the diff.", change.relativePath, state);
    item.command = {
      command: "builderforce.openChange",
      title: vscode.l10n.t("Open the diff"),
      arguments: [change],
    };
    item.contextValue = "builderforceChange";
    return item;
  }
}

/**
 * Owns the Changes sidebar: the tree, its count badge, its commands, and the git
 * subscription that keeps all three live. Disposable — `activate` pushes it and
 * nothing else has to know how any of it works.
 */
export class PendingChangesController implements vscode.Disposable {
  private readonly provider = new PendingChangesTreeProvider();
  private readonly treeView: vscode.TreeView<ChangesNode>;
  private readonly subs: vscode.Disposable[] = [];
  private disposed = false;

  constructor() {
    this.treeView = vscode.window.createTreeView("builderforce.changes", {
      treeDataProvider: this.provider,
    });
    this.subs.push(
      this.treeView,
      // Every surface opens a change through this ONE command (see openPendingChange).
      vscode.commands.registerCommand("builderforce.openChange", (change: PendingChange) =>
        change?.path ? openPendingChange(change) : this.reveal(),
      ),
      vscode.commands.registerCommand("builderforce.refreshChanges", () => {
        refreshPendingChanges();
        return this.refresh();
      }),
      // "Review changes" from the palette, the chat's pending-changes bar and the
      // Inbox all mean the same thing: show me the list.
      vscode.commands.registerCommand("builderforce.reviewChanges", () => this.reveal()),
      vscode.commands.registerCommand("builderforce.openSourceControl", () => openSourceControl()),
      // Recount whenever git moves — an edit, a stage, a commit, a checkout — and
      // whenever an agent tool writes to disk (the host fires refreshPendingChanges).
      watchPendingChanges(() => void this.refresh()),
    );
    void this.refresh();
  }

  /** Re-read the working set and repaint the tree, its badge and its header. */
  async refresh(): Promise<void> {
    if (this.disposed) return;
    const set = await detectPendingChanges();
    if (this.disposed) return;
    this.provider.apply(set);
    // The badge is the INDICATION: VS Code rolls view badges up onto the activity-bar
    // icon, so pending work is visible without the section even being open.
    this.treeView.badge =
      set.total > 0
        ? {
            value: set.total,
            tooltip: vscode.l10n.t("{0} uncommitted file(s) waiting for review", set.total),
          }
        : undefined;
    this.treeView.description =
      set.total > 0 ? vscode.l10n.t("{0} pending", set.total) : undefined;
    // Lets the manifest hide review-only actions on a clean tree.
    await vscode.commands.executeCommand("setContext", "builderforce.hasPendingChanges", set.total > 0);
  }

  /** Bring the Changes section into view (and expand the panel if it is collapsed). */
  private async reveal(): Promise<void> {
    await this.refresh();
    await vscode.commands.executeCommand("builderforce.changes.focus").then(undefined, () => undefined);
  }

  dispose(): void {
    this.disposed = true;
    for (const s of this.subs) s.dispose();
    this.subs.length = 0;
  }
}

/** VS Code's own Source Control view — where staging, committing and discarding live. */
async function openSourceControl(): Promise<void> {
  await vscode.commands.executeCommand("workbench.view.scm").then(undefined, () => undefined);
  await vscode.commands.executeCommand("workbench.scm.focus").then(undefined, () => undefined);
}
