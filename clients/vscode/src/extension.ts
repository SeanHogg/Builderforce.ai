import * as os from "os";
import * as vscode from "vscode";
import { BuilderForceAuthProvider } from "./auth";
import * as bfApi from "./bfApi";
import { initActivity, trackVsix } from "./activity";
import { BoardPanel } from "./boardPanel";
import { BrainWebview } from "./brainWebview";
import { Project360Panel } from "./project360Panel";
import { ProjectPagePanel, projectPageChoices } from "./projectPagePanel";
import { registerChatParticipant } from "./chatParticipant";
import { registerChatSessions } from "./chatSessions";
import { scanCodebase } from "./codebaseScan";
import { getModels, getWebBaseUrl, SECRET_KEY, clearPersonalityBlockCache } from "./gateway";
import { InsightsController } from "./insights";
import { EvermindViewProvider } from "./evermindView";
import { DiagnosticsController } from "./diagnostics";
import { clearPlatformToolsCache } from "./platformTools";
import { setGroundingSummary } from "./grounding";
import { onModelChange, setSelectedModel } from "./modelState";
import { getSelectedProject, initProjectState, onProjectChange, setSelectedProject } from "./projectState";
import { invalidateProjectNames } from "./projectNames";
import { ProjectsTreeProvider } from "./projectsTree";
import { SessionsTreeProvider } from "./sessionsTree";
import { InboxTreeProvider } from "./inboxTree";
import { AttentionPoller, setLocalChatRuns, onLocalRunsChange, managerAttention } from "./attention";
import { appUrl } from "./auth";
import { MeetingsController, joinMeetingInBrowser, joinMeetingNative, openMeetingsWeb, type MeetingItem } from "./meetings";

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

/** The Evermind sidebar console; re-pushed init on project switch + auth change. */
let evermindView: EvermindViewProvider | undefined;

/** Security & compliance Diagnostics sidebar; re-fetched on auth/project change. */
let diagnostics: DiagnosticsController | undefined;

/** Meetings sidebar (upcoming/live video calls); refreshed on auth change. */
let meetings: MeetingsController | undefined;

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

/**
 * Mirror the signed-in state into the `builderforce.signedIn` context key so the
 * sidebar can hide every feature view behind a single login panel when logged out
 * (the views' `when` clauses read this key). Signed-in truth is "has an editor key
 * in SecretStorage" — the same check every surface already makes ad hoc.
 */
async function syncSignedInContext(context: vscode.ExtensionContext): Promise<void> {
  const signedIn = !!(await context.secrets.get(SECRET_KEY));
  await vscode.commands.executeCommand("setContext", "builderforce.signedIn", signedIn);
}

