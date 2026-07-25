/**
 * laneApprover — THE answer to "who must approve this lane?".
 *
 * WHY THIS EXISTS (measured, not hypothetical). Approval used to resolve required roles
 * from ONE source: the `swimlane_requirements` table. In production exactly 1 of 11
 * boards has any requirement rows. On the other 10, `enforceLaneRequirements` returned
 * `none` before it ever reached its reviewer dispatch, so no reviewer was asked, no
 * manifest slot ever completed, and `ticket_role_signoffs` was EMPTY tenant-wide — 487
 * required slots, 0 satisfied. Every downstream gate built on sign-off (the Manager's
 * self-governance gate, the Done gate, the accountability report) was therefore
 * unsatisfiable by construction, not by policy.
 *
 * The operator's actual configuration on those boards is not a template — it is
 * STAFFING: `swimlane_agent_assignments` says which agent works a lane. So that
 * staffing is the fallback answer to who approves it.
 *
 * ── PRECEDENCE (documented, single implementation) ────────────────────────────────
 *   (a) `requirements` — the lane's `swimlane_requirements` reviewer/role rows. When a
 *       lane declares requirements they win outright and nothing here changes existing
 *       behaviour: this module reports the tier and hands the role keys straight back.
 *   (b) `lane_agents`  — otherwise, the agents STAFFED on the lane
 *       (`swimlane_agent_assignments`), each mapped to a role key it is genuinely
 *       CAPABLE of, deduplicated by role key.
 *   (c) `none`         — otherwise nothing. This is a FAIL-CLOSED verdict: it means
 *       "no approver could be resolved, so approval cannot be satisfied
 *       automatically". It must NEVER be read as implicit approval — with no approver
 *       there is no manifest slot, and `decideSignoffGate` correctly stays shut on an
 *       empty manifest.
 *
 * WHY THE ROLE KEY MUST BE ONE THE AGENT IS CAPABLE OF. The sign-off route is
 * default-deny: `POST /api/kanban/tasks/:id/signoff` rejects an agent that is not
 * `isAgentRefRoleCapable` of the `roleKey` with a 403. Resolving a role the staffed
 * agent cannot act as would therefore dispatch a run that is guaranteed to be refused
 * at the last step — a paid run that can never close the loop. So capability is part
 * of resolution, not a later check.
 *
 * The decision is a PURE function ({@link decideLaneApprovers}) with the queries kept in
 * {@link loadLaneStaffedAgents}, so every precedence branch is unit-tested with no DB.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { ideAgents, swimlaneAgentAssignments } from '../../infrastructure/database/schema';
import { BUILTIN_ROLES, isReviewRole, roleDisplayName } from '../kanban/roleCatalog';
import { agentRoleKeys } from '../kanban/roleCapability';
import { normalizeRoleText } from '../kanban/roleMatch';

/** Which tier of the precedence answered "who approves this lane?". */
export type LaneApproverTier = 'requirements' | 'lane_agents' | 'none';

export type LaneApproverReason =
  /** (a) the lane declares requirement rows — they own the lane. */
  | 'requirement_rows'
  /** (b) no requirement rows, but the lane is staffed with role-capable agent(s). */
  | 'lane_agents'
  /** (c) no requirement rows and no agents staffed on the lane at all. */
  | 'lane_unstaffed'
  /** (c) staffed, but no staffed agent can act AS any role — its sign-off would 403. */
  | 'lane_agents_not_role_capable';

/** A lane's staffed agent plus the facts needed to decide which role it approves as. */
export interface LaneStaffedAgent {
  agentRef: string;
  agentName: string | null;
  /**
   * `swimlane_agent_assignments.role` — the operator's declared role text. In practice
   * `resolveAssignedAgent` stores the chosen agent's DISPLAY NAME here, not a role key
   * ("Aria the Architect", not "architect"), which is exactly why the pre-existing
   * `normalizeRoleText(role) === roleKey` equality match in `laneRequirementGate`
   * almost never matched anything.
   */
  declaredRole: string | null;
  /** Model pinned on the assignment, carried into the approval run's dispatch. */
  model: string | null;
  position: number;
  /** Role keys this agent may act AS (`roleCapability.agentRoleKeys`). Empty ⇒ cannot approve. */
  capableRoleKeys: readonly string[];
}

