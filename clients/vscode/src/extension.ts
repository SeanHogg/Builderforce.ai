import * as os from "os";
import * as vscode from "vscode";
import { BuilderForceAuthProvider } from "./auth";
import * as bfApi from "./bfApi";
import { BoardPanel } from "./boardPanel";
import { BrainWebview } from "./brainWebview";
import { EmbedPanel } from "./embedPanel";
import { registerChatParticipant } from "./chatParticipant";
import { registerChatSessions } from "./chatSessions";
import { scanCodebase } from "./codebaseScan";
import { getModels, getWebBaseUrl, SECRET_KEY } from "./gateway";
import { InsightsController } from "./insights";
import { clearPlatformToolsCache } from "./platformTools";
import { setGroundingSummary } from "./grounding";
import { setSelectedModel } from "./modelState";
import { getSelectedProject, initProjectState, onProjectChange, setSelectedProject } from "./projectState";
import { ProjectsTreeProvider } from "./projectsTree";
import { SessionsTreeProvider } from "./sessionsTree";
import { InboxTreeProvider } from "./inboxTree";

/** Pull a numeric Brain chat id out of a Sessions tree item or a raw id argument. */
function chatIdOf(item: bfApi.BfBrainChat | number | string | undefined): number | undefined {
  if (item == null) return undefined;
  if (typeof item === "number") return item;
  if (typeof item === "string") return Number(item) || undefined;
  return typeof item.id === "number" ? item.id : undefined;
}

type TaskNode = { kind: "task"; task: bfApi.BfTask };

/** Persisted (per-machine) id of the workspace the editor is acting as. */
const SELECTED_TENANT_KEY = "builderforce.selectedTenantId";

/** The Project & Tasks tree view — held so its header can show the active workspace.
 *  Typed to just what we use (description + disposal) to avoid TreeView<T> variance. */
let projectView: (vscode.Disposable & { description?: string }) | undefined;

/** Live builder-insights surface (status bar + tree); restarted on auth change. */
let insights: InsightsController | undefined;

/** Show the active workspace (tenant) name next to the Project & Tasks view title. */
async function refreshWorkspaceHeader(context: vscode.ExtensionContext): Promise<void> {
  if (!projectView) return;
  if (!(await context.secrets.get(SECRET_KEY))) {
    projectView.description = undefined;
    return;
  }
  try {
    const ws = await bfApi.getCurrentWorkspace(context.secrets);
    projectView.description = ws?.name;
  } catch {
    projectView.description = undefined;
  }
}

/** Embeddable BuilderForce web views opened inside VS Code (reuse the real pages, DRY). */
// Only views the framed `/embed/<view>` surface actually renders are listed here —
// `sprints` and `velocity` have no wired surface (they fell through to a null
// render, i.e. a blank panel), so they are intentionally omitted until built.
const EMBED_VIEWS: { label: string; view: string }[] = [
  { label: "Board (Kanban)", view: "kanban" },
  { label: "Backlog", view: "backlog" },
  { label: "Roadmap", view: "roadmap" },
  { label: "Retrospectives", view: "retros" },
  { label: "Planning Poker", view: "poker" },
  { label: "PRDs & Specs", view: "prd" },
  { label: "Ideas", view: "ideas" },
  { label: "Feature ROI", view: "feature-roi" },
];

