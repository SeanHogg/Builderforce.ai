/**
 * The ONE tool catalog an editor-hosted Brain run advertises and executes: the local
 * workspace tools (file edits, search, shell, git), Evermind's write-through
 * cognition tools, delegation to a sub-agent, and the SHARED server-side platform
 * catalog (projects, tasks, OKRs, specs, …) fetched from the gateway MCP relay.
 *
 * Shared by the native `@builderforce` chat participant and the host-owned webview
 * run (`brainRunHost.ts`), so the two chat surfaces cannot drift apart in what the
 * model may call. Each group is gated on what it actually requires: file tools need
 * a workspace, `remember_fact` needs only a project (works chat-only), delegation
 * needs a workspace and a model route, the platform catalog needs an account (the
 * fetch returns nothing signed out).
 */

import type * as vscode from "vscode";
import type { BrainStreamFn } from "@seanhogg/builderforce-brain-embedded";
import { TOOL_DEFS, type ToolDef } from "./fileTools";
import { cognitionToolDefs } from "./cognition";
import { listPlatformTools } from "./platformTools";
import { subagentToolDef, type SubagentToolDeps } from "./subagentTool";

export async function brainToolCatalog(
  secrets: vscode.SecretStorage,
  root: string | undefined,
  projectId: number | undefined,
  /** Model route for a delegated child run. Omitted ⇒ no `spawn_agent`: advertising a
   *  tool whose only backing is a model we cannot reach would surface a call that is
   *  certain to fail. */
  stream?: () => Promise<BrainStreamFn>,
  /** How a delegated child asks permission to write. Omitted ⇒ children stay read-only;
   *  `spawn_agent` is still advertised, because a read-only child is the DEFAULT and is
   *  most of what delegation is for. */
  confirmWrite?: SubagentToolDeps["confirmWrite"],
): Promise<ToolDef[]> {
  const cognitionTools = projectId != null ? cognitionToolDefs(secrets, projectId) : [];
  const platformTools = await listPlatformTools(secrets);
  const localTools = root ? TOOL_DEFS : [];
  // Delegation needs a workspace to explore AND a model to run the child on. Built
  // last so its `catalog()` can hand the child the tools assembled above — the child's
  // read-only subset is derived from the parent's catalog, never a second list that
  // could drift from it.
  const delegation: ToolDef[] =
    root && stream
      ? [subagentToolDef({
          stream,
          catalog: () => [...localTools, ...cognitionTools, ...platformTools],
          ...(confirmWrite ? { confirmWrite } : {}),
        })]
      : [];
  return [...localTools, ...cognitionTools, ...platformTools, ...delegation];
}
