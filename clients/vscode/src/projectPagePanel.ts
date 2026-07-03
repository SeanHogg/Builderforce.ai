import * as vscode from "vscode";
import { getTenantJwt } from "./bfApi";
import { BrainWebview } from "./brainWebview";
import { getBaseUrl, SECRET_KEY } from "./gateway";

/** The list-shaped project pages rendered natively (bundled-React webview, NO iframe —
 *  the same reliable hosting model as the Brain chat + Project 360). Add a view here +
 *  a mapper in the webview's ProjectPageScreen + a menu entry; nothing else. */
export type ProjectPageView = "backlog" | "prd";

/** Human labels for the "Open Page…" picker, localized via vscode.l10n. */
export function projectPageChoices(): { view: ProjectPageView; label: string }[] {
  const t = vscode.l10n.t;
  return [
    { view: "backlog", label: t("Backlog") },
    { view: "prd", label: t("PRDs & Specs") },
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
export class ProjectPagePanel {
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

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly view: ProjectPageView,
    private readonly projectId: number,
    private readonly projectName: string,
    private readonly keyId: string,
  ) {
    const title = `${titleForView(view)} — ${projectName}`;
    this.panel = vscode.window.createWebviewPanel(
      "builderforce.projectPage",
      title,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, "media")],
      },
    );
    this.panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, "media", "icon.png");
    this.panel.webview.html = this.html(this.panel.webview);
    this.panel.webview.onDidReceiveMessage((m) => void this.onMessage(m), undefined, this.disposables);
    // Re-pull when the panel regains focus — a task may have moved / a spec changed.
    this.panel.onDidChangeViewState((e) => { if (e.webviewPanel.visible) this.revalidate(); }, undefined, this.disposables);
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  private revalidate(): void {
    void this.panel.webview.postMessage({ type: "intent", intent: { kind: "revalidate" } });
  }

  private async onMessage(msg: { type?: string; id?: string; action?: ProjectPageActionMsg }): Promise<void> {
    switch (msg.type) {
      case "ready":
        await this.sendInit();
        break;
      case "token.refresh": {
        const token = (await getTenantJwt(this.ctx.secrets)) ?? null;
        if (msg.id) void this.panel.webview.postMessage({ type: "response", id: msg.id, ok: true, result: { token } });
        break;
      }
      case "signin":
        void vscode.commands.executeCommand("builderforce.signIn");
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
    void this.panel.webview.postMessage({
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

  private dispose(): void {
    ProjectPagePanel.panels.delete(this.keyId);
    for (const d of this.disposables) {
      try {
        d.dispose();
      } catch {
        /* noop */
      }
    }
  }

  private html(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const asset = (f: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "webview", f));
    let apiOrigin = "https://api.builderforce.ai";
    try {
      apiOrigin = new URL(getBaseUrl()).origin;
    } catch {
      /* keep default */
    }
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data: blob:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource} data:`,
      `connect-src ${apiOrigin} https:`,
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="${asset("index.css")}" />
<title>${titleForView(this.view)}</title>
</head>
<body>
<div id="root"></div>
<script type="module" nonce="${nonce}" src="${asset("index.js")}"></script>
</body>
</html>`;
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
  };
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
