import * as vscode from "vscode";
import { listHumanRequests, type BfApproval } from "./bfApi";
import { SECRET_KEY } from "./gateway";
import { getSelectedProject, onProjectChange } from "./projectState";
import { getProjectNames, projectLabel } from "./projectNames";

/**
 * The Work Inbox (Activity Bar → BuilderForce → Inbox) — the proactive "what needs
 * you" surface that keeps the team's work in the editor instead of a dashboard. It
 * lists pending human-in-the-loop approvals (live, server-side) and the action entry
 * points that hand the unified Brain a job to do with its shared platform + git tools:
 * review pull requests + CI, fix production errors, and open a pull request. The
 * approvals are the only items NOT already shown elsewhere (the Project & Tasks tree
 * covers tasks), so this never duplicates another view.
 *
 * Like the Sessions list, the approvals key off the active project: with a project
 * selected only that project's approvals show; with none selected every approval shows,
 * each labelled with the project it belongs to (or "No project").
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

  // Set during getChildren so getTreeItem knows whether to label each approval with its
  // project: unfiltered lists show the project; a project-scoped list implies it.
  private filtered = false;
  private projectNameById = new Map<number, string>();

  constructor(private readonly secrets: vscode.SecretStorage) {
    // The active project scopes this list — repaint when it changes.
    onProjectChange(() => this.refresh());
  }

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

  async getChildren(): Promise<InboxNode[]> {
    if (!(await this.secrets.get(SECRET_KEY))) return [];
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

    const top: InboxNode[] = approvals.length
      ? approvals.map((approval) => ({ kind: "approval" as const, approval }))
      : [{ kind: "empty" as const, label: vscode.l10n.t("Nothing needs you right now") }];
    return [...top, ...this.actions()];
  }
}
