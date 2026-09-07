import * as vscode from "vscode";
import * as bfApi from "./bfApi";
import { clearPlatformToolsCache } from "./platformTools";

/**
 * Register a bring-your-own MCP server from the editor.
 *
 * The tools of a registered server reach this extension automatically — the
 * gateway merges them into the shared platform catalog `brainToolCatalog` already
 * fetches — so the ONLY thing missing was a way to register one without calling
 * the API by hand. This is that way, and it is deliberately the same flow the web
 * settings panel drives (same routes, same owner gate, same server-to-server OAuth):
 * the credential never passes through the editor, and the consent screen opens in
 * a real browser because it cannot be shown in a webview.
 */

/** Sentinel id for the "register a new server" row in the picker. */
const REGISTER = "__register__";

function describe(server: bfApi.BfMcpExtension): string {
  if (!server.enabled) return vscode.l10n.t("disabled");
  if (server.authKind === "oauth" && !server.oauthConnectedAt) return vscode.l10n.t("needs consent");
  return server.serverUrl;
}

/** Prompt for the server's details and register it. Returns the created row. */
async function registerFlow(secrets: vscode.SecretStorage): Promise<bfApi.BfMcpExtension | undefined> {
  const name = await vscode.window.showInputBox({
    title: vscode.l10n.t("Register MCP server"),
    prompt: vscode.l10n.t("Name this server"),
    placeHolder: vscode.l10n.t("e.g. Design system tools"),
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim() ? undefined : vscode.l10n.t("A name is required")),
  });
  if (!name?.trim()) return undefined;

  const serverUrl = await vscode.window.showInputBox({
    title: vscode.l10n.t("Register MCP server"),
    prompt: vscode.l10n.t("Server URL"),
    placeHolder: "https://mcp.example.com/sse",
    ignoreFocusOut: true,
    // Mirrors the server's own guard: https only, no private or loopback hosts.
    validateInput: (v) =>
      /^https:\/\/\S+$/i.test(v.trim()) ? undefined : vscode.l10n.t("Enter a public https:// address"),
  });
  if (!serverUrl?.trim()) return undefined;

  const secret = await vscode.window.showInputBox({
    title: vscode.l10n.t("Register MCP server"),
    prompt: vscode.l10n.t("Secret — leave empty for OAuth or a server that needs no credential"),
    password: true,
    ignoreFocusOut: true,
  });
  if (secret === undefined) return undefined;

  return bfApi.createMcpExtension(secrets, {
    name: name.trim(),
    serverUrl: serverUrl.trim(),
    ...(secret.trim() ? { secret: secret.trim() } : {}),
  });
}

/** Offer to finish a server's OAuth connection in the browser. */
async function offerConnect(secrets: vscode.SecretStorage, server: bfApi.BfMcpExtension): Promise<void> {
  const authUrl = await bfApi.beginMcpOAuthConnect(secrets, server.id);
  if (!authUrl) {
    // 409 = the server answered an unauthenticated probe, so there is nothing to consent to.
    void vscode.window.showInformationMessage(
      vscode.l10n.t("BuilderForce: “{0}” needs no authorization — its tools are ready.", server.name),
    );
    return;
  }
  const open = vscode.l10n.t("Open consent page");
  const pick = await vscode.window.showInformationMessage(
    vscode.l10n.t("BuilderForce: finish connecting “{0}” in your browser.", server.name),
    open,
  );
  if (pick === open) void vscode.env.openExternal(vscode.Uri.parse(authUrl));
}

/**
 * The `builderforce.registerMcpServer` command: list what this workspace already
 * has, and either connect one of them or register a new one.
 * `ensureSignedIn` is the caller's gate — this needs the tenant JWT.
 */
export async function manageMcpServers(secrets: vscode.SecretStorage): Promise<void> {
  let servers: bfApi.BfMcpExtension[];
  try {
    servers = await bfApi.listMcpExtensions(secrets);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // 403 is the owner gate, and saying so is more useful than the raw status.
    void vscode.window.showErrorMessage(
      /HTTP 403/.test(message)
        ? vscode.l10n.t("BuilderForce: only a workspace owner can manage MCP servers.")
        : vscode.l10n.t("BuilderForce: could not load MCP servers ({0}).", message),
    );
    return;
  }

  const pick = await vscode.window.showQuickPick(
    [
      { label: vscode.l10n.t("$(add) Register external MCP server…"), id: REGISTER, description: "" },
      ...servers.map((s) => ({
        label: `${s.authKind === "oauth" && !s.oauthConnectedAt ? "$(warning) " : "$(plug) "}${s.name}`,
        description: describe(s),
        id: s.id,
      })),
    ],
    {
      title: vscode.l10n.t("BuilderForce MCP servers"),
      placeHolder: vscode.l10n.t("Register a server, or connect one you already registered"),
    },
  );
  if (!pick) return;

  try {
    if (pick.id === REGISTER) {
      const created = await registerFlow(secrets);
      if (!created) return;
      // The catalog is cached for a minute; drop it so the new server's tools are
      // offered on the very next turn instead of after an unexplained delay.
      clearPlatformToolsCache();
      void vscode.window.showInformationMessage(
        vscode.l10n.t("BuilderForce: registered “{0}”.", created.name),
      );
      if (!created.hasSecret) await offerConnect(secrets, created);
      return;
    }
    const server = servers.find((s) => s.id === pick.id);
    if (server) await offerConnect(secrets, server);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    void vscode.window.showErrorMessage(
      /HTTP 403/.test(message)
        ? vscode.l10n.t("BuilderForce: only a workspace owner can manage MCP servers.")
        : vscode.l10n.t("BuilderForce: could not register the MCP server ({0}).", message),
    );
  }
}
