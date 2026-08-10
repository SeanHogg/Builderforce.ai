/**
 * Ticket Participation Manifest + Accountability Record
 * (PRD-coordinated-role-participation.md §5.2, §5.9).
 *
 * The manifest is the per-ticket, forward-looking roster: who MUST participate on a
 * ticket (role + responsibility), who has, and with what evidence. It is DERIVED
 * from the ticket's board requirements and kept dynamic — a Resource Assessment step
 * ADDS roles (a designer, a security engineer) the template didn't foresee, and an
 * added role with no capable+available resource surfaces as an audited RESOURCE GAP.
 *
 * Each participant may materialize as a CHILD TASK of the primary ticket, so the
 * parent's real %-complete rolls up from the children (a first-class reporting axis).
 *
 * The Accountability Report is the operator's headline surface: for every required
 * role — Who signed (identity + role), When, Verdict, Comments, and a link to the
 * Contribution that backs it — plus the gaps (unstaffed roles, unsigned roles,
 * sign-offs with no linked contribution, audited waivers). The sign-off ledger is
 * append-only, so this record is immutable history.
 */
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached, getCacheVersion, bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import {
  boards, ideAgents, projects, swimlaneRequirements, swimlanes, tasks, tenantMembers,
  ticketParticipants, ticketRoleSignoffs, users,
} from '../../infrastructure/database/schema';
import { roleDisplayName } from './roleCatalog';
import { resolveRoleCapableAgents } from './roleCapability';
import { projectRoleAssignments } from '../../infrastructure/database/schema';
import { requirementApplies, type Responsibility } from './types';
import { ADVANCEABLE_PARTICIPANT_STATES, blocksCompletion, isParticipantSatisfied } from './participantStates';
import { computeAccountabilityGaps, slotKey, type AccountabilityGapSeverity } from './accountabilityGaps';
import type { SignoffContribution } from '../audit/ticketAuditService';
import { TaskStatus } from '../../domain/shared/types';
import { findCanonicalBoard } from '../swimlane/canonicalBoard';
import { decideParticipantRemoval } from './participantRemovalPolicy';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';

// Role display names come from the ONE resolver in `roleCatalog` (this module used to
// keep its own private copy, and it disagreed with the lane gate's).
const roleName = roleDisplayName;

const versionKey = (taskId: number) => `participants:task:${taskId}`;
const projectVersionKey = (projectId: number) => `participants:project:${projectId}`;

/** Compact per-ticket progress for the board — the %-complete rollup chip. */
export interface ParticipantsSummaryRow {
  taskId: number;
  completed: number;
  required: number;
  percent: number;
}

export type ParticipantState =
  | 'pending' | 'assigned' | 'in_progress' | 'completed' | 'changes_requested' | 'waived' | 'skipped' | 'unstaffed';

export interface ManifestParticipant {
  id: string;
  stageKey: string | null;
  roleKey: string;
  roleName: string;
  responsibility: Responsibility;
  required: boolean;
  source: string;
  assigneeKind: string | null;
  assigneeRef: string | null;
  assigneeName: string | null;
  state: ParticipantState;
  signoffId: string | null;
  childTaskId: number | null;
  evidence: unknown;
  note: string | null;
}

export interface AccountabilitySignoff {
  laneKey: string | null;
  roleKey: string;
  roleName: string;
  memberKind: string | null;
  memberRef: string | null;
  memberName: string | null;
  verdict: string;
  summary: string | null;
  contribution: SignoffContribution | null;
  waiveReason: string | null;
  createdAt: string;
}

export type AccountabilityGapKind = 'unsigned' | 'unstaffed' | 'no_contribution' | 'waived' | 'changes_requested';

/**
 * Severity of a gap — the reason the report can no longer paint every line red.
 *
 * `blocking` is something actually WRONG (nobody can do the role, changes were
 * requested and left unresolved, an approval with no evidence behind it).
 * `advisory` is a slot that simply has not got there yet, or a recorded, reasoned
 * waiver. Rendering the second bucket as an error contradicted the table right
 * below it, which showed those same slots as "Assigned" / "In progress".
 *
 * The classification itself lives in `accountabilityGaps` (pure + unit-tested).
 */
export type { AccountabilityGapSeverity };

export interface AccountabilityGap {
  kind: AccountabilityGapKind;
  severity: AccountabilityGapSeverity;
  roleKey: string;
  roleName: string;
  /**
   * SLOT identity, not just role identity. A ticket routinely carries the same role
   * twice (Architect as owner AND as reviewer), so a gap keyed on `roleKey` alone
   * rendered as two identical lines that matched no particular table row.
   */
  stageKey: string | null;
  responsibility: Responsibility | null;
  /** The slot's participant state, so the gap line can say the same thing its row's State chip does. */
  state: ParticipantState | null;
  /** Free text for gaps that carry one (a waiver's reason). Localized copy is derived from `kind`/`state`. */
  reason: string | null;
  detail: string;
}

