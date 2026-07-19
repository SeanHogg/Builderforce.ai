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
import { requirementApplies } from '../kanban/types';
import { findCanonicalBoard } from '../swimlane/canonicalBoard';

const flaggedKey = (tenantId: number) => `audit:flagged:${tenantId}`;

/** Stable identity of an audit verdict — the status plus the exact set of unmet
 *  checks. The manager re-audits every pass, so a 'flag' action is only worth
 *  journalling when this signature CHANGES; re-recording an unchanged verdict every
 *  pass floods the manager feed with duplicates of the same gap. */
function verdictSignature(status: string, missing: UnmetRequirement[]): string {
  return [
    status,
    ...missing.map((m) => `${m.laneKey}|${m.kind}|${m.ref}|${m.responsibility ?? ''}|${m.reason}`).sort(),
  ].join('\n');
}

export interface TicketAuditResult extends CoverageResult {
  taskId: number;
  boardId: string | null;
}

/** The verdict a role can record. `waived`/`delegated` require a reason and are
 *  role-capability gated at the route (they weaken the standard, so must be audited). */
export type SignoffVerdict = 'approved' | 'changes_requested' | 'waived' | 'delegated';

/** The verifiable work backing a sign-off — what makes it more than a rubber stamp. */
export interface SignoffContribution {
  executionId?: number;
  prdRevision?: number;
  prUrl?: string;
  diffFiles?: string[];
  reviewThreadRef?: string;
  toolRunId?: string;
}

export interface SignoffInput {
  taskId: number;
  roleKey: string;
  laneKey?: string | null;
  memberKind?: string | null;
  memberRef?: string | null;
  memberName?: string | null;
  verdict?: SignoffVerdict;
  summary?: string | null;
  contribution?: SignoffContribution | null;
  waiveReason?: string | null;
}

export class TicketAuditService {
  constructor(private readonly db: Db) {}

  /** Record a role sign-off (append-only accountability record), then recompute the
   *  ticket's audit. Returns the audit AND the new sign-off id so callers can link it
   *  to a manifest participant. */
  async recordSignoff(env: Env, tenantId: number, input: SignoffInput): Promise<TicketAuditResult & { signoffId: string }> {
    const signoffId = crypto.randomUUID();
    await this.db.insert(ticketRoleSignoffs).values({
      id: signoffId,
      tenantId,
      taskId: input.taskId,
      laneKey: input.laneKey ?? null,
      roleKey: input.roleKey,
      memberKind: input.memberKind ?? null,
      memberRef: input.memberRef ?? null,
      memberName: input.memberName ?? null,
      verdict: input.verdict ?? 'approved',
      summary: input.summary ?? null,
      contribution: input.contribution ?? null,
      waiveReason: input.waiveReason ?? null,
      createdAt: new Date(),
    });
    const audit = await this.computeAudit(env, tenantId, input.taskId);
    return { ...audit, signoffId };
  }

  /**
   * Compute (and persist) the coverage audit for one ticket. Applicable
   * requirements = those on lanes at or before the ticket's current lane position.
   */
  async computeAudit(env: Env, tenantId: number, taskId: number): Promise<TicketAuditResult> {
    const [task] = await this.db
      .select({ id: tasks.id, projectId: tasks.projectId, status: tasks.status, taskType: tasks.taskType, actionType: tasks.actionType })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    if (!task) throw new Error('task not found');

    const board = await findCanonicalBoard(this.db, task.projectId, tenantId);

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
          // Ticket-type / condition scoping: a requirement only counts for the ticket
          // types it applies to (a Security ticket requires the security role; a docs
          // ticket doesn't require QA). Shared with the manifest + gate for consistency.
          .filter((r) => requirementApplies({ ticketType: r.ticketType, condition: r.condition }, { taskType: task.taskType, actionType: task.actionType }))
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
              quorum: r.quorum,
            };
          });
      }
    }

    const signals = await this.gatherSignals(taskId);
    const coverage = computeCoverage(reqs, signals);

    // Prior verdict, read BEFORE the upsert overwrites it — the flag journal below
    // is change-driven, not pass-driven.
    const [previous] = await this.db
      .select({ status: ticketAudits.status, missing: ticketAudits.missing })
      .from(ticketAudits)
      .where(and(eq(ticketAudits.tenantId, tenantId), eq(ticketAudits.taskId, taskId)))
      .limit(1);

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

    // Journal the flag only when the verdict actually changed (newly flagged, or the
    // set of unmet checks moved). An unchanged verdict is already visible on the
    // ticket + the flagged list — re-recording it every pass buries the feed.
    const previousSignature = previous
      ? verdictSignature(previous.status, safeParseMissing(previous.missing))
      : null;
    const changed = verdictSignature(coverage.status, coverage.missing) !== previousSignature;
    if (coverage.status === 'flagged' && changed) {
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
        .select({ toolId: toolRuns.toolId, result: toolRuns.result, createdAt: toolRuns.createdAt })
        .from(toolRuns)
        .where(eq(toolRuns.taskId, taskId))
        .orderBy(asc(toolRuns.createdAt)),
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
      // 'delegated' = handed to another actor, not yet satisfied → leave unmet.
      else if (verdict === 'delegated') { /* still outstanding */ }
      // 'approved' and 'waived' (an audited, reasoned exception) both satisfy coverage.
      else approvedRoles.add(role);
    }

    // Diagnostic pass/fail: a tool's ToolResult carries an optional 0..5 `score`. The
    // LATEST run per tool decides — score present & below threshold ⇒ failed (does not
    // satisfy); score absent ⇒ satisfied-by-existence (legacy, backward-compatible).
    const ranDiagnostics = new Set<string>();
    const failedDiagnostics = new Set<string>();
    const latestScore = new Map<string, number | null>();
    for (const d of diagnostics) {
      ranDiagnostics.add(d.toolId);
      const score = d.result && typeof d.result === 'object' && 'score' in d.result ? (d.result as { score?: number | null }).score ?? null : null;
      latestScore.set(d.toolId, score); // ordered asc by createdAt ⇒ last write is latest
    }
    for (const [toolId, score] of latestScore) {
      if (score != null && score < DIAGNOSTIC_PASS_THRESHOLD) failedDiagnostics.add(toolId);
    }

    return {
      approvedRoles,
      changesRequestedRoles,
      ranDiagnostics,
      failedDiagnostics,
      performedRoles: performed,
    };
  }
}

/** Pass mark for a scored diagnostic requirement (ToolResult.score is 0..5). A run at
 *  or above this satisfies; below it, the requirement stays unmet. */
const DIAGNOSTIC_PASS_THRESHOLD = 3;

function safeParseMissing(raw: string | null): UnmetRequirement[] {
  if (!raw) return [];
  try {
    const p: unknown = JSON.parse(raw);
    return Array.isArray(p) ? (p as UnmetRequirement[]) : [];
  } catch {
    return [];
  }
}
