import * as vscode from "vscode";
import { BfTask, listClosedTasks } from "./bfApi";
import { SECRET_KEY } from "./gateway";
import { getSelectedProject } from "./projectState";
import { humanLabel, taskRowLabel, taskStatusIcon } from "./taskTreeShared";

/** A closed-ticket row. The shape matches the open Tasks rows (`{ task }`), so every
 *  task command (start session, set status, archive, delete) takes either. */
export interface ClosedTaskNode {
  kind: "task";
  task: BfTask;
}

type Node = ClosedTaskNode | { kind: "info"; label: string };

/** Newest first: the ticket that closed last is the one most likely to be reopened. */
function byRecency(a: BfTask, b: BfTask): number {
  return (Date.parse(b.updatedAt ?? "") || 0) - (Date.parse(a.updatedAt ?? "") || 0);
}

/**
 * The Closed section of the Work view: the selected project's done, cancelled and
 * archived tickets, kept out of the open Tasks list. It sits collapsed, so nothing is
 * fetched until it is opened, and it repaints whenever the open list does (every task
 * write refreshes that list, so one signal keeps both sections current).
 *
 * Rows: reopen by setting a status, archive / restore, or delete (confirmed).
 */
export class ClosedTasksTreeProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<Node | void>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly sub: vscode.Disposable;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    openTasks: { onDidChangeTreeData: vscode.Event<unknown> },
  ) {
    this.sub = openTasks.onDidChangeTreeData(() => this.changed.fire());
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === "info") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon("info");
      return item;
    }
    const t = node.task;
    const item = new vscode.TreeItem(taskRowLabel(t), vscode.TreeItemCollapsibleState.None);
    const status = humanLabel(t.status, "status");
    item.description = t.archived ? `${vscode.l10n.t("Archived")} · ${status}` : status;
    item.tooltip = t.description ?? t.title;
    item.iconPath = taskStatusIcon(t);
    item.contextValue = t.archived ? "builderforceArchivedTask" : "builderforceClosedTask";
    item.command = { command: "builderforce.startTaskSession", title: vscode.l10n.t("Start Session"), arguments: [node] };
    return item;
  }

  async getChildren(element?: Node): Promise<Node[]> {
    if (element) return [];
    if (!(await this.ctx.secrets.get(SECRET_KEY))) return [];
    const project = getSelectedProject();
    if (!project) return [];
    try {
      const tasks = await listClosedTasks(this.ctx.secrets, project.id);
      if (tasks.length === 0) return [{ kind: "info", label: vscode.l10n.t("No closed tasks") }];
      return [...tasks].sort(byRecency).map((task) => ({ kind: "task" as const, task }));
    } catch (e) {
      return [{ kind: "info", label: vscode.l10n.t("Tasks unavailable — {0}", (e as Error).message) }];
    }
  }

  dispose(): void {
    this.sub.dispose();
    this.changed.dispose();
  }
}
