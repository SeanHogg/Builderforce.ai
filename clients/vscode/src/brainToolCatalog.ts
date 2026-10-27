/**
 * The ONE tool catalog an editor-hosted Brain run advertises and executes: the local
 * workspace tools (file edits, search, shell, git), Evermind's write-through
 * cognition tools, delegation to sub-agents, and the SHARED server-side platform
 * catalog (projects, tasks, OKRs, specs, …) fetched from the gateway MCP relay.
 *
 * Shared by the native `@builderforce` chat participant and the host-owned webview
 * run (`brainRunHost.ts`), so the two chat surfaces cannot drift apart in what the
 * model may call. Each group is gated on what it actually requires: file tools need
 * a workspace, `remember_fact` needs only a project (works chat-only), delegation
 * needs a workspace and a host that can run a child, the platform catalog needs an account (the
 * fetch returns nothing signed out).
 */

import type * as vscode from "vscode";
import { TOOL_DEFS, type ToolDef } from "./fileTools";
import { cognitionToolDefs } from "./cognition";
import { listPlatformTools } from "./platformTools";
import { subagentToolDef } from "./subagentTool";
import { subagentFanOutToolDef } from "./subagentFanOutTool";
import { subagentControlToolDefs } from "./subagentControlTools";
import type { ChildControls } from "./childRunSpawner";
import { ticketBranchReviewToolDef } from "./ticketBranchTool";
import { desktopBackedTools } from "./desktopContext";
import { withLocalResearch } from "./localResearch/researchPort";

export async function brainToolCatalog(
  secrets: vscode.SecretStorage,
  root: string | undefined,
  projectId: number | undefined,
  /** This run's handle on its sub-agents (`childRunSpawner.ts`). Omitted ⇒ no delegation
   *  tools: a child is an ordinary run, and a surface that cannot start one must not
   *  advertise a call that is certain to fail. */
  children?: ChildControls,
  /** This run's Stop, read when a `wait_agents` call starts. */
  signal?: () => AbortSignal | undefined,
  /** `memory: false` — the chat's Memory switch is off: no `recall_facts` /
   *  `remember_fact`, so the run neither reads nor writes project memory. Default on. */
  opts: { memory?: boolean } = {},
): Promise<ToolDef[]> {
  const cognitionTools = projectId != null && opts.memory !== false ? cognitionToolDefs(secrets, projectId) : [];
  const platformTools = await listPlatformTools(secrets);
  // The ticket branch review needs both halves: the project's tickets AND a checkout to
  // compare their branches in.
  // `semantic_search` stays only while Builderforce Desktop answers and `read_compressed`
  // only while it has its compressor — a run never sees a tool whose only backing is a
  // service that is not running. `repo_map` always stays: without Desktop it is served
  // from the workspace's own symbol index (`localSemantic.ts`). `local_research` stays only
  // while a model on this machine can answer it.
  const localTools = root
    ? await withLocalResearch(await desktopBackedTools(
        [...TOOL_DEFS, ...(projectId != null ? [ticketBranchReviewToolDef(secrets, projectId)] : [])],
        { localRepoMap: true },
      ))
    : [];
  // Delegation needs a workspace AND a host that can run the child. Spawning stops at the
  // depth cap, but the collect / redirect / stop verbs stay while children may be live.
  const deps = root && children
    ? {
        children,
        personaBrief: (agent: string) => resolvePersonaBrief(platformTools, agent, root),
        ...(projectId != null
          ? { staffRole: (role: string, ticket?: string) => staffRoleOnProject(platformTools, projectId, role, ticket, root) }
          : {}),
      }
    : null;
  const delegation: ToolDef[] = deps
    ? [
        ...(children!.canSpawn ? [subagentToolDef(deps), subagentFanOutToolDef(deps)] : []),
        ...subagentControlToolDefs(children!, signal ?? (() => undefined)),
      ]
    : [];
  return [...localTools, ...cognitionTools, ...platformTools, ...delegation];
}

/** The read-only platform tool that answers "who is this agent, and what are they for?". */
const PERSONA_BRIEF_TOOL = "builtin_cloud_agents_persona_brief";
/** The platform tool that staffs a role on a project — reusing a teammate or hiring one. */
const STAFF_ROLE_TOOL = "builtin_cloud_agents_staff_role";

/**
 * Staff `role` on the run's project through the SAME relay as every platform call, and
 * assign the slice's ticket to whoever takes it (`cloud_agents.staff_role` assigns without
 * starting a cloud run — the local child is the run). Null when the gateway predates the
 * tool or refuses: the caller falls back to an on-demand persona.
 */
async function staffRoleOnProject(
  platformTools: readonly ToolDef[],
  projectId: number,
  role: string,
  ticket: string | undefined,
  root: string,
): Promise<{ ref: string; name: string; brief: string; roleKeys?: string[]; created?: boolean } | null> {
  const tool = platformTools.find((t) => t.name === STAFF_ROLE_TOOL);
  if (!tool) return null;
  const taskId = ticket != null ? Number(String(ticket).replace(/^#/, "")) : NaN;
  try {
    const raw = await tool.execute({ role, projectId, ...(Number.isInteger(taskId) ? { taskIds: [taskId] } : {}) }, root);
    const persona = parsePersona(raw);
    if (!persona) return null;
    const created = (JSON.parse(raw) as { created?: unknown }).created === true;
    return { ...persona, created };
  } catch {
    return null;
  }
}

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
    return parsePersona(await tool.execute({ agent }, root));
  } catch {
    return null;
  }
}

/**
 * One agent persona out of a platform tool's JSON — `persona_brief` and `staff_role` answer
 * in the same shape, so they are read by the same parser.
 */
function parsePersona(raw: string): { ref: string; name: string; brief: string; roleKeys?: string[] } | null {
  try {
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
