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
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached, getCacheVersion, bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import {
  boards, swimlaneRequirements, swimlanes, tasks, ticketParticipants, ticketRoleSignoffs,
} from '../../infrastructure/database/schema';
import { BUILTIN_ROLES } from './roleCatalog';
import { resolveRoleCapableAgents } from './roleCapability';
import { projectRoleAssignments } from '../../infrastructure/database/schema';
import { requirementApplies, type Responsibility } from './types';
import type { SignoffContribution } from '../audit/ticketAuditService';
import { TaskStatus } from '../../domain/shared/types';

const ROLE_NAME = new Map(BUILTIN_ROLES.map((r) => [r.key, r.name]));
function roleName(key: string): string {
  return ROLE_NAME.get(key) ?? key.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

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
export interface AccountabilityGap {
  kind: AccountabilityGapKind;
  roleKey: string;
  roleName: string;
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

export interface AddParticipantInput {
  roleKey: string;
  responsibility?: Responsibility;
  stageKey?: string | null;
  note?: string | null;
  source?: 'assessment' | 'manual';
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

  /**
   * Done gate (PRD §5.5 / AC-2): on a LIFECYCLE-MANAGED board, a ticket cannot reach a
   * terminal (Done) lane while any required participant is not completed-with-evidence.
   * Returns the outstanding role names so the caller can show why. No-op (never blocks)
   * on un-managed boards, so legacy behaviour is unchanged.
   */
  async doneGate(env: Env, tenantId: number, taskId: number, targetStatus: string): Promise<{ blocked: boolean; outstanding: string[] }> {
    const ctx = await this.taskContext(taskId);
    if (!ctx) return { blocked: false, outstanding: [] };
    const [board] = await this.db.select({ id: boards.id, managed: boards.lifecycleManaged }).from(boards).where(eq(boards.projectId, ctx.projectId)).limit(1);
    if (!board || !board.managed) return { blocked: false, outstanding: [] };
    const [lane] = await this.db.select({ isTerminal: swimlanes.isTerminal }).from(swimlanes).where(and(eq(swimlanes.boardId, board.id), eq(swimlanes.key, targetStatus))).limit(1);
    const terminal = lane?.isTerminal ?? targetStatus === TaskStatus.DONE;
    if (!terminal) return { blocked: false, outstanding: [] };
    const report = await this.getAccountability(env, tenantId, taskId);
    const done = new Set(['completed', 'waived', 'skipped']);
    const outstanding = report.participants.filter((p) => p.required && !done.has(p.state)).map((p) => p.roleName);
    return { blocked: outstanding.length > 0, outstanding };
  }

  /**
   * Attribution (§5.6): record that a role's manifest participant ran on the ticket,
   * linked to the execution it ran AS. Best-effort and non-destructive — only advances a
   * not-yet-terminal slot (pending/assigned/unstaffed/in_progress) and never downgrades a
   * completed/changes_requested/waived state. A PRODUCER (owner/contributor) slot with PR
   * evidence completes; everything else advances to `in_progress` (a reviewer completes
   * via its sign-off, not merely by finishing a run). No-op until the manifest is derived.
   */
  async recordRunAttribution(env: Env, tenantId: number, taskId: number, opts: { roleKey: string; stageKey?: string | null; executionId?: number; prUrl?: string }): Promise<void> {
    const all = await this.db
      .select({ id: ticketParticipants.id, stageKey: ticketParticipants.stageKey, state: ticketParticipants.state, responsibility: ticketParticipants.responsibility, evidence: ticketParticipants.evidence })
      .from(ticketParticipants)
      .where(and(eq(ticketParticipants.tenantId, tenantId), eq(ticketParticipants.taskId, taskId), eq(ticketParticipants.roleKey, opts.roleKey)));
    if (!all.length) return;
    const advanceable = new Set<ParticipantState>(['pending', 'assigned', 'unstaffed', 'in_progress']);
    // Prefer the slot for the exact stage the run served; else any advanceable slot.
    const exact = opts.stageKey != null ? all.filter((r) => r.stageKey === opts.stageKey && advanceable.has(r.state as ParticipantState)) : [];
    const targets = exact.length ? exact : all.filter((r) => advanceable.has(r.state as ParticipantState));
    if (!targets.length) return;
    for (const r of targets) {
      const isProducer = r.responsibility === 'owner' || r.responsibility === 'contributor';
      const state: ParticipantState = isProducer && opts.prUrl ? 'completed' : 'in_progress';
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
      const done = new Set<ParticipantState>(['completed', 'waived', 'skipped']);
      const byTask = new Map<number, { completed: number; required: number }>();
      for (const r of rows) {
        if (!r.required) continue;
        const agg = byTask.get(r.taskId) ?? { completed: 0, required: 0 };
        agg.required += 1;
        if (done.has(r.state as ParticipantState)) agg.completed += 1;
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
    const [board] = await this.db.select({ id: boards.id }).from(boards).where(eq(boards.projectId, projectId)).limit(1);
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
    const [pin] = await this.db
      .select({ kind: projectRoleAssignments.assigneeKind, ref: projectRoleAssignments.assigneeRef, name: projectRoleAssignments.assigneeName })
      .from(projectRoleAssignments)
      .where(and(eq(projectRoleAssignments.tenantId, tenantId), eq(projectRoleAssignments.roleKey, roleKey)))
      .limit(1);
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
    // Fetch the task's assignee fields directly (including assignedUserId/assignedAgentRef) to support auto-owner-resolution.
    const [taskRow] = await this.db
      .select({ assignedUserId: tasks.assignedUserId, assignedAgentRef: tasks.assignedAgentRef })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    const now = new Date();

    // Determine the Owner internal role key (and whether to auto-assign from task ownership).
    const ownerRoleKey = BUILTIN_ROLES.find((r) => r.key === 'owner')?.key ?? null;
    const autoOwnerFromTask =
      ownerRoleKey !== null
        && !slots.some((s) => s.roleKey === ownerRoleKey)
        && (taskRow?.assignedUserId != null || taskRow?.assignedAgentRef != null);

    for (const s of slots) {
      // Explicit Owner slot versus auto-owner injection: auto-owner uses a dedicated source to stay discoverable
      // yet not collide with template slots. If autoOwnerFromTask and matching Owner role, we'll inject later.
      const isExplicitOwnerSlot = s.roleKey === ownerRoleKey;

      let assignee: { kind: string; ref: string; name: string } | null = null;
      let source = s.source;

      // Lax: use template source only if not manually set; we lean to 'manual' where we have it.
      if (isExplicitOwnerSlot && !s.source) {
        source = 'template'; // keep onConflict intentional grouping
      } else if (isExplicitOwnerSlot && s.source === 'template') {
        source = s.source;
      } else {
        source = s.source;
      }

      // If this slot pertains to Owner and we have auto-owner-ready task ownership, fetch from task instead of resolving via roles.
      if (autoOwnerFromTask && s.roleKey === ownerRoleKey) {
        // persoon: resolve which assignee to use in the manifest owner slot per PRD FR-1/FR-5/FR-6
        if (taskRow?.assignedUserId != null) {
          assignee = { kind: 'human', ref: taskRow.assignedUserId, name: taskRow.assignedUserId }; // will be resolved AFTER insertion into name/nameRef
        } else if (taskRow?.assignedAgentRef != null) {
          assignee = { kind: 'agent', ref: taskRow.assignedAgentRef, name: taskRow.assignedAgentRef };
        }
        // When assignee is null (task the owner role to be left unstaffed); we will not insert.
      } else {
        assignee = await this.resolveAssignee(env, tenantId, projectId, s.roleKey);
      }

      // Note: we skip insertion for Owner when auto-owner is assigned but we have no assignee, preserving AC-4 / AC-6 empty unstaffed.
      if ((autoOwnerFromTask && s.roleKey === ownerRoleKey) && !assignee) {
        // Keep empty: reflect no capable owner as a pending or unstaffed participant to be overridden later if needed.
        continue;
      }

      await this.db
        .insert(ticketParticipants)
        .values({
          tenantId,
          taskId,
          stageKey: s.stageKey,
          roleKey: s.roleKey,
          responsibility: s.responsibility,
          required: s.required,
          source: source,
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
   */
  async addParticipant(env: Env, tenantId: number, taskId: number, input: AddParticipantInput): Promise<ManifestParticipant | null> {
    const ctx = await this.taskContext(taskId);
    if (!ctx) return null;
    const projectId = ctx.projectId;
    const responsibility = input.responsibility ?? 'owner';
    const source = input.source ?? 'assessment';
    const assignee = await this.resolveAssignee(env, tenantId, projectId, input.roleKey);
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
    await this.db
      .delete(ticketParticipants)
      .where(and(eq(ticketParticipants.tenantId, tenantId), eq(ticketParticipants.taskId, taskId), eq(ticketParticipants.id, participantId), inArray(ticketParticipants.source, ['assessment', 'manual'])));
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
      .select({ id: ticketRoleSignoffs.id, roleKey: ticketRoleSignoffs.roleKey, verdict: ticketRoleSignoffs.verdict, createdAt: ticketRoleSignoffs.createdAt })
      .from(ticketRoleSignoffs)
      .where(eq(ticketRoleSignoffs.taskId, taskId))
      .orderBy(asc(ticketRoleSignoffs.createdAt));
    const latestByRole = new Map<string, { id: string; verdict: string }>();
    for (const s of signoffs) latestByRole.set(s.roleKey, { id: s.id, verdict: s.verdict });

    // Child task statuses for rollup.
    const childIds = rows.map((r) => r.childTaskId).filter((n): n is number => n != null);
    const childStatus = new Map<number, string>();
    if (childIds.length) {
      const kids = await this.db.select({ id: tasks.id, status: tasks.status }).from(tasks).where(inArray(tasks.id, childIds));
      for (const k of kids) childStatus.set(k.id, k.status);
    }

    for (const r of rows) {
      const so = latestByRole.get(r.roleKey);
      let state: ParticipantState = r.assigneeRef ? 'assigned' : (r.required ? 'unstaffed' : 'pending');
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

  /** Cached manifest read; derives on first access when empty. */
  async listParticipants(env: Env, tenantId: number, taskId: number): Promise<ManifestParticipant[]> {
    const existing = await this.db.select().from(ticketParticipants).where(and(eq(ticketParticipants.tenantId, tenantId), eq(ticketParticipants.taskId, taskId)));
    if (!existing.length) {
      await this.deriveManifest(env, tenantId, taskId);
    }
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
    return getOrSetCached(env, `participants:accountability:${taskId}:v:${version}`, async () => {
      const soRows = await this.db
        .select()
        .from(ticketRoleSignoffs)
        .where(eq(ticketRoleSignoffs.taskId, taskId))
        .orderBy(asc(ticketRoleSignoffs.createdAt));
      const signoffs: AccountabilitySignoff[] = soRows.map((s) => ({
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
      const latestByRole = new Map<string, AccountabilitySignoff>();
      for (const s of signoffs) latestByRole.set(s.roleKey, s);

      const required = participants.filter((p) => p.required);
      const done = new Set<ParticipantState>(['completed', 'waived', 'skipped']);
      const completedCount = required.filter((p) => done.has(p.state)).length;
      const percentComplete = required.length === 0 ? 100 : Math.round((completedCount / required.length) * 100);

      const gaps: AccountabilityGap[] = [];
      for (const p of required) {
        if (p.state === 'unstaffed') gaps.push({ kind: 'unstaffed', roleKey: p.roleKey, roleName: p.roleName, detail: 'No capable resource is available for this required role.' });
        else if (p.state === 'changes_requested') gaps.push({ kind: 'changes_requested', roleKey: p.roleKey, roleName: p.roleName, detail: 'Changes were requested and not yet resolved.' });
        else if (!done.has(p.state)) gaps.push({ kind: 'unsigned', roleKey: p.roleKey, roleName: p.roleName, detail: 'Required role has not signed off.' });
      }
      for (const s of latestByRole.values()) {
        const hasContribution = s.contribution && Object.values(s.contribution).some((v) => v != null && (!Array.isArray(v) || v.length > 0));
        if ((s.verdict === 'approved') && !hasContribution) gaps.push({ kind: 'no_contribution', roleKey: s.roleKey, roleName: s.roleName, detail: 'Approved with no linked contribution/interaction — a rubber-stamp risk.' });
        if (s.verdict === 'waived') gaps.push({ kind: 'waived', roleKey: s.roleKey, roleName: s.roleName, detail: s.waiveReason ? `Waived: ${s.waiveReason}` : 'Waived without a recorded reason.' });
      }

      return { taskId, requiredCount: required.length, completedCount, percentComplete, participants, signoffs, gaps };
    });
  }
}
