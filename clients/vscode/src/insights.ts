import * as vscode from "vscode";
import {
  SECRET_KEY,
  getBuilderInsights,
  streamBuilderInsights,
  type BuilderInsightsSnapshot,
} from "./gateway";
import {
  INSIGHTS_CADENCE,
  insightsMode,
  insightsStartDelay,
  nextErrorBackoff,
  type InsightsMode,
} from "./insightsCadence";
import { getSelectedProject, onProjectChange } from "./projectState";
import { NOT_SIGNED_IN } from "@seanhogg/builderforce-brain-embedded";

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
 * Owns the live Insights surface: a status-bar item + the Health view's "Spend
 * today" rows (`treeProvider`). Audience-aware (see `insightsCadence.ts`): a live
 * SSE stream only while the window is attended AND the Health view is visible,
 * slow cached reads while only the status bar shows, and nothing at all while the
 * window is unfocused or idle — refetching on return. Failures back off 15 s → 5 min.
 * Degrades gracefully when signed out and exposes a manual refresh. Disposable.
 */
export class InsightsController implements vscode.Disposable {
  private readonly statusBar: vscode.StatusBarItem;
  /** The "Spend today" rows; the Health view composes it as a section. */
  readonly treeProvider = new InsightsTreeProvider();
  private controller: AbortController | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private snapshot: BuilderInsightsSnapshot | undefined;
  private signedIn = false;
  private viewVisible = false;
  private mode: InsightsMode = "off";
  /** Bumped by every stop; async work from an older generation drops its result. */
  private generation = 0;
  private lastFrameAt = 0;
  private errorMs = 0;
  private errorUntil = 0;
  private readonly subs: vscode.Disposable[];

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBar.command = "builderforce.refreshInsights";
    this.subs = [
      // Insights key off the active project: restart against the new scope.
      // (The Health view header names the project, so the scope stays visible.)
      onProjectChange(() => void this.start()),
      // Leaving the window closes the stream; coming back reopens it (or refetches).
      vscode.window.onDidChangeWindowState(() => this.reconcile(false)),
    ];
    void this.start();
  }

  /** The project the surfaces are scoped to (undefined = whole tenant/caller). */
  private get projectId(): number | undefined {
    return getSelectedProject()?.id;
  }

  /** One-line summary for the "Spend today" header, e.g. "$4.12 · 62% of cap". */
  summary(): string | undefined {
    const s = this.snapshot;
    if (!s) return undefined;
    const cap = s.pctOfDailyCap == null ? "" : ` · ${vscode.l10n.t("{0}% of cap", Math.round(s.pctOfDailyCap))}`;
    return `${fmtUsd(s.todayCostUsd)}${cap}`;
  }

  /** The Health view's visibility — the stream runs only while it is on screen. */
  setViewVisible(visible: boolean): void {
    if (this.viewVisible === visible) return;
    this.viewVisible = visible;
    this.reconcile(false);
  }

  /** Begin (or restart) against the current sign-in + project. Safe to call repeatedly. */
  async start(): Promise<void> {
    if (this.disposed) return;
    this.stop();
    this.mode = "off";
    this.signedIn = !!(await this.ctx.secrets.get(SECRET_KEY));
    if (this.disposed) return;
    if (!this.signedIn) {
      this.showSignedOut();
      return;
    }
    this.reconcile(true);
  }

  /** Bring the transport in line with who is looking. `fresh` skips the min-gap and
   *  error waits (sign-in, project switch). */
  private reconcile(fresh: boolean): void {
    if (this.disposed) return;
    const { focused, active } = vscode.window.state;
    const next = insightsMode({ signedIn: this.signedIn, attended: focused && active, viewVisible: this.viewVisible });
    const running = !!this.controller || !!this.timer;
    if (!fresh && next === this.mode && (running || next === "off")) return;

    this.stop();
    this.mode = next;
    if (next === "off") return;
    const delay = insightsStartDelay(next, Date.now(), this.lastFrameAt, this.errorUntil, fresh);
    this.schedule(delay, () => (next === "stream" ? this.openStream() : void this.pollOnce()));
  }

  private openStream(): void {
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
      if (this.disposed || controller.signal.aborted) return;
      // The server closes a healthy stream after ~5 min — reopen if still wanted.
      this.controller = undefined;
      this.schedule(INSIGHTS_CADENCE.RECONNECT_MS, () => this.reconcile(false));
    } catch (err) {
      if (this.disposed || controller.signal.aborted) return;
      this.controller = undefined;
      this.onFailure(err, () => this.reconcile(false));
    }
  }

  /** One read of the server-cached snapshot (status-bar-only cadence). */
  private async pollOnce(): Promise<void> {
    const gen = this.generation;
    try {
      const s = await getBuilderInsights(this.ctx.secrets, this.projectId);
      if (this.disposed || gen !== this.generation) return;
      this.applySnapshot(s);
      this.schedule(INSIGHTS_CADENCE.POLL_MS, () => void this.pollOnce());
    } catch (err) {
      if (this.disposed || gen !== this.generation) return;
      this.onFailure(err, () => void this.pollOnce());
    }
  }

  /** Signed out → go quiet; anything else → widen the wait and retry. */
  private onFailure(err: unknown, retry: () => void): void {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes(NOT_SIGNED_IN)) {
      this.signedIn = false;
      this.stop();
      this.mode = "off";
      this.showSignedOut();
      return;
    }
    this.errorMs = nextErrorBackoff(this.errorMs);
    this.errorUntil = Date.now() + this.errorMs;
    this.schedule(this.errorMs, retry);
  }

  private schedule(delayMs: number, fn: () => void): void {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      fn();
    }, delayMs);
  }

  /** Manual refresh — fetch once and update the surfaces immediately. */
  async refresh(): Promise<void> {
    if (this.disposed) return;
    const signedIn = !!(await this.ctx.secrets.get(SECRET_KEY));
    if (!signedIn) {
      this.signedIn = false;
      this.stop();
      this.mode = "off";
      this.showSignedOut();
      return;
    }
    if (!this.signedIn) {
      // Signed in since we last looked — bring the transport up too.
      await this.start();
      return;
    }
    try {
      const s = await getBuilderInsights(this.ctx.secrets, this.projectId);
      this.applySnapshot(s);
    } catch {
      /* keep last-known; the transport will recover */
    }
  }

  private showSignedOut(): void {
    this.statusBar.hide();
    this.snapshot = undefined;
    this.treeProvider.setSnapshot(undefined, false);
  }

  private applySnapshot(s: BuilderInsightsSnapshot): void {
    if (this.disposed) return;
    this.snapshot = s;
    this.lastFrameAt = Date.now();
    // A good frame clears the failure ladder.
    this.errorMs = 0;
    this.errorUntil = 0;

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

  /** Tear down the stream and any pending timer; in-flight reads go stale. */
  private stop(): void {
    this.generation++;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.controller) {
      this.controller.abort();
      this.controller = undefined;
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const sub of this.subs) sub.dispose();
    this.stop();
    this.statusBar.dispose();
  }
}

