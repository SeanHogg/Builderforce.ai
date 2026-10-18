/**
 * PMO initiative dependency edges (blocker → blocked) — the critical-path input.
 *
 * The sibling of task precedence edges (application/task/taskDependencies.ts): a
 * different graph (initiatives, per segment, not tasks per project) with the same
 * integrity rule, so it follows the same shape — the route only parses and answers,
 * this module owns the write, and both use the ONE cycle gate in
 * `domain/shared/dagEdges`. It also adopts the task side's check-then-insert race
 * close (neon-http has no interactive transactions), which the route-level copy here
 * never had: two concurrent opposite edges could each pass the pre-check and land
 * a cycle that the critical-path walk would then trip over.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { initiatives, pmoDependencies } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { wouldCloseCycle } from '../../domain/shared/dagEdges';

export interface InitiativeScope {
  tenantId: number;
  segmentId: string;
}

export type AddInitiativeDependencyResult =
  | { ok: true; edge: typeof pmoDependencies.$inferSelect | { fromInitiativeId: string; toInitiativeId: string } }
  | { ok: false; status: 400 | 404 | 409; error: string };

const CYCLE_ERROR = 'that dependency would create a cycle';

async function segmentEdges(db: Db, scope: InitiativeScope) {
  const rows = await db
    .select({ fromInitiativeId: pmoDependencies.fromInitiativeId, toInitiativeId: pmoDependencies.toInitiativeId })
    .from(pmoDependencies)
    .where(scopedToTenant(pmoDependencies, scope.tenantId, eq(pmoDependencies.segmentId, scope.segmentId)));
  return rows.map((r) => [r.fromInitiativeId, r.toInitiativeId] as const);
}

export async function addInitiativeDependency(
  db: Db,
  scope: InitiativeScope,
  from: string | null | undefined,
  to: string | null | undefined,
): Promise<AddInitiativeDependencyResult> {
  if (!from || !to) return { ok: false, status: 400, error: 'fromInitiativeId and toInitiativeId are required' };
  if (from === to) return { ok: false, status: 400, error: 'an initiative cannot depend on itself' };

  // Both endpoints must belong to this tenant/segment.
  const ends = await db
    .select({ id: initiatives.id })
    .from(initiatives)
    .where(scopedToTenant(initiatives, scope.tenantId, inArray(initiatives.id, [from, to]), eq(initiatives.segmentId, scope.segmentId)));
  if (ends.length !== 2) return { ok: false, status: 404, error: 'initiative not found' };

  if (wouldCloseCycle(await segmentEdges(db, scope), from, to)) return { ok: false, status: 409, error: CYCLE_ERROR };

  const [inserted] = await db
    .insert(pmoDependencies)
    .values({ tenantId: scope.tenantId, segmentId: scope.segmentId, fromInitiativeId: from, toInitiativeId: to })
    .onConflictDoNothing({ target: [pmoDependencies.fromInitiativeId, pmoDependencies.toInitiativeId] })
    .returning();
  // An existing identical edge is not an error: the graph already says this.
  if (!inserted) return { ok: true, edge: { fromInitiativeId: from, toInitiativeId: to } };

  // Close the race: re-check against the now-current edges and compensate. Our own
  // from→to edge cannot create a to⇝from path, so a hit means a concurrent reverse
  // path landed between the pre-check and the insert.
  if (wouldCloseCycle(await segmentEdges(db, scope), from, to)) {
    await db.delete(pmoDependencies).where(scopedToTenant(pmoDependencies, scope.tenantId, eq(pmoDependencies.id, inserted.id)));
    return { ok: false, status: 409, error: CYCLE_ERROR };
  }
  return { ok: true, edge: inserted };
}

/** Remove one edge in this tenant/segment. The deleted id, or null when none matched. */
export async function deleteInitiativeDependency(db: Db, scope: InitiativeScope, id: string): Promise<string | null> {
  const [row] = await db
    .delete(pmoDependencies)
    .where(scopedToTenant(pmoDependencies, scope.tenantId, and(eq(pmoDependencies.id, id), eq(pmoDependencies.segmentId, scope.segmentId))))
    .returning({ id: pmoDependencies.id });
  return row?.id ?? null;
}
