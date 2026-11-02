import * as vscode from "vscode";
import * as path from "path";
import { autoApproveDefault } from "./permissionMode";
import { JOURNAL_FILE } from "./localFirstJournalIo";
import { listLocalModels, localModelOptions } from "./localModels";
import { BUILD_ID, BUILT_AT } from "./buildInfo";
import { posixShellReport } from "@builderforce/agent-tools/node-posix-shell";
import { getTenantJwt, getCurrentUserId, signedInTenantId } from "./bfApi";
import { getBaseUrl, getWebBaseUrl, getLocalModelsConfig, SECRET_KEY } from "./gateway";
import { fetchPersonalityBlock } from "./personalityLimbic";
import { INIT_GROUNDING_BUDGET_MS, stableGroundingWithin } from "./grounding";
import { getEditorContext, getEditorContextLive } from "./editorContext";
import { initFrameAuth } from "./initFrameAuth";
import { detectPendingChanges, EMPTY_CHANGE_SET } from "./gitChanges";
import { resolveModelRoute, type ModelRoute } from "./modelRouting";
import { pickedChoice } from "./modelState";
import { createInitBudget } from "./initBudget";
import { ttlCache } from "./ttlCache";
import { localModelLabels } from "./localModelLabels";
import { inferenceModeLabels } from "./inferenceModeLabels";
import { currentInferenceMode, inferenceModeInit } from "./inferenceModeSetting";
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
import { prefetchLabels } from "./prefetch/prefetchLabels";
import { connectionsLabels } from "./connectionsLabels";
import { knowledgeViewLabels } from "./knowledge/knowledgeLabels";
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
  opts: {
    session: WorkspaceCanvasSession;
    surface: "chat" | "graph";
    boardBeside?: boolean;
    /** A step (the definition index, the token, the model route…) was still pending at its
     *  deadline and has now landed: re-push init. Fires at most once per build. */
    onLate?: () => void;
    /** The build finished; `true` when any step went past its budget (see `createLateRepushLimit`). */
    onBuilt?: (hadLate: boolean) => void;
  },
): Promise<Record<string, unknown>> {
  const signedIn = !!(await ctx.secrets.get(SECRET_KEY));
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  // The panel shows "Connecting…" until this frame is posted, so NOTHING here may wait on
  // the network: the slow steps run together, each under a short budget, and a late one
  // degrades to a safe value and re-pushes init when it lands (`onLate`).
  const budget = createInitBudget(opts.onLate);
  const fallbackRoute = pickedRoute();
  // Grounding starts with the rest (its own budget): not queued behind them.
  const groundingP = stableGroundingWithin(root, INIT_GROUNDING_BUDGET_MS, { onLate: budget.late });
  const [token, editorContext, projectNames, personalityBlock, modelChoice, localModels, pendingChanges] = await Promise.all([
    // Null while signed in is tolerated: the webview mints its own (`WorkspaceApp.mintToken`).
    budget.step("token", signedIn ? getTenantJwt(ctx.secrets).then((t) => t ?? null) : Promise.resolve(null), null, (t) => t !== null),
    // Awaited (not peeked) so the FIRST turn already knows the repo — the whole
    // point of shipping this: the agent must not open a chat asking where the code is.
    budget.step("editorContext", getEditorContextLive(), getEditorContext()),
    // `projectId → name` for every project, so the header can name the project an
    // existing chat belongs to (best-effort; falls back to "No project").
    budget.step("projectNames", signedIn ? projectNamesOf(ctx) : Promise.resolve({}), {} as Record<string, string>, (names) => Object.keys(names).length > 0),
    // The signed-in user's PERSONALITY-only directive block — fetched once per
    // session (cached in `personalityLimbic.ts`) and injected into the webview's
    // ambient system channel, so the Brain chat's tone reflects the user. The
    // webview can't bundle the shared compiler (--no-dependencies), so the host
    // fetches the compiled block from the gateway. '' when the user has no
    // profile (a no-op) or offline.
    budget.step("personality", signedIn ? personalityBlockOf(ctx) : Promise.resolve(""), "", (block) => block !== ""),
    // The SAME seam every other AI surface routes through, so the panel cannot drift
    // onto a different model (or a different transport) from the chat participant.
    // Late, it shows the saved pick (read with no network), never another model.
    budget.step("modelRoute", resolveModelRoute(ctx.secrets), fallbackRoute),
    // The models this MACHINE can serve, in the shared builder's row shape. The
    // composer's menu is built from the gateway catalogue, which by definition cannot
    // know about them — so without this the panel offered no way to pick one and the
    // feature existed only in the command palette.
    budget.step("localModels", localModelRowsNow(), []),
    // What is uncommitted RIGHT NOW. Seeds the chat's pending-changes bar so a panel
    // opened after the edits still says they are waiting; refreshed via
    // `pendingChanges` messages.
    budget.step("pendingChanges", detectPendingChanges(), EMPTY_CHANGE_SET),
  ]);
  const grounding = await groundingP;
  opts.onBuilt?.(budget.hadLate());
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
    // Where every chat's full dialogue is committed on this machine (the journal is the
    // record; `local-first-v1.json` beside it is a cache), for the diagnostics report.
    chatHistoryPath: path.join(ctx.globalStorageUri.fsPath, JOURNAL_FILE),
    platformPolicy: platformPolicy().snapshot(),
    ...inferenceModeInit(),
    // token / tenantId / localPick: see `initFrameAuth`.
    ...initFrameAuth({ signedIn, token, tenantId: signedInTenantId(), routeDegraded: modelChoice === fallbackRoute, model: modelChoice.model }),
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
    localModels,
    // The workspace SHAPE only: run notes change after every run and reach each run
    // fresh through the host (`recentActivitySection`), so this prompt stays cacheable.
    grounding,
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
    pendingChanges,
    // The sidebar's active project — injected into the system prompt (so the
    // Brain scopes platform tools without asking for a projectId) AND used to
    // scope newly-created chats. Re-pushed on project change via refresh.
    project: getSelectedProject(),
    projectNames,
    // Static personality tone for the chat's system prompt (see above).
    personalityBlock,
    // BOTH label sets: one surface renders the chat AND the board, so both have to
    // be present whichever surface it opens at.
    labels: { ...authLabels(), ...brainChatLabels(), ...canvasLabels(), ...subagentLabels(), ...localModelLabels(), ...inferenceModeLabels(), ...chatTicketsLabels(), ...chatSurfaceLabels(), ...workStatusLabels(), ...connectionsLabels(), ...prefetchLabels(), ...knowledgeViewLabels() },
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
    // How an attached picture is prepared for the model (`builderforce.images.*`).
    images: imagePrepSettings(),
  };
}

