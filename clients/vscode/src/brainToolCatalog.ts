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
import { subagentToolDef } from "./subagentTool";
import { subagentFanOutToolDef } from "./subagentFanOutTool";
import type { SubagentRunBinding } from "./subagentRun";
import { ticketBranchReviewToolDef } from "./ticketBranchTool";
import { desktopBackedTools } from "./desktopContext";

export async function brainToolCatalog(
  secrets: vscode.SecretStorage,
  root: string | undefined,
  projectId: number | undefined,
  /** Model route for a delegated child run. Omitted ⇒ no `spawn_agent`: advertising a
   *  tool whose only backing is a model we cannot reach would surface a call that is
   *  certain to fail. */
  stream?: () => Promise<BrainStreamFn>,
  /** The run a delegated child belongs to — its write gate, Stop, model route, tool
   *  bookkeeping and chat report (`SubagentRunBinding`). Omitted ⇒ children stay
   *  read-only; delegation is still advertised, because a read-only child is the DEFAULT
   *  and is most of what delegation is for. */
  run?: SubagentRunBinding,
): Promise<ToolDef[]> {
  const cognitionTools = projectId != null ? cognitionToolDefs(secrets, projectId) : [];
  const platformTools = await listPlatformTools(secrets);
  // The ticket branch review needs both halves: the project's tickets AND a checkout to
  // compare their branches in.
  // `semantic_search` / `repo_map` stay only while Builderforce Desktop answers — a run
  // never sees a tool whose only backing is a service that is not running.
  const localTools = root
    ? await desktopBackedTools([...TOOL_DEFS, ...(projectId != null ? [ticketBranchReviewToolDef(secrets, projectId)] : [])])
    : [];
  // Delegation needs a workspace to explore AND a model to run the child on. Built
  // last so its `catalog()` can hand the child the tools assembled above — the child's
  // read-only subset is derived from the parent's catalog, never a second list that
  // could drift from it.
  // One child, and several side by side (`spawn_agents` — what a planner's hand-off fans
  // out to), on the SAME deps: they differ only in how many children they start.
  const deps = root && stream
    ? {
        stream,
        catalog: () => [...localTools, ...cognitionTools, ...platformTools],
        personaBrief: (agent: string) => resolvePersonaBrief(platformTools, agent, root),
        ...(run ? { run } : {}),
      }
    : null;
  const delegation: ToolDef[] = deps ? [subagentToolDef(deps), subagentFanOutToolDef(deps)] : [];
  return [...localTools, ...cognitionTools, ...platformTools, ...delegation];
}

/** The read-only platform tool that answers "who is this agent, and what are they for?". */
const PERSONA_BRIEF_TOOL = "builtin_cloud_agents_persona_brief";

/**
 * Resolve one workspace agent to the brief a persona sub-agent runs as.
 *
 * Deliberately NOT a second HTTP client: the gateway catalog this run already assembled
 * carries the tool, so the lookup goes through the SAME relay, auth and cache as every
 * other platform call. A hand-rolled fetch here would be a second copy of the auth/base-URL
 * decision, and the first one to drift would fail silently — as a persona that "does not
 * exist" on a workspace full of agents.
 *
 * Returns null on anything that is not a clean hit (tool absent on an older gateway, the
 * relay refusing, `{ ok:false }`, a missing name): the caller turns that into a refusal
 * naming the tools that list the real agents, which is more use than a guess.
 */
async function resolvePersonaBrief(
  platformTools: readonly ToolDef[],
  agent: string,
  root: string,
): Promise<{ ref: string; name: string; brief: string; roleKeys?: string[] } | null> {
  const tool = platformTools.find((t) => t.name === PERSONA_BRIEF_TOOL);
  if (!tool) return null;
  try {
    const raw = await tool.execute({ agent }, root);
    const parsed = JSON.parse(raw) as { ok?: boolean; agentRef?: unknown; name?: unknown; title?: unknown; brief?: unknown; roleKeys?: unknown };
    if (!parsed || parsed.ok === false) return null;
    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    if (!name) return null;
    const brief = typeof parsed.brief === "string" ? parsed.brief.trim() : "";
    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    return {
      ref: typeof parsed.agentRef === "string" && parsed.agentRef ? parsed.agentRef : name,
      name,
      // The title is part of WHO the agent is; a brief that drops it makes a Security
      // Reviewer and a Frontend Engineer read as the same anonymous helper.
      brief: [title, brief].filter(Boolean).join(" — ") || name,
      // What tells a Developer from a QA when a slice is handed to this agent. Absent
      // (an older api) ⇒ the role check does not filter rather than refusing everyone.
      ...(Array.isArray(parsed.roleKeys)
        ? { roleKeys: parsed.roleKeys.filter((k): k is string => typeof k === "string") }
        : {}),
    };
  } catch {
    return null;
  }
}