/** One resolved approver of a lane. */
export interface LaneApprover {
  roleKey: string;
  roleName: string;
  /** The agent to dispatch. Null on tier (a), where the gate resolves the agent itself. */
  agentRef: string | null;
  agentName: string | null;
  model: string | null;
}

export interface LaneApproverDecision {
  tier: LaneApproverTier;
  /** Deduplicated by role key, in lane-assignment order (tier b) / requirement order (tier a). */
  approvers: LaneApprover[];
  /**
   * True when at least one approver was resolved. FALSE is the fail-closed verdict: no
   * approver exists to ask, so approval cannot be satisfied automatically — it is NOT
   * permission to proceed unapproved.
   */
  approverResolved: boolean;
  reason: LaneApproverReason;
}

/**
 * Map free-form role text to a builtin role key by LONGEST containment match.
 *
 * Longest wins because short keys are substrings of long names: "Product Manager"
 * contains both `manager` (Delivery Manager) and `product-manager`, and picking the
 * first match in catalog order would silently classify every product manager as the
 * delivery manager. Pure.
 */
export function builtinRoleKeyFromText(text: string | null | undefined): string | null {
  const hay = normalizeRoleText(text ?? '');
  if (!hay) return null;
  let best: { key: string; len: number } | null = null;
  for (const role of BUILTIN_ROLES) {
    for (const needle of [normalizeRoleText(role.name), normalizeRoleText(role.key)]) {
      if (!needle || !hay.includes(needle)) continue;
      if (!best || needle.length > best.len) best = { key: role.key, len: needle.length };
    }
  }
  return best?.key ?? null;
}

/**
 * The role a staffed lane agent APPROVES AS, or null when it cannot approve anything.
 *
 * Sub-precedence, most-intentional first:
 *   1. the operator's declared assignment role text, when it names a builtin role the
 *      agent is actually capable of (an explicit configuration beats an inference);
 *   2. else the first REVIEW-shaped role it is capable of, in catalog order — we are
 *      resolving an APPROVER, and `isReviewRole` is already the codebase's definition
 *      of "a sign-off that is a judgement on the change";
 *   3. else the first builtin role of any kind it is capable of (a producing role's
 *      sign-off is still a real accountability record: "the developer confirms done");
 *   4. else a tenant-CUSTOM role key the agent explicitly declares via `role_keys`.
 * Pure.
 */
export function approverRoleKeyForLaneAgent(agent: LaneStaffedAgent): string | null {
  const capable = new Set(agent.capableRoleKeys);
  if (capable.size === 0) return null;

  const declared = builtinRoleKeyFromText(agent.declaredRole);
  if (declared && capable.has(declared)) return declared;

  const review = BUILTIN_ROLES.find((r) => capable.has(r.key) && isReviewRole(r.key));
  if (review) return review.key;

  const anyBuiltin = BUILTIN_ROLES.find((r) => capable.has(r.key));
  if (anyBuiltin) return anyBuiltin.key;

  // Deterministic pick among custom keys so repeated resolution is stable (the
  // manifest slot's unique index is keyed on the role, so a flapping choice would
  // materialise duplicate required slots that can never all be satisfied).
  return [...capable].sort()[0] ?? null;
}

/**
 * Decide who approves a lane. PURE — see the module header for the precedence.
 *
 * `requirementRoleKeys` are the lane's ALREADY-FILTERED required reviewer/role refs
 * (the caller has applied `requirementApplies` for the ticket's type/condition), so a
 * requirement that does not apply to this ticket correctly cannot suppress tier (b).
 */
