import * as vscode from "vscode";
import { getTenantJwt } from "./bfApi";
import { BrainWebview } from "./brainWebview";
import { getBaseUrl, SECRET_KEY } from "./gateway";
import { WebviewPanelBase, type WebviewInbound } from "./webviewShared";

/** Inbound messages unique to a project-page panel (shared cases live in the base). */
interface ProjectPageInbound extends WebviewInbound {
  action?: ProjectPageActionMsg;
}

/** The list-shaped project pages rendered natively (bundled-React webview, NO iframe —
 *  the same reliable hosting model as the Brain chat + Project 360). Add a view here +
 *  a mapper in the webview's ProjectPageScreen + a menu entry; nothing else. */
export type ProjectPageView = "backlog" | "prd" | "roadmap" | "retros" | "poker";

/** Human labels for the "Open Page…" picker, localized via vscode.l10n. */
export function projectPageChoices(): { view: ProjectPageView; label: string }[] {
  const t = vscode.l10n.t;
  return [
    { view: "backlog", label: t("Backlog") },
    { view: "prd", label: t("PRDs & Specs") },
    { view: "roadmap", label: t("Roadmap") },
    { view: "retros", label: t("Retrospectives") },
    { view: "poker", label: t("Planning Poker") },
  ];
}

/**
 * Project 360's sibling for the LIST-shaped project pages (Backlog, PRDs, …). One
 * bundled-React webview per (view, project); the React <ProjectPageScreen> fetches
 * the view's REST endpoint directly over HTTPS with the host-minted tenant token
 * (exactly as the Brain fetches `/api/brain` and Project 360 fetches `/…/360`), then
 * renders the shared <ProjectListView>. Row actions (open a task, ask the Brain) are
 * forwarded to the commands the host already owns — the panel is a thin trigger.
 */
export class ProjectPagePanel extends WebviewPanelBase<ProjectPageInbound> {
  private static readonly panels = new Map<string, ProjectPagePanel>();

  static open(ctx: vscode.ExtensionContext, view: ProjectPageView, projectId: number, projectName: string): void {
    const keyId = `${view}:${projectId}`;
    const existing = ProjectPagePanel.panels.get(keyId);
    if (existing) {
      existing.panel.reveal();
      existing.revalidate();
      return;
    }
    ProjectPagePanel.panels.set(keyId, new ProjectPagePanel(ctx, view, projectId, projectName, keyId));
  }

  private constructor(
    ctx: vscode.ExtensionContext,
    private readonly view: ProjectPageView,
    private readonly projectId: number,
    private readonly projectName: string,
    private readonly keyId: string,
  ) {
    super(ctx, {
      viewType: "builderforce.projectPage",
      title: `${titleForView(view)} — ${projectName}`,
      htmlTitle: titleForView(view),
    });
    // Re-pull when the panel regains focus — a task may have moved / a spec changed.
    this.onDidBecomeVisible(() => this.revalidate());
  }

  private revalidate(): void {
    this.post({ type: "intent", intent: { kind: "revalidate" } });
  }

  protected async onMessage(msg: ProjectPageInbound): Promise<void> {
    switch (msg.type) {
      case "ready":
        await this.sendInit();
        break;
      case "page.action":
        if (msg.action) this.runAction(msg.action);
        break;
    }
  }

  /** Delegate a row action to the command the host already owns (DRY — no duplicated
   *  session/seed handling; the panel is a thin trigger surface). */
  private runAction(action: ProjectPageActionMsg): void {
    switch (action.kind) {
      case "open-task":
        if (action.task) void vscode.commands.executeCommand("builderforce.startTaskSession", { kind: "task", task: action.task });
        break;
      case "brain":
        BrainWebview.open(this.ctx, { kind: "seed", text: action.text ?? "" });
        break;
      case "open-360":
        void vscode.commands.executeCommand("builderforce.openProject360");
        break;
    }
  }

