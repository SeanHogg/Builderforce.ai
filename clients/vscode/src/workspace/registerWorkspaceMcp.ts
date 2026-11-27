import { isAbsolute, relative, resolve } from "node:path";
import * as vscode from "vscode";
import { createWorkspaceMcpTools, WORKSPACE_MCP_INFO } from "@builderforce/workspace-mcp";
import { hostLog } from "../host/hostLog";
import { knowledgeRootId } from "../knowledge/knowledgeRoots";
import { buildLocalCapabilityProvider } from "../tools/localCapabilities";
import { findRipgrep } from "../tools/ripgrep";
import { startWorkspaceMcpListener } from "./workspaceMcpListener";
import { vscodeWatchPort } from "./workspaceSymbolWatch";
import { symbolGrammarOptions } from "./workspaceSymbols";

function trustedWorkspaceRoots(): string[] {
  if (!vscode.workspace.isTrusted) return [];
  return (vscode.workspace.workspaceFolders ?? [])
    .filter(({ uri }) => uri.scheme === "file" || uri.scheme === "vscode-remote")
    .map(({ uri }) => resolve(uri.fsPath));
}

export function registerWorkspaceMcp(context: vscode.ExtensionContext): void {
  if (typeof vscode.lm?.registerMcpServerDefinitionProvider !== "function") return;
  const changed = new vscode.EventEmitter<void>();
  const tools = createWorkspaceMcpTools((requestedRoot) => {
    const roots = trustedWorkspaceRoots();
    const root = requestedRoot && isAbsolute(requestedRoot)
      ? roots.find((folder) => relative(folder, requestedRoot) === "")
      : requestedRoot === undefined && roots.length === 1 ? roots[0] : undefined;
    if (!root) throw new Error("Choose an open, trusted workspace folder as projectRoot");
    return { root, caps: buildLocalCapabilityProvider(root, { ripgrep: findRipgrep }) };
  }, { grammar: symbolGrammarOptions, watch: vscodeWatchPort(), rootId: knowledgeRootId });

  let listener: ReturnType<typeof startWorkspaceMcpListener> | undefined;
  let disposed = false;
  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider("builderforce.workspace", {
      onDidChangeMcpServerDefinitions: changed.event,
      async provideMcpServerDefinitions(token) {
        if (disposed || token.isCancellationRequested || trustedWorkspaceRoots().length === 0) return [];
        try {
          listener ??= startWorkspaceMcpListener(tools);
          const server = await listener;
          if (disposed || token.isCancellationRequested || trustedWorkspaceRoots().length === 0) return [];
          return [new vscode.McpHttpServerDefinition(
            vscode.l10n.t("BuilderForce Workspace"),
            vscode.Uri.parse(server.url),
            { Authorization: server.authorization },
            WORKSPACE_MCP_INFO.version,
          )];
        } catch (error) {
          listener = undefined;
          hostLog(`Workspace MCP could not start: ${error instanceof Error ? error.message : String(error)}`);
          return [];
        }
      },
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => changed.fire()),
    vscode.workspace.onDidGrantWorkspaceTrust(() => changed.fire()),
    changed,
    { dispose: () => {
      disposed = true;
      void listener?.then((server) => server.dispose(), () => undefined);
    } },
  );
}