function projectHash(): string | undefined {
  const p = getSelectedProject();
  return p ? `projectId=${p.id}` : undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  initProjectState(context.workspaceState);
  const tree = new SessionsTreeProvider(context.secrets);
  const projects = new ProjectsTreeProvider(context);
  const inbox = new InboxTreeProvider(context.secrets);

  // The Brain panel is the ONE chat surface — keep the sidebars live as it writes:
  // a new/renamed conversation refreshes the Sessions list; a platform-catalog write
  // (task/project/OKR) refreshes Project & Tasks.
  BrainWebview.configure({
    onChatsChanged: () => tree.refresh(),
    onPlatformWrite: () => {
      bfApi.invalidateTasks();
      projects.refresh();
      void refreshWorkspaceHeader(context);
    },
  });
  projectView = vscode.window.createTreeView("builderforce.project", { treeDataProvider: projects });
  context.subscriptions.push(projectView);
  // Restore the workspace the editor was last acting as (re-scopes the tenant JWT).
  const savedTenant = context.globalState.get<number>(SELECTED_TENANT_KEY);
  if (typeof savedTenant === "number") bfApi.setSelectedWorkspace(savedTenant);
  void refreshWorkspaceHeader(context);
  const auth = BuilderForceAuthProvider.register(context);
  const output = vscode.window.createOutputChannel("BuilderForce");
  context.subscriptions.push(output);

  // Native Chat participant (@builderforce) + dedicated session tab (proposed API,
  // feature-detected — no-ops unless launched with --enable-proposed-api).
  const participant = registerChatParticipant(context);
  const sessions = registerChatSessions(context, participant);
  if (sessions) context.subscriptions.push(sessions);

  // Live builder-insights surface — status bar + tree fed by the gateway SSE
  // stream. Self-starts; auto-reconnects; hides itself when signed out.
  insights = new InsightsController(context);
  context.subscriptions.push(insights);

  context.subscriptions.push(
    participant,
    vscode.window.registerTreeDataProvider("builderforce.sessions", tree),
    vscode.window.registerTreeDataProvider("builderforce.inbox", inbox),
    vscode.commands.registerCommand("builderforce.refreshInbox", () => inbox.refresh()),
    // Work Inbox entry points — each hands the unified Brain a job to do with its
    // shared platform + git tools (one Brain, one tool catalog; no bespoke dashboards).
    vscode.commands.registerCommand("builderforce.reviewPullRequests", () =>
      BrainWebview.open(context, {
        kind: "seed",
        text: vscode.l10n.t("Review my open pull requests: use repos.list_pull_requests to list them, summarize each PR's status and any failing CI checks, and flag anything stale or blocked so I can triage."),
      }),
    ),
    vscode.commands.registerCommand("builderforce.fixErrors", () =>
      BrainWebview.open(context, {
        kind: "seed",
        text: vscode.l10n.t("Show my unresolved production errors using quality.list_error_groups (most impactful first). For the top one, get its details with quality.get_error_group, then search_code/read_file the culprit and propose a fix."),
      }),
    ),
    vscode.commands.registerCommand("builderforce.openPullRequest", () =>
      BrainWebview.open(context, {
        kind: "seed",
        text: vscode.l10n.t("Review my current changes with git_status and git_diff, then commit them on a new branch, push, and open a pull request. Confirm the branch name and PR title with me first."),
      }),
    ),
    // Review the agent's working-tree changes as one diff before committing — VS Code's
    // native Source Control view already renders the multi-file diff, so reuse it.
    vscode.commands.registerCommand("builderforce.reviewChanges", async () => {
      await vscode.commands.executeCommand("workbench.view.scm").then(undefined, () => undefined);
      await vscode.commands.executeCommand("workbench.scm.focus").then(undefined, () => undefined);
    }),
    vscode.commands.registerCommand("builderforce.refreshInsights", () => insights?.refresh()),
    // Internal: repaint the server-backed Sessions list (after auth / chat writes).
    vscode.commands.registerCommand("builderforce.refreshSessions", () => tree.refresh()),
    vscode.commands.registerCommand("builderforce.newSession", () =>
      BrainWebview.open(context, { kind: "new" }),
    ),
    vscode.commands.registerCommand("builderforce.openSession", (id: number | string) => {
      const chatId = chatIdOf(id);
      BrainWebview.open(context, chatId != null ? { kind: "focus", chatId } : { kind: "new" });
    }),
    vscode.commands.registerCommand("builderforce.selectProject", () => selectProject(context, projects)),
    vscode.commands.registerCommand("builderforce.createProject", () => createProject(context, projects)),
    vscode.commands.registerCommand("builderforce.createWorkspace", () => manageWorkspace(context, projects)),
    vscode.commands.registerCommand("builderforce.refreshProjects", () => {
      bfApi.invalidateTasks();
      projects.refresh();
      void refreshWorkspaceHeader(context);
    }),
    vscode.commands.registerCommand("builderforce.hideDoneTasks", () => projects.setHideDone(true)),
    vscode.commands.registerCommand("builderforce.showDoneTasks", () => projects.setHideDone(false)),
    vscode.commands.registerCommand("builderforce.diagnose", async () => {
      output.clear();
      output.appendLine("BuilderForce connection diagnostics");
      output.appendLine("");
      output.appendLine(await bfApi.diagnose(context.secrets));
      output.show(true);
    }),
    vscode.commands.registerCommand("builderforce.startTaskSession", (node: TaskNode) => {
      const t = node?.task;
      if (!t) return;
      // Open the unified Brain seeded for this task. The Brain has the shared platform
      // tools (tasks.get/update/…), so it can read + act on the task, not just chat.
      BrainWebview.open(context, {
        kind: "task",
        task: { id: t.id, key: t.key, title: t.title, projectId: getSelectedProject()?.id },
      });
    }),
    vscode.commands.registerCommand("builderforce.setTaskStatus", (node: TaskNode) =>
      setTaskStatus(context, projects, node?.task),
    ),
    // Dispatch a PLATFORM run for the task (its assigned AgentHost / cloud agent) —
    // distinct from the local in-editor agent loop. Surfaces the run via a task session.
    vscode.commands.registerCommand("builderforce.runTask", (node: TaskNode) =>
      runTask(context, projects, node?.task),
    ),
    // Review the tenant's pending human-in-the-loop approvals and resolve them.
    vscode.commands.registerCommand("builderforce.humanRequests", () =>
      reviewHumanRequests(context, projects),
    ),
    // The Board renders NATIVELY in a webview from bfApi data (not the embedded web
    // page) — reliable inside a VS Code webview where the /embed iframe is not.
    vscode.commands.registerCommand("builderforce.openBoard", async () => {
      let project = getSelectedProject();
      if (!project) {
        await selectProject(context, projects);
        project = getSelectedProject();
      }
      if (project) BoardPanel.open(context, project.id, project.name);
    }),
    vscode.commands.registerCommand("builderforce.openView", async () => {
      const pick = await vscode.window.showQuickPick(
        EMBED_VIEWS.map((v) => ({ label: v.label, view: v.view })),
        { title: "Open a BuilderForce page in VS Code", placeHolder: "Manage your workforce & tasks without leaving the editor" },
      );
      if (!pick) return;
      if (pick.view === "kanban") {
        void vscode.commands.executeCommand("builderforce.openBoard");
        return;
      }
      EmbedPanel.open(context, pick.view, { title: `BuilderForce: ${pick.label}`, hash: projectHash() });
    }),
    vscode.commands.registerCommand("builderforce.deleteSession", async (item: bfApi.BfBrainChat | string) => {
      const id = chatIdOf(item);
      if (id == null) return;
      try {
        await bfApi.deleteBrainChat(context.secrets, id);
        tree.refresh();
        BrainWebview.open(context, { kind: "new" });
      } catch (e) {
        vscode.window.showErrorMessage(`BuilderForce: could not delete chat (${(e as Error).message}).`);
      }
    }),
    vscode.commands.registerCommand("builderforce.renameSession", async (item: bfApi.BfBrainChat | string) => {
      const id = chatIdOf(item);
      if (id == null) return;
      const current = typeof item === "object" ? item.title : "";
      const title = await vscode.window.showInputBox({
        title: vscode.l10n.t("Rename chat"),
        prompt: vscode.l10n.t("New chat name"),
        value: current ?? "",
        ignoreFocusOut: true,
      });
      if (title === undefined) return;
      try {
        await bfApi.renameBrainChat(context.secrets, id, title.trim() || vscode.l10n.t("New chat"));
        tree.refresh();
      } catch (e) {
        vscode.window.showErrorMessage(`BuilderForce: could not rename chat (${(e as Error).message}).`);
      }
    }),
    // "Open Chat" opens the unified Brain (the improved experience).
    vscode.commands.registerCommand("builderforce.openChat", () => BrainWebview.open(context)),
    // The unified Brain — the SAME React <BrainTimeline> + brain-embedded core as
    // the web app, backed by the same server-side /api/brain conversations. This is
    // the primary, improved chat experience (timeline transcript, tool input/output,
    // images). Local file edits run in the host via the tool bridge.
    vscode.commands.registerCommand("builderforce.openBrain", () => BrainWebview.open(context)),
    // Mascot button in the editor title bar (top-right of the active pane) —
    // opens the unified Brain chat, mirroring how peer agents surface there.
    vscode.commands.registerCommand("builderforce.editorChat", () => BrainWebview.open(context)),
    vscode.commands.registerCommand("builderforce.signIn", () => signIn(context)),
    vscode.commands.registerCommand("builderforce.signOut", () => signOut(context, auth)),
    vscode.commands.registerCommand("builderforce.pickModel", () => pickModel(context)),
    vscode.commands.registerCommand("builderforce.rescanCodebase", () => maybeScan(context, true)),
    vscode.commands.registerCommand("builderforce.openSettings", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", "builderforce"),
    ),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      setGroundingSummary(undefined);
      void maybeScan(context, false);
    }),
    // Switching the active project re-pushes Brain init so an open chat's system
    // prompt (and new-chat scoping) tracks the current project without a reopen.
    onProjectChange(() => BrainWebview.refresh()),
  );

  void maybeScan(context, false);

  // Track this VS Code coder-agent connection (human-in-the-loop) via heartbeat.
  void heartbeat(context);
  const hb = setInterval(() => void heartbeat(context), 5 * 60_000);
  context.subscriptions.push({ dispose: () => clearInterval(hb) });
}

