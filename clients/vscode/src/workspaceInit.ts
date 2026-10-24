import * as vscode from "vscode";
import { autoApproveDefault } from "./permissionMode";
import { listLocalModels, localModelOptions } from "./localModels";
import { BUILD_ID, BUILT_AT } from "./buildInfo";
import { posixShellReport } from "./posixShell";
import { getTenantJwt, getCurrentUserId } from "./bfApi";
import { getBaseUrl, getWebBaseUrl, getLocalModelsConfig, SECRET_KEY } from "./gateway";
import { fetchPersonalityBlock } from "./personalityLimbic";
import { getStableGrounding } from "./grounding";
import { getEditorContextLive } from "./editorContext";
import { detectPendingChanges } from "./gitChanges";
import { resolveModelRoute } from "./modelRouting";
import { localModelLabels } from "./localModelLabels";
import { inferenceModeLabels } from "./inferenceModeLabels";
import { inferenceModeInit } from "./inferenceModeSetting";
import { chatTicketsLabels } from "./chatTicketsLabels";
import { chatSurfaceLabels } from "./chatSurfaceLabels";
import { modelChoiceLabels } from "./modelChoiceLabels";
import { brainChatLabels } from "./brainChatLabels";
import { getSelectedProject } from "./projectState";
import { getProjectNames } from "./projectNames";
import { canvasLabels, isLightTheme } from "./canvasHostActions";
import { authLabels } from "./authLabels";
import { subagentLabels } from "./subagentLabels";
import { workStatusLabels } from "./workStatusLabels";
import { platformPolicy } from "./platformPolicy";
import type { WorkspaceCanvasSession } from "./workspaceSession";

/**
 * The `init` frame for the workspace bundle (board + chat): gateway URL, tenant token,
 * model route, grounding, editor context, labels. Built in ONE place so every host of
 * the workspace surface — the editor tab and the secondary-sidebar chat view — hands
 * the React app the same config.
 */
