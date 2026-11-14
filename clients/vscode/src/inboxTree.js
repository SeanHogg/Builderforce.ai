import * as vscode from "vscode";
import { listHumanRequests } from "./bfApi";
import { SECRET_KEY } from "./gateway";
import { getSelectedProject, onProjectChange } from "./projectState";
import { getProjectNames, projectLabel } from "./projectNames";
/** The always-present Brain entry points, in priority order. Static: no fetch. */
export class InboxQuickActionsProvider {
    getTreeItem(node) {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon(node.icon);
        item.tooltip = node.tooltip;
        item.command = { command: node.command, title: node.label };
        item.contextValue = "builderforceInboxAction";
        return item;
    }
    getChildren(element) {
        if (element)
            return [];
        return [
            { label: vscode.l10n.t("Review pull requests"), tooltip: vscode.l10n.t("List your open PRs and their CI status, and triage them"), icon: "git-pull-request", command: "builderforce.reviewPullRequests" },
            { label: vscode.l10n.t("Fix production errors"), tooltip: vscode.l10n.t("See your unresolved runtime errors and fix the top one"), icon: "bug", command: "builderforce.fixErrors" },
            { label: vscode.l10n.t("Open a pull request"), tooltip: vscode.l10n.t("Review your changes, commit on a branch, and open a PR"), icon: "git-commit", command: "builderforce.openPullRequest" },
        ];
    }
}
export class InboxTreeProvider {
    secrets;
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    cache;
    static TTL = 5_000;
    // Set during getChildren so getTreeItem knows whether to label each approval with its
    // project: unfiltered lists show the project; a project-scoped list implies it.
    filtered = false;
    projectNameById = new Map();
    _pendingCount = 0;
    /** Requests waiting on you in the current scope, as of the last load. */
    get pendingCount() {
        return this._pendingCount;
    }
    constructor(secrets) {
        this.secrets = secrets;
        // The active project scopes this list — repaint when it changes.
        onProjectChange(() => this.refresh());
    }
    /** Drop the cache and repaint (after sign-in / resolving an approval). */
    refresh() {
        this.cache = undefined;
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(node) {
        if (node.kind === "empty") {
            const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
            item.iconPath = new vscode.ThemeIcon("check");
            return item;
        }
        const a = node.approval;
        const label = a.description?.trim() || a.actionType || vscode.l10n.t("Approval request");
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.id = `approval:${a.id}`;
        const kind = a.kind === "question" ? vscode.l10n.t("question") : a.kind === "feedback" ? vscode.l10n.t("feedback") : vscode.l10n.t("approval");
        // Unfiltered (all projects): prefix the project so a mixed queue stays legible.
        const project = this.filtered ? undefined : projectLabel(this.projectNameById, a.projectId);
        item.description = project ? `${project} · ${kind}` : kind;
        item.iconPath = new vscode.ThemeIcon(a.kind === "approval" ? "shield" : "comment-unresolved");
        item.tooltip = label;
        // Resolve through the SAME review flow the command palette uses (DRY).
        item.command = {
            command: "builderforce.humanRequests",
            title: vscode.l10n.t("Review request"),
            arguments: [a.id],
        };
        item.contextValue = "builderforceApproval";
        return item;
    }
    async getChildren(element) {
        if (element)
            return [];
        if (!(await this.secrets.get(SECRET_KEY))) {
            this._pendingCount = 0;
            return [];
        }
        if (!this.cache || Date.now() - this.cache.ts >= InboxTreeProvider.TTL) {
            this.cache = { ts: Date.now(), approvals: await listHumanRequests(this.secrets, { status: "pending" }) };
        }
        const project = getSelectedProject();
        this.filtered = !!project;
        const approvals = project
            ? this.cache.approvals.filter((a) => a.projectId === project.id)
            : this.cache.approvals;
        // Unfiltered: resolve project names for the per-row labels (best-effort, cached).
        this.projectNameById = project ? new Map() : await getProjectNames(this.secrets);
        this._pendingCount = approvals.length;
        return approvals.length
            ? approvals.map((approval) => ({ kind: "approval", approval }))
            : [{ kind: "empty", label: vscode.l10n.t("Nothing needs you right now") }];
    }
}
//# sourceMappingURL=inboxTree.js.map