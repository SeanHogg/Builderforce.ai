import * as vscode from "vscode";
import { getCurrentWorkspace } from "./bfApi";
import { SECRET_KEY } from "./gateway";
import { getSelectedProject, onProjectChange } from "./projectState";
/**
 * The working context the Work view is scoped to: the workspace (tenant) and the
 * project. Two rows, each switching its own scope. Sessions and Tasks below them,
 * and every other panel, key off the same selection.
 */
export class ProjectContextTreeProvider {
    secrets;
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    _workspaceName;
    constructor(secrets) {
        this.secrets = secrets;
        onProjectChange(() => this.refresh());
    }
    /** The active workspace's name, as of the last load (undefined until resolved). */
    get workspaceName() {
        return this._workspaceName;
    }
    /** Re-resolve the workspace name and repaint (after a switch or a platform write). */
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(node) {
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
    async getChildren(element) {
        if (element || !(await this.secrets.get(SECRET_KEY))) {
            if (!element)
                this._workspaceName = undefined;
            return [];
        }
        try {
            this._workspaceName = (await getCurrentWorkspace(this.secrets))?.name;
        }
        catch {
            /* name unresolved (older API) — the row still switches; label falls back */
            this._workspaceName = undefined;
        }
        return [
            { kind: "workspace", name: this._workspaceName },
            { kind: "project", name: getSelectedProject()?.name },
        ];
    }
}
//# sourceMappingURL=projectContextTree.js.map