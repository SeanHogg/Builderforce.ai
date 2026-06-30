import * as vscode from "vscode";
import { listHumanRequests, type BfApproval } from "./bfApi";
import { SECRET_KEY } from "./gateway";

/**
 * The Work Inbox (Activity Bar → BuilderForce → Inbox) — the proactive "what needs
 * you" surface that keeps the team's work in the editor instead of a dashboard. It
 * lists pending human-in-the-loop approvals (live, server-side) and the action entry
 * points that hand the unified Brain a job to do with its shared platform + git tools:
 * review pull requests + CI, fix production errors, and open a pull request. The
 * approvals are the only items NOT already shown elsewhere (the Project & Tasks tree
 * covers tasks), so this never duplicates another view.
 */

type InboxNode =
  | { kind: "approval"; approval: BfApproval }
  | { kind: "action"; label: string; tooltip: string; icon: string; command: string }
  | { kind: "empty"; label: string };

export class InboxTreeProvider implements vscode.TreeDataProvider<InboxNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private cache: { ts: number; approvals: BfApproval[] } | undefined;
  private static readonly TTL = 5_000;

  constructor(private readonly secrets: vscode.SecretStorage) {}

  /** Drop the cache and repaint (after sign-in / resolving an approval). */
  refresh(): void {
    this.cache = undefined;
    this._onDidChangeTreeData.fire();
  }

  /** The always-present action entry points, in priority order. */
  private actions(): InboxNode[] {
    return [
      { kind: "action", label: vscode.l10n.t("Review pull requests"), tooltip: vscode.l10n.t("List your open PRs and their CI status, and triage them"), icon: "git-pull-request", command: "builderforce.reviewPullRequests" },
      { kind: "action", label: vscode.l10n.t("Fix production errors"), tooltip: vscode.l10n.t("See your unresolved runtime errors and fix the top one"), icon: "bug", command: "builderforce.fixErrors" },
      { kind: "action", label: vscode.l10n.t("Open a pull request"), tooltip: vscode.l10n.t("Review your changes, commit on a branch, and open a PR"), icon: "git-commit", command: "builderforce.openPullRequest" },
    ];
  }

  getTreeItem(node: InboxNode): vscode.TreeItem {
    if (node.kind === "empty") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon("check");
      return item;
    }
    if (node.kind === "action") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon(node.icon);
      item.tooltip = node.tooltip;
      item.command = { command: node.command, title: node.label };
      item.contextValue = "builderforceInboxAction";
      return item;
    }
    const a = node.approval;
    const label = a.description?.trim() || a.actionType || vscode.l10n.t("Approval request");
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.id = `approval:${a.id}`;
    item.description = a.kind === "question" ? vscode.l10n.t("question") : a.kind === "feedback" ? vscode.l10n.t("feedback") : vscode.l10n.t("approval");
    item.iconPath = new vscode.ThemeIcon(a.kind === "approval" ? "shield" : "comment-unresolved");
    item.tooltip = label;
    // Resolve through the SAME review flow the command palette uses (DRY).
    item.command = { command: "builderforce.humanRequests", title: vscode.l10n.t("Review request") };
    item.contextValue = "builderforceApproval";
    return item;
  }

  async getChildren(): Promise<InboxNode[]> {
    if (!(await this.secrets.get(SECRET_KEY))) return [];
    if (!this.cache || Date.now() - this.cache.ts >= InboxTreeProvider.TTL) {
      this.cache = { ts: Date.now(), approvals: await listHumanRequests(this.secrets, { status: "pending" }) };
    }
    const approvals = this.cache.approvals;
    const top: InboxNode[] = approvals.length
      ? approvals.map((approval) => ({ kind: "approval" as const, approval }))
      : [{ kind: "empty" as const, label: vscode.l10n.t("Nothing needs you right now") }];
    return [...top, ...this.actions()];
  }
}
