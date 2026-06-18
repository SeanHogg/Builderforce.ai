import * as vscode from "vscode";
import { ChatViewProvider } from "./ChatViewProvider";
import { getModels, SECRET_KEY } from "./gateway";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ChatViewProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewId, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("builderforce.signIn", () => signIn(context, provider)),
    vscode.commands.registerCommand("builderforce.signOut", () => signOut(context, provider)),
    vscode.commands.registerCommand("builderforce.newChat", () => provider.newChat()),
    vscode.commands.registerCommand("builderforce.pickModel", () => pickModel(context, provider)),
    vscode.commands.registerCommand("builderforce.openSettings", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", "builderforce"),
    ),
  );
}

export function deactivate(): void {
  /* no-op */
}

/**
 * v0 sign-in: paste an API key into SecretStorage. The browser device-code flow
 * (PRD 14 §6.1/§6.4) replaces this once the `/api/auth/device/*` endpoints are deployed
 * — at which point this command runs the device flow instead, with paste-key kept as the
 * remote/offline fallback.
 */
async function signIn(
  context: vscode.ExtensionContext,
  provider: ChatViewProvider,
): Promise<void> {
  const key = await vscode.window.showInputBox({
    title: "Sign in to BuilderForce",
    prompt:
      "Paste your BuilderForce API key. (Browser device-code sign-in arrives once the device-auth endpoints are deployed — see PRD 14.)",
    placeHolder: "clu_…",
    password: true,
    ignoreFocusOut: true,
  });
  if (!key) return;
  await context.secrets.store(SECRET_KEY, key.trim());
  vscode.window.showInformationMessage("BuilderForce: signed in.");
  await provider.refreshState();
}

async function signOut(
  context: vscode.ExtensionContext,
  provider: ChatViewProvider,
): Promise<void> {
  await context.secrets.delete(SECRET_KEY);
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