export function decideLaneApprovers(input: {
  requirementRoleKeys: readonly string[];
  laneAgents: readonly LaneStaffedAgent[];
}): LaneApproverDecision {
  // (a) Requirement rows own the lane. Agent refs are left null: the existing gate
  // resolves the agent for a required role via its own staffed→role-capable resolver,
  // and that path is deliberately untouched.
  if (input.requirementRoleKeys.length > 0) {
    const seen = new Set<string>();
    const approvers: LaneApprover[] = [];
    for (const key of input.requirementRoleKeys) {
      if (seen.has(key)) continue;
      seen.add(key);
      approvers.push({ roleKey: key, roleName: roleDisplayName(key), agentRef: null, agentName: null, model: null });
    }
    return { tier: 'requirements', approvers, approverResolved: true, reason: 'requirement_rows' };
  }

  // (c) Nothing staffed and nothing declared — fail closed.
  if (input.laneAgents.length === 0) {
    return { tier: 'none', approvers: [], approverResolved: false, reason: 'lane_unstaffed' };
  }

  // (b) The lane's staffed agents, each as the role it can approve as. Deduplicated by
  // ROLE KEY because the sign-off ledger and the manifest are both role-keyed: two
  // agents sharing one role could never be tracked as two slots, so the lowest-position
  // assignment becomes that role's approver.
  const byRole = new Map<string, LaneApprover>();
  const ordered = [...input.laneAgents].sort(
    (a, b) => a.position - b.position || a.agentRef.localeCompare(b.agentRef),
  );
  for (const agent of ordered) {
    const roleKey = approverRoleKeyForLaneAgent(agent);
    if (!roleKey || byRole.has(roleKey)) continue;
    byRole.set(roleKey, {
      roleKey,
      roleName: roleDisplayName(roleKey),
      agentRef: agent.agentRef,
      agentName: agent.agentName,
      model: agent.model,
    });
  }
  if (byRole.size === 0) {
    return { tier: 'none', approvers: [], approverResolved: false, reason: 'lane_agents_not_role_capable' };
  }
  return { tier: 'lane_agents', approvers: [...byRole.values()], approverResolved: true, reason: 'lane_agents' };
}

/**
 * Load a lane's staffed agents WITH their role capability, in exactly TWO queries: the
 * assignments, then ONE batched `ide_agents` read for every distinct ref. Never a
 * capability lookup per agent — this runs on every lane entry and inside the autonomous
 * sweep, where a per-agent round-trip would be an N+1 on the hot path.
 *
 * Only `active` agents are returned. A retired/archived agent still pinned to a lane
 * yields no capability row, so it resolves to no role and the lane falls to tier (c)
 * rather than burning a run dispatching an agent that no longer exists.
 */
export async function loadLaneStaffedAgents(db: Db, tenantId: number, swimlaneId: string): Promise<LaneStaffedAgent[]> {
  const rows = await db
    .select({
      agentRef: swimlaneAgentAssignments.agentRef,
      name: swimlaneAgentAssignments.name,
      role: swimlaneAgentAssignments.role,
      model: swimlaneAgentAssignments.model,
      position: swimlaneAgentAssignments.position,
    })
    .from(swimlaneAgentAssignments)
    .where(and(eq(swimlaneAgentAssignments.tenantId, tenantId), eq(swimlaneAgentAssignments.swimlaneId, swimlaneId)));

  const refs = [...new Set(rows.flatMap((r) => (r.agentRef ? [r.agentRef] : [])))];
  if (refs.length === 0) return [];

  const agentRows = await db
    .select({
      id: ideAgents.id, name: ideAgents.name, title: ideAgents.title,
      skills: ideAgents.skills, builtinKind: ideAgents.builtinKind, roleKeys: ideAgents.roleKeys,
    })
    .from(ideAgents)
    .where(and(eq(ideAgents.tenantId, tenantId), eq(ideAgents.status, 'active'), inArray(ideAgents.id, refs)));
  const byId = new Map(agentRows.map((a) => [a.id, a]));

  return rows.flatMap((r) => {
    if (!r.agentRef) return [];
    const agent = byId.get(r.agentRef);
    return [{
      agentRef: r.agentRef,
      agentName: r.name ?? agent?.name ?? null,
      declaredRole: r.role ?? null,
      model: r.model ?? null,
      position: r.position,
      capableRoleKeys: agent ? [...agentRoleKeys(agent)] : [],
    }];
  });
}

/**
 * The IO wrapper over {@link decideLaneApprovers}: short-circuits with ZERO extra
 * queries when the lane already declares requirements (tier a), and only then reads the
 * lane's staffing. Callers pass the requirement refs they have already loaded and
 * filtered, so nothing is queried twice.
 */
export async function resolveLaneApprovers(
  db: Db,
  args: { tenantId: number; swimlaneId: string; requirementRoleKeys: readonly string[] },
): Promise<LaneApproverDecision> {
  if (args.requirementRoleKeys.length > 0) {
    return decideLaneApprovers({ requirementRoleKeys: args.requirementRoleKeys, laneAgents: [] });
  }
  const laneAgents = await loadLaneStaffedAgents(db, args.tenantId, args.swimlaneId);
  return decideLaneApprovers({ requirementRoleKeys: [], laneAgents });
}
