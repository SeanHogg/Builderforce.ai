import * as vscode from "vscode";
import { readMcpConfig, type McpConfigHost } from "@seanhogg/builderforce-mcp/config";
import * as bfApi from "../bfApi";
import { clearPlatformToolsCache } from "../platform/platformTools";
import { messageOf } from "../shared/messageOf";

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

const NATIVE_MCP_LIST = "workbench.mcp.listServer";
const WORKSPACE_MCP_CONFIGS = [
  { host: "vscode", segments: [".vscode", "mcp.json"] },
  { host: "claude-code", segments: [".mcp.json"] },
  { host: "cursor", segments: [".cursor", "mcp.json"] },
] as const satisfies readonly { host: McpConfigHost; segments: readonly string[] }[];

type McpServerPick = vscode.QuickPickItem & (
  | { action: "register" | "native" | "catalog" }
  | { action: "remote"; server: bfApi.BfMcpExtension }
  | { action: "local"; config: vscode.Uri }
);

async function workspaceMcpPicks(): Promise<McpServerPick[]> {
  const decoder = new TextDecoder("utf-8");
  const workspacePicks = await Promise.all((vscode.workspace.workspaceFolders ?? []).map(async (folder) => {
    const configs = await Promise.all(WORKSPACE_MCP_CONFIGS.map(async ({ host, segments }) => {
      const config = vscode.Uri.joinPath(folder.uri, ...segments);
      try {
        const document = decoder.decode(await vscode.workspace.fs.readFile(config));
        return { config, servers: readMcpConfig(document, host) };
      } catch {
        return null;
      }
    }));
    const seen = new Set<string>();
    const picks: McpServerPick[] = [];
    for (const file of configs) {
      if (!file) continue;
      for (const [name, server] of file.servers) {
        if (server.transport !== "stdio") continue;
        const env = Object.entries(server.env ?? {}).sort(([a], [b]) => a.localeCompare(b));
        const identity = JSON.stringify([server.command, server.args ?? [], server.cwd, env]);
        if (seen.has(identity)) continue;
        seen.add(identity);
        picks.push({
          action: "local",
          label: `$(terminal) ${name}`,
          description: vscode.workspace.asRelativePath(file.config),
          config: file.config,
        });
      }
    }
    return picks;
  }));
  return workspacePicks.flat();
}

async function installCatalogServer(secrets: vscode.SecretStorage): Promise<void> {
  const catalog = await bfApi.listMcpConnectorCatalog(secrets);
  const options = catalog.flatMap((offer) => offer.transports.flatMap((transport) =>
    transport.transport === "stdio" ? [{ label: offer.name, id: offer.id, transport }] : [],
  ));
  const pick = await vscode.window.showQuickPick(options, {
    title: vscode.l10n.t("Add a local MCP server"),
  });
  if (!pick) return;

  const args = ["-y", ...pick.transport.npx];
  const env: Record<string, string> = {};
  for (const input of pick.transport.inputs) {
    if (input.kind === "folder") {
      const folder = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false });
      if (!folder?.[0]) return;
      args.push(folder[0].fsPath);
    } else {
      env[input.key] = "${env:" + input.key + "}";
    }
  }

  // The native installer shows the command for review before saving or activating it.
  const definition = { name: pick.id, command: "npx", args, env };
  const uri = vscode.Uri.parse(`${vscode.env.uriScheme}:mcp/install?${encodeURIComponent(JSON.stringify(definition))}`);
  await vscode.env.openExternal(uri);
}

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
    placeHolder: "https://mcp.example.com/mcp",
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
 * Open local configurations and manage platform connections from one picker.
 * Platform writes use the existing tenant sign-in flow.
 */
export async function manageMcpServers(
  secrets: vscode.SecretStorage,
  ensureSignedIn: () => Promise<boolean>,
): Promise<void> {
  const [remote, local, commands] = await Promise.all([
    bfApi.listMcpExtensions(secrets).then(
      (servers) => ({ ok: true as const, servers }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
    workspaceMcpPicks(),
    vscode.commands.getCommands(true),
  ]);
  const picks: McpServerPick[] = [...local];
  if (commands.includes(NATIVE_MCP_LIST)) {
    picks.unshift(
      { action: "catalog", label: `$(add) ${vscode.l10n.t("Add a local MCP server")}` },
      { action: "native", label: vscode.l10n.t("$(gear) Manage local MCP servers") },
    );
  }
  if (!remote.ok) {
    const message = messageOf(remote.error);
    // 403 is the owner gate, and saying so is more useful than the raw status.
    void vscode.window.showErrorMessage(
      /HTTP 403/.test(message)
        ? vscode.l10n.t("BuilderForce: only a workspace owner can manage MCP servers.")
        : vscode.l10n.t("BuilderForce: could not load MCP servers ({0}).", message),
    );
  } else {
    picks.unshift(
      { action: "register", label: vscode.l10n.t("$(add) Register external MCP server…") },
      ...remote.servers.map((server): McpServerPick => ({
        action: "remote",
        label: `${server.authKind === "oauth" && !server.oauthConnectedAt ? "$(warning) " : "$(plug) "}${server.name}`,
        description: describe(server),
        server,
      })),
    );
  }
  if (!picks.length) return;

  const pick = await vscode.window.showQuickPick(
    picks,
    {
      title: vscode.l10n.t("BuilderForce MCP servers"),
      placeHolder: vscode.l10n.t("Register a server, or connect one you already registered"),
    },
  );
  if (!pick) return;

  try {
    if (pick.action === "native") {
      await vscode.commands.executeCommand(NATIVE_MCP_LIST);
      return;
    }
    if (pick.action === "local") {
      await vscode.window.showTextDocument(pick.config);
      return;
    }
    if (pick.action === "catalog") {
      if (await ensureSignedIn()) await installCatalogServer(secrets);
      return;
    }
    if (pick.action === "register") {
      if (!(await ensureSignedIn())) return;
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
    if (pick.action === "remote" && await ensureSignedIn()) await offerConnect(secrets, pick.server);
  } catch (e) {
    const message = messageOf(e);
    void vscode.window.showErrorMessage(
      /HTTP 403/.test(message)
        ? vscode.l10n.t("BuilderForce: only a workspace owner can manage MCP servers.")
        : vscode.l10n.t("BuilderForce: could not register the MCP server ({0}).", message),
    );
  }
}
