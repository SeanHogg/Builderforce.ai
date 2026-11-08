/**
 * backlogDispositionPass — PRD 23 §6: give every non-Done ticket a keep / close / consolidate /
 * quarantine disposition, from evidence, as a DRY RUN.
 *
 * Operator decision: the pass only PROPOSES. It writes `ticket_dispositions` rows with
 * `applied_at` NULL and never touches a ticket. Acting on a proposal is a separate, explicit,
 * superadmin-triggered step (`backlogDispositionApply.ts`, re-exported here as
 * {@link applyDispositions}). The rules themselves are pure (`backlogDispositionRules.ts`).
 *
 * Re-running the pass refreshes still-pending proposals (the evidence moves) but NEVER
 * overwrites a row that has been applied: an applied disposition is a record of what was done.
 */
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { pullRequests, taskSpecs, tasks, ticketDispositions } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { NON_TERMINAL_TASK_STATUSES } from '../../domain/shared/types';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import {
  computeDispositions, type DispositionDecision, type DispositionKind, type TicketEvidence, type TicketPrEvidence,
} from './backlogDispositionRules';

export { applyDispositions } from './backlogDispositionApply';

/** `decided_by` for the scheduled dry-run. */
export const BACKLOG_PASS_ACTOR = 'system:backlog-disposition';

const IN_CHUNK = 500;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface PassScope { tenantId: number; projectId?: number }

/** Load the evidence for every non-Done ticket in scope: tickets, their PRs and PRD links (batched). */
export async function loadTicketEvidence(db: Db, scope: PassScope): Promise<TicketEvidence[]> {
  const rows = await db.select({
    id: tasks.id, projectId: tasks.projectId, title: tasks.title, description: tasks.description,
    status: tasks.status, taskType: tasks.taskType,
  }).from(tasks).where(scopedToTenant(
    tasks, scope.tenantId, inArray(tasks.status, NON_TERMINAL_TASK_STATUSES),
    ...(scope.projectId != null ? [eq(tasks.projectId, scope.projectId)] : []),
  ));
  if (!rows.length) return [];

  const ids = rows.map((r) => r.id);
  const prsByTask = new Map<number, TicketPrEvidence[]>();
  const prdTasks = new Set<number>();
  for (const part of chunk(ids, IN_CHUNK)) {
    const [prs, links] = await Promise.all([
      db.select({
        taskId: pullRequests.taskId, id: pullRequests.id, number: pullRequests.number,
        status: pullRequests.status, buildStatus: pullRequests.buildStatus,
      }).from(pullRequests).where(and(eq(pullRequests.tenantId, scope.tenantId), inArray(pullRequests.taskId, part))),
      db.select({ taskId: taskSpecs.taskId }).from(taskSpecs)
        .where(and(eq(taskSpecs.tenantId, scope.tenantId), inArray(taskSpecs.taskId, part))),
    ]);
    for (const p of prs) {
      if (p.taskId == null) continue;
      const list = prsByTask.get(p.taskId) ?? [];
      list.push({ id: p.id, number: p.number, status: p.status, buildStatus: p.buildStatus });
      prsByTask.set(p.taskId, list);
    }
    for (const l of links) prdTasks.add(l.taskId);
  }

  return rows.map((r) => ({
    id: r.id, projectId: r.projectId, title: r.title, description: r.description,
    status: r.status, taskType: String(r.taskType), prs: prsByTask.get(r.id) ?? [], hasPrd: prdTasks.has(r.id),
  }));
}

export interface PassResult {
  considered: number;
  written: number;
  byDisposition: Record<DispositionKind, number>;
  duplicateScanTruncated: boolean;
}

const emptyCounts = (): Record<DispositionKind, number> => ({ keep: 0, close: 0, consolidate: 0, quarantine: 0 });

/**
 * Compute dispositions and persist them as PENDING proposals (`applied_at` NULL). Never
 * mutates a ticket and never overwrites an applied row.
 */
