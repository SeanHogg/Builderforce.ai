import * as os from "os";
import * as vscode from "vscode";
import { BuilderForceAuthProvider } from "./auth";
import * as bfApi from "./bfApi";
import { ChatPanel } from "./chatPanel";
import { EmbedPanel } from "./embedPanel";
import { registerChatParticipant } from "./chatParticipant";
import { registerChatSessions } from "./chatSessions";
import { scanCodebase } from "./codebaseScan";
import { getModels, SECRET_KEY } from "./gateway";
import { setGroundingSummary } from "./grounding";
import { setSelectedModel } from "./modelState";
import { getSelectedProject, initProjectState, setSelectedProject } from "./projectState";
import { ProjectsTreeProvider } from "./projectsTree";
import { ChatSession, SessionStore } from "./sessionStore";
import { SessionsTreeProvider } from "./sessionsTree";

type TaskNode = { kind: "task"; task: bfApi.BfTask };

/** Embeddable BuilderForce web views opened inside VS Code (reuse the real pages, DRY). */
const EMBED_VIEWS: { label: string; view: string }[] = [
  { label: "Board (Kanban)", view: "kanban" },
  { label: "Backlog", view: "backlog" },
  { label: "Roadmap", view: "roadmap" },
  { label: "Sprints", view: "sprints" },
  { label: "Retrospectives", view: "retros" },
  { label: "Planning Poker", view: "poker" },
  { label: "Velocity", view: "velocity" },
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
  const store = new SessionStore(context.workspaceState);
  const tree = new SessionsTreeProvider(store);
  const projects = new ProjectsTreeProvider(context);
  const auth = BuilderForceAuthProvider.register(context);
  const output = vscode.window.createOutputChannel("BuilderForce");
  context.subscriptions.push(output);

  // Native Chat participant (@builderforce) + dedicated session tab (proposed API,
  // feature-detected — no-ops unless launched with --enable-proposed-api).
  const participant = registerChatParticipant(context);
  const sessions = registerChatSessions(context, participant);
  if (sessions) context.subscriptions.push(sessions);

  context.subscriptions.push(
    participant,
    vscode.window.registerTreeDataProvider("builderforce.sessions", tree),
    vscode.window.registerTreeDataProvider("builderforce.project", projects),
    vscode.commands.registerCommand("builderforce.newSession", () => {
      const sel = getSelectedProject();
      const s = store.create(sel ? { projectId: sel.id } : {});
      ChatPanel.open(context, store, s.id);
    }),
    vscode.commands.registerCommand("builderforce.openSession", (id: string) =>
      ChatPanel.open(context, store, id),
    ),
    vscode.commands.registerCommand("builderforce.selectProject", () => selectProject(context, projects)),
    vscode.commands.registerCommand("builderforce.refreshProjects", () => {
      bfApi.invalidateTasks();
      projects.refresh();
    }),
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
      const s = store.create({
        title: `${t.key ? `${t.key} ` : ""}${t.title}`.slice(0, 60),
        projectId: getSelectedProject()?.id,
        taskId: t.id,
        taskKey: t.key,
        taskTitle: t.title,
      });
      ChatPanel.open(context, store, s.id);
    }),
    vscode.commands.registerCommand("builderforce.setTaskStatus", (node: TaskNode) =>
      setTaskStatus(context, projects, node?.task),
    ),
    // Open the real BuilderForce web pages inside VS Code (embedded — DRY, no rebuild).
    vscode.commands.registerCommand("builderforce.openBoard", () =>
      EmbedPanel.open(context, "kanban", { title: "BuilderForce Board", hash: projectHash() }),
    ),
    vscode.commands.registerCommand("builderforce.openView", async () => {
      const pick = await vscode.window.showQuickPick(
        EMBED_VIEWS.map((v) => ({ label: v.label, view: v.view })),
        { title: "Open a BuilderForce page in VS Code", placeHolder: "Manage your workforce & tasks without leaving the editor" },
      );
      if (!pick) return;
      EmbedPanel.open(context, pick.view, { title: `BuilderForce: ${pick.label}`, hash: projectHash() });
    }),
    vscode.commands.registerCommand("builderforce.deleteSession", (item: ChatSession | string) => {
      const id = typeof item === "string" ? item : item?.id;
      if (!id) return;
      ChatPanel.close(id);
      store.delete(id);
    }),
    vscode.commands.registerCommand("builderforce.renameSession", async (item: ChatSession | string) => {
      const id = typeof item === "string" ? item : item?.id;
      if (!id) return;
      const current = store.get(id);
      const title = await vscode.window.showInputBox({
        title: "Rename session",
        prompt: "New session name",
        value: current?.title ?? "",
        ignoreFocusOut: true,
      });
      if (title === undefined) return;
      const finalTitle = title.trim() || "New session";
      store.rename(id, finalTitle);
      ChatPanel.setTitle(id, finalTitle);
    }),
    // Recover/reveal the sidebar list if it was moved or hidden.
    vscode.commands.registerCommand("builderforce.openChat", () =>
      vscode.commands.executeCommand("builderforce.sessions.focus"),
    ),
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
  if (!list.length) {
    vscode.window.showInformationMessage("BuilderForce: no projects found (or sign in first).");
    return;
  }
  const pick = await vscode.window.showQuickPick(
    list.map((p) => ({ label: p.name, description: p.key ?? "", id: p.id, name: p.name })),
    { title: "Select a BuilderForce project", placeHolder: "Associate this editor with a project" },
  );
  if (!pick) return;
  setSelectedProject({ id: pick.id, name: pick.name });
  bfApi.invalidateTasks(pick.id);
  projects.refresh();
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
  await ChatPanel.refreshAll(context);
  void heartbeat(context);
  void vscode.commands.executeCommand("builderforce.refreshProjects");
  void maybeScan(context, false);
}

async function signOut(
  context: vscode.ExtensionContext,
  auth: BuilderForceAuthProvider,
): Promise<void> {
  await auth.removeSession();
  bfApi.clearJwt();
  setGroundingSummary(undefined);
  setSelectedProject(undefined);
  vscode.window.showInformationMessage("BuilderForce: signed out.");
  await ChatPanel.refreshAll(context);
  void vscode.commands.executeCommand("builderforce.refreshProjects");
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
