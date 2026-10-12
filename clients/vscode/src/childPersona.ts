/**
 * WHO a child run is — the one decision a delegation makes about it.
 *
 * A sub-agent is a CLONE of the run that spawned it: the same run (`brainRunHost.ts` runs
 * both through one `runTurn`), the same catalog, the same approval gate, the same
 * execution. There is no child loop, no child catalog and no child policy. A delegation
 * decides only who the child runs AS — a workspace agent, staffed into the role if nobody
 * fitting was named.
 */

import { DELEGATION_DELIVERY_ROLES, staffDelegation, type ModelRole } from "@builderforce/agent-tools";
import type { ChildControls } from "./childRunSpawner";

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