export interface AccountabilityReport {
  taskId: number;
  requiredCount: number;
  completedCount: number;
  percentComplete: number;
  participants: ManifestParticipant[];
  signoffs: AccountabilitySignoff[];
  gaps: AccountabilityGap[];
}

/** A concrete participant resolved by the CALLER (kind/ref/name), bypassing role lookup. */
export interface ExplicitAssignee {
  kind: string;
  ref: string;
  name: string;
}

export interface AddParticipantInput {
  roleKey: string;
  responsibility?: Responsibility;
  stageKey?: string | null;
  note?: string | null;
  /**
   * Provenance of the slot. `lane_agent` is a slot materialised from a lane's
   * `swimlane_agent_assignments` staffing on a board that declares no requirements
   * (see `swimlane/laneApprover.ts`) — distinct from `template` so it never suppresses
   * template derivation, and distinct from `assessment`/`manual` so a human's resource
   * assessment is never confused with an inferred staffing slot.
   */
  source?: 'assessment' | 'manual' | 'lane_agent';
  /**
   * Pin the participant to a SPECIFIC resource instead of resolving one by role.
   *
   * Needed because the lane's staffed agent is not necessarily what `resolveAssignee`
   * would pick (that walks project pin → first role-capable agent). A slot whose
   * assignee is some other role-capable agent would send the sign-off request to an
   * agent the operator never staffed on the lane.
   */
  assignee?: ExplicitAssignee | null;
}

export interface AssignParticipantInput {
  roleKey: string;
  assigneeRef: string;
  assigneeKind: 'agent' | 'user';
}

export interface AssignParticipantResult {
  updated: number;
  participants: ManifestParticipant[];
}

/** Port for creating a child work-item task — injected from the route (TaskService). */
export type CreateChildTask = (input: {
  title: string;
  parentTaskId: number;
  assignedAgentRef?: string | null;
  assignedUserId?: string | null;
}) => Promise<{ id: number }>;

interface SlotSeed {
  stageKey: string | null;
  roleKey: string;
  responsibility: Responsibility;
  required: boolean;
}

export class TicketParticipantsService {
  constructor(private readonly db: Db) {}

  private async bump(env: Env, taskId: number): Promise<void> {
    await bumpCacheVersion(env, versionKey(taskId));
    const ctx = await this.taskContext(taskId);
    if (ctx) await bumpCacheVersion(env, projectVersionKey(ctx.projectId));
  }

  /** Invalidate a ticket's cached manifest/accountability + its project summary. */
  async invalidate(env: Env, taskId: number): Promise<void> {
    await this.bump(env, taskId);
  }

