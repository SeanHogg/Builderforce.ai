import * as vscode from "vscode";
import { BfTask, listTasks } from "./bfApi";
import { SECRET_KEY } from "./gateway";
import { getSelectedProject, onProjectChange } from "./projectState";

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

  constructor(private readonly ctx: vscode.ExtensionContext) {
    onProjectChange(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
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
    if (!signedIn) return [{ kind: "info", label: "Sign in to load projects", command: "builderforce.signIn" }];

    const project = getSelectedProject();
    if (!project) return [{ kind: "info", label: "Select a project…", command: "builderforce.selectProject" }];

    const nodes: Node[] = [{ kind: "project", name: project.name }];
    try {
      const tasks = await listTasks(this.ctx.secrets, project.id);
      if (tasks.length === 0) nodes.push({ kind: "info", label: "No tasks in this project" });
      else nodes.push(...tasks.map((task) => ({ kind: "task" as const, task })));
    } catch {
      nodes.push({ kind: "info", label: "Tasks unavailable — update the BuilderForce backend" });
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
