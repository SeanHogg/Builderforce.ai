/**
 * Ticket role/diagnostic audit engine — pillar 1.
 *
 * Records role SIGN-OFFS as work happens, then computes per-ticket coverage: for
 * every REQUIRED role / diagnostic / review the ticket's lanes declare (up to and
 * including its current lane), was it satisfied? Any unmet required check flags the
 * ticket for review and records a manager 'flag' action — this is the Manager AI
 * agent's ticket-coverage diagnostic. The verdict is denormalised onto the task so
 * the board renders a flag chip cheaply.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  boards,
  swimlaneRequirements,
  swimlanes,
  tasks,
  ticketAudits,
  ticketRoleSignoffs,
  toolRuns,
} from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { recordManagerAction } from '../manager/ManagerService';
import { computeCoverage, type AuditSignals, type RequirementInput } from './auditRules';
import type { CoverageResult, UnmetRequirement } from './auditRules';

const flaggedKey = (tenantId: number) => `audit:flagged:${tenantId}`;

export interface TicketAuditResult extends CoverageResult {
  taskId: number;
  boardId: string | null;
}

export interface SignoffInput {
  taskId: number;
  roleKey: string;
  laneKey?: string | null;
  memberKind?: string | null;
  memberRef?: string | null;
  verdict?: 'approved' | 'changes_requested';
  summary?: string | null;
}

export class TicketAuditService {
  constructor(private readonly db: Db) {}

  /** Record a role sign-off, then recompute the ticket's audit. */
  async recordSignoff(env: Env, tenantId: number, input: SignoffInput): Promise<TicketAuditResult> {
    await this.db.insert(ticketRoleSignoffs).values({
      id: crypto.randomUUID(),
      tenantId,
      taskId: input.taskId,
      laneKey: input.laneKey ?? null,
      roleKey: input.roleKey,
      memberKind: input.memberKind ?? null,
      memberRef: input.memberRef ?? null,
      verdict: input.verdict ?? 'approved',
      summary: input.summary ?? null,
      createdAt: new Date(),
    });
    return this.computeAudit(env, tenantId, input.taskId);
  }

  /**
   * Compute (and persist) the coverage audit for one ticket. Applicable
   * requirements = those on lanes at or before the ticket's current lane position.
   */
  async computeAudit(env: Env, tenantId: number, taskId: number): Promise<TicketAuditResult> {
    const [task] = await this.db
      .select({ id: tasks.id, projectId: tasks.projectId, status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    if (!task) throw new Error('task not found');

    const [board] = await this.db
      .select({ id: boards.id })
      .from(boards)
      .where(eq(boards.projectId, task.projectId))
      .limit(1);

    let reqs: RequirementInput[] = [];
    if (board) {
      const laneRows = await this.db
        .select({ id: swimlanes.id, key: swimlanes.key, name: swimlanes.name, position: swimlanes.position })
        .from(swimlanes)
        .where(eq(swimlanes.boardId, board.id))
        .orderBy(asc(swimlanes.position));
      const currentLane = laneRows.find((l) => l.key === task.status);
      // Lanes the ticket has reached (position <= current). If the status matches no
      // lane, audit every lane so nothing silently escapes coverage.
      const applicable = currentLane ? laneRows.filter((l) => l.position <= currentLane.position) : laneRows;
      const laneById = new Map(applicable.map((l) => [l.id, l]));
      if (applicable.length) {
        const reqRows = await this.db
          .select()
          .from(swimlaneRequirements)
          .where(inArray(swimlaneRequirements.swimlaneId, applicable.map((l) => l.id)));
        reqs = reqRows
          .filter((r) => laneById.has(r.swimlaneId))
          .map((r): RequirementInput => {
            const lane = laneById.get(r.swimlaneId)!;
            return {
              laneKey: lane.key,
              laneName: lane.name,
              kind: r.kind as RequirementInput['kind'],
              ref: r.ref,
              responsibility: (r.responsibility as RequirementInput['responsibility']) ?? undefined,
              isRequired: r.isRequired,
              description: r.description ?? undefined,
            };
          });
      }
    }

    const signals = await this.gatherSignals(taskId);
    const coverage = computeCoverage(reqs, signals);

    const now = new Date();
    await this.db
      .insert(ticketAudits)
      .values({
        taskId,
        tenantId,
        boardId: board?.id ?? null,
        status: coverage.status,
        coverage: coverage.coverage,
        requiredCount: coverage.requiredCount,
        satisfiedCount: coverage.satisfiedCount,
        missing: JSON.stringify(coverage.missing),
        computedAt: now,
      })
      .onConflictDoUpdate({
        target: ticketAudits.taskId,
        set: {
          status: coverage.status,
          coverage: coverage.coverage,
          requiredCount: coverage.requiredCount,
          satisfiedCount: coverage.satisfiedCount,
          missing: JSON.stringify(coverage.missing),
          computedAt: now,
        },
      });

    await this.db
      .update(tasks)
      .set({ auditStatus: coverage.status, auditFlagCount: coverage.missing.length })
      .where(eq(tasks.id, taskId));

    if (coverage.status === 'flagged') {
      await recordManagerAction(this.db, {
        tenantId,
        projectId: task.projectId,
        taskId,
        actionType: 'flag',
        summary: `Ticket audit: ${coverage.missing.length} required ${coverage.missing.length === 1 ? 'check' : 'checks'} unmet`,
        detail: { missing: coverage.missing },
      });
    }

    await invalidateCached(env, flaggedKey(tenantId));
    return { ...coverage, taskId, boardId: board?.id ?? null };
  }

  /** Read the stored audit for a ticket (missing parsed). */
  async getAudit(_env: Env, tenantId: number, taskId: number): Promise<
    { status: string; coverage: number; requiredCount: number; satisfiedCount: number; missing: UnmetRequirement[] } | null
  > {
    const [row] = await this.db
      .select()
      .from(ticketAudits)
      .where(and(eq(ticketAudits.tenantId, tenantId), eq(ticketAudits.taskId, taskId)))
      .limit(1);
    if (!row) return null;
    return {
      status: row.status,
      coverage: row.coverage,
      requiredCount: row.requiredCount,
      satisfiedCount: row.satisfiedCount,
      missing: safeParseMissing(row.missing),
    };
  }

  /** Flagged tickets for the workspace (optionally one project). Cached. */
  async listFlagged(env: Env, tenantId: number, projectId?: number): Promise<
    Array<{ taskId: number; title: string; status: string; projectId: number; missing: UnmetRequirement[]; coverage: number }>
  > {
    const all = await getOrSetCached(env, flaggedKey(tenantId), async () => {
      const rows = await this.db
        .select({
          taskId: ticketAudits.taskId,
          coverage: ticketAudits.coverage,
          missing: ticketAudits.missing,
          title: tasks.title,
          status: tasks.status,
          projectId: tasks.projectId,
        })
        .from(ticketAudits)
        .innerJoin(tasks, eq(ticketAudits.taskId, tasks.id))
        .where(and(eq(ticketAudits.tenantId, tenantId), eq(ticketAudits.status, 'flagged')));
      return rows.map((r) => ({
        taskId: r.taskId, title: r.title, status: r.status, projectId: r.projectId,
        coverage: r.coverage, missing: safeParseMissing(r.missing),
      }));
    });
    return projectId ? all.filter((r) => r.projectId === projectId) : all;
  }

  private async gatherSignals(taskId: number): Promise<AuditSignals> {
    const [signoffs, diagnostics] = await Promise.all([
      this.db
        .select({ roleKey: ticketRoleSignoffs.roleKey, verdict: ticketRoleSignoffs.verdict, createdAt: ticketRoleSignoffs.createdAt })
        .from(ticketRoleSignoffs)
        .where(eq(ticketRoleSignoffs.taskId, taskId))
        .orderBy(asc(ticketRoleSignoffs.createdAt)),
      this.db
        .select({ toolId: toolRuns.toolId })
        .from(toolRuns)
        .where(eq(toolRuns.taskId, taskId)),
    ]);

    // Latest verdict per role wins (append-only ledger; a later approval clears an
    // earlier changes-requested and vice-versa).
    const latest = new Map<string, string>();
    const performed = new Set<string>();
    for (const s of signoffs) {
      latest.set(s.roleKey, s.verdict);
      performed.add(s.roleKey);
    }
    const approvedRoles = new Set<string>();
    const changesRequestedRoles = new Set<string>();
    for (const [role, verdict] of latest) {
      if (verdict === 'changes_requested') changesRequestedRoles.add(role);
      else approvedRoles.add(role);
    }

    return {
      approvedRoles,
      changesRequestedRoles,
      ranDiagnostics: new Set(diagnostics.map((d) => d.toolId)),
      performedRoles: performed,
    };
  }
}

function safeParseMissing(raw: string | null): UnmetRequirement[] {
  if (!raw) return [];
  try {
    const p: unknown = JSON.parse(raw);
    return Array.isArray(p) ? (p as UnmetRequirement[]) : [];
  } catch {
    return [];
  }
}
