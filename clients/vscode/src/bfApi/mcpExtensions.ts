import type * as vscode from "vscode";
import { authed, authedRaw } from "./transport";
import { getCurrentWorkspace } from "./workspace";

/** A bring-your-own MCP server this workspace has registered. Mirrors the API's
 *  `McpExtensionView` — the credential itself is never returned. */
export interface BfMcpExtension {
  id: string;
  name: string;
  serverUrl: string;
  enabled: boolean;
  hasSecret: boolean;
  authKind: "none" | "secret" | "oauth";
  oauthConnectedAt: string | null;
  allowedTools: string[] | null;
}

/** The workspace's registered MCP servers. `[]` when signed out or unreachable. */
export async function listMcpExtensions(secrets: vscode.SecretStorage): Promise<BfMcpExtension[]> {
  const ws = await getCurrentWorkspace(secrets);
  if (!ws) return [];
  const r = await authed<{ extensions?: BfMcpExtension[] }>(secrets, `/api/tenants/${ws.id}/mcp-extensions`);
  return r?.extensions ?? [];
}

/** Register an external MCP server for the active workspace (owner-only server-side). */
export async function createMcpExtension(
  secrets: vscode.SecretStorage,
  input: { name: string; serverUrl: string; secret?: string },
): Promise<BfMcpExtension | undefined> {
  const ws = await getCurrentWorkspace(secrets);
  if (!ws) return undefined;
  return authed<BfMcpExtension>(secrets, `/api/tenants/${ws.id}/mcp-extensions`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * Begin the three-legged OAuth connect for a registered server. Returns the
 * provider's authorize URL for the caller to open in a browser — the consent
 * screen is a top-level navigation and cannot be shown inside the editor.
 * `undefined` when the server needs no authorization (the API answers 409).
 */
export async function beginMcpOAuthConnect(
  secrets: vscode.SecretStorage,
  extensionId: string,
): Promise<string | undefined> {
  const ws = await getCurrentWorkspace(secrets);
  if (!ws) return undefined;
  const r = await authedRaw<{ authUrl?: string }>(
    secrets,
    `/api/tenants/${ws.id}/mcp-extensions/${extensionId}/oauth/connect`,
  );
  return r?.status === 200 ? r.body?.authUrl : undefined;
}