type LocalModelRows = ReturnType<typeof localModelOptions>;
const localModelRows = ttlCache<string, Promise<LocalModelRows>>(5_000);

/**
 * The probe is fresh per build, so a build that gave up on it would make the late re-push
 * probe AGAIN and maybe time out again. Memoized for a few seconds, from when it LANDS, so
 * the re-push reads the answer that arrived.
 */
function localModelRowsNow(): Promise<LocalModelRows> {
  const hit = localModelRows.get("rows");
  if (hit) return hit.value;
  const probe = listLocalModels(getLocalModelsConfig()).then(localModelOptions);
  localModelRows.set("rows", probe);
  probe.then(() => localModelRows.set("rows", probe), () => localModelRows.invalidate("rows"));
  return probe;
}

/** The route to show while the real one resolves: the saved pick, read with no network. */
function pickedRoute(): ModelRoute {
  return { ...pickedChoice(), inferenceMode: currentInferenceMode() };
}

async function projectNamesOf(ctx: vscode.ExtensionContext): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  for (const [id, name] of await getProjectNames(ctx.secrets)) names[String(id)] = name;
  return names;
}

async function personalityBlockOf(ctx: vscode.ExtensionContext): Promise<string> {
  const userId = (await getCurrentUserId(ctx.secrets)) ?? undefined;
  return fetchPersonalityBlock(ctx.secrets, userId ? { userId } : undefined);
}

/** The `builderforce.images.*` caps the panel's picture prep runs with (brain-embedded `ImagePrepOptions`). */
export function imagePrepSettings(): { maxEdge: number; jpegQuality: number } {
  const cfg = vscode.workspace.getConfiguration("builderforce.images");
  return { maxEdge: cfg.get<number>("maxEdge", 1568), jpegQuality: cfg.get<number>("jpegQuality", 0.85) };
}
