import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * managedLaneRoles — THE answer to "which roles may execute this stage of this ticket,
 * and who can act as one", on a lifecycle-managed board.
 *
 * ── THE FAILURE THIS CLOSES ──────────────────────────────────────────────────────
 * A managed board accepts only role-attributed executions: `authorizeManagedTaskExecution`
 * refuses any dispatch payload without an `actAsRole`/`reviewRole`. The lane trigger
 * (`maybeAutoRunOnLaneEntry`) never produced one — it built `{cloudAgentRef, model,
 * laneKey}` and handed it straight to the dispatcher — so on a managed board the trigger
 * could NEVER dispatch. `dispatchCloudRunForTask` threw, the trigger recorded
 * `auto_run_error`, and because the throw happened BEFORE the execution row existed, no
 * failure was recorded: the 3-strike breaker and the re-run cooldown never engaged and
 * the refusal repeated on every sweep, forever.
 *
 * Every autonomous dispatcher funnels through that trigger — the cron sweep,
 * `system:lane-auto`, the manager's stage-5 dispatch, its triage remedies, ceremonies,
 * the MCP task tools, a board drag. Only `requestRoleRun` callers (the requirement gate's
 * reviewer/producer asks, `driveOutstandingSignoffs`) ever passed. Measured on project 11:
 * task 1032 — a manager systemic-finding ticket — was dead on arrival, and the
 * `unassigned` / `never_started` cohorts are largely this.
 *
 * ── WHY IT IS ONE MODULE AND NOT TWO OPINIONS ────────────────────────────────────
 * The GUARD (which roles are allowed) and the DISPATCHER (which role to send) were
 * deriving the same fact independently. That asymmetry is the whole bug class — the same
 * shape that had already emptied the sign-off ledger when the role SELECTOR and the
 * sign-off GATE disagreed about what "role-capable" means. So the authority is resolved
 * once here, and both sides read it: the guard cannot refuse what the dispatcher sends,
 * because the dispatcher only sends what this module authorized.
 *
 * ── COST ─────────────────────────────────────────────────────────────────────────
 * {@link resolveManagedLaneAuthority} is the single-lane path (the guard, the evaluator).
 * {@link loadBoardLaneAuthorities} is the BULK path for the census, which must classify
 * every ticket in a project: it loads a whole board's lanes, requirements and staffing in
 * four queries and then decides per ticket in memory, so a 675-ticket census costs four
 * round-trips, not 675 (or even one per lane).
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { swimlaneRequirements, swimlanes, ticketParticipants } from '../../infrastructure/database/schema';
import {
  decideLaneApprovers, loadLaneStaffedAgents, loadStaffedAgentsForLanes,
  type LaneApprover, type LaneApproverTier, type LaneStaffedAgent,
} from '../swimlane/laneApprover';
import { isParticipantOpen } from './participantStates';
import { requirementApplies } from './types';

/** The ticket facts a requirement's applicability is scoped by. */
export interface ManagedTaskScope {
  taskType?: string | null;
  actionType?: string | null;
}

/** What a managed stage authorizes for ONE ticket. */
export interface ManagedLaneAuthority {
  /**
   * Role keys this stage authorizes for this ticket — the set the guard enforces and the
   * dispatcher must pick from. Empty means the stage authorizes nothing, which is a
   * FAIL-CLOSED verdict (no dispatch), never "anything goes".
   */
  roleKeys: string[];
  /** The resolved approvers. Tier (a) carries no agent; tier (b) always does. */
  approvers: LaneApprover[];
  tier: LaneApproverTier;
}

/** The lane inputs a per-ticket authority decision needs, loaded once per lane. */
export interface LaneAuthorityInputs {
  requirements: Array<{ kind: string; ref: string; ticketType: string | null; condition: string | null }>;
  laneAgents: LaneStaffedAgent[];
}

/**
 * Decide a stage's authority for one ticket. PURE — the queries live in
 * {@link resolveManagedLaneAuthority} / {@link loadBoardLaneAuthorities}.
 *
 * Requirement rows are filtered by {@link requirementApplies} FIRST, so a requirement that
 * does not apply to this ticket (a security-only reviewer on a docs ticket) correctly
 * cannot suppress the lane-staffing tier — the same rule `decideLaneApprovers` documents.
 */