  private async sendInit(): Promise<void> {
    const signedIn = !!(await this.ctx.secrets.get(SECRET_KEY));
    const token = signedIn ? ((await getTenantJwt(this.ctx.secrets)) ?? null) : null;
    this.post({
      type: "init",
      view: this.view,
      baseUrl: getBaseUrl(),
      token,
      signedIn,
      hasWorkspace: !!vscode.workspace.workspaceFolders?.[0],
      project: { id: this.projectId, name: this.projectName },
      tools: [],
      labels: buildProjectPageLabels(),
    });
  }

  protected onDispose(): void {
    ProjectPagePanel.panels.delete(this.keyId);
  }
}

interface ProjectPageActionMsg {
  kind: "open-task" | "brain" | "open-360";
  text?: string;
  task?: { id: number; key?: string; title: string };
}

function titleForView(view: ProjectPageView): string {
  return projectPageChoices().find((c) => c.view === view)?.label ?? "BuilderForce";
}

/**
 * Localized UI strings for the bundled <ProjectListView> + the per-view mappers.
 * The webview ships no i18n stack (next-intl is web-only), so the host translates
 * via `vscode.l10n` and forwards a `list.*` / `page.*` / `st.*` / `pr.*` bundle
 * through `init` — the SAME pattern the Brain chat + Project 360 use for labels.
 */
function buildProjectPageLabels(): Record<string, string> {
  const t = vscode.l10n.t;
  return {
    // Generic <ProjectListView>
    "list.refresh": t("Refresh"),
    "list.connecting": t("Loading…"),
    "list.loadError": t("Couldn't load this page"),
    "list.items": t("items"),
    // Per-view titles + empty hints
    "backlog.title": t("Backlog"),
    "backlog.empty": t("No tasks yet"),
    "backlog.emptyHint": t("Create tasks in this project to see them here."),
    "prd.title": t("PRDs & Specs"),
    "prd.empty": t("No specs yet"),
    "prd.emptyHint": t("Draft a PRD or spec for this project to see it here."),
    // Task statuses (Backlog groups)
    "st.in_progress": t("In progress"),
    "st.in_review": t("In review"),
    "st.todo": t("To do"),
    "st.blocked": t("Blocked"),
    "st.done": t("Done"),
    "st.backlog": t("Backlog"),
    // Spec statuses (PRD groups)
    "st.draft": t("Draft"),
    "st.ready": t("Ready"),
    "st.complete": t("Complete"),
    "st.other": t("Other"),
    // Task priorities (badges)
    "pr.urgent": t("Urgent"),
    "pr.high": t("High"),
    "pr.medium": t("Medium"),
    "pr.low": t("Low"),
    // Row actions
    "act.openTask": t("Open a working session for this task"),
    "act.workPrd": t("Work on this spec with the Brain"),
    "prd.seed": t("Let's work on the spec \"{title}\". Summarise it, then help me move it forward."),
    // Roadmap
    "roadmap.title": t("Roadmap"),
    "roadmap.empty": t("No roadmap items yet"),
    "roadmap.emptyHint": t("Add roadmap items to this project to see them here."),
    "hz.now": t("Now"),
    "hz.next": t("Next"),
    "hz.later": t("Later"),
    "roadmap.seed": t("Let's work on the roadmap item \"{title}\". Summarise it and help me plan the work to deliver it."),
    "act.workRoadmap": t("Plan this roadmap item with the Brain"),
    // Retrospectives + Planning Poker (workspace-scoped)
    "retros.title": t("Retrospectives"),
    "retros.empty": t("No retrospectives yet"),
    "retros.emptyHint": t("Start a retrospective in your workspace to see it here."),
    "retros.seed": t("Open the retrospective \"{title}\": summarise the feedback and turn the action items into tasks."),
    "act.workRetro": t("Review this retrospective with the Brain"),
    "poker.title": t("Planning Poker"),
    "poker.empty": t("No planning-poker sessions yet"),
    "poker.emptyHint": t("Start a planning-poker session in your workspace to see it here."),
    "poker.seed": t("Summarise the planning-poker session \"{title}\" and its story estimates, and flag anything unestimated."),
    "act.workPoker": t("Review this session with the Brain"),
    // Session statuses (retros/poker groups)
    "st.active": t("Active"),
    "st.closed": t("Closed"),
  };
}