async function heartbeat(context: vscode.ExtensionContext): Promise<void> {
  if (!(await context.secrets.get(SECRET_KEY))) return;
  const version = (context.extension.packageJSON as { version?: string }).version ?? "0.0.0";
  await bfApi.connect(context.secrets, os.hostname(), version);
}

async function selectProject(
  context: vscode.ExtensionContext,
  projects: ProjectsTreeProvider,
): Promise<void> {
  if (!(await context.secrets.get(SECRET_KEY))) {
    const action = await vscode.window.showInformationMessage(
      "Sign in to your BuilderForce workspace first.",
      "Sign In",
    );
    if (action === "Sign In") void vscode.commands.executeCommand("builderforce.signIn");
    return;
  }
  let list: bfApi.BfProject[];
  try {
    list = await bfApi.listProjects(context.secrets);
  } catch (e) {
    const action = await vscode.window.showErrorMessage(
      `BuilderForce: could not load projects — ${(e as Error).message}`,
      "Diagnose",
    );
    if (action === "Diagnose") void vscode.commands.executeCommand("builderforce.diagnose");
    return;
  }
  // No projects yet → go straight to creation (the user needs one to manage tasks).
  if (!list.length) {
    await createProject(context, projects);
    return;
  }
  const CREATE = "$(add) Create new project…";
  const pick = await vscode.window.showQuickPick(
    [
      { label: CREATE, id: -1, name: "" },
      ...list.map((p) => ({ label: p.name, description: p.key ?? "", id: p.id, name: p.name })),
    ],
    { title: "Select a BuilderForce project", placeHolder: "Associate this editor with a project" },
  );
  if (!pick) return;
  if (pick.id === -1) {
    await createProject(context, projects);
    return;
  }
  setSelectedProject({ id: pick.id, name: pick.name });
  bfApi.invalidateTasks(pick.id);
  projects.refresh();
}

