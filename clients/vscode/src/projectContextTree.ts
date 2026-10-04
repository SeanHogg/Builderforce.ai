import * as vscode from "vscode";
import { getCurrentWorkspace } from "./bfApi";
import { SECRET_KEY } from "./gateway";
import { getSelectedProject, onProjectChange } from "./projectState";

type ContextNode = { kind: "workspace"; name?: string } | { kind: "project"; name?: string };

/**
 * The working context the Work view is scoped to: the workspace (tenant) and the
 * project. Two rows, each switching its own scope. Sessions and Tasks below them,
 * and every other panel, key off the same selection.
 */
export class ProjectContextTreeProvider implements vscode.TreeDataProvider<ContextNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private _workspaceName: string | undefined;

  constructor(private readonly secrets: vscode.SecretStorage) {
    onProjectChange(() => this.refresh());
  }

  /** The active workspace's name, as of the last load (undefined until resolved). */
  get workspaceName(): string | undefined {
    return this._workspaceName;
  }

  /** Re-resolve the workspace name and repaint (after a switch or a platform write). */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(node: ContextNode): vscode.TreeItem {
    if (node.kind === "workspace") {
      const item = new vscode.TreeItem(node.name ?? vscode.l10n.t("Select workspace"), vscode.TreeItemCollapsibleState.None);
      item.description = vscode.l10n.t("switch");
      item.iconPath = new vscode.ThemeIcon("organization");
      item.contextValue = "builderforceWorkspace";
      item.tooltip = vscode.l10n.t("Switch or create a workspace");
      item.command = { command: "builderforce.createWorkspace", title: vscode.l10n.t("Switch Workspace") };
      return item;
    }
    const item = new vscode.TreeItem(node.name ?? vscode.l10n.t("Select or create a project…"), vscode.TreeItemCollapsibleState.None);
    item.description = node.name ? vscode.l10n.t("change") : undefined;
    item.iconPath = new vscode.ThemeIcon("folder-active");
    item.contextValue = "builderforceProject";
    item.command = { command: "builderforce.selectProject", title: vscode.l10n.t("Change Project") };
    return item;
  }

  async getChildren(element?: ContextNode): Promise<ContextNode[]> {
    if (element || !(await this.secrets.get(SECRET_KEY))) {
      if (!element) this._workspaceName = undefined;
      return [];
    }
    try {
      this._workspaceName = (await getCurrentWorkspace(this.secrets))?.name;
    } catch {
      /* name unresolved (older API) — the row still switches; label falls back */
      this._workspaceName = undefined;
    }
    return [
      { kind: "workspace", name: this._workspaceName },
      { kind: "project", name: getSelectedProject()?.name },
    ];
  }
}
