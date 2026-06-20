import * as vscode from "vscode";
import { BuilderForceAuthProvider } from "./auth";
import { ChatViewProvider } from "./ChatViewProvider";
import { registerChatParticipant } from "./chatParticipant";
import { scanCodebase } from "./codebaseScan";
import { getModels, SECRET_KEY } from "./gateway";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ChatViewProvider(context);
  const auth = BuilderForceAuthProvider.register(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewId, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    // Also expose BuilderForce in VS Code's native Chat view as @builderforce.
    registerChatParticipant(context),
    // Reveal/focus the chat view wherever it's docked — recovers it if the user
    // dragged it to the panel/secondary sidebar and the Activity Bar icon vanished.
    vscode.commands.registerCommand("builderforce.openChat", () =>
      vscode.commands.executeCommand("builderforce.chat.focus"),
    ),
    vscode.commands.registerCommand("builderforce.signIn", () => signIn(context, provider)),
    vscode.commands.registerCommand("builderforce.signOut", () => signOut(auth, provider)),
    vscode.commands.registerCommand("builderforce.newChat", () => provider.newChat()),
    vscode.commands.registerCommand("builderforce.pickModel", () => pickModel(context, provider)),
    vscode.commands.registerCommand("builderforce.rescanCodebase", () =>
      maybeScan(context, provider, true),
    ),
    vscode.commands.registerCommand("builderforce.openSettings", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", "builderforce"),
    ),
    // Re-ground when the open folder changes.
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      provider.setCodebaseSummary(undefined);
      void maybeScan(context, provider, false);
    }),
  );

  // Best-effort grounding scan on startup (cached by version token; no-op if signed out).
  void maybeScan(context, provider, false);
}

export function deactivate(): void {
  /* no-op */
}

async function signIn(
  context: vscode.ExtensionContext,
  provider: ChatViewProvider,
): Promise<void> {
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
  await provider.refreshState();
  void maybeScan(context, provider, false);
}

async function signOut(
  auth: BuilderForceAuthProvider,
  provider: ChatViewProvider,
): Promise<void> {
  await auth.removeSession();
  provider.setCodebaseSummary(undefined);
  vscode.window.showInformationMessage("BuilderForce: signed out.");
  await provider.refreshState();
}

async function pickModel(
  context: vscode.ExtensionContext,
  provider: ChatViewProvider,
): Promise<void> {
  try {
    const models = await getModels(context.secrets, true);
    const auto = "(auto — let the gateway choose)";
    const pick = await vscode.window.showQuickPick([auto, ...models], {
      title: "Select BuilderForce model",
      placeHolder: "Pick a model for this conversation",
    });
    if (pick === undefined) return;
    provider.setModel(pick === auto ? undefined : pick);
  } catch (e) {
    const message = (e as { message?: string }).message ?? String(e);
    if (message.includes("not_signed_in")) {
      const action = await vscode.window.showWarningMessage(
        "Sign in to BuilderForce first.",
        "Sign In",
      );
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
async function maybeScan(
  context: vscode.ExtensionContext,
  provider: ChatViewProvider,
  force: boolean,
): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return;
  const key = await context.secrets.get(SECRET_KEY);
  if (!key) return;

  const model =
    vscode.workspace.getConfiguration("builderforce").get<string>("defaultModel") || undefined;

  const work = async (progress?: vscode.Progress<{ message?: string }>) => {
    progress?.report({ message: "Scanning workspace…" });
    try {
      const summary = await scanCodebase(context.secrets, root, model, force);
      provider.setCodebaseSummary(summary);
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
