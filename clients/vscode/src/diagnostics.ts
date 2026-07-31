import * as vscode from "vscode";
import { SECRET_KEY } from "./gateway";
import { getSelectedProject, onProjectChange } from "./projectState";
import {
  listSystemAudits,
  getProjectDiagnostics,
  runAudit,
  type BfProjectDiagnostic,
} from "./bfApi";

/**
 * One row in the Diagnostics tree: a security/compliance system audit (SOC 2,
 * Architecture, Quality, Privacy & Data-Law), optionally carrying this project's
 * latest score + report. Runnable against the selected project.
 */
export interface DiagnosticRow {
  auditId: string;
  name: string;
  emoji: string;
  blurb: string;
  score: number | null;
  scoreLabel: string | null;
  headline: string;
  result?: BfProjectDiagnostic["result"];
}

/** Score band → a themed status icon so the rating reads at a glance. */
function scoreIcon(score: number | null): vscode.ThemeIcon {
  if (score == null) return new vscode.ThemeIcon("circle-large-outline");
  if (score >= 4) return new vscode.ThemeIcon("pass", new vscode.ThemeColor("charts.green"));
  if (score >= 3) return new vscode.ThemeIcon("info", new vscode.ThemeColor("charts.blue"));
  if (score >= 2) return new vscode.ThemeIcon("warning", new vscode.ThemeColor("charts.yellow"));
  return new vscode.ThemeIcon("error", new vscode.ThemeColor("charts.red"));
}

/**
 * Owns the Diagnostics sidebar: a tree of security & compliance diagnostics that
 * run against the active project's connected repos, showing each one's latest
 * rating. Scoped to the selected project (like Insights); re-fetches on project
 * change and on sign-in. Disposable.
 */
export class DiagnosticsController implements vscode.Disposable {
  private readonly treeProvider = new DiagnosticsTreeProvider();
  private readonly treeView: vscode.TreeView<DiagnosticRow>;
  private readonly projectSub: vscode.Disposable;
  private disposed = false;

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.treeView = vscode.window.createTreeView("builderforce.diagnostics", {
      treeDataProvider: this.treeProvider,
    });
    this.applyProjectScope();
    this.projectSub = onProjectChange(() => {
      this.applyProjectScope();
      void this.refresh();
    });
    void this.refresh();
  }

  private get projectId(): number | undefined {
    return getSelectedProject()?.id;
  }

  /** Reflect the active project in the Diagnostics header. */
  private applyProjectScope(): void {
    this.treeView.description = getSelectedProject()?.name;
  }

  /** Re-fetch the audit catalog + this project's scores and repaint. */
  async refresh(): Promise<void> {
    if (this.disposed) return;
    const signedIn = !!(await this.ctx.secrets.get(SECRET_KEY));
    if (!signedIn) {
      this.treeProvider.setRows([]);
      return;
    }

    const audits = await listSystemAudits(this.ctx.secrets);
    const projectId = this.projectId;
    const score = projectId != null ? await getProjectDiagnostics(this.ctx.secrets, projectId) : undefined;
    const byId = new Map((score?.diagnostics ?? []).map((d) => [d.toolId, d]));

    const rows: DiagnosticRow[] = audits.map((a) => {
      const d = byId.get(a.id);
      return {
        auditId: a.id,
        name: a.name,
        emoji: a.icon,
        blurb: a.blurb,
        score: d?.score ?? null,
        scoreLabel: d?.scoreLabel ?? null,
        headline: d?.headline ?? "",
        result: d?.result,
      };
    });
    this.treeProvider.setRows(rows);
  }

  /**
   * Run one diagnostic against the selected project. Requires a selected project;
   * surfaces the specific reason on failure (e.g. not a manager, no repo linked).
   */
  async run(row: DiagnosticRow | undefined): Promise<void> {
    if (!row) return;
    const projectId = this.projectId;
    if (projectId == null) {
      vscode.window.showWarningMessage(
        vscode.l10n.t("Select a project first — diagnostics run against a project's connected repositories."),
      );
      return;
    }
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t("Running {0}…", row.name) },
        () => runAudit(this.ctx.secrets, row.auditId, projectId),
      );
      vscode.window.showInformationMessage(
        vscode.l10n.t("{0} started. The report + any remediation ticket will appear shortly.", row.name),
      );
      // The audit records a report + files an agent ticket; re-fetch to show the
      // fresh deterministic score (the deep pass updates it again when it finishes).
      await this.refresh();
    } catch (e) {
      const msg = (e as { message?: string }).message ?? String(e);
      const friendly = /403/.test(msg)
        ? vscode.l10n.t("You need a manager role to run diagnostics.")
        : /400|no repo/i.test(msg)
          ? vscode.l10n.t("This project has no connected repository to scan.")
          : msg;
      vscode.window.showErrorMessage(`BuilderForce: ${friendly}`);
    }
  }

  /** Open a readable Markdown report for a diagnostic's latest run. */
  async openReport(row: DiagnosticRow | undefined): Promise<void> {
    if (!row) return;
    if (!row.result) {
      vscode.window.showInformationMessage(
        vscode.l10n.t("{0} hasn't been run against this project yet. Run it to generate a report.", row.name),
      );
      return;
    }
    const r = row.result;
    const lines: string[] = [`# ${row.emoji} ${row.name}`, "", `**${r.headline}**`, ""];
    if (r.summary) lines.push(r.summary, "");
    if (r.metrics?.length) {
      lines.push("## Breakdown", "", "| Check | Result |", "| --- | --- |");
      for (const m of r.metrics) lines.push(`| ${m.label} | ${m.value}${m.hint ? ` — ${m.hint}` : ""} |`);
      lines.push("");
    }
    if (r.recommendations?.length) {
      lines.push("## What to close next", "");
      for (const rec of r.recommendations) lines.push(`### ${rec.title}`, "", rec.detail, "");
    }
    const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: lines.join("\n") });
    await vscode.window.showTextDocument(doc, { preview: true });
    // Best-effort: render it as a preview rather than raw source.
    void vscode.commands.executeCommand("markdown.showPreview", doc.uri).then(undefined, () => {});
  }

  dispose(): void {
    this.disposed = true;
    this.projectSub.dispose();
    this.treeView.dispose();
  }
}

/** Tree view rendering the diagnostics as flat rows, or a sign-in welcome. */
class DiagnosticsTreeProvider implements vscode.TreeDataProvider<DiagnosticRow> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private rows: DiagnosticRow[] = [];

  setRows(rows: DiagnosticRow[]): void {
    this.rows = rows;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(row: DiagnosticRow): vscode.TreeItem {
    const item = new vscode.TreeItem(`${row.emoji} ${row.name}`, vscode.TreeItemCollapsibleState.None);
    item.description =
      row.score != null ? `${row.score.toFixed(1)}/5${row.scoreLabel ? ` — ${row.scoreLabel}` : ""}` : "Not run";
    const tip = new vscode.MarkdownString(undefined, true);
    tip.appendMarkdown(`**${row.name}**\n\n${row.blurb}`);
    if (row.headline) tip.appendMarkdown(`\n\n_${row.headline}_`);
    item.tooltip = tip;
    item.iconPath = scoreIcon(row.score);
    item.contextValue = "builderforceDiagnostic";
    // Primary click opens the report when there is one.
    item.command = {
      command: "builderforce.openDiagnosticReport",
      title: "Open Diagnostic Report",
      arguments: [row],
    };
    return item;
  }

  getChildren(): DiagnosticRow[] {
    return this.rows;
  }
}