/** Create a project in the current workspace and select it (the onboarding step a
 *  user needs before they can manage tasks). Routes plan-limit / errors to a clear
 *  message; an upgrade is a web-app action. */
async function createProject(
  context: vscode.ExtensionContext,
  projects: ProjectsTreeProvider,
): Promise<void> {
  if (!(await context.secrets.get(SECRET_KEY))) {
    const action = await vscode.window.showInformationMessage(
      "Sign in to your BuilderForce workspace first.",
      "Sign In",
    );
    if (action === "Sign In") void vscode.commands.executeCommand("builderforce.signIn");
    return;
  }
  const name = await vscode.window.showInputBox({
    title: "Create BuilderForce project",
    prompt: "Name your project",
    placeHolder: "e.g. Mobile App, Website Redesign",
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim() ? undefined : "A project name is required"),
  });
  if (!name?.trim()) return;
  try {
    const project = await bfApi.createProject(context.secrets, name.trim());
    setSelectedProject({ id: project.id, name: project.name });
    bfApi.invalidateTasks(project.id);
    projects.refresh();
    vscode.window.showInformationMessage(`BuilderForce: created project “${project.name}”.`);
  } catch (e) {
    const message = (e as Error).message;
    // 402 = plan project limit reached → upgrading is a web-app action.
    if (/HTTP 402/.test(message)) {
      const action = await vscode.window.showErrorMessage(
        "BuilderForce: your plan's project limit is reached. Upgrade your workspace to add more.",
        "Open BuilderForce",
      );
      if (action) void vscode.env.openExternal(vscode.Uri.parse(`${getWebBaseUrl()}/settings`));
      return;
    }
    vscode.window.showErrorMessage(`BuilderForce: could not create project (${message}).`);
  }
}