export function decideManagedLaneAuthority(
  inputs: LaneAuthorityInputs,
  task: ManagedTaskScope,
): ManagedLaneAuthority {
  const requirementRoleKeys = inputs.requirements
    .filter((r) => (r.kind === 'role' || r.kind === 'review')
      && requirementApplies({ ticketType: r.ticketType, condition: r.condition }, task))
    .map((r) => r.ref);
  const decision = decideLaneApprovers({ requirementRoleKeys, laneAgents: inputs.laneAgents });
  return {
    roleKeys: decision.approvers.map((a) => a.roleKey),
    approvers: decision.approvers,
    tier: decision.tier,
  };
}

/** A manifest slot, as far as producer selection cares. */
export interface ManagedProducerSlot {
  roleKey: string;
  responsibility: string;
  state: string;
  assigneeKind: string | null;
  assigneeRef: string | null;
}

/** The role-attributed run a managed stage would start. */
export interface ManagedProducer {
  roleKey: string;
  agentRef: string;
  model: string | null;
  /** Where the pick came from — the ticket's own manifest, or the lane's staffing. */
  source: 'manifest' | 'lane_agent';
}

/**
 * Pick the role-attributed producer for a managed stage. PURE.
 *
 * Order, most-specific first:
 *  1. the ticket's OWN manifest — an open owner/contributor slot resolved to an agent,
 *     whose role the stage authorizes. This is the Coordinator's recorded intent for this
 *     ticket, so it beats a generic lane pick.
 *  2. the lane's staffing (tier b) — the operator staffed this agent to work this lane,
 *     and `decideLaneApprovers` already mapped it to a role it is genuinely capable of.
 *
 * A manifest slot whose role the stage does NOT authorize is deliberately skipped rather
 * than dispatched: the guard would refuse it, and a dispatch guaranteed to be refused is
 * exactly the loop this module exists to end.
 *
 * Null means no role-attributed run is possible here — read by the evaluator as
 * `managed_no_role`, never as permission to dispatch un-attributed.
 */
export function pickManagedProducer(
  authority: ManagedLaneAuthority,
  slots: readonly ManagedProducerSlot[],
): ManagedProducer | null {
  const authorized = new Set(authority.roleKeys);

  const slot = slots.find((s) =>
    (s.responsibility === 'owner' || s.responsibility === 'contributor')
    && s.assigneeKind === 'agent'
    && !!s.assigneeRef
    && isParticipantOpen(s.state)
    && authorized.has(s.roleKey));
  if (slot?.assigneeRef) {
    const approver = authority.approvers.find((a) => a.roleKey === slot.roleKey);
    return { roleKey: slot.roleKey, agentRef: slot.assigneeRef, model: approver?.model ?? null, source: 'manifest' };
  }

  const staffed = authority.approvers.find((a) => !!a.agentRef);
  if (staffed?.agentRef) {
    return { roleKey: staffed.roleKey, agentRef: staffed.agentRef, model: staffed.model, source: 'lane_agent' };
  }
  return null;
}

/** Requirement rows for one lane, unfiltered (applicability is a per-ticket decision). */
async function loadLaneRequirements(db: Db, tenantId: number, swimlaneId: string): Promise<LaneAuthorityInputs['requirements']> {
  return db
    .select({
      kind: swimlaneRequirements.kind,
      ref: swimlaneRequirements.ref,
      ticketType: swimlaneRequirements.ticketType,
      condition: swimlaneRequirements.condition,
    })
    .from(swimlaneRequirements)
    .where(and(
      eq(swimlaneRequirements.tenantId, tenantId),
      eq(swimlaneRequirements.swimlaneId, swimlaneId),
      eq(swimlaneRequirements.isRequired, true),
    ));
}

/** A managed stage's authority for one ticket — the single-lane (guard / evaluator) path. */
export async function resolveManagedLaneAuthority(
  db: Db,
  args: { tenantId: number; swimlaneId: string; task: ManagedTaskScope },
): Promise<ManagedLaneAuthority> {
  const requirements = await loadLaneRequirements(db, args.tenantId, args.swimlaneId);
  // Staffing is only read when no requirement applies — `decideLaneApprovers` short-
  // circuits tier (a), so a templated lane costs exactly one query.
  const applies = requirements.some((r) => (r.kind === 'role' || r.kind === 'review')
    && requirementApplies({ ticketType: r.ticketType, condition: r.condition }, args.task));
  const laneAgents = applies ? [] : await loadLaneStaffedAgents(db, args.tenantId, args.swimlaneId);
  return decideManagedLaneAuthority({ requirements, laneAgents }, args.task);
}

