import { homedir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";
import { isRemoteMcpEndpoint } from "@seanhogg/builderforce-mcp";
import { readMcpConfig, readSynapseConnectors, type LaunchSpec, type McpConfigHost } from "@seanhogg/builderforce-mcp/config";
import * as bfApi from "../bfApi";
import { getWebBaseUrl } from "../gateway/gateway";
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
const USER_MCP_CONFIGS = [
  { host: "claude-code", segments: [".claude.json"] },
  { host: "cursor", segments: [".cursor", "mcp.json"] },
] as const satisfies readonly { host: McpConfigHost; segments: readonly string[] }[];

type McpServerPick = vscode.QuickPickItem & (
  | { action: "register" | "native" | "catalog" | "import" }
  | { action: "remote"; server: bfApi.BfMcpExtension }
  | { action: "local"; config: vscode.Uri }
);

type ConfigLocation = { host: McpConfigHost; segments: readonly string[]; project?: { path: string; name: string } };

async function configuredMcpPicks(root: vscode.Uri, locations: readonly ConfigLocation[], sharedWorkspaceRoot = false): Promise<McpServerPick[]> {
  const decoder = new TextDecoder("utf-8");
  const configs = await Promise.all(locations.map(async ({ host, segments, project }) => {
    const config = vscode.Uri.joinPath(root, ...segments);
    try {
      const document = decoder.decode(await vscode.workspace.fs.readFile(config));
      return { config, project, servers: readMcpConfig(document, host, { claudeProjectPath: project?.path }) };
    } catch {
      return null;
    }
  }));
  const seen = new Set<string>();
  const picks: McpServerPick[] = [];
  for (const file of configs) {
    if (!file) continue;
    for (const [name, server] of file.servers) {
      // Remote credentials and host-resolved variables cannot prove two configurations are the same.
      // Only coalesce identical literal launches within one workspace root.
      if (sharedWorkspaceRoot && server.transport === "stdio" && !Object.keys(server.env ?? {}).length) {
        const identity = JSON.stringify([server.command, server.args ?? [], server.cwd]);
        if (!identity.includes("${")) {
          if (seen.has(identity)) continue;
          seen.add(identity);
        }
      }
      picks.push({
        action: "local",
        label: `${server.transport === "stdio" ? "$(terminal)" : "$(plug)"} ${name}`,
        description: [vscode.workspace.asRelativePath(file.config), file.project?.name].filter(Boolean).join(" · "),
        config: file.config,
      });
    }
  }
  return picks;
}

async function localMcpPicks(): Promise<McpServerPick[]> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const claudeProjectConfigs = folders.map(({ uri, name }): ConfigLocation => ({
    host: "claude-code", segments: [".claude.json"], project: { path: uri.fsPath, name },
  }));
  const groups = await Promise.all([
    ...folders.map(({ uri }) => configuredMcpPicks(uri, WORKSPACE_MCP_CONFIGS, true)),
    configuredMcpPicks(vscode.Uri.file(homedir()), [...USER_MCP_CONFIGS, ...claudeProjectConfigs]),
  ]);
  return groups.flat();
}

async function browseConnectorCatalog(secrets: vscode.SecretStorage, canInstallLocally: boolean): Promise<void> {
  const catalog = await bfApi.listMcpConnectorCatalog(secrets);
  // Offer local launch and Platform setup separately so each keeps its own credential scope.
  const options = catalog.flatMap((offer) => offer.transports
    .filter((transport) => canInstallLocally || transport.transport === "http")
    .sort((a, b) => Number(a.transport === "http") - Number(b.transport === "http"))
    .map((transport) => ({
      label: `${transport.transport === "stdio" ? "$(terminal)" : "$(globe)"} ${offer.name}`,
      id: offer.id,
      transport,
    })));
  const pick = await vscode.window.showQuickPick(options, { title: vscode.l10n.t("Browse MCP connectors") });
  if (!pick) return;
  if (pick.transport.transport === "http") {
    const url = new URL("/settings/integrations", getWebBaseUrl());
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    url.searchParams.set("connector", pick.transport.connectorKey);
    await vscode.env.openExternal(vscode.Uri.parse(url.href));
    return;
  }

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

  await reviewLocalInstall(pick.id, { command: "npx", args, env });
}

async function reviewLocalInstall(name: string, launch: LaunchSpec): Promise<void> {
  const definition = { name, ...launch };
  const uri = vscode.Uri.parse(`${vscode.env.uriScheme}:mcp/install?${encodeURIComponent(JSON.stringify(definition))}`);
  await vscode.env.openExternal(uri);
}

async function importSynapseConnector(): Promise<void> {
  const root = process.env.BUILDERFORCE_DESKTOP_HOME || join(homedir(), ".builderforce", "desktop");
  const title = vscode.l10n.t("Import a Synapse connector");
  const files = await vscode.window.showOpenDialog({
    title,
    filters: { JSON: ["json"] },
    defaultUri: vscode.Uri.file(join(root, "connectors.json")),
    canSelectMany: false,
  });
  if (!files?.[0]) return;
  const source = new TextDecoder().decode(await vscode.workspace.fs.readFile(files[0]));
  const choices = readSynapseConnectors(source).map((connector) => ({ label: connector.name, connector }));
  const pick = await vscode.window.showQuickPick(choices, { title });
  if (pick) await reviewLocalInstall(pick.connector.id, pick.connector.launch);
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
      isRemoteMcpEndpoint(v) ? undefined : vscode.l10n.t("Enter a public https:// address"),
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
    localMcpPicks(),
    vscode.commands.getCommands(true),
  ]);
  const picks: McpServerPick[] = [...local];
  const hasNativeManager = commands.includes(NATIVE_MCP_LIST);
  if (hasNativeManager) {
    picks.unshift(
      { action: "import", label: `$(import) ${vscode.l10n.t("Import a Synapse connector")}` },
      { action: "native", label: vscode.l10n.t("$(gear) Manage local MCP servers") },
    );
  }
  if (hasNativeManager || remote.ok) {
    picks.unshift({ action: "catalog", label: `$(add) ${vscode.l10n.t("Browse MCP connectors")}` });
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
      if (await ensureSignedIn()) await browseConnectorCatalog(secrets, hasNativeManager);
      return;
    }
    if (pick.action === "import") {
      await importSynapseConnector();
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