/**
 * In-editor workspace (tenant) picker: list the user's workspaces, switch between them,
 * or create one — all via the userId-scoped /api/vscode/tenants endpoints. Degrades to
 * the web onboarding deep-link if those aren't deployed yet (older API).
 */
async function manageWorkspace(
  context: vscode.ExtensionContext,
  projects: ProjectsTreeProvider,
): Promise<void> {
  if (!(await context.secrets.get(SECRET_KEY))) {
    const action = await vscode.window.showInformationMessage(
      "Sign in first, or create a workspace on the web.",
      "Sign In",
      "Open BuilderForce",
    );
    if (action === "Sign In") void vscode.commands.executeCommand("builderforce.signIn");
    else if (action === "Open BuilderForce") void openWorkspaceWeb();
    return;
  }

  let workspaces: bfApi.BfWorkspace[];
  try {
    workspaces = await bfApi.listWorkspaces(context.secrets);
  } catch {
    // Endpoint not deployed / unreachable → fall back to the web onboarding.
    void openWorkspaceWeb();
    return;
  }

  const current = context.globalState.get<number>(SELECTED_TENANT_KEY);
  const CREATE = -1;
  const pick = await vscode.window.showQuickPick(
    [
      { label: "$(add) Create new workspace…", id: CREATE, description: "" },
      ...workspaces.map((w) => ({
        label: `${w.id === current ? "$(check) " : ""}${w.name}`,
        description: w.role ?? "",
        id: w.id,
      })),
    ],
    { title: "BuilderForce workspace", placeHolder: "Switch to or create a workspace" },
  );
  if (!pick) return;
  if (pick.id === CREATE) {
    await createWorkspaceFlow(context, projects);
    return;
  }
  await applyWorkspace(context, projects, pick.id);
}

/** Prompt for a name, create the workspace, and switch to it. */
async function createWorkspaceFlow(
  context: vscode.ExtensionContext,
  projects: ProjectsTreeProvider,
): Promise<void> {
  const name = await vscode.window.showInputBox({
    title: "Create BuilderForce workspace",
    prompt: "Name your workspace (organisation / team)",
    placeHolder: "e.g. Acme Inc, My Team",
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim() ? undefined : "A workspace name is required"),
  });
  if (!name?.trim()) return;
  try {
    const ws = await bfApi.createWorkspace(context.secrets, name.trim());
    await applyWorkspace(context, projects, ws.id);
    vscode.window.showInformationMessage(`BuilderForce: created workspace “${ws.name}”.`);
  } catch (e) {
    const message = (e as Error).message;
    if (/HTTP 404/.test(message)) {
      void openWorkspaceWeb();
      return;
    }
    vscode.window.showErrorMessage(`BuilderForce: could not create workspace (${message}).`);
  }
}

/** Make `tenantId` the active workspace: re-scope the token, reset project/task state
 *  (projects are per-workspace), and refresh the views. */
