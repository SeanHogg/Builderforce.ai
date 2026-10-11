/**
 * What makes a child run a CHILD — the narrowing, and nothing else.
 *
 * A sub-agent is the same run as the one that spawned it (`brainRunHost.ts` runs both
 * through one `runTurn`), so there is no child loop here. What a delegation decides is
 * only: which of the owner's tools the child may hold, where it may write, and WHO it is
 * (a workspace agent, staffed into the role if nobody fitting was named).
 */

import { DELEGATION_DELIVERY_ROLES, inScope, staffDelegation, type ModelRole } from "@builderforce/agent-tools";
import { isCodeChangeTool } from "@seanhogg/builderforce-brain-embedded";
import type { ToolDef } from "./fileTools";
import type { ChildControls } from "./childRunSpawner";

/** What a child run may do, carried on its run spec. */
export interface ChildPolicy {
  /** Investigation only — no tool that changes anything. */
  readOnly: boolean;
  /** Paths this child may WRITE. Set for a workstream running beside siblings. */
  scope?: readonly string[];
}

/**
 * The child's catalog: the owner's, narrowed.
 *
 *   • read-only ⇒ no mutating tool is HANDED to it (the tools a run holds are the
 *     boundary, so a child that must not write is never shown one);
 *   • scoped (side by side with siblings) ⇒ of the mutating tools only the file writers
 *     whose target a scope can check: a shell, a commit or a push reaches the whole tree
 *     whatever the scope says, so the owner verifies, commits and pushes.
 *
 * Delegation tools are not narrowed here: the child's catalog is built with ITS OWN
 * controls, which stop offering spawn at the depth cap (`brainToolCatalog.ts`).
 */
export function childCatalog(defs: readonly ToolDef[], policy: ChildPolicy): ToolDef[] {
  return defs.filter((t) => {
    if (!t.mutating) return true;
    if (policy.readOnly) return false;
    return !policy.scope || isCodeChangeTool(t.name);
  });
}

/**
 * Why a scoped child may not make this write, or null. Refused BEFORE the human is asked,
 * so nobody is prompted for a write that must not happen; a sibling may own the path.
 */
export function scopeRefusal(def: ToolDef, args: unknown, scope: readonly string[] | undefined): { ok: false; error: string } | null {
  if (!scope || !def.mutating) return null;
  const target = args && typeof args === "object" && typeof (args as { path?: unknown }).path === "string" ? (args as { path: string }).path : "";
  if (target && inScope(target, scope)) return null;
  return {
    ok: false,
    error: `'${target || "(no path)"}' is outside this workstream's paths (${scope.join(", ")}) — another workstream may own it. Change only files inside your paths, and name anything else you believe must change in your report.`,
  };
}

/** One workspace agent as a child runs AS it. */
export interface ResolvedPersona {
  ref: string;
  name: string;
  brief: string;
  roleKeys?: readonly string[];
}

/** What the delegation tools need from the host. */
export interface SubagentToolDeps {
  /** The owner's handle on its children. Absent ⇒ this surface cannot host a child run. */
  children?: ChildControls;
  /**
   * Resolve one of the WORKSPACE's own agents (Ada, Kevin, Bob…) to the brief the child
   * should run as. Absent ⇒ `as_agent` is refused rather than silently ignored. `null`
   * means "no such agent", not "reader failed".
   */
  personaBrief?(agent: string): Promise<ResolvedPersona | null>;
  /**
   * Staff a delivery ROLE on this run's project — the project's capable teammate, or a
   * newly HIRED agent holding the role — and assign `ticket` to it. Absent, or null, ⇒
   * the slice falls back to an on-demand persona.
   */
  staffRole?(role: string, ticket?: string): Promise<(ResolvedPersona & { created?: boolean }) | null>;
}

/** A resolved persona, or a refusal the owner can act on. */
export type ChildPersona =
  | { ok: true; persona?: { name: string; brief: string }; asAgent?: { ref: string; name: string }; note?: string }
  | { ok: false; error: string };

/**
 * WHO does a slice. An unresolvable name is REFUSED rather than run anonymously: an owner
 * that believes Ada did the work will report that she did. A slice that needs a delivery
 * role (Developer for code, QA for verify) is STAFFED when nobody fitting was named — the
 * project's capable teammate takes it, or one is hired — and the child runs AS that real
 * agent. Only where the host cannot staff does it fall back to an on-demand role persona.
 */
export async function resolveChildPersona(
  deps: SubagentToolDeps,
  asAgentName: string,
  role: ModelRole,
  ticket?: string,
): Promise<ChildPersona> {
  const needed = DELEGATION_DELIVERY_ROLES[role];
  if (!asAgentName) return needed ? staffChild(deps, needed, ticket) : { ok: true };
  const resolved = await deps.personaBrief?.(asAgentName).catch(() => null);
  if (!resolved) {
    return {
      ok: false,
      error: `no agent named '${asAgentName}' in this workspace — use builtin_chats_list_agents or builtin_cloud_agents_list_mine and pass its exact name or id`,
    };
  }
  const staffing = staffDelegation(resolved, role);
  if (staffing.kind === "on-demand") {
    return staffChild(deps, needed!, ticket, { persona: staffing.persona, note: staffing.note, named: resolved.name });
  }
  return { ok: true, persona: { name: resolved.name, brief: resolved.brief }, asAgent: { ref: resolved.ref, name: resolved.name } };
}

async function staffChild(
  deps: SubagentToolDeps,
  roleKey: string,
  ticket: string | undefined,
  fallback?: { persona: { name: string; brief: string }; note: string; named: string },
): Promise<ChildPersona> {
  const staffed = await deps.staffRole?.(roleKey, ticket).catch(() => null);
  if (staffed) {
    const why = fallback ? `${fallback.named} does not hold ${roleKey}, so ` : "";
    const how = staffed.created ? `${staffed.name} was hired as ${roleKey} for this project` : `${staffed.name} (${roleKey}) took it`;
    return {
      ok: true,
      persona: { name: staffed.name, brief: staffed.brief },
      asAgent: { ref: staffed.ref, name: staffed.name },
      note: `${why}${how}${ticket ? ` and ticket ${ticket} is assigned to them` : ""}.`,
    };
  }
  return fallback ? { ok: true, persona: fallback.persona, note: fallback.note } : { ok: true };
}
