import * as vscode from "vscode";
import { BfTask, DEFAULT_HIDE_DONE, isDoneStatus, listTasks } from "./bfApi";
import { SECRET_KEY } from "./gateway";
import { getSelectedProject, onProjectChange } from "./projectState";

const HIDE_DONE_KEY = "builderforce.hideDoneTasks";

type Node =
  | { kind: "project"; name: string }
  | { kind: "task"; task: BfTask }
  | { kind: "info"; label: string; command?: string };

/**
 * The "Project" view: pick a BuilderForce project, then see its tasks. Clicking a task
 * starts a chat session linked to it; right-click sets status (which can trigger the
 * project's lane automation server-side). Degrades to a hint when not signed in or the
 * tenant APIs aren't reachable yet.
 */
export class ProjectsTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private hideDone: boolean;

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.hideDone = ctx.globalState.get<boolean>(HIDE_DONE_KEY, DEFAULT_HIDE_DONE);
    // Seed the menu's when-clause context so the right toggle icon shows on load.
    void vscode.commands.executeCommand("setContext", HIDE_DONE_KEY, this.hideDone);
    onProjectChange(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /** Toggle showing/hiding done tasks (persisted; drives the view-title icon). */
  setHideDone(hide: boolean): void {
    this.hideDone = hide;
    void this.ctx.globalState.update(HIDE_DONE_KEY, hide);
    void vscode.commands.executeCommand("setContext", HIDE_DONE_KEY, hide);
    this.refresh();
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === "info") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon("info");
      if (node.command) item.command = { command: node.command, title: node.label };
      return item;
    }
    if (node.kind === "project") {
      const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
      item.description = "change";
      item.iconPath = new vscode.ThemeIcon("folder-active");
      item.contextValue = "builderforceProject";
      item.command = { command: "builderforce.selectProject", title: "Change Project" };
      return item;
    }
    const t = node.task;
    const item = new vscode.TreeItem(
      `${t.key ? `${t.key} ` : ""}${t.title}`,
      vscode.TreeItemCollapsibleState.None,
    );
    item.description = t.status ?? "";
    item.tooltip = t.description ?? t.title;
    item.iconPath = new vscode.ThemeIcon(iconForStatus(t.status));
    item.contextValue = "builderforceTask";
    item.command = { command: "builderforce.startTaskSession", title: "Start Session", arguments: [node] };
    return item;
  }

  async getChildren(element?: Node): Promise<Node[]> {
    if (element) return [];
    const signedIn = !!(await this.ctx.secrets.get(SECRET_KEY));
    if (!signedIn) {
      return [
        { kind: "info", label: "Sign in to your workspace", command: "builderforce.signIn" },
        { kind: "info", label: "Create a workspace…", command: "builderforce.createWorkspace" },
      ];
    }

    const project = getSelectedProject();
    if (!project) return [{ kind: "info", label: "Select or create a project…", command: "builderforce.selectProject" }];

    const nodes: Node[] = [{ kind: "project", name: project.name }];
    try {
      const tasks = await listTasks(this.ctx.secrets, project.id);
      const visible = this.hideDone ? tasks.filter((t) => !isDoneStatus(t.status)) : tasks;
      if (tasks.length === 0) nodes.push({ kind: "info", label: "No tasks in this project" });
      else if (visible.length === 0) nodes.push({ kind: "info", label: "All tasks are done (hidden)" });
      else nodes.push(...visible.map((task) => ({ kind: "task" as const, task })));
    } catch (e) {
      nodes.push({ kind: "info", label: `Tasks unavailable — ${(e as Error).message}`, command: "builderforce.diagnose" });
    }
    return nodes;
  }
}

function iconForStatus(status?: string): string {
  switch (status) {
    case "done":
      return "pass-filled";
    case "in_progress":
      return "loading~spin";
    case "in_review":
      return "git-pull-request";
    case "blocked":
      return "error";
    default:
      return "circle-outline";
  }
}