async function applyWorkspace(
  context: vscode.ExtensionContext,
  projects: ProjectsTreeProvider,
  tenantId: number,
): Promise<void> {
  bfApi.setSelectedWorkspace(tenantId);
  await context.globalState.update(SELECTED_TENANT_KEY, tenantId);
  bfApi.invalidateTasks();
  setSelectedProject(undefined); // projects belong to a workspace — pick one in the new one
  projects.refresh();
  void refreshWorkspaceHeader(context);
}

/** Workspace onboarding on the web (fallback when the in-editor endpoints are absent). */
function openWorkspaceWeb(): Thenable<boolean> {
  return vscode.env.openExternal(vscode.Uri.parse(`${getWebBaseUrl()}/tenants`));
}

async function setTaskStatus(
  context: vscode.ExtensionContext,
  projects: ProjectsTreeProvider,
  task?: bfApi.BfTask,
): Promise<void> {
  if (!task) return;
  const statuses = ["backlog", "todo", "ready", "in_progress", "in_review", "done", "blocked"];
  const pick = await vscode.window.showQuickPick(statuses, {
    title: `Set status for ${task.key ?? task.title}`,
    placeHolder: task.status,
  });
  if (!pick) return;
  try {
    await bfApi.updateTaskStatus(context.secrets, task.id, pick);
    bfApi.invalidateTasks(getSelectedProject()?.id);
    projects.refresh();
    vscode.window.showInformationMessage(`BuilderForce: ${task.key ?? "task"} → ${pick}`);
  } catch (e) {
    vscode.window.showErrorMessage(`BuilderForce: could not update task (${(e as Error).message}).`);
  }
}

/**
 * Dispatch a PLATFORM execution run for `task` to its assigned AgentHost / cloud agent
 * (POST /api/runtime/executions — the same path the web app uses). This is NOT the local
 * in-editor agent: it hands the task to the platform runtime. After a successful dispatch
 * we open (or reattach) the task's chat session, which polls the execution trace so the
 * user can watch the run's progress in the editor.
 *
 * Branches the three meaningful outcomes:
 *   - started      → confirm + open the task session (trace polling lives there)
 *   - awaiting_approval (202) → tell the user a human approval is now pending + offer to review
 *   - 402 plan limit → upgrade deep-link (mirrors createProject)
 */
async function runTask(
  context: vscode.ExtensionContext,
  projects: ProjectsTreeProvider,
  task?: bfApi.BfTask,
): Promise<void> {
  if (!task) return;
  if (!(await context.secrets.get(SECRET_KEY))) {
    const action = await vscode.window.showInformationMessage(
      "Sign in to your BuilderForce workspace first.",
      "Sign In",
    );
    if (action === "Sign In") void vscode.commands.executeCommand("builderforce.signIn");
    return;
  }

  const label = task.key ?? task.title;
  try {
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `BuilderForce: dispatching ${label}…` },
      () => bfApi.submitExecution(context.secrets, task.id),
    );

    if (result.awaitingApproval) {
      const reason = result.awaitingApproval.reason ?? "A manager approval is required before this run can start.";
      const action = await vscode.window.showWarningMessage(
        `BuilderForce: ${label} is awaiting approval. ${reason}`,
        "Review Approvals",
      );
      if (action === "Review Approvals") void vscode.commands.executeCommand("builderforce.humanRequests");
      return;
    }

    // Run started — refresh task state (status may have flipped to in_progress) and open
    // the unified Brain seeded for this task so the user can follow up / steer it.
    bfApi.invalidateTasks(getSelectedProject()?.id);
    projects.refresh();
    BrainWebview.open(context, {
      kind: "task",
      task: { id: task.id, key: task.key, title: task.title, projectId: getSelectedProject()?.id, dispatched: true },
    });
    vscode.window.showInformationMessage(`BuilderForce: dispatched ${label} to the platform runtime.`);
  } catch (e) {
    const message = (e as Error).message;
    if (/HTTP 402/.test(message)) {
      const action = await vscode.window.showErrorMessage(
        "BuilderForce: your plan's run limit is reached. Upgrade your workspace to dispatch more runs.",
        "Open BuilderForce",
      );
      if (action) void vscode.env.openExternal(vscode.Uri.parse(`${getWebBaseUrl()}/settings`));
      return;
    }
    if (/not_signed_in/.test(message)) {
      const action = await vscode.window.showWarningMessage("Sign in to BuilderForce first.", "Sign In");
      if (action) void vscode.commands.executeCommand("builderforce.signIn");
      return;
    }
    vscode.window.showErrorMessage(`BuilderForce: could not dispatch ${label} (${message}).`);
  }
}

