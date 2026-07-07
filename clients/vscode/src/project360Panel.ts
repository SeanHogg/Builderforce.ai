import * as vscode from "vscode";
import { getTenantJwt } from "./bfApi";
import { BrainWebview } from "./brainWebview";
import { getBaseUrl, SECRET_KEY } from "./gateway";
import { WebviewPanelBase, type WebviewInbound } from "./webviewShared";

/** Inbound messages unique to the Project 360 panel (shared cases live in the base). */
interface Project360Inbound extends WebviewInbound {
  action?: Project360ActionMsg;
}

/**
 * Project 360 — the whole-picture project management view, rendered as a bundled
 * React webview (the SAME model the chat uses: the shared <Project360View> from
 * `@seanhogg/builderforce-brain-ui`, hosted in the same webview bundle). We do NOT
 * iframe the web page (that path is unreliable inside a VS Code webview); instead
 * the React screen fetches `GET /api/projects/:id/360` directly over HTTPS with the
 * host-minted tenant token, exactly as the Brain fetches `/api/brain`.
 *
 * The host owns only two privileged things over the typed postMessage bridge:
 *   - minting/refreshing the tenant token
 *   - executing the improve/workforce actions the view raises, by delegating to the
 *     commands it already has (Open Board, Human Requests, run/open a task, Brain seed)
 */
export class Project360Panel extends WebviewPanelBase<Project360Inbound> {
  private static readonly panels = new Map<number, Project360Panel>();

  static open(ctx: vscode.ExtensionContext, projectId: number, projectName: string): void {
    const existing = Project360Panel.panels.get(projectId);
    if (existing) {
      existing.panel.reveal();
      existing.revalidate();
      return;
    }
    Project360Panel.panels.set(projectId, new Project360Panel(ctx, projectId, projectName));
  }

  private constructor(
    ctx: vscode.ExtensionContext,
    private readonly projectId: number,
    private readonly projectName: string,
  ) {
    super(ctx, {
      viewType: "builderforce.project360",
      title: `Project 360 — ${projectName}`,
      htmlTitle: "Project 360",
    });
    // When the panel regains focus, nudge the screen to re-pull — a run may have
    // started or work moved, so "who's working" and the counts stay live.
    this.onDidBecomeVisible(() => this.revalidate());
  }

  private revalidate(): void {
    this.post({ type: "intent", intent: { kind: "revalidate" } });
  }

  protected async onMessage(msg: Project360Inbound): Promise<void> {
    switch (msg.type) {
      case "ready":
        await this.sendInit();
        break;
      case "p360.action":
        if (msg.action) this.runAction(msg.action);
        break;
    }
  }

  /** Delegate a view action to the command the host already owns (DRY — no duplicated
   *  dispatch/approval/plan-limit handling; the panel is a thin trigger surface). */
  private runAction(action: Project360ActionMsg): void {
    switch (action.kind) {
      case "board":
        void vscode.commands.executeCommand("builderforce.openBoard");
        break;
      case "approvals":
        void vscode.commands.executeCommand("builderforce.humanRequests");
        break;
      case "brain":
        BrainWebview.open(this.ctx, { kind: "seed", text: action.text ?? "" });
        break;
      case "run-task":
        if (action.task) void vscode.commands.executeCommand("builderforce.runTask", { kind: "task", task: action.task });
        break;
      case "open-task":
        if (action.task) void vscode.commands.executeCommand("builderforce.startTaskSession", { kind: "task", task: action.task });
        break;
    }
  }

  private async sendInit(): Promise<void> {
    const signedIn = !!(await this.ctx.secrets.get(SECRET_KEY));
    const token = signedIn ? ((await getTenantJwt(this.ctx.secrets)) ?? null) : null;
    this.post({
      type: "init",
      view: "project360",
      baseUrl: getBaseUrl(),
      token,
      signedIn,
      hasWorkspace: !!vscode.workspace.workspaceFolders?.[0],
      project: { id: this.projectId, name: this.projectName },
      tools: [],
      labels: buildProject360Labels(),
    });
  }

  protected onDispose(): void {
    Project360Panel.panels.delete(this.projectId);
  }
}

interface Project360ActionMsg {
  kind: "board" | "approvals" | "brain" | "run-task" | "open-task";
  label?: string;
  text?: string;
  task?: { id: number; key?: string; title: string; taskType?: "task" | "epic" | "gap" };
}

/**
 * Localized UI strings for the bundled <Project360View>. The webview ships no i18n
 * stack (next-intl is web-only), so the host translates via `vscode.l10n` (editor
 * display language) and forwards a `p360.*` bundle through `init` — the SAME pattern
 * the Brain chat uses for its labels.
 */
function buildProject360Labels(): Record<string, string> {
  const t = vscode.l10n.t;
  return {
    "p360.title": t("Project 360"),
    "p360.subtitle": t("The whole picture — health, gaps, and who is moving the work."),
    "p360.overall": t("Overall health"),
    "p360.progress": t("Progress"),
    "p360.refresh": t("Refresh"),
    "p360.openBoard": t("Open board"),
    "p360.improveAll": t("Improve with Brain"),
    "p360.connecting": t("Loading Project 360…"),
    "p360.loadError": t("Couldn't load Project 360"),
    "p360.noData": t("No tasks yet"),
    "p360.noDataHint": t("Add tasks to this project to see its health, gaps, and team activity."),
    "p360.missingItems": t("Missing items — improve health"),
    "p360.noGaps": t("No gaps found. This project is in good shape."),
    "p360.workforce": t("Who's working / idle"),
    "p360.noWorkforce": t("Nobody is assigned to this project yet."),
    "p360.allDimensions": t("All dimensions"),
    "p360.counts_open": t("open"),
    "p360.counts_blocked": t("blocked"),
    "p360.counts_overdue": t("overdue"),
    "p360.counts_running": t("running"),
    "p360.status_working": t("Working"),
    "p360.status_awaiting": t("Awaiting input"),
    "p360.status_blocked": t("Blocked"),
    "p360.status_idle": t("Idle"),
    "p360.status_available": t("Available"),
    "p360.member_run": t("Run"),
    "p360.member_open": t("Open"),
    "p360.improveSeedIntro": t("Here is my project's Project 360 health check. Help me work through these gaps, highest impact first."),
  };
}
