/**
 * backlogDispositionApply — the explicit, superadmin-triggered ACT on the dry-run
 * proposals `backlogDispositionPass.ts` wrote (PRD 23 §6). Never called by a cron.
 *
 *   close        -> status `cancelled` (NEVER `done`: abandoned work must not inflate
 *                   completion, PRD 23 §9) with the evidence quoted on the ticket.
 *   consolidate  -> the duplicate's unique text is appended to the canonical ticket
 *                   (idempotent, by marker) so no requirement is discarded, then the
 *                   duplicate is cancelled with a link to the canonical ticket.
 *   quarantine   -> status `blocked` and a `[Quarantined]` note (a bounded human decision
 *                   queue; tickets carry no blocked_reason column, so the reason is the note
 *                   and the `ticket_dispositions.evidence`).
 *   keep         -> nothing to do; the proposal is stamped applied.
 *
 * Every act goes through the existing TaskService, and each row is RE-CHECKED against the
 * ticket's current state: if the ticket left the board, or a PR appeared that the dry-run
 * did not see (open or merged), the row is skipped with a reason rather than acted on.
 * `applied_at` is stamped only for rows that were actually applied.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { pullRequests, tasks, ticketDispositions } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { TaskRepository } from '../../infrastructure/repositories/TaskRepository';
import { ProjectRepository } from '../../infrastructure/repositories/ProjectRepository';
import { NON_TERMINAL_TASK_STATUSES, TaskStatus } from '../../domain/shared/types';
import { TaskService } from '../task/TaskService';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { DispositionKind } from './backlogDispositionRules';

export const CANCELLED_STATUS = 'cancelled';

export interface PendingDisposition {
  taskId: number;
  disposition: DispositionKind;
  duplicateOf: number | null;
  supersededBy: number | null;
  evidence: unknown;
}

export interface TaskSnapshot { id: number; title: string; description: string | null; status: string }

/** The ports the apply step needs - real ones by default, fakes in tests. */
export interface ApplyDeps {
  pending(tenantId: number, taskIds?: readonly number[]): Promise<PendingDisposition[]>;
  tasks(tenantId: number, ids: readonly number[]): Promise<Map<number, TaskSnapshot>>;
  /** Task ids (of those asked) that now have an open/draft/merged PR. */
  prsThatBlock(tenantId: number, ids: readonly number[]): Promise<Set<number>>;
  update(taskId: number, patch: { status?: string; description?: string }): Promise<void>;
  stamp(tenantId: number, taskId: number, at: Date): Promise<void>;
}

export interface ApplyOutcome { taskId: number; disposition: DispositionKind; result: 'applied' | 'skipped'; reason?: string }
export interface ApplyResult { applied: number; skipped: number; outcomes: ApplyOutcome[] }

const marker = (kind: string, id: number) => `[${kind} #${id}]`;
const note = (text: string, existing: string | null) => `${existing ?? ''}\n\n${text}`.trim();

/** Description of the canonical ticket after absorbing `dup` (unchanged when already absorbed). PURE. */
export function absorbDuplicate(canonicalDescription: string | null, dup: TaskSnapshot): string {
  const m = marker('Consolidated', dup.id);
  if ((canonicalDescription ?? '').includes(m)) return canonicalDescription ?? '';
  const body = (dup.description ?? '').trim();
  return note(`${m} ${dup.title}${body ? `\n${body}` : ''}`, canonicalDescription);
}

export function defaultApplyDeps(db: Db): ApplyDeps {
  const service = new TaskService(new TaskRepository(db), new ProjectRepository(db));
  return {
    async pending(tenantId, taskIds) {
      return db.select({
        taskId: ticketDispositions.taskId, disposition: ticketDispositions.disposition,
        duplicateOf: ticketDispositions.duplicateOf, supersededBy: ticketDispositions.supersededBy,
        evidence: ticketDispositions.evidence,
      }).from(ticketDispositions).where(and(
        eq(ticketDispositions.tenantId, tenantId), isNull(ticketDispositions.appliedAt),
        ...(taskIds?.length ? [inArray(ticketDispositions.taskId, [...taskIds])] : []),
      )).then((rows) => rows as PendingDisposition[]);
    },
    async tasks(tenantId, ids) {
      const out = new Map<number, TaskSnapshot>();
      if (!ids.length) return out;
      const rows = await db.select({ id: tasks.id, title: tasks.title, description: tasks.description, status: tasks.status })
        .from(tasks).where(scopedToTenant(tasks, tenantId, inArray(tasks.id, [...ids])));
      for (const r of rows) out.set(r.id, r);
      return out;
    },
    async prsThatBlock(tenantId, ids) {
      if (!ids.length) return new Set();
      const rows = await db.select({ taskId: pullRequests.taskId }).from(pullRequests).where(and(
        eq(pullRequests.tenantId, tenantId), inArray(pullRequests.taskId, [...ids]),
        inArray(pullRequests.status, ['open', 'draft', 'merged']),
      ));
      return new Set(rows.map((r) => r.taskId).filter((n): n is number => n != null));
    },
    async update(taskId, patch) { await service.updateTask(taskId, patch); },
    async stamp(tenantId, taskId, at) {
      await db.update(ticketDispositions).set({ appliedAt: at })
        .where(and(eq(ticketDispositions.tenantId, tenantId), eq(ticketDispositions.taskId, taskId), isNull(ticketDispositions.appliedAt)));
    },
  };
}

