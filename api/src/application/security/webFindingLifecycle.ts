/**
 * webFindingLifecycle — when a web-scan finding's ticket is allowed to CLOSE.
 *
 * Extracted from `webSecurityScan` for one concrete reason: findings now arrive from
 * TWO runtimes. The Worker pass raises the header/cookie/CORS/content/exposure checks
 * in-request; the container stages raise the TLS and CVE checks minutes later. Both
 * need the same deterministic auto-close, and the container ingest importing it back
 * out of `webSecurityScan` (which imports the ingest's dispatch) would close a module
 * cycle for no reason. One small module both sides depend on, and no cycle.
 *
 * PURE decision + the one narrow write it implies, kept together so there is exactly
 * one definition of "this finding is resolved".
 */
import { and, eq, ne, inArray } from 'drizzle-orm';
import { tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { TaskStatus } from '../../domain/shared/types';
import { stageOfCheckId } from './webScanStages';
import type { Db } from '../../infrastructure/database/connection';

/**
 * Which findings a given pass is ENTITLED to close. The Worker pass owns every check
 * it can make itself; a container stage owns its own (`tls-*`, `cve-*`). Default is
 * the Worker's half, because that is the caller that runs on every scan.
 */
export type CheckOwnership = (checkId: string) => boolean;

/** The Worker-side scan owns every check that is not a container stage's. */
export const workerOwnedCheck: CheckOwnership = (checkId) => stageOfCheckId(checkId) == null;

/**
 * PURE decision: given the open tickets in a project, which ones should this pass
 * auto-close? A ticket is resolved when it carries a web marker for THIS origin, for a
 * check THIS pass is responsible for, that the pass no longer raises. Scoped to one
 * origin's `[web:*]` markers so it never touches SOC 2 / GitHub / manual tickets.
 * Separated from IO so it is fully unit-testable without a DB (mirrors the scanner's
 * pure/IO split).
 *
 * `owns` is what makes this safe now that findings arrive from TWO runtimes. The
 * Worker pass must not close a `tls-*` ticket merely because it did not raise it —
 * it CANNOT raise it; the container does, minutes later. Closing it anyway would
 * churn the ticket closed-then-reopened on every single scan.
 */
export function selectResolvedTicketIds(
  openTickets: Array<{ id: number; title: string | null }>,
  origin: string,
  currentMarkers: Set<string>,
  owns: CheckOwnership = workerOwnedCheck,
): number[] {
  const originLc = origin.toLowerCase();
  const out: number[] = [];
  for (const r of openTickets) {
    const m = /\[web:([a-z0-9-]+):([^\]]+)\]/i.exec(r.title ?? '');
    if (!m) continue;
    if ((m[2] ?? '').toLowerCase() !== originLc) continue; // only this site's findings
    if (!owns(m[1] ?? '')) continue;                        // not this pass's to close
    if (currentMarkers.has(m[0].toLowerCase())) continue;   // still raised → keep open
    out.push(r.id);
  }
  return out;
}

/**
 * Auto-close SECURITY tickets from a prior scan of the SAME origin whose finding the
 * current pass no longer raises. Safe precisely because this scanner is deterministic:
 * a check that fired before and doesn't now is objectively resolved (unlike an
 * external alert feed's silence, which is ambiguous — see githubAlerts). Returns the
 * number closed. Exported so a container stage closes ITS OWN resolved findings by
 * the same rule rather than growing a second, subtly different closer.
 */
export async function autoCloseResolved(
  db: Db,
  tenantId: number,
  projectId: number,
  origin: string,
  currentMarkers: Set<string>,
  owns: CheckOwnership = workerOwnedCheck,
): Promise<number> {
  // Both statements carry the tenant predicate through `scopedToTenant`, even though
  // the project was already resolved tenant-scoped by the caller. A closer that
  // reaches its tenant only through a join is unscoped by construction, and this one
  // now runs from TWO entry points (the Worker pass and the container ingest) — one
  // caller resolving the project loosely would silently close another workspace's
  // tickets.
  const rows = await db
    .select({ id: tasks.id, title: tasks.title })
    .from(tasks)
    .where(scopedToTenant(tasks, tenantId, and(
      eq(tasks.projectId, projectId),
      eq(tasks.archived, false),
      ne(tasks.status, TaskStatus.DONE),
    )));
  const toClose = selectResolvedTicketIds(rows, origin, currentMarkers, owns);
  if (toClose.length === 0) return 0;
  await db.update(tasks)
    .set({ status: TaskStatus.DONE, updatedAt: new Date() })
    .where(scopedToTenant(tasks, tenantId, inArray(tasks.id, toClose)));
  return toClose.length;
}