export async function buildWorkspaceInit(
  ctx: vscode.ExtensionContext,
  opts: { session: WorkspaceCanvasSession; surface: "chat" | "graph"; boardBeside?: boolean },
): Promise<Record<string, unknown>> {
  const signedIn = !!(await ctx.secrets.get(SECRET_KEY));
  const token = signedIn ? ((await getTenantJwt(ctx.secrets)) ?? null) : null;
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  // Awaited (not peeked) so the FIRST turn already knows the repo — the whole
  // point of shipping this: the agent must not open a chat asking where the code is.
  const editorContext = await getEditorContextLive();
  // `projectId → name` for every project, so the header can name the project an
  // existing chat belongs to (best-effort; falls back to "No project").
  const projectNames: Record<string, string> = {};
  if (signedIn) {
    try {
      for (const [id, name] of await getProjectNames(ctx.secrets)) projectNames[String(id)] = name;
    } catch {
      /* names are best-effort */
    }
  }
  // The signed-in user's PERSONALITY-only directive block — fetched once per
  // session (cached in `personalityLimbic.ts`) and injected into the webview's
  // ambient system channel, so the Brain chat's tone reflects the user. The
  // webview can't bundle the shared compiler (--no-dependencies), so the host
  // fetches the compiled block from the gateway. '' when the user has no
  // profile (a no-op) or offline.
  let personalityBlock = "";
  if (signedIn) {
    try {
      const userId = (await getCurrentUserId(ctx.secrets)) ?? undefined;
      personalityBlock = await fetchPersonalityBlock(ctx.secrets, userId ? { userId } : undefined);
    } catch {
      /* personality is best-effort — never blocks init */
    }
  }
  // The SAME seam every other AI surface routes through, so the panel cannot drift
  // onto a different model (or a different transport) from the chat participant.
  const modelChoice = await resolveModelRoute(ctx.secrets);
  return {
    type: "init",
    baseUrl: getBaseUrl(),
    // The installed build, for the diagnostics report (a stale VSIX explains a
    // surprising share of "this was already fixed" reports).
    extensionVersion: ctx.extension.packageJSON.version as string,
    // …and the ARTIFACT identity the version cannot carry: two VSIXes can share a
    // version and differ in code, so the source hash is what actually answers
    // "did you get the fix?". See `buildInfo.ts`.
    buildId: BUILD_ID,
    builtAt: BUILT_AT,
    // Whether THIS machine routes POSIX scripts to a real shell. The `git_sync_latest`
    // / `git_undo` / `git_redo` tools are sh scripts; without a POSIX shell they reach
    // `cmd.exe` and fail with a message naming neither the cause nor a remedy, and a
    // report of that failure could not say whether the guard against it was even
    // present. Now it travels with every copied diagnostics report.
    posixShell: posixShellReport(),
    platformPolicy: platformPolicy().snapshot(),
    ...inferenceModeInit(),
    token,
    // Manual pick > active project's Evermind pin > configured default. Sending the
    // `project_evermind:<id>` pin lets the gateway serve the project's CURRENT learned
    // model on every completion (auto-following learning bumps mid-session).
    model: modelChoice.model,
    modelStrict: modelChoice.modelStrict,
    routingMode: modelChoice.routingMode,
    // Present only for an on-device model: switches the panel onto the host-proxied
    // transport, and lets it render without an account.
    ...(modelChoice.local
      ? { localRoute: { baseUrl: modelChoice.local.endpoint.baseUrl, model: modelChoice.local.model } }
      : {}),
    // The standing "apply edits without asking?" instruction. The panel's Auto-mode
    // switch overrides it live, but the SETTING is what it starts from — the panel
    // used to default this off in its own code and never consult the setting, so
    // changing the setting moved the participant and left the panel asking.
    autoApproveDefault: autoApproveDefault(),
    // The models this MACHINE can serve, in the shared builder's row shape. The
    // composer's menu is built from the gateway catalogue, which by definition cannot
    // know about them — so without this the panel offered no way to pick one and the
    // feature existed only in the command palette.
    localModels: localModelOptions(await listLocalModels(getLocalModelsConfig())),
    // The workspace SHAPE only: run notes change after every run and reach each run
    // fresh through the host (`recentActivitySection`), so this prompt stays cacheable.
    grounding: await getStableGrounding(root),
    // Live editor context (active file / selection / open tabs). Seeds the React
    // app's ambient system channel; refreshed via `editorContext` messages.
    editorContext,
    signedIn,
    hasWorkspace: !!root,
    // WHERE THE CODE IS: the absolute root the local file tools resolve against,
    // and the repository detected for it (branch / owner-repo / dirty state).
    // `hasWorkspace` is kept — other consumers read it.
    workspaceRoot: root,
    git: editorContext?.git,
    // What is uncommitted RIGHT NOW. Seeds the chat's pending-changes bar so a panel
    // opened after the edits still says they are waiting; refreshed via
    // `pendingChanges` messages.
    pendingChanges: await detectPendingChanges(),
    // The sidebar's active project — injected into the system prompt (so the
    // Brain scopes platform tools without asking for a projectId) AND used to
    // scope newly-created chats. Re-pushed on project change via refresh.
    project: getSelectedProject(),
    projectNames,
    // Static personality tone for the chat's system prompt (see above).
    personalityBlock,
    // BOTH label sets: one surface renders the chat AND the board, so both have to
    // be present whichever surface it opens at.
    labels: { ...authLabels(), ...brainChatLabels(), ...canvasLabels(), ...subagentLabels(), ...localModelLabels(), ...inferenceModeLabels(), ...chatTicketsLabels(), ...chatSurfaceLabels(), ...workStatusLabels() },
    // The editor's display language: how the shared components format numbers,
    // money and relative times (the strings themselves are already translated above).
    locale: vscode.env.language,
    // The model rows' copy, shared verbatim with the host's `Change model` QuickPick.
    modelLabels: modelChoiceLabels(),
    // The board this surface is working in, and which of its surfaces the entry asked
    // for. Together these are what used to be the difference between two panels.
    session: { id: opts.session.id, title: opts.session.title, webOrigin: getWebBaseUrl(), durable: opts.session.durable },
    surface: opts.surface,
    // The sidebar chat view draws the conversation only; its board opens beside it.
    ...(opts.boardBeside ? { boardBeside: true } : {}),
    colorTheme: isLightTheme() ? "light" : "dark",
  };
}