export function activate(context: vscode.ExtensionContext): void {
  initProjectState(context.workspaceState);
  // Gate the sidebar on auth before anything else registers: until this resolves the
  // key is falsy, so the login (Welcome) panel shows and the feature views stay hidden.
  void syncSignedInContext(context);
  // Empty provider so the Welcome view can render its viewsWelcome sign-in panel.
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("builderforce.welcome", {
      getChildren: () => [],
      getTreeItem: () => new vscode.TreeItem(""),
    } satisfies vscode.TreeDataProvider<never>),
    // Keep the key fresh when auth changes out-of-band (e.g. the device-code flow
    // completing, or a sign-out in another window).
    vscode.authentication.onDidChangeSessions((e) => {
      if (e.provider.id === BuilderForceAuthProvider.id) void syncSignedInContext(context);
    }),
  );
  const tree = new SessionsTreeProvider(context.secrets);
  const projects = new ProjectsTreeProvider(context);
  const inbox = new InboxTreeProvider(context.secrets);

  // Cross-surface live-status poller: one fetch of `GET /api/runtime/attention`
  // feeds BOTH the Sessions and Project trees so a running / question-blocked
  // session lights up in lockstep with the web app and the board. Repaints the
  // two trees only when the surfaced state actually changes.
  const attention = new AttentionPoller(context.secrets);

  // Ambient "AI Manager" status bar item — the manager runs in the background
  // (cron + manual) across a project or the whole tenant, so a human in the editor
  // should see when it just acted without opening the web app. Rides the SAME
  // attention poll (manager cadence travels on that signal). Hidden until a manager
  // has actually run in this workspace. Clicking opens the web Manager tab.
  const OPEN_MANAGER_CMD = "builderforce.openManager";
  const managerStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  managerStatus.command = OPEN_MANAGER_CMD;
  const updateManagerStatus = () => {
    const m = managerAttention();
    if (!m.lastRunAt) { managerStatus.hide(); return; }
    const agoMs = Date.now() - new Date(m.lastRunAt).getTime();
    const ago = agoMs < 60_000 ? vscode.l10n.t("just now")
      : agoMs < 3_600_000 ? vscode.l10n.t("{0}m ago", Math.floor(agoMs / 60_000))
      : agoMs < 86_400_000 ? vscode.l10n.t("{0}h ago", Math.floor(agoMs / 3_600_000))
      : vscode.l10n.t("{0}d ago", Math.floor(agoMs / 86_400_000));
    managerStatus.text = m.recentlyActive
      ? `$(compass) ${vscode.l10n.t("Manager active")}`
      : `$(compass) ${vscode.l10n.t("Manager · {0}", ago)}`;
    managerStatus.tooltip = vscode.l10n.t("AI Manager — last managed {0}. Click to open the Manager.", ago);
    managerStatus.show();
  };

  context.subscriptions.push(
    attention,
    managerStatus,
    vscode.commands.registerCommand(OPEN_MANAGER_CMD, () =>
      vscode.env.openExternal(vscode.Uri.parse(`${appUrl()}/projects?tab=manager`))),
    attention.onDidChange(() => {
      tree.refresh(); projects.refresh(); inbox.refresh(); updateManagerStatus();
      // Per-session chat tabs show the same live status as the Sessions rows, off the
      // same map — repaint them on the same signal (no second poller).
      BrainWebview.refreshTabStatus();
    }),
    // The in-webview Brain loop reports its own running / awaiting chats (the server
    // can't see them) — repaint the Sessions tree so they light up in lockstep.
    onLocalRunsChange(() => { tree.refresh(); BrainWebview.refreshTabStatus(); }),
    // Switching the active project re-scopes the attention query.
    onProjectChange(() => attention.refresh()),
  );
  attention.start();
  updateManagerStatus();

  // The Brain panel is the ONE chat surface — keep the sidebars live as it writes:
  // a new/renamed conversation refreshes the Sessions list; a platform-catalog write
  // (task/project/OKR) refreshes Project & Tasks; either may have started/answered a
  // run, so re-poll attention immediately rather than waiting for the next tick.
  BrainWebview.configure({
    onChatsChanged: () => { tree.refresh(); attention.refresh(); },
    onPlatformWrite: () => {
      bfApi.invalidateTasks();
      projects.refresh();
      attention.refresh();
      void refreshWorkspaceHeader(context);
    },
    // Merge the webview's in-flight chat runs into the live-status map so a chat
    // that keeps executing after the user opens a new one still shows a spinner
    // (or ❓ when paused on a confirm) in the Sessions tree. Keyed by the reporting
    // panel — with per-session tabs several panels report at once.
    onLocalRunsChanged: (sourceId, runs) => setLocalChatRuns(sourceId, runs),
  });
  projectView = vscode.window.createTreeView("builderforce.project", { treeDataProvider: projects });
  context.subscriptions.push(projectView);
  // The Sessions list is scoped by the active project — surface that in its header so
  // it's obvious you're looking at one project's chats vs. every conversation.
  const sessionsView = vscode.window.createTreeView("builderforce.sessions", { treeDataProvider: tree });
  sessionsView.description = getSelectedProject()?.name;
  context.subscriptions.push(sessionsView);
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

  // Evermind sidebar console — inspect what the active project's self-learning model
  // has learned and steer its training (seed / inference / learning / teacher / teach
  // from a transcript / learn-now), from the activity-bar sidebar.
  evermindView = new EvermindViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(EvermindViewProvider.viewType, evermindView, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("builderforce.refreshEvermind", () => evermindView?.triggerRefresh()),
  );

  // Security & compliance Diagnostics — SOC 2, Architecture, Quality, and Privacy
  // & Data-Law audits run against the active project's repos, from the sidebar.
  diagnostics = new DiagnosticsController(context);
  context.subscriptions.push(
    diagnostics,
    vscode.commands.registerCommand("builderforce.refreshDiagnostics", () => diagnostics?.refresh()),
    vscode.commands.registerCommand("builderforce.runDiagnostic", (row) => diagnostics?.run(row)),
    vscode.commands.registerCommand("builderforce.openDiagnosticReport", (row) => diagnostics?.openReport(row)),
  );

  // Meetings sidebar — upcoming/live video calls for the workspace. Join in the
  // browser (reliable camera) or natively in a VS Code webview.
  meetings = new MeetingsController(context);
  context.subscriptions.push(
    meetings,
    vscode.commands.registerCommand("builderforce.refreshMeetings", () => meetings?.refresh()),
    vscode.commands.registerCommand("builderforce.joinMeetingBrowser", (item: MeetingItem) => joinMeetingInBrowser(item)),
    vscode.commands.registerCommand("builderforce.joinMeetingNative", (item: MeetingItem) => joinMeetingNative(context, item)),
    vscode.commands.registerCommand("builderforce.scheduleMeeting", () => openMeetingsWeb()),
  );

  // Editor activity capture — heartbeats + file-open navigation feed the billable
  // timecard pipeline (source 'vscode'). Best-effort; no-op when signed out.
  context.subscriptions.push(initActivity(context.secrets));

  context.subscriptions.push(
    participant,
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
    // Project & Tasks view arrangement: Flat ⇄ Hierarchy (epic → child tasks),
    // plus group-by / sort / status-filter quick-picks.
    vscode.commands.registerCommand("builderforce.projectViewHierarchy", () => projects.setHierarchy(true)),
    vscode.commands.registerCommand("builderforce.projectViewFlat", () => projects.setHierarchy(false)),
    vscode.commands.registerCommand("builderforce.projectGroupBy", () => projects.pickGroupBy()),
    vscode.commands.registerCommand("builderforce.projectSortBy", () => projects.pickSortBy()),
    vscode.commands.registerCommand("builderforce.projectFilterStatus", () => projects.pickStatusFilter()),
    // "Needs attention" filter (blocked / overdue / stale) — paired on/off so the
    // toolbar icon reflects the active state, like hide-done and Flat⇄Hierarchy.
    vscode.commands.registerCommand("builderforce.projectFilterAttentionOn", () => projects.setNeedsAttention(true)),
    vscode.commands.registerCommand("builderforce.projectFilterAttentionOff", () => projects.setNeedsAttention(false)),
    // "Assigned to me" filter — paired on/off like the others.
    vscode.commands.registerCommand("builderforce.projectFilterMineOn", () => projects.setAssignedToMe(true)),
    vscode.commands.registerCommand("builderforce.projectFilterMineOff", () => projects.setAssignedToMe(false)),
    // Change a work-item's type from the tree: task⇄epic, or promote an epic to an OKR.
    vscode.commands.registerCommand("builderforce.convertTaskType", (node: TaskNode) =>
      convertTaskType(context, projects, node?.task),
    ),
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
      // Auto-link the work item so the chat is tied to it (epics/gaps use their own
      // ticket kind; everything else is a plain task).
      const projectId = getSelectedProject()?.id;
      const ticketKind = t.taskType === "epic" ? "epic" : t.taskType === "gap" ? "gap" : "task";
      BrainWebview.open(context, {
        kind: "task",
        task: { id: t.id, key: t.key, title: t.title, taskType: t.taskType, projectId },
        ticket: { kind: ticketKind, ref: String(t.id), title: t.title, projectId },
      });
    }),
    vscode.commands.registerCommand("builderforce.setTaskStatus", (node: TaskNode) =>
      setTaskStatus(context, projects, node?.task),
    ),
    // Dispatch a PLATFORM run for the task (its assigned AgentHost / cloud agent) —
    // distinct from the local in-editor agent loop. Surfaces the run via a task session.
    vscode.commands.registerCommand("builderforce.runTask", (node: TaskNode) => {
      // Audited engagement signal: dispatching a run is billable activity.
      trackVsix("agent_run", { ref: node?.task ? `task:${node.task.id}` : undefined, weight: 2 });
      return runTask(context, projects, node?.task);
    }),
    // Log a meeting as PAID time (it's the worker's time) — prompts for minutes.
    vscode.commands.registerCommand("builderforce.logMeeting", async () => {
      const mins = await vscode.window.showInputBox({ prompt: "Meeting length in minutes", validateInput: (v) => (Number(v) > 0 ? null : "Enter a positive number") });
      if (!mins) return;
      const note = await vscode.window.showInputBox({ prompt: "Meeting note (optional)" });
      trackVsix("meeting", { durationSeconds: Math.round(Number(mins) * 60), ref: "meeting", metadata: note ? { note } : undefined });
      void vscode.window.showInformationMessage(`Logged a ${mins}-minute meeting as paid time.`);
    }),
    // Review the tenant's pending human-in-the-loop approvals and resolve them.
    vscode.commands.registerCommand("builderforce.humanRequests", (approvalId?: string) =>
      reviewHumanRequests(context, projects, approvalId),
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
    // Project 360 — the whole-picture management view (health wheel, missing items,
    // who's working / idle). Renders NATIVELY as a bundled React webview (the shared
    // <Project360View>, same hosting model as the Brain chat), fed by /api/projects/:id/360.
    vscode.commands.registerCommand("builderforce.openProject360", async () => {
      let project = getSelectedProject();
      if (!project) {
        await selectProject(context, projects);
        project = getSelectedProject();
      }
      if (project) Project360Panel.open(context, project.id, project.name);
    }),
    // Open a list-shaped project page (Backlog, PRDs, …) — NATIVE bundled-React
    // webview screens (shared <ProjectListView>, same hosting model as the chat +
    // Project 360), each fed by its own REST endpoint. Replaces the retired /embed
    // "Open Page…" iframe picker, which never ran in the webview.
    vscode.commands.registerCommand("builderforce.openPage", async () => {
      const pick = await vscode.window.showQuickPick(
        projectPageChoices().map((c) => ({ label: c.label, view: c.view })),
        { title: vscode.l10n.t("Open a BuilderForce page"), placeHolder: vscode.l10n.t("Manage your project without leaving the editor") },
      );
      if (!pick) return;
      let project = getSelectedProject();
      if (!project) {
        await selectProject(context, projects);
        project = getSelectedProject();
      }
      if (project) ProjectPagePanel.open(context, pick.view, project.id, project.name);
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
    // prompt (and new-chat scoping) tracks the current project without a reopen, and
    // re-labels the Sessions header to show which project's chats are in view.
    onProjectChange(() => {
      BrainWebview.refresh();
      evermindView?.refresh();
      sessionsView.description = getSelectedProject()?.name;
    }),
    // A manual model pick re-pushes Brain init so an open chat switches immediately
    // (parity with project change; the native participant re-resolves per turn).
    onModelChange(() => BrainWebview.refresh()),
  );

  void maybeScan(context, false);

  // Track this VS Code coder-agent connection (human-in-the-loop) via heartbeat, and
  // on the same cadence poll for newly-assigned work so a ticket assigned on the web
  // board is delivered to the editor (tracked HITL). One timer for both (DRY).
  void heartbeat(context);
  void pollAssignedTasks(context, projects);
  const hb = setInterval(() => {
    void heartbeat(context);
    void pollAssignedTasks(context, projects);
  }, 5 * 60_000);
  context.subscriptions.push({ dispose: () => clearInterval(hb) });
}

async function heartbeat(context: vscode.ExtensionContext): Promise<void> {
  if (!(await context.secrets.get(SECRET_KEY))) return;
  const version = (context.extension.packageJSON as { version?: string }).version ?? "0.0.0";
  await bfApi.connect(context.secrets, os.hostname(), version);
}

/** globalState key: the assigned-task ids we've already announced, so a poll only
 *  notifies on newly-assigned work (and re-notifies if a task is unassigned then
 *  reassigned). `undefined` = never polled on this machine → seed silently. */
const ASSIGNED_SEEN_KEY = "builderforce.assignedTaskIdsSeen";

/**
 * Deliver assigned work to the editor: fetch the open tasks assigned to the signed-in
 * user and raise a notification for any that appeared since the last poll. The FIRST
 * poll on a machine seeds the seen-set silently so we don't announce the whole existing
 * backlog. "Show my tasks" flips the Projects & Tasks tree to its assigned-to-me filter.
 */
async function pollAssignedTasks(
  context: vscode.ExtensionContext,
  projects: ProjectsTreeProvider,
): Promise<void> {
  if (!(await context.secrets.get(SECRET_KEY))) return;
  const assigned = await bfApi.listAssignedTasks(context.secrets);
  const currentIds = assigned.map((t) => t.id);
  const prev = context.globalState.get<number[]>(ASSIGNED_SEEN_KEY);
  await context.globalState.update(ASSIGNED_SEEN_KEY, currentIds);
  if (prev === undefined) return; // first run — seed silently

  const prevSet = new Set(prev);
  const fresh = assigned.filter((t) => !prevSet.has(t.id));
  if (fresh.length === 0) return;

  projects.refresh();
  const msg =
    fresh.length === 1
      ? vscode.l10n.t('BuilderForce: “{0}” was assigned to you.', fresh[0]!.title)
      : vscode.l10n.t('BuilderForce: {0} tasks were assigned to you.', String(fresh.length));
  const show = vscode.l10n.t('Show my tasks');
  const action = await vscode.window.showInformationMessage(msg, show);
  if (action === show) {
    projects.setAssignedToMe(true);
    await vscode.commands.executeCommand('builderforce.project.focus');
  }
}

/**
 * Gate a command on being signed in. Prompts once (Sign In → runs the sign-in flow)
 * and returns false when there's no stored editor key, so the caller can bail. The
 * one shared guard for every command that needs the tenant JWT.
 */
async function ensureSignedIn(context: vscode.ExtensionContext): Promise<boolean> {
  if (await context.secrets.get(SECRET_KEY)) return true;
  const action = await vscode.window.showInformationMessage(
    "Sign in to your BuilderForce workspace first.",
    "Sign In",
  );
  if (action === "Sign In") void vscode.commands.executeCommand("builderforce.signIn");
  return false;
}

/**
 * The shared 402 plan-limit response: show the surface-specific `message` with an
 * "Open BuilderForce" action that deep-links to workspace settings, where the upgrade
 * lives (a web-app action).
 */
async function handlePlanLimit(message: string): Promise<void> {
  const action = await vscode.window.showErrorMessage(message, "Open BuilderForce");
  if (action) void vscode.env.openExternal(vscode.Uri.parse(`${getWebBaseUrl()}/settings`));
}

async function selectProject(
  context: vscode.ExtensionContext,
  projects: ProjectsTreeProvider,
): Promise<void> {
  if (!(await ensureSignedIn(context))) return;
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
  if (!(await ensureSignedIn(context))) return;
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
    invalidateProjectNames(); // a new project must appear in the Sessions/Inbox labels
    setSelectedProject({ id: project.id, name: project.name });
    bfApi.invalidateTasks(project.id);
    projects.refresh();
    vscode.window.showInformationMessage(`BuilderForce: created project “${project.name}”.`);
  } catch (e) {
    const message = (e as Error).message;
    // 402 = plan project limit reached → upgrading is a web-app action.
    if (/HTTP 402/.test(message)) {
      await handlePlanLimit("BuilderForce: your plan's project limit is reached. Upgrade your workspace to add more.");
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
  if (!(await ensureSignedIn(context))) return;

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

/**
 * Change a work-item's TYPE from the tree (task ⇄ epic, or promote to an OKR
 * Objective). Promoting an epic to an OKR moves it off the board onto the OKRs tab
 * (and satisfies the project's 360 direction), so we confirm that first. Server-side
 * `POST /api/tasks/:id/convert-type` re-links children + scopes the new objective.
 */
async function convertTaskType(
  context: vscode.ExtensionContext,
  projects: ProjectsTreeProvider,
  task?: bfApi.BfTask,
): Promise<void> {
  if (!task) return;
  const isEpic = task.taskType === "epic";
  const choices: { label: string; target: "task" | "epic" | "objective" }[] = [
    { label: vscode.l10n.t("Promote to OKR objective"), target: "objective" },
    isEpic
      ? { label: vscode.l10n.t("Convert to task"), target: "task" }
      : { label: vscode.l10n.t("Convert to epic"), target: "epic" },
  ];
  const pick = await vscode.window.showQuickPick(choices, {
    title: vscode.l10n.t("Change type — {0}", task.key ?? task.title),
  });
  if (!pick) return;
  if (pick.target === "objective") {
    const ok = await vscode.window.showWarningMessage(
      vscode.l10n.t("Promote this item to an OKR objective? Its child tasks are re-linked to the new objective and it leaves the board."),
      { modal: true },
      vscode.l10n.t("Promote"),
    );
    if (!ok) return;
  }
  const done = await bfApi.convertTaskType(context.secrets, task.id, pick.target);
  if (!done) {
    vscode.window.showErrorMessage(vscode.l10n.t("BuilderForce: could not change the item's type."));
    return;
  }
  bfApi.invalidateTasks(getSelectedProject()?.id);
  bfApi.invalidateObjectives(getSelectedProject()?.id);
  projects.refresh();
  vscode.window.showInformationMessage(vscode.l10n.t("BuilderForce: {0} → {1}", task.key ?? "item", pick.target));
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
  if (!(await ensureSignedIn(context))) return;

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
    const dispatchErr = e instanceof bfApi.BfDispatchError ? e : undefined;
    if (dispatchErr?.httpStatus === 402 || /HTTP 402/.test(message)) {
      await handlePlanLimit("BuilderForce: your plan's run limit is reached. Upgrade your workspace to dispatch more runs.");
      return;
    }
    // Token budget exhausted (HTTP 429). Show the API's plan-tailored reason (e.g.
    // "Plan daily token limit reached (10,000 tokens)…") with a direct upgrade path,
    // instead of dumping the raw dispatch error — the whole point of this branch.
    const isTokenLimit =
      dispatchErr?.code === "plan_token_limit_exceeded" ||
      dispatchErr?.code === "plan_monthly_token_limit_exceeded" ||
      dispatchErr?.httpStatus === 429;
    if (isTokenLimit) {
      const reason = dispatchErr?.serverMessage ?? "Your workspace has reached its plan token limit for now.";
      const action = await vscode.window.showErrorMessage(
        `BuilderForce: can't run ${label} — ${reason}`,
        "Upgrade to Pro",
        "View Usage",
      );
      if (action === "Upgrade to Pro") void vscode.env.openExternal(vscode.Uri.parse(`${getWebBaseUrl()}/pricing`));
      else if (action === "View Usage") void vscode.env.openExternal(vscode.Uri.parse(`${getWebBaseUrl()}/settings`));
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
  requestedApprovalId?: string,
): Promise<void> {
  if (!(await ensureSignedIn(context))) return;

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
  const requested = requestedApprovalId
    ? pending.find((a) => String(a.id) === String(requestedApprovalId))
    : undefined;
  const pick = requested ? { approval: requested } : await vscode.window.showQuickPick(
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
  void syncSignedInContext(context); // reveal the feature views
  bfApi.clearJwt();
  clearPlatformToolsCache();
  BrainWebview.refresh();
  evermindView?.refresh();
  void vscode.commands.executeCommand("builderforce.refreshSessions");
  void vscode.commands.executeCommand("builderforce.refreshInbox");
  void heartbeat(context);
  void vscode.commands.executeCommand("builderforce.refreshProjects");
  // Land the user on a ready board instead of "Select or create a project…":
  // zero-setup onboarding provisions a Default project, so auto-select it.
  void autoSelectDefaultProject(context);
  void maybeScan(context, false);
  void insights?.start();
  void diagnostics?.refresh();
  meetings?.refresh();
}

/** After sign-in, if no project is selected yet, select the workspace's sole/first
 *  project so the user lands on a ready board instead of the "Select or create a
 *  project…" placeholder. Zero-setup onboarding provisions a Default project on the
 *  web, so a fresh builder has exactly one to land on. Best-effort and silent on any
 *  failure — the manual "Select or create a project…" affordance always remains. */
async function autoSelectDefaultProject(context: vscode.ExtensionContext): Promise<void> {
  if (getSelectedProject()) return; // a returning user keeps their persisted selection
  try {
    const list = await bfApi.listProjects(context.secrets);
    const first = list[0];
    if (!first) return; // no projects yet — leave the create affordance
    setSelectedProject({ id: first.id, name: first.name });
    bfApi.invalidateTasks(first.id);
    void vscode.commands.executeCommand("builderforce.refreshProjects");
  } catch {
    /* best-effort — leave the manual picker affordance in place */
  }
}

async function signOut(
  context: vscode.ExtensionContext,
  auth: BuilderForceAuthProvider,
): Promise<void> {
  await auth.removeSession();
  void syncSignedInContext(context); // collapse back to the login-only Welcome panel
  bfApi.clearJwt();
  clearPlatformToolsCache();
  clearPersonalityBlockCache();
  bfApi.setSelectedWorkspace(undefined);
  await context.globalState.update(SELECTED_TENANT_KEY, undefined);
  setGroundingSummary(undefined);
  setSelectedProject(undefined);
  vscode.window.showInformationMessage("BuilderForce: signed out.");
  BrainWebview.refresh();
  evermindView?.refresh();
  void vscode.commands.executeCommand("builderforce.refreshSessions");
  void vscode.commands.executeCommand("builderforce.refreshInbox");
  void vscode.commands.executeCommand("builderforce.refreshProjects");
  void insights?.start();
  void diagnostics?.refresh();
  meetings?.refresh();
}

/** Human-facing provider names for the BYO groups. Falls back to the raw key. */
const BYO_PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  meta: "Meta",
  xai: "xAI",
  mistral: "Mistral",
  deepseek: "DeepSeek",
};

function byoProviderLabel(vendor: string): string {
  return BYO_PROVIDER_LABELS[vendor] ?? vendor.replace(/^./, (ch) => ch.toUpperCase());
}

async function pickModel(context: vscode.ExtensionContext): Promise<void> {
  try {
    const { models, canUsePremiumModels, premiumModels, canChooseModel, byo, premiumInfo } =
      await getModels(context.secrets, true);
    const auto = "(auto — let the gateway choose)";

    // When premium is locked, the gateway tells us WHY and which step opens it.
    // Same unlock vocabulary the chat error banner uses, so the picker and a failed
    // turn name the same remedy.
    const premiumUnlock = canUsePremiumModels
      ? null
      : premiumInfo?.unlock === "validate_card"
        ? {
            label: "$(credit-card) Add a card to unlock premium models",
            detail: "Your plan allows premium; it needs a validated card on file",
          }
        : premiumInfo?.unlock === "upgrade"
          ? {
              label: "$(rocket) Upgrade to unlock premium models",
              detail: "Any paid OpenRouter model, at cost + 1¢/request",
            }
          : null;

    // Model choice is a gated entitlement (frontier access: paid plan, superadmin,
    // premium override, or a connected BYO account). Without it the gateway rejects a
    // pinned model, so offering one would be a dead control — clear the pin instead.
    if (!canChooseModel) {
      setSelectedModel(undefined);
      const action = await vscode.window.showInformationMessage(
        "Model choice needs a paid plan or a connected provider account. Connect your own Anthropic/OpenAI key to pick models and have turns billed to your account.",
        "Open settings",
      );
      if (action) void vscode.commands.executeCommand("builderforce.openSettings");
      return;
    }

    // Separator-grouped QuickPick, ordered by what it COSTS the user:
    //   1. BYO — their own connected account. Billed to their key, $0 to us, so it
    //      leads. Grouped per provider ("BYO — Anthropic") because a tenant can
    //      connect several and needs to know whose key a pick will spend.
    //   2. Plan models — included in the plan.
    //   3. Premium — any paid OpenRouter model, metered at cost + 1¢/request.
    // Groups the tenant isn't entitled to never render, so the picker can only ever
    // offer models the gateway will accept.
    const items: vscode.QuickPickItem[] = [{ label: auto, description: "Default · gateway picks per turn" }];

    // Group the BYO models by their serving provider, preserving catalog order.
    const byVendor = new Map<string, typeof byo.models>();
    for (const m of byo.models) {
      const list = byVendor.get(m.vendor) ?? [];
      list.push(m);
      byVendor.set(m.vendor, list);
    }
    for (const [vendor, vendorModels] of byVendor) {
      items.push(
        {
          label: `BYO — ${byoProviderLabel(vendor)} (billed to your own key)`,
          kind: vscode.QuickPickItemKind.Separator,
        },
        ...vendorModels.map((m) => ({
          label: m.id,
          description: `your ${byoProviderLabel(vendor)} account · ${m.tier}`,
          detail:
            m.contextWindow != null
              ? `${m.contextWindow.toLocaleString()} token context · no platform charge`
              : "no platform charge",
        })),
      );
    }

    items.push(
      { label: "Plan models — included in your plan", kind: vscode.QuickPickItemKind.Separator },
      ...models.map((m) => ({ label: m, description: "included in your plan" })),
    );

    if (canUsePremiumModels && premiumModels.length > 0) {
      items.push(
        { label: "Premium — any OpenRouter model (cost + 1¢/request)", kind: vscode.QuickPickItemKind.Separator },
        ...premiumModels.map((m) => ({ label: m, description: "premium · metered at cost + 1¢/request" })),
      );
    } else if (premiumUnlock) {
      // Premium is off — SAY SO, and name the step that turns it on. Silently
      // omitting the group made the picker look like it was missing models the web
      // app plainly offers. Picking this row opens the page that unlocks it rather
      // than pinning anything.
      items.push(
        { label: "Premium — any OpenRouter model", kind: vscode.QuickPickItemKind.Separator },
        { label: premiumUnlock.label, description: premiumUnlock.detail },
      );
    }

    const pick = await vscode.window.showQuickPick(items, {
      title: "Select BuilderForce model",
      placeHolder: byo.providers.length > 0
        ? "Your connected accounts are listed first — those turns are billed to your own key"
        : "Pick a model for new turns",
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (pick === undefined) return;
    // The unlock row is a call to action, not a model — send them to the page that
    // grants the entitlement and leave the current pin untouched.
    if (premiumUnlock && pick.label === premiumUnlock.label) {
      void vscode.env.openExternal(
        vscode.Uri.parse(
          `${getWebBaseUrl()}${premiumInfo?.unlock === "upgrade" ? "/pricing?upgrade=pro" : "/pricing"}`,
        ),
      );
      return;
    }
    setSelectedModel(pick.label === auto ? undefined : pick.label);
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