export async function runBacklogDispositionPass(
  db: Db, scope: PassScope, decidedBy: string = BACKLOG_PASS_ACTOR,
): Promise<PassResult> {
  const evidence = await loadTicketEvidence(db, scope);
  const result: PassResult = { considered: evidence.length, written: 0, byDisposition: emptyCounts(), duplicateScanTruncated: false };
  if (!evidence.length) return result;

  const referenced = [...new Set(evidence.flatMap((t) => `${t.title}\n${t.description ?? ''}`.match(/#(\d+)/g) ?? []))]
    .map((m) => Number(m.slice(1))).filter((n) => Number.isSafeInteger(n) && n > 0 && n < 2_147_483_647);
  const known = new Set<number>(evidence.map((t) => t.id));
  for (const part of chunk(referenced.filter((n) => !known.has(n)), IN_CHUNK)) {
    const found = await db.select({ id: tasks.id }).from(tasks).where(scopedToTenant(tasks, scope.tenantId, inArray(tasks.id, part)));
    for (const f of found) known.add(f.id);
  }

  const { decisions, duplicateScanTruncated } = computeDispositions(evidence, known);
  result.duplicateScanTruncated = duplicateScanTruncated;
  const now = new Date();
  for (const part of chunk(decisions, 200)) {
    for (const d of part) result.byDisposition[d.disposition]++;
    try {
      await db.insert(ticketDispositions).values(part.map((d) => toRow(scope.tenantId, d, decidedBy, now)))
        .onConflictDoUpdate({
          target: ticketDispositions.taskId,
          set: {
            disposition: excluded('disposition'), prdAlignment: excluded('prd_alignment'), deliveryState: excluded('delivery_state'),
            evidence: excluded('evidence'), duplicateOf: excluded('duplicate_of'), supersededBy: excluded('superseded_by'),
            decidedBy: excluded('decided_by'), decidedAt: excluded('decided_at'),
          },
          // An applied row is history, not a proposal.
          setWhere: isNull(ticketDispositions.appliedAt),
        });
      result.written += part.length;
    } catch (error) {
      reportCaughtError(error, { source: 'application/manager/backlogDispositionPass.ts', operation: 'persist', context: { tenantId: scope.tenantId } });
    }
  }
  return result;
}

function toRow(tenantId: number, d: DispositionDecision, decidedBy: string, now: Date) {
  return {
    taskId: d.taskId, tenantId, disposition: d.disposition, prdAlignment: d.prdAlignment,
    deliveryState: d.deliveryState, evidence: d.evidence, duplicateOf: d.duplicateOf,
    supersededBy: d.supersededBy, decidedBy, decidedAt: now,
  };
}

// drizzle's `excluded.<col>` for ON CONFLICT DO UPDATE.
const excluded = (column: string) => sql.raw(`excluded.${column}`);

export interface DispositionReport {
  total: number;
  pending: number;
  applied: number;
  byDisposition: Record<DispositionKind, number>;
  /** Non-Done tickets with NO disposition row yet (PRD 23 §8: should reach zero). */
  undisposed: number;
  rows: Array<{
    taskId: number; title: string; status: string; disposition: string; deliveryState: string | null;
    prdAlignment: string | null; duplicateOf: number | null; supersededBy: number | null;
    evidence: unknown; decidedBy: string; decidedAt: Date; appliedAt: Date | null;
  }>;
}

/** The dry-run report: what the pass would do (pending) and what has been done (applied). */
export async function getDispositionReport(db: Db, scope: PassScope, limit = 1000): Promise<DispositionReport> {
  const rows = await db.select({
    taskId: ticketDispositions.taskId, title: tasks.title, status: tasks.status,
    disposition: ticketDispositions.disposition, deliveryState: ticketDispositions.deliveryState,
    prdAlignment: ticketDispositions.prdAlignment, duplicateOf: ticketDispositions.duplicateOf,
    supersededBy: ticketDispositions.supersededBy, evidence: ticketDispositions.evidence,
    decidedBy: ticketDispositions.decidedBy, decidedAt: ticketDispositions.decidedAt, appliedAt: ticketDispositions.appliedAt,
  }).from(ticketDispositions).innerJoin(tasks, eq(tasks.id, ticketDispositions.taskId)).where(and(
    eq(ticketDispositions.tenantId, scope.tenantId),
    ...(scope.projectId != null ? [eq(tasks.projectId, scope.projectId)] : []),
  )).orderBy(ticketDispositions.taskId).limit(limit);

  // Totals come from COUNT aggregates, never from the (limited) row list above.
  const projectFilter = scope.projectId != null ? [eq(tasks.projectId, scope.projectId)] : [];
  const [grouped, [undisposedRow]] = await Promise.all([
    db.select({
      disposition: ticketDispositions.disposition,
      applied: sql<boolean>`${ticketDispositions.appliedAt} is not null`,
      n: count(),
    }).from(ticketDispositions).innerJoin(tasks, eq(tasks.id, ticketDispositions.taskId))
      .where(and(eq(ticketDispositions.tenantId, scope.tenantId), ...projectFilter))
      .groupBy(ticketDispositions.disposition, sql`${ticketDispositions.appliedAt} is not null`),
    db.select({ n: count() }).from(tasks).where(scopedToTenant(
      tasks, scope.tenantId, inArray(tasks.status, NON_TERMINAL_TASK_STATUSES), ...projectFilter,
      sql`not exists (select 1 from ${ticketDispositions} where ${ticketDispositions.taskId} = ${tasks.id})`,
    )),
  ]);

  const byDisposition = emptyCounts();
  let total = 0;
  let applied = 0;
  for (const g of grouped) {
    const n = Number(g.n);
    total += n;
    if (g.applied) applied += n;
    if (g.disposition in byDisposition) byDisposition[g.disposition as DispositionKind] += n;
  }
  return { total, pending: total - applied, applied, byDisposition, undisposed: Number(undisposedRow?.n ?? 0), rows };
}
