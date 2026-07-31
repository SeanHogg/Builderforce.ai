import * as vscode from "vscode";
import {
  SECRET_KEY,
  getBuilderInsights,
  streamBuilderInsights,
  type BuilderInsightsSnapshot,
} from "./gateway";
import { getSelectedProject, onProjectChange } from "./projectState";

/** One row in the Insights tree. */
interface InsightRow {
  label: string;
  value: string;
  icon: string;
  tooltip?: string;
}

/** Human-readable token count: 12345 → "12.3k". */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * Owns the live Insights surface: a status-bar item + a tree view, both fed by
 * the gateway SSE stream. Auto-reconnects with backoff, degrades gracefully when
 * signed out, and exposes a manual refresh. Disposable (aborts the stream +
 * disposes its UI).
 */
export class InsightsController implements vscode.Disposable {
  private readonly statusBar: vscode.StatusBarItem;
  private readonly treeProvider: InsightsTreeProvider;
  private readonly treeView: vscode.TreeView<InsightRow>;
  private controller: AbortController | undefined;
  private disposed = false;
  private snapshot: BuilderInsightsSnapshot | undefined;
  private backoffMs = 2_000;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly projectSub: vscode.Disposable;

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBar.command = "builderforce.refreshInsights";
    this.treeProvider = new InsightsTreeProvider();
    this.treeView = vscode.window.createTreeView("builderforce.insights", {
      treeDataProvider: this.treeProvider,
    });
    this.applyProjectScope();
    // Insights key off the active project: restart the stream against the new scope
    // and label the view header so it's clear the spend is for one project vs. all.
    this.projectSub = onProjectChange(() => {
      this.applyProjectScope();
      void this.start();
    });
    void this.start();
  }

  /** The project the surfaces are scoped to (undefined = whole tenant/caller). */
  private get projectId(): number | undefined {
    return getSelectedProject()?.id;
  }

  /** Reflect the active project in the Insights header. */
  private applyProjectScope(): void {
    this.treeView.description = getSelectedProject()?.name;
  }

  /** Begin (or restart) the SSE subscription. Safe to call repeatedly. */
  async start(): Promise<void> {
    if (this.disposed) return;
    this.stopStream();

    const signedIn = !!(await this.ctx.secrets.get(SECRET_KEY));
    if (!signedIn) {
      this.statusBar.hide();
      this.snapshot = undefined;
      this.treeProvider.setSnapshot(undefined, false);
      return;
    }

    const controller = new AbortController();
    this.controller = controller;
    void this.runStream(controller);
  }

  private async runStream(controller: AbortController): Promise<void> {
    try {
      await streamBuilderInsights(
        this.ctx.secrets,
        (s) => this.applySnapshot(s),
        controller.signal,
        this.projectId,
      );
      // Stream ended cleanly (server closed after ~5 min) — reconnect promptly.
      this.backoffMs = 2_000;
      this.scheduleReconnect(this.backoffMs);
    } catch (err) {
      if (this.disposed || controller.signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not_signed_in")) {
        this.statusBar.hide();
        this.treeProvider.setSnapshot(undefined, false);
        return;
      }
      // Transient error — back off and retry, capped.
      this.scheduleReconnect(this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, 60_000);
    }
  }

  private scheduleReconnect(delayMs: number): void {
    if (this.disposed) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => void this.start(), delayMs);
  }

  /** Manual refresh — fetch once and update the surfaces immediately. */
  async refresh(): Promise<void> {
    if (this.disposed) return;
    const signedIn = !!(await this.ctx.secrets.get(SECRET_KEY));
    if (!signedIn) {
      this.statusBar.hide();
      this.treeProvider.setSnapshot(undefined, false);
      return;
    }
    try {
      const s = await getBuilderInsights(this.ctx.secrets, this.projectId);
      this.applySnapshot(s);
    } catch {
      /* keep last-known; the stream will recover */
    }
  }

  private applySnapshot(s: BuilderInsightsSnapshot): void {
    if (this.disposed) return;
    this.snapshot = s;
    this.backoffMs = 2_000; // a good frame resets backoff

    const pct = s.pctOfDailyCap == null ? "" : ` · ${Math.round(s.pctOfDailyCap)}%`;
    this.statusBar.text = `$(graph) ${fmtTokens(s.todayTokens)} tok · ${fmtUsd(s.todayCostUsd)}${pct}`;
    this.statusBar.tooltip = this.buildTooltip(s);
    this.statusBar.show();

    this.treeProvider.setSnapshot(s, true);
  }

  private buildTooltip(s: BuilderInsightsSnapshot): vscode.MarkdownString {
    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown(`**BuilderForce Insights** (${s.windowLabel})\n\n`);
    md.appendMarkdown(`- Tokens: ${s.todayTokens.toLocaleString()}\n`);
    md.appendMarkdown(`- Cost: ${fmtUsd(s.todayCostUsd)}\n`);
    md.appendMarkdown(
      `- % of daily cap: ${
        s.pctOfDailyCap == null
          ? "no cap"
          : `${s.pctOfDailyCap}%${s.dailyCapTokens ? ` of ${s.dailyCapTokens.toLocaleString()}` : ""}`
      }\n`,
    );
    if (s.topModel) md.appendMarkdown(`- Top model: ${s.topModel.model} (${fmtTokens(s.topModel.tokens)} tok)\n`);
    if (s.costPerMergedPrUsd != null) md.appendMarkdown(`- Cost / merged PR: ${fmtUsd(s.costPerMergedPrUsd)}\n`);
    if (s.tip) md.appendMarkdown(`\n💡 ${s.tip}\n`);
    md.appendMarkdown(`\n_Click to refresh_`);
    return md;
  }

  private stopStream(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.controller) {
      this.controller.abort();
      this.controller = undefined;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.projectSub.dispose();
    this.stopStream();
    this.statusBar.dispose();
    this.treeView.dispose();
  }
}

/** Tree view rendering the latest snapshot as flat rows, or a sign-in welcome. */
class InsightsTreeProvider implements vscode.TreeDataProvider<InsightRow> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private rows: InsightRow[] = [];

  setSnapshot(s: BuilderInsightsSnapshot | undefined, signedIn: boolean): void {
    if (!signedIn || !s) {
      this.rows = [];
      this._onDidChangeTreeData.fire();
      return;
    }
    this.rows = [
      { label: "Today tokens", value: fmtTokens(s.todayTokens), icon: "symbol-number" },
      { label: "Today cost", value: fmtUsd(s.todayCostUsd), icon: "credit-card" },
      {
        label: "% of cap",
        value: s.pctOfDailyCap == null ? "no cap" : `${s.pctOfDailyCap}%`,
        icon: "dashboard",
      },
      {
        label: "Top model",
        value: s.topModel ? s.topModel.model : "—",
        icon: "chip",
        tooltip: s.topModel ? `${s.topModel.tokens.toLocaleString()} tokens today` : undefined,
      },
      {
        label: "Cost / merged PR",
        value: s.costPerMergedPrUsd == null ? "—" : fmtUsd(s.costPerMergedPrUsd),
        icon: "git-merge",
      },
    ];
    if (s.tip) this.rows.push({ label: "Tip", value: s.tip, icon: "lightbulb" });
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(row: InsightRow): vscode.TreeItem {
    const item = new vscode.TreeItem(row.label, vscode.TreeItemCollapsibleState.None);
    item.description = row.value;
    item.iconPath = new vscode.ThemeIcon(row.icon);
    item.tooltip = row.tooltip ?? `${row.label}: ${row.value}`;
    return item;
  }

  getChildren(): InsightRow[] {
    return this.rows;
  }
}
