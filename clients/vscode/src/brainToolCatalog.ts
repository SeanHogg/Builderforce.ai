/**
 * The ONE tool catalog an editor-hosted Brain run advertises and executes: the local
 * workspace tools (file edits, search, shell, git), Evermind's write-through
 * cognition tools, and the SHARED server-side platform catalog (projects, tasks,
 * OKRs, specs, …) fetched from the gateway MCP relay.
 *
 * Shared by the native `@builderforce` chat participant and the host-owned webview
 * run (`brainRunHost.ts`), so the two chat surfaces cannot drift apart in what the
 * model may call. Each group is gated on what it actually requires: file tools need
 * a workspace, `remember_fact` needs only a project (works chat-only), the platform
 * catalog needs an account (the fetch returns nothing signed out).
 */

import type * as vscode from "vscode";
import { TOOL_DEFS, type ToolDef } from "./fileTools";
import { cognitionToolDefs } from "./cognition";
import { listPlatformTools } from "./platformTools";

export async function brainToolCatalog(
  secrets: vscode.SecretStorage,
  root: string | undefined,
  projectId: number | undefined,
): Promise<ToolDef[]> {
  const cognitionTools = projectId != null ? cognitionToolDefs(secrets, projectId) : [];
  const platformTools = await listPlatformTools(secrets);
  return [...(root ? TOOL_DEFS : []), ...cognitionTools, ...platformTools];
}