/**
 * Apply the pending proposals (optionally only `taskIds`). Idempotent: an applied row is no
 * longer pending, and every textual mutation is marker-guarded.
 */
export async function applyDispositions(
  db: Db,
  args: { tenantId: number; actor: string; taskIds?: readonly number[]; dispositions?: readonly DispositionKind[] },
  deps: ApplyDeps = defaultApplyDeps(db),
): Promise<ApplyResult> {
  const result: ApplyResult = { applied: 0, skipped: 0, outcomes: [] };
  const wanted = args.dispositions?.length ? new Set<string>(args.dispositions) : null;
  const rows = (await deps.pending(args.tenantId, args.taskIds)).filter((r) => !wanted || wanted.has(r.disposition));
  if (!rows.length) return result;

  // Every referenced id is loaded through the TENANT-SCOPED snapshot read: a duplicate_of / superseded_by
  // pointing at another tenant's ticket never appears in `snap`, so it is neither absorbed into nor quoted.
  const ids = [...new Set(rows.flatMap((r) => [r.taskId, ...(r.duplicateOf != null ? [r.duplicateOf] : []), ...(r.supersededBy != null ? [r.supersededBy] : [])]))];
  const [snap, blockingPrs] = await Promise.all([deps.tasks(args.tenantId, ids), deps.prsThatBlock(args.tenantId, ids)]);
  const open = (s: TaskSnapshot | undefined): s is TaskSnapshot => !!s && NON_TERMINAL_TASK_STATUSES.includes(s.status);

  /** Where each ticket cancelled by consolidation in THIS run went, so a chain A -> B -> C lands on a live ticket. */
  const movedTo = new Map<number, number>();
  const liveTarget = (id: number): TaskSnapshot | undefined => {
    const seen = new Set<number>();
    for (let cur: number | undefined = id; cur != null && !seen.has(cur); cur = movedTo.get(cur)) {
      seen.add(cur);
      const s = snap.get(cur);
      if (open(s)) return s;
    }
    return undefined;
  };

  const skip = (r: PendingDisposition, reason: string) => {
    result.skipped++;
    result.outcomes.push({ taskId: r.taskId, disposition: r.disposition, result: 'skipped', reason });
  };

  for (const r of rows) {
    const t = snap.get(r.taskId);
    try {
      if (!open(t)) { skip(r, 'ticket_not_open'); continue; }
      if (r.disposition === 'keep') {
        // nothing to mutate
      } else if (blockingPrs.has(r.taskId)) {
        skip(r, 'pr_appeared_since_dry_run'); continue;
      } else if (r.disposition === 'close') {
        const why = (r.evidence as { rule?: string } | null)?.rule ?? 'evidence';
        const ref = r.supersededBy != null && snap.has(r.supersededBy) ? ` Superseded by #${r.supersededBy}.` : '';
        snap.set(t.id, { ...t, status: CANCELLED_STATUS });
        await deps.update(t.id, { status: CANCELLED_STATUS, description: note(`[Closed by backlog disposition: ${why}.${ref}]`, t.description) });
      } else if (r.disposition === 'consolidate') {
        const canon = r.duplicateOf != null ? liveTarget(r.duplicateOf) : undefined;
        if (!open(canon) || canon.id === t.id) { skip(r, 'canonical_not_open'); continue; }
        // Absorb FIRST: if the cancel below fails, the requirement is already preserved.
        const merged = absorbDuplicate(canon.description, t);
        if (merged !== (canon.description ?? '')) {
          await deps.update(canon.id, { description: merged });
          snap.set(canon.id, { ...canon, description: merged });
        }
        await deps.update(t.id, { status: CANCELLED_STATUS, description: note(`[Consolidated into #${canon.id}]`, t.description) });
        snap.set(t.id, { ...t, status: CANCELLED_STATUS });
        movedTo.set(t.id, canon.id);
      } else if (r.disposition === 'quarantine') {
        const why = (r.evidence as { rule?: string } | null)?.rule ?? 'evidence';
        await deps.update(t.id, {
          status: TaskStatus.BLOCKED,
          description: (t.description ?? '').includes('[Quarantined')
            ? t.description ?? '' : note(`[Quarantined: ${why}. Needs a human keep-or-close decision.]`, t.description),
        });
      }
      await deps.stamp(args.tenantId, r.taskId, new Date());
      result.applied++;
      result.outcomes.push({ taskId: r.taskId, disposition: r.disposition, result: 'applied' });
    } catch (error) {
      reportCaughtError(error, { source: 'application/manager/backlogDispositionApply.ts', operation: 'applyDispositions', context: { details: { taskId: r.taskId, actor: args.actor } } });
      skip(r, 'error');
    }
  }
  return result;
}