  /** Assign or reassign every manifest slot for one role. The role must already
   * exist: resource assessment owns slot creation, while this operation only
   * staffs an existing contract. Reassignment resets the slot to `assigned` so
   * evidence produced by the previous assignee cannot silently credit the new one. */
  async assignParticipant(
    env: Env,
    tenantId: number,
    taskId: number,
    input: AssignParticipantInput,
  ): Promise<AssignParticipantResult> {
    const roleKey = input.roleKey.trim();
    const assigneeRef = input.assigneeRef.trim();
    if (!Number.isInteger(taskId) || taskId <= 0) throw new Error('taskId must be a positive integer');
    if (!roleKey) throw new Error('roleKey is required');
    if (!assigneeRef) throw new Error('assigneeRef is required');
    if (input.assigneeKind !== 'agent' && input.assigneeKind !== 'user') {
      throw new Error('assigneeKind must be "agent" or "user"');
    }

    const [task] = await this.db
      .select({ id: tasks.id })
      .from(tasks)
      .innerJoin(projects, and(eq(projects.id, tasks.projectId), eq(projects.tenantId, tenantId)))
      .where(eq(tasks.id, taskId))
      .limit(1);
    if (!task) throw new Error('task not found');

    const slots = await this.db
      .select({ id: ticketParticipants.id })
      .from(ticketParticipants)
      .where(and(
        eq(ticketParticipants.tenantId, tenantId),
        eq(ticketParticipants.taskId, taskId),
        eq(ticketParticipants.roleKey, roleKey),
      ));
    if (!slots.length) throw new Error(`participant role "${roleKey}" not found on task`);

    let assigneeName: string;
    let storedKind: 'agent' | 'human';
    if (input.assigneeKind === 'agent') {
      const [agent] = await this.db
        .select({ name: ideAgents.name })
        .from(ideAgents)
        .where(and(eq(ideAgents.tenantId, tenantId), eq(ideAgents.id, assigneeRef), eq(ideAgents.status, 'active')))
        .limit(1);
      if (!agent) throw new Error('active agent assignee not found in tenant');
      assigneeName = agent.name;
      storedKind = 'agent';
    } else {
      const [member] = await this.db
        .select({ name: users.displayName, email: users.email })
        .from(tenantMembers)
        .innerJoin(users, eq(users.id, tenantMembers.userId))
        .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, assigneeRef)))
        .limit(1);
      if (!member) throw new Error('user assignee is not a tenant member');
      assigneeName = member.name ?? member.email;
      storedKind = 'human';
    }

    const updated = await this.db
      .update(ticketParticipants)
      .set({
        assigneeKind: storedKind,
        assigneeRef,
        assigneeName,
        state: 'assigned',
        signoffId: null,
        evidence: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(ticketParticipants.tenantId, tenantId),
        eq(ticketParticipants.taskId, taskId),
        eq(ticketParticipants.roleKey, roleKey),
      ))
      .returning();
    await this.bump(env, taskId);
    return { updated: updated.length, participants: updated.map((row) => this.mapRow(row)) };
  }

  /**
   * Done gate (PRD §5.5 / AC-2): on a LIFECYCLE-MANAGED board, a ticket cannot reach a
   * terminal (Done) lane while any required participant is not completed-with-evidence.
   * Returns the outstanding role names so the caller can show why. No-op (never blocks)
   * on un-managed boards, so legacy behaviour is unchanged.
   */
  async doneGate(env: Env, tenantId: number, taskId: number, targetStatus: string): Promise<{ blocked: boolean; outstanding: string[] }> {
    const ctx = await this.taskContext(taskId);
    if (!ctx) return { blocked: false, outstanding: [] };
    const board = await findCanonicalBoard(this.db, ctx.projectId);
    if (!board || !board.lifecycleManaged) return { blocked: false, outstanding: [] };
    const [lane] = await this.db.select({ isTerminal: swimlanes.isTerminal }).from(swimlanes).where(and(eq(swimlanes.boardId, board.id), eq(swimlanes.key, targetStatus))).limit(1);
    const terminal = lane?.isTerminal ?? targetStatus === TaskStatus.DONE;
    if (!terminal) return { blocked: false, outstanding: [] };
    const report = await this.getAccountability(env, tenantId, taskId);
    const outstanding = report.participants.filter(blocksCompletion).map((p) => p.roleName);
    return { blocked: outstanding.length > 0, outstanding };
  }

  /**
   * Attribution (§5.6): record that a role's manifest participant ran on the ticket,
   * linked to the execution it ran AS. Best-effort and non-destructive — only advances a
   * not-yet-terminal slot (pending/assigned/unstaffed/in_progress) and never downgrades a
   * completed/changes_requested/waived state. No-op until the manifest is derived.
   *
   * IT MARKS `in_progress` AND NOTHING ELSE, DELIBERATELY. This used to complete a
   * PRODUCER slot outright when the ticket had a pull request — a write that DID NOT
   * SURVIVE. `syncStates` recomputes every slot from the sign-off ledger and preserves
   * only `in_progress`, so a `completed` with no ledger row behind it was reverted to
   * `assigned` by the next recompute; and `coordinateCompletedStage` calls `syncStates`
   * as its FIRST act, immediately before reading the manifest to decide whether to
   * advance. The credit was therefore erased microseconds before the only check that
   * cared could read it — which is why 110 completed runs in a day advanced zero lanes.
   *
   * Completion is now recorded where it lasts: `attestCompletedRoleRun` writes a real
   * ledger entry, and `syncStates` derives `completed` from that. This method's job is
   * only to record that a run touched the slot.
   */
  async recordRunAttribution(env: Env, tenantId: number, taskId: number, opts: { roleKey: string; stageKey?: string | null; executionId?: number; prUrl?: string }): Promise<void> {
    const all = await this.db
      .select({ id: ticketParticipants.id, stageKey: ticketParticipants.stageKey, state: ticketParticipants.state, responsibility: ticketParticipants.responsibility, evidence: ticketParticipants.evidence })
      .from(ticketParticipants)
      .where(and(eq(ticketParticipants.tenantId, tenantId), eq(ticketParticipants.taskId, taskId), eq(ticketParticipants.roleKey, opts.roleKey)));
    if (!all.length) return;
    // Prefer the slot for the exact stage the run served; else any advanceable slot.
    const exact = opts.stageKey != null ? all.filter((r) => r.stageKey === opts.stageKey && ADVANCEABLE_PARTICIPANT_STATES.has(r.state as ParticipantState)) : [];
    const targets = exact.length ? exact : all.filter((r) => ADVANCEABLE_PARTICIPANT_STATES.has(r.state as ParticipantState));
    if (!targets.length) return;
    for (const r of targets) {
      const state: ParticipantState = 'in_progress';
      const evidence = {
        ...(r.evidence && typeof r.evidence === 'object' ? r.evidence : {}),
        ...(opts.executionId != null ? { executionId: opts.executionId } : {}),
        ...(opts.prUrl ? { prUrl: opts.prUrl } : {}),
      };
      await this.db.update(ticketParticipants).set({ state, evidence, updatedAt: new Date() }).where(eq(ticketParticipants.id, r.id));
    }
    await this.bump(env, taskId);
  }

  /** Thin wrapper: mark a dispatched role `in_progress` with its execution (no evidence). */
  async markRoleInProgress(env: Env, tenantId: number, taskId: number, roleKey: string, stageKey: string | null, executionId: number): Promise<void> {
    await this.recordRunAttribution(env, tenantId, taskId, { roleKey, stageKey, executionId });
  }

  /**
   * Per-ticket participation progress for a whole project's board — the %-complete
   * chip. Cached on the project version token (bumped on any participant write).
   * Only tickets with a materialized manifest appear.
   */
  async projectSummary(env: Env, tenantId: number, projectId: number): Promise<ParticipantsSummaryRow[]> {
    const version = await getCacheVersion(env, projectVersionKey(projectId));
    return getOrSetCached(env, `participants:summary:project:${projectId}:v:${version}`, async () => {
      const rows = await this.db
        .select({ taskId: ticketParticipants.taskId, required: ticketParticipants.required, state: ticketParticipants.state })
        .from(ticketParticipants)
        .innerJoin(tasks, eq(tasks.id, ticketParticipants.taskId))
        .where(and(eq(ticketParticipants.tenantId, tenantId), eq(tasks.projectId, projectId)));
      const byTask = new Map<number, { completed: number; required: number }>();
      for (const r of rows) {
        if (!r.required) continue;
        const agg = byTask.get(r.taskId) ?? { completed: 0, required: 0 };
        agg.required += 1;
        if (isParticipantSatisfied(r.state)) agg.completed += 1;
        byTask.set(r.taskId, agg);
      }
      return [...byTask.entries()].map(([taskId, a]) => ({
        taskId, completed: a.completed, required: a.required,
        percent: a.required === 0 ? 100 : Math.round((a.completed / a.required) * 100),
      }));
    });
  }

  private async taskContext(taskId: number): Promise<{ projectId: number; taskType: string | null; actionType: string | null } | null> {
    const [row] = await this.db.select({ projectId: tasks.projectId, taskType: tasks.taskType, actionType: tasks.actionType }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
    return row ? { projectId: row.projectId, taskType: row.taskType, actionType: row.actionType } : null;
  }

  /** The required role/review slots across the ticket's whole board lifecycle, scoped
   *  to the ticket's type/condition (a Security ticket includes the security role; a
   *  docs ticket excludes QA). */
  private async templateSlots(projectId: number, task: { taskType: string | null; actionType: string | null }): Promise<SlotSeed[]> {
    const board = await findCanonicalBoard(this.db, projectId);
    if (!board) return [];
    const laneRows = await this.db
      .select({ id: swimlanes.id, key: swimlanes.key, position: swimlanes.position })
      .from(swimlanes)
      .where(eq(swimlanes.boardId, board.id))
      .orderBy(asc(swimlanes.position));
    if (!laneRows.length) return [];
    const laneById = new Map(laneRows.map((l) => [l.id, l]));
    const reqRows = await this.db
      .select()
      .from(swimlaneRequirements)
      .where(inArray(swimlaneRequirements.swimlaneId, laneRows.map((l) => l.id)));
    const slots: SlotSeed[] = [];
    for (const r of reqRows) {
      if (r.kind !== 'role' && r.kind !== 'review') continue;
      if (!requirementApplies({ ticketType: r.ticketType, condition: r.condition }, task)) continue;
      const lane = laneById.get(r.swimlaneId);
      const responsibility: Responsibility = (r.responsibility as Responsibility) ?? (r.kind === 'review' ? 'reviewer' : 'owner');
      slots.push({ stageKey: lane?.key ?? null, roleKey: r.ref, responsibility, required: r.isRequired });
    }
    return slots;
  }

  /** Resolve the best concrete assignee for a role (explicit pin → capable agent). */
  private async resolveAssignee(env: Env, tenantId: number, projectId: number, roleKey: string): Promise<{ kind: string; ref: string; name: string } | null> {
    const pins = await this.db
      .select({ projectId: projectRoleAssignments.projectId, kind: projectRoleAssignments.assigneeKind, ref: projectRoleAssignments.assigneeRef, name: projectRoleAssignments.assigneeName })
      .from(projectRoleAssignments)
      .where(and(
        eq(projectRoleAssignments.tenantId, tenantId),
        eq(projectRoleAssignments.roleKey, roleKey),
        or(eq(projectRoleAssignments.projectId, projectId), isNull(projectRoleAssignments.projectId)),
      ));
    pins.sort((a, b) => Number(b.projectId === projectId) - Number(a.projectId === projectId));
    const pin = pins[0];
    if (pin) return { kind: pin.kind, ref: pin.ref, name: pin.name ?? pin.ref };
    const [agent] = await resolveRoleCapableAgents(env, this.db, tenantId, projectId, roleKey);
    return agent ? { kind: 'agent', ref: agent.ref, name: agent.name } : null;
  }

  /**
   * Derive (idempotently) the template-sourced manifest for a ticket and resolve each
   * slot's assignee. Safe to call repeatedly — the unique slot index upserts. Does NOT
   * remove assessment-added rows. Returns the number of template slots present.
   */
  async deriveManifest(env: Env, tenantId: number, taskId: number): Promise<number> {
    const ctx = await this.taskContext(taskId);
    if (!ctx) return 0;
    const projectId = ctx.projectId;
    const slots = await this.templateSlots(projectId, { taskType: ctx.taskType, actionType: ctx.actionType });
    const now = new Date();
    for (const s of slots) {
      const assignee = await this.resolveAssignee(env, tenantId, projectId, s.roleKey);
      await this.db
        .insert(ticketParticipants)
        .values({
          tenantId,
          taskId,
          stageKey: s.stageKey,
          roleKey: s.roleKey,
          responsibility: s.responsibility,
          required: s.required,
          source: 'template',
          assigneeKind: assignee?.kind ?? null,
          assigneeRef: assignee?.ref ?? null,
          assigneeName: assignee?.name ?? null,
          state: assignee ? 'assigned' : (s.required ? 'unstaffed' : 'pending'),
          quorumGroup: `${s.stageKey ?? ''}:${s.roleKey}:${s.responsibility}`,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [ticketParticipants.taskId, ticketParticipants.stageKey, ticketParticipants.roleKey, ticketParticipants.responsibility, ticketParticipants.source],
          // Re-resolve assignee (roster may have changed) but never clobber a live state.
          set: { assigneeKind: assignee?.kind ?? null, assigneeRef: assignee?.ref ?? null, assigneeName: assignee?.name ?? null, required: s.required, updatedAt: now },
        });
    }
    await this.syncStates(env, tenantId, taskId);
    await this.bump(env, taskId);
    return slots.length;
  }

  /**
   * Resource Assessment — add a role the ticket needs beyond the template (designer,
   * security engineer, …). Resolves a capable resource; when none is available the
   * row lands `unstaffed` — a first-class, audited RESOURCE GAP that blocks Done.
   *
   * Idempotent on the slot's unique index (taskId, stageKey, roleKey, responsibility,
   * source), so a caller on a per-lane-entry hot path may call it every hop.
   */
  async addParticipant(env: Env, tenantId: number, taskId: number, input: AddParticipantInput): Promise<ManifestParticipant | null> {
    const ctx = await this.taskContext(taskId);
    if (!ctx) return null;
    const projectId = ctx.projectId;
    const responsibility = input.responsibility ?? 'owner';
    const source = input.source ?? 'assessment';
    // An explicitly-named resource wins over role-based resolution (see ExplicitAssignee).
    const assignee = input.assignee ?? await this.resolveAssignee(env, tenantId, projectId, input.roleKey);
    const now = new Date();
    const [row] = await this.db
      .insert(ticketParticipants)
      .values({
        tenantId,
        taskId,
        stageKey: input.stageKey ?? null,
        roleKey: input.roleKey,
        responsibility,
        required: true,
        source,
        assigneeKind: assignee?.kind ?? null,
        assigneeRef: assignee?.ref ?? null,
        assigneeName: assignee?.name ?? null,
        state: assignee ? 'assigned' : 'unstaffed',
        note: input.note ?? null,
        quorumGroup: `${input.stageKey ?? ''}:${input.roleKey}:${responsibility}`,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [ticketParticipants.taskId, ticketParticipants.stageKey, ticketParticipants.roleKey, ticketParticipants.responsibility, ticketParticipants.source],
        set: { assigneeKind: assignee?.kind ?? null, assigneeRef: assignee?.ref ?? null, assigneeName: assignee?.name ?? null, note: input.note ?? null, updatedAt: now },
      })
      .returning();
    await this.bump(env, taskId);
    return row ? this.mapRow(row) : null;
  }

  /** Waive/remove an assessment-added participant (audited elsewhere via sign-off). */
  async removeParticipant(env: Env, tenantId: number, taskId: number, participantId: string): Promise<void> {
    const rows = await this.db
      .select({
        id: ticketParticipants.id,
        roleKey: ticketParticipants.roleKey,
        responsibility: ticketParticipants.responsibility,
        required: ticketParticipants.required,
        source: ticketParticipants.source,
      })
      .from(ticketParticipants)
      .where(scopedToTenant(ticketParticipants, tenantId, eq(ticketParticipants.taskId, taskId)));
    const target = rows.find((row) => row.id === participantId);
    if (!target) throw new Error('participant not found on task');
    const decision = decideParticipantRemoval(target, rows);
    if (!decision.allowed) throw new Error(decision.message);
    await this.db
      .delete(ticketParticipants)
      .where(and(eq(ticketParticipants.tenantId, tenantId), eq(ticketParticipants.taskId, taskId), eq(ticketParticipants.id, participantId)));
    await this.bump(env, taskId);
  }

  /**
   * Materialize child work-item tasks for every not-yet-materialized participant that
   * has a resolved assignee — one child task per resource, linked back via childTaskId,
   * so the parent ticket's %-complete rolls up from real board tasks.
   */
  async materializeChildTasks(env: Env, tenantId: number, taskId: number, createChild: CreateChildTask): Promise<number> {
    const [parent] = await this.db.select({ title: tasks.title }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
    const rows = await this.db
      .select()
      .from(ticketParticipants)
      .where(and(eq(ticketParticipants.tenantId, tenantId), eq(ticketParticipants.taskId, taskId)));
    let created = 0;
    for (const r of rows) {
      if (r.childTaskId != null || !r.assigneeRef) continue;
      const title = `[${roleName(r.roleKey)}] ${parent?.title ?? `Ticket #${taskId}`}`;
      const child = await createChild({
        title,
        parentTaskId: taskId,
        assignedAgentRef: r.assigneeKind === 'agent' ? r.assigneeRef : null,
        assignedUserId: r.assigneeKind === 'human' ? r.assigneeRef : null,
      }).catch(() => null);
      if (!child) continue;
      await this.db.update(ticketParticipants).set({ childTaskId: child.id, updatedAt: new Date() }).where(eq(ticketParticipants.id, r.id));
      created += 1;
    }
    if (created) { await this.syncStates(env, tenantId, taskId); await this.bump(env, taskId); }
    return created;
  }

  /**
   * Recompute each participant's state from the append-only sign-off ledger, its child
   * task's status, and evidence. Persists changed rows. Called on write events (sign-off,
   * add, materialize) — reads stay cached.
   */
  async syncStates(env: Env, tenantId: number, taskId: number): Promise<void> {
    const rows = await this.db.select().from(ticketParticipants).where(and(eq(ticketParticipants.tenantId, tenantId), eq(ticketParticipants.taskId, taskId)));
    if (!rows.length) return;

    // Latest sign-off per role (append-only ledger — last verdict wins).
    const signoffs = await this.db
      .select({ id: ticketRoleSignoffs.id, laneKey: ticketRoleSignoffs.laneKey, roleKey: ticketRoleSignoffs.roleKey, verdict: ticketRoleSignoffs.verdict, createdAt: ticketRoleSignoffs.createdAt })
      .from(ticketRoleSignoffs)
      .where(eq(ticketRoleSignoffs.taskId, taskId))
      .orderBy(asc(ticketRoleSignoffs.createdAt));
    const latestBySlot = new Map<string, { id: string; verdict: string }>();
    // A verdict recorded WITHOUT a laneKey, indexed by role alone. `laneKey` is optional
    // on the sign-off route and the MCP tool, so an agent that omits it produced a ledger
    // row keyed `:role` that matched NO lane-scoped slot — the verdict was recorded and
    // then ignored by every gate reading the manifest. An unscoped sign-off is best read
    // as "this role approved the ticket", so it is applied to that role's slots as a
    // FALLBACK only; an exact lane match always wins.
    const latestByRole = new Map<string, { id: string; verdict: string }>();
    for (const s of signoffs) {
      latestBySlot.set(slotKey(s.laneKey, s.roleKey), { id: s.id, verdict: s.verdict });
      if (s.laneKey == null) latestByRole.set(s.roleKey, { id: s.id, verdict: s.verdict });
    }

    // Child task statuses for rollup.
    const childIds = rows.map((r) => r.childTaskId).filter((n): n is number => n != null);
    const childStatus = new Map<number, string>();
    if (childIds.length) {
      const kids = await this.db.select({ id: tasks.id, status: tasks.status }).from(tasks).where(inArray(tasks.id, childIds));
      for (const k of kids) childStatus.set(k.id, k.status);
    }

    for (const r of rows) {
      const so = latestBySlot.get(slotKey(r.stageKey, r.roleKey)) ?? latestByRole.get(r.roleKey);
      // PRESERVE `in_progress`. It is written by run ATTRIBUTION
      // (`recordRunAttribution`, i.e. "a run for this role/stage finalized"), which is
      // evidence this function cannot re-derive from the ledger or the child task — so
      // recomputing the baseline as `assigned` silently ERASED the record that a run had
      // already served the slot. It erased it constantly, too: `listParticipants`
      // re-derives whenever the ticket has no `template`-sourced row (which is every
      // ticket on a board with no `swimlane_requirements`), and `deriveManifest` ends by
      // calling this method. Any consumer keyed on `in_progress` — the producer
      // re-dispatch guard here, and the lane-agent approval rule in
      // `swimlane/laneApprover.ts` — therefore saw the slot bounce back to `assigned` and
      // either re-dispatched work already in flight or never asked for the sign-off at
      // all. A sign-off / child-task status / delegation below still overrides it.
      let state: ParticipantState = r.state === 'in_progress'
        ? 'in_progress'
        : (r.assigneeRef ? 'assigned' : (r.required ? 'unstaffed' : 'pending'));
      let signoffId: string | null = r.signoffId;
      if (r.childTaskId != null) {
        const st = childStatus.get(r.childTaskId);
        if (st === TaskStatus.DONE) state = 'completed';
        else if (st && st !== TaskStatus.BACKLOG && st !== TaskStatus.TODO) state = 'in_progress';
      }
      if (so) {
        signoffId = so.id;
        if (so.verdict === 'approved' || so.verdict === 'waived') state = so.verdict === 'waived' ? 'waived' : 'completed';
        else if (so.verdict === 'changes_requested') state = 'changes_requested';
        else if (so.verdict === 'delegated') state = 'assigned';
      }
      if (state !== r.state || signoffId !== r.signoffId) {
        await this.db.update(ticketParticipants).set({ state, signoffId, updatedAt: new Date() }).where(eq(ticketParticipants.id, r.id));
      }
    }
  }

  private mapRow(r: typeof ticketParticipants.$inferSelect): ManifestParticipant {
    return {
      id: r.id,
      stageKey: r.stageKey,
      roleKey: r.roleKey,
      roleName: roleName(r.roleKey),
      responsibility: r.responsibility as Responsibility,
      required: r.required,
      source: r.source,
      assigneeKind: r.assigneeKind,
      assigneeRef: r.assigneeRef,
      assigneeName: r.assigneeName,
      state: r.state as ParticipantState,
      signoffId: r.signoffId,
      childTaskId: r.childTaskId,
      evidence: r.evidence,
      note: r.note,
    };
  }

  /** Keep the explicit assessment `owner` slot synchronized with the task's actual
   * coordinator. The task assignment is authoritative; changing it invalidates any
   * evidence recorded for the previous owner. Invalid/missing assignees remain an
   * explicit `unstaffed` resource gap rather than resolving to a random role pin. */
  private async syncOwnerAssignee(env: Env, tenantId: number, taskId: number): Promise<void> {
    const [task] = await this.db
      .select({
        assignedUserId: tasks.assignedUserId,
        assignedAgentRef: tasks.assignedAgentRef,
      })
      .from(tasks)
      .innerJoin(projects, and(eq(projects.id, tasks.projectId), eq(projects.tenantId, tenantId)))
      .where(eq(tasks.id, taskId))
      .limit(1);
    if (!task) return;

    let assignee: { kind: 'human' | 'agent'; ref: string; name: string } | null = null;
    if (task.assignedUserId) {
      const [member] = await this.db
        .select({ name: users.displayName, email: users.email })
        .from(tenantMembers)
        .innerJoin(users, eq(users.id, tenantMembers.userId))
        .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, task.assignedUserId)))
        .limit(1);
      if (member) assignee = { kind: 'human', ref: task.assignedUserId, name: member.name ?? member.email };
    } else if (task.assignedAgentRef) {
      const [agent] = await this.db
        .select({ name: ideAgents.name })
        .from(ideAgents)
        .where(and(eq(ideAgents.tenantId, tenantId), eq(ideAgents.id, task.assignedAgentRef), eq(ideAgents.status, 'active')))
        .limit(1);
      if (agent) assignee = { kind: 'agent', ref: task.assignedAgentRef, name: agent.name };
    }

    const owners = await this.db
      .select({
        id: ticketParticipants.id,
        assigneeKind: ticketParticipants.assigneeKind,
        assigneeRef: ticketParticipants.assigneeRef,
        assigneeName: ticketParticipants.assigneeName,
      })
      .from(ticketParticipants)
      .where(scopedToTenant(ticketParticipants, tenantId, and(
        eq(ticketParticipants.taskId, taskId),
        eq(ticketParticipants.roleKey, 'owner'),
        eq(ticketParticipants.responsibility, 'owner'),
      )));
    let changed = false;
    for (const owner of owners) {
      if (owner.assigneeKind === assignee?.kind
        && owner.assigneeRef === assignee?.ref
        && owner.assigneeName === assignee?.name) continue;
      await this.db.update(ticketParticipants).set({
        assigneeKind: assignee?.kind ?? null,
        assigneeRef: assignee?.ref ?? null,
        assigneeName: assignee?.name ?? null,
        state: assignee ? 'assigned' : 'unstaffed',
        signoffId: null,
        evidence: null,
        updatedAt: new Date(),
      }).where(scopedToTenant(ticketParticipants, tenantId, eq(ticketParticipants.id, owner.id)));
      changed = true;
    }
    if (changed) await this.bump(env, taskId);
  }

  /** Cached manifest read; derives on first access when empty. */
  async listParticipants(env: Env, tenantId: number, taskId: number): Promise<ManifestParticipant[]> {
    // Assessment/manual rows do not prove the board-template manifest was derived.
    // A coordinator may assess resources before a template is applied; previously
    // that single row permanently suppressed all BA→Architect→Developer→QA slots.
    const [templateRow] = await this.db.select({ id: ticketParticipants.id }).from(ticketParticipants)
      .where(and(eq(ticketParticipants.tenantId, tenantId), eq(ticketParticipants.taskId, taskId), eq(ticketParticipants.source, 'template')))
      .limit(1);
    if (!templateRow) {
      await this.deriveManifest(env, tenantId, taskId);
    }
    await this.syncOwnerAssignee(env, tenantId, taskId);
    const version = await getCacheVersion(env, versionKey(taskId));
    return getOrSetCached(env, `participants:list:${taskId}:v:${version}`, async () => {
      const rows = await this.db
        .select()
        .from(ticketParticipants)
        .where(and(eq(ticketParticipants.tenantId, tenantId), eq(ticketParticipants.taskId, taskId)))
        .orderBy(asc(ticketParticipants.createdAt));
      return rows.map((r) => this.mapRow(r));
    });
  }

  /**
   * The Accountability Report — the "open a ticket and see the standard was met"
   * surface. Cached on the per-task version token (bumped on any sign-off / manifest
   * write). Assembles participants + the append-only sign-off history + the gaps.
   */
  async getAccountability(env: Env, tenantId: number, taskId: number): Promise<AccountabilityReport> {
    const participants = await this.listParticipants(env, tenantId, taskId);
    const version = await getCacheVersion(env, versionKey(taskId));
    // `s2` = report SHAPE version. Gaps gained `severity`/slot identity, and a cached
    // pre-`severity` payload would be read as "nothing blocking" by the UI's filter —
    // so the key changes with the shape rather than relying on entries expiring.
    return getOrSetCached(env, `participants:accountability:s2:${taskId}:v:${version}`, async () => {
      const soRows = await this.db
        .select()
        .from(ticketRoleSignoffs)
        .where(eq(ticketRoleSignoffs.taskId, taskId))
        .orderBy(asc(ticketRoleSignoffs.createdAt));
      const signoffs: AccountabilitySignoff[] = soRows.map((s) => ({
        laneKey: s.laneKey,
        roleKey: s.roleKey,
        roleName: roleName(s.roleKey),
        memberKind: s.memberKind,
        memberRef: s.memberRef,
        memberName: s.memberName,
        verdict: s.verdict,
        summary: s.summary,
        contribution: (s.contribution as SignoffContribution | null) ?? null,
        waiveReason: s.waiveReason,
        createdAt: s.createdAt.toISOString(),
      }));
      const latestBySlot = new Map<string, AccountabilitySignoff>();
      for (const s of signoffs) latestBySlot.set(slotKey(s.laneKey, s.roleKey), s);

      const required = participants.filter((p) => p.required);
      const completedCount = required.filter((p) => isParticipantSatisfied(p.state)).length;
      const percentComplete = required.length === 0 ? 100 : Math.round((completedCount / required.length) * 100);

      // Every gap names the SLOT it came from (lane + responsibility + state) so the
      // banner and the table below it are two views of one list, not two lists.
      const gaps = computeAccountabilityGaps(participants, [...latestBySlot.values()]);

      return { taskId, requiredCount: required.length, completedCount, percentComplete, participants, signoffs, gaps };
    });
  }
}