/**
 * Review the tenant's pending human-in-the-loop approvals (GET /api/approvals) and
 * resolve one (PATCH /api/approvals/:id — the same endpoints the web HumanRequestsView /
 * ApprovalResolveControl use). A quick-pick lists each pending request; selecting one
 * offers Approve/Reject (for approval kinds) or an answer box (for question/feedback),
 * then refreshes the list + the task tree (an approval may have started a run).
 */
async function reviewHumanRequests(
  context: vscode.ExtensionContext,
  projects: ProjectsTreeProvider,
): Promise<void> {
  if (!(await context.secrets.get(SECRET_KEY))) {
    const action = await vscode.window.showInformationMessage(
      "Sign in to your BuilderForce workspace first.",
      "Sign In",
    );
    if (action === "Sign In") void vscode.commands.executeCommand("builderforce.signIn");
    return;
  }

  let pending: bfApi.BfApproval[];
  try {
    pending = await bfApi.listHumanRequests(context.secrets, { status: "pending" });
  } catch (e) {
    vscode.window.showErrorMessage(`BuilderForce: could not load approvals (${(e as Error).message}).`);
    return;
  }
  if (!pending.length) {
    vscode.window.showInformationMessage("BuilderForce: no pending approvals.");
    return;
  }

  const isAnswerable = (a: bfApi.BfApproval): boolean => a.kind === "question" || a.kind === "feedback";
  const pick = await vscode.window.showQuickPick(
    pending.map((a) => ({
      label: `$(${isAnswerable(a) ? "comment" : "shield"}) ${a.description?.slice(0, 70) || a.actionType || a.kind || "Approval"}`,
      description: a.kind ?? "",
      detail: a.executionId ? `execution #${a.executionId}` : a.agentHostId ? `host #${a.agentHostId}` : undefined,
      approval: a,
    })),
    { title: "BuilderForce: pending approvals", placeHolder: "Select a request to resolve" },
  );
  if (!pick) return;
  const approval = pick.approval;

  let decision: "approve" | "reject" | "answer";
  let note: string | undefined;
  if (isAnswerable(approval)) {
    const answer = await vscode.window.showInputBox({
      title: `Answer: ${approval.description?.slice(0, 80) ?? "request"}`,
      prompt: "Your answer is delivered to the run and resumes it.",
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim() ? undefined : "An answer is required"),
    });
    if (answer === undefined) return;
    decision = "answer";
    note = answer.trim();
  } else {
    const choice = await vscode.window.showQuickPick(
      [
        { label: "$(check) Approve", value: "approve" as const },
        { label: "$(x) Reject", value: "reject" as const },
      ],
      { title: approval.description?.slice(0, 80) ?? "Resolve approval", placeHolder: "Approve or reject this request" },
    );
    if (!choice) return;
    decision = choice.value;
    note = await vscode.window.showInputBox({
      title: `${decision === "approve" ? "Approve" : "Reject"} — optional note`,
      prompt: "Optional review note (press Enter to skip)",
      ignoreFocusOut: true,
    });
    if (note === undefined) return; // cancelled
    note = note.trim() || undefined;
  }

  try {
    const updated = await bfApi.resolveHumanRequest(context.secrets, approval.id, decision, note);
    // An approval may have auto-started a run — refresh the board/task tree to reflect it.
    bfApi.invalidateTasks(getSelectedProject()?.id);
    projects.refresh();
    void vscode.commands.executeCommand("builderforce.refreshInbox");
    const verb = decision === "answer" ? "answered" : decision === "approve" ? "approved" : "rejected";
    const started = updated.startedExecutionId ? ` Run #${updated.startedExecutionId} started.` : "";
    vscode.window.showInformationMessage(`BuilderForce: request ${verb}.${started}`);
    // Loop back so several can be cleared in one sitting if more remain.
    const remaining = await bfApi.listHumanRequests(context.secrets, { status: "pending" });
    if (remaining.length) {
      const action = await vscode.window.showInformationMessage(
        `BuilderForce: ${remaining.length} approval(s) still pending.`,
        "Review Next",
      );
      if (action === "Review Next") void reviewHumanRequests(context, projects);
    }
  } catch (e) {
    vscode.window.showErrorMessage(`BuilderForce: could not resolve approval (${(e as Error).message}).`);
  }
}