/** The latest snapshot as flat rows (empty until the first frame or when signed out). */
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
      { label: vscode.l10n.t("Today tokens"), value: fmtTokens(s.todayTokens), icon: "symbol-number" },
      { label: vscode.l10n.t("Today cost"), value: fmtUsd(s.todayCostUsd), icon: "credit-card" },
      {
        label: vscode.l10n.t("% of cap"),
        value: s.pctOfDailyCap == null ? vscode.l10n.t("no cap") : `${s.pctOfDailyCap}%`,
        icon: "dashboard",
      },
      {
        label: vscode.l10n.t("Top model"),
        value: s.topModel ? s.topModel.model : "—",
        icon: "chip",
        tooltip: s.topModel ? `${s.topModel.tokens.toLocaleString()} tokens today` : undefined,
      },
      {
        label: vscode.l10n.t("Cost / merged PR"),
        value: s.costPerMergedPrUsd == null ? "—" : fmtUsd(s.costPerMergedPrUsd),
        icon: "git-merge",
      },
    ];
    if (s.tip) this.rows.push({ label: vscode.l10n.t("Tip"), value: s.tip, icon: "lightbulb" });
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(row: InsightRow): vscode.TreeItem {
    const item = new vscode.TreeItem(row.label, vscode.TreeItemCollapsibleState.None);
    item.description = row.value;
    item.iconPath = new vscode.ThemeIcon(row.icon);
    item.tooltip = row.tooltip ?? `${row.label}: ${row.value}`;
    return item;
  }

  getChildren(element?: InsightRow): InsightRow[] {
    return element ? [] : this.rows;
  }
}