/** Open required manifest slots for ONE ticket's current stage. */
export async function loadStageProducerSlots(
  db: Db,
  args: { tenantId: number; taskId: number; stageKey: string },
): Promise<ManagedProducerSlot[]> {
  return db
    .select({
      roleKey: ticketParticipants.roleKey,
      responsibility: ticketParticipants.responsibility,
      state: ticketParticipants.state,
      assigneeKind: ticketParticipants.assigneeKind,
      assigneeRef: ticketParticipants.assigneeRef,
    })
    .from(ticketParticipants)
    .where(and(
      eq(ticketParticipants.tenantId, args.tenantId),
      eq(ticketParticipants.taskId, args.taskId),
      eq(ticketParticipants.stageKey, args.stageKey),
      eq(ticketParticipants.required, true),
    ));
}

/**
 * The role-attributed run a managed ticket's current stage would start, or null.
 * The evaluator's entry point — one authority read plus one manifest read.
 */
export async function resolveManagedProducer(
  db: Db,
  args: { tenantId: number; taskId: number; swimlaneId: string; stageKey: string; task: ManagedTaskScope },
): Promise<{ producer: ManagedProducer | null; authority: ManagedLaneAuthority }> {
  const [authority, slots] = await Promise.all([
    resolveManagedLaneAuthority(db, { tenantId: args.tenantId, swimlaneId: args.swimlaneId, task: args.task }),
    loadStageProducerSlots(db, { tenantId: args.tenantId, taskId: args.taskId, stageKey: args.stageKey }),
  ]);
  return { producer: pickManagedProducer(authority, slots), authority };
}

/**
 * BULK: every lane's authority inputs for a whole board, in THREE queries (requirements,
 * staffing, and the one batched agent-capability read inside `loadLaneStaffedAgents`'s
 * bulk sibling below). Keyed by swimlane id.
 *
 * The census classifies every ticket in a project, so a per-ticket — or even a per-lane —
 * resolution would be the N+1 the caching rules forbid. Requirements are returned
 * unfiltered because applicability depends on the TICKET, and the caller applies
 * {@link decideManagedLaneAuthority} per ticket in memory.
 */
export async function loadBoardLaneAuthorities(
  db: Db,
  args: { tenantId: number; boardId: string },
): Promise<Map<string, LaneAuthorityInputs>> {
  const laneRows = await db
    .select({ id: swimlanes.id })
    .from(swimlanes)
    .where(and(eq(swimlanes.tenantId, args.tenantId), eq(swimlanes.boardId, args.boardId)));
  const laneIds = laneRows.map((l) => l.id);
  const out = new Map<string, LaneAuthorityInputs>();
  if (laneIds.length === 0) return out;
  for (const id of laneIds) out.set(id, { requirements: [], laneAgents: [] });

  const [requirementRows, staffed] = await Promise.all([
    db
      .select({
        swimlaneId: swimlaneRequirements.swimlaneId,
        kind: swimlaneRequirements.kind,
        ref: swimlaneRequirements.ref,
        ticketType: swimlaneRequirements.ticketType,
        condition: swimlaneRequirements.condition,
      })
      .from(swimlaneRequirements)
      .where(and(
        eq(swimlaneRequirements.tenantId, args.tenantId),
        inArray(swimlaneRequirements.swimlaneId, laneIds),
        eq(swimlaneRequirements.isRequired, true),
      ))
      .catch((error) => {
        reportCaughtError(error, { source: "application/kanban/managedLaneRoles.ts", operation: "[requirementRows, staffed]", context: { logMessage: '[managed-lane-roles] board requirement load failed', details: {
          tenantId: args.tenantId,
          boardId: args.boardId,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        } } });
        return [];
      }),
    loadStaffedAgentsForLanes(db, args.tenantId, laneIds).catch((error) => {
      reportCaughtError(error, { source: "application/kanban/managedLaneRoles.ts", operation: "[requirementRows, staffed]", context: { logMessage: '[managed-lane-roles] board staffing load failed', details: {
        tenantId: args.tenantId,
        boardId: args.boardId,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      } } });
      return new Map<string, LaneStaffedAgent[]>();
    }),
  ]);

  for (const r of requirementRows) {
    out.get(r.swimlaneId)?.requirements.push({ kind: r.kind, ref: r.ref, ticketType: r.ticketType, condition: r.condition });
  }
  for (const [laneId, agents] of staffed) {
    const entry = out.get(laneId);
    if (entry) entry.laneAgents = agents;
  }
  return out;
}