export function deactivate(): void {
  /* no-op */
}

async function signIn(context: vscode.ExtensionContext): Promise<void> {
  try {
    await vscode.authentication.getSession(BuilderForceAuthProvider.id, ["gateway"], {
      createIfNone: true,
    });
  } catch (e) {
    const msg = (e as { message?: string }).message ?? String(e);
    if (!/cancel/i.test(msg)) vscode.window.showErrorMessage(`BuilderForce: ${msg}`);
    return;
  }
  vscode.window.showInformationMessage("BuilderForce: signed in.");
  bfApi.clearJwt();
  clearPlatformToolsCache();
  BrainWebview.refresh();
  void vscode.commands.executeCommand("builderforce.refreshSessions");
  void vscode.commands.executeCommand("builderforce.refreshInbox");
  void heartbeat(context);
  void vscode.commands.executeCommand("builderforce.refreshProjects");
  void maybeScan(context, false);
  void insights?.start();
}

async function signOut(
  context: vscode.ExtensionContext,
  auth: BuilderForceAuthProvider,
): Promise<void> {
  await auth.removeSession();
  bfApi.clearJwt();
  clearPlatformToolsCache();
  bfApi.setSelectedWorkspace(undefined);
  await context.globalState.update(SELECTED_TENANT_KEY, undefined);
  setGroundingSummary(undefined);
  setSelectedProject(undefined);
  vscode.window.showInformationMessage("BuilderForce: signed out.");
  BrainWebview.refresh();
  void vscode.commands.executeCommand("builderforce.refreshSessions");
  void vscode.commands.executeCommand("builderforce.refreshInbox");
  void vscode.commands.executeCommand("builderforce.refreshProjects");
  void insights?.start();
}

async function pickModel(context: vscode.ExtensionContext): Promise<void> {
  try {
    const models = await getModels(context.secrets, true);
    const auto = "(auto — let the gateway choose)";
    const pick = await vscode.window.showQuickPick([auto, ...models], {
      title: "Select BuilderForce model",
      placeHolder: "Pick a model for new turns",
    });
    if (pick === undefined) return;
    setSelectedModel(pick === auto ? undefined : pick);
  } catch (e) {
    const message = (e as { message?: string }).message ?? String(e);
    if (message.includes("not_signed_in")) {
      const action = await vscode.window.showWarningMessage("Sign in to BuilderForce first.", "Sign In");
      if (action) void vscode.commands.executeCommand("builderforce.signIn");
    } else {
      vscode.window.showErrorMessage(`BuilderForce: ${message}`);
    }
  }
}

/**
 * Run the codebase scan if a folder is open and we are signed in. Best-effort: the
 * grounding summary is cached by a version token (only re-summarizes on drift or force),
 * and any failure leaves the agent working, just ungrounded.
 */
async function maybeScan(context: vscode.ExtensionContext, force: boolean): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return;
  const key = await context.secrets.get(SECRET_KEY);
  if (!key) return;

  const model =
    vscode.workspace.getConfiguration("builderforce").get<string>("defaultModel") || undefined;

  const work = async (progress?: vscode.Progress<{ message?: string }>) => {
    progress?.report({ message: "Scanning workspace…" });
    try {
      setGroundingSummary(await scanCodebase(context.secrets, root, model, force));
    } catch (e) {
      console.error("BuilderForce codebase scan failed:", e);
    }
  };

  if (force) {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "BuilderForce: rescanning codebase" },
      work,
    );
    vscode.window.showInformationMessage("BuilderForce: codebase knowledge refreshed.");
  } else {
    await work();
  }
}
