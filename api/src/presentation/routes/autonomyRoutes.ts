/**
 * LENS — "Autonomy Health": /api/insights/autonomy
 *
 * The fleet-scale answer to "are tickets created by the manager or by a human
 * ACTUALLY going through their full lifecycle autonomously?" — the question that had
 * no answer anywhere in the product, because the evidence sat in four unjoined tables.
 *
 * Reads existing collectors only (activity_log + task_status_transitions + executions
 * + tool_audit_events — no new collection, no migration), so the figures are
 * retroactive: the first load already reports on months of accumulated history.
 *
 * The metric that cannot be fudged is the hop split. Every lane move is stamped
 * `actor_kind` ('system' for agents/automation, 'human' for a person), so:
 *   • tickets that reached a terminal lane with ZERO human hops → autonomy did it
 *   • tickets whose every hop is human → autonomy never drove them
 *   • tickets short of Done with nothing running → stalled, with the exact gate
 *     (`no_agent`, `human_gate`, `run_cap_exhausted`, `cooldown_active`, …) that holds them
 *
 * Manager-gated + short-TTL cached like the sibling lenses; the underlying summary is
 * version-token cached off the activity-log version so a new ticket invalidates it
 * rather than serving a stale funnel.
 */
import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { scope } from './segmentTrackerRoutes';
import { getAutonomySummary } from '../../application/activity/ticketLifecycleLedger';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

/** Clamp a `?days=` window to a sane range (default 30). */
function parseDays(raw: string | undefined, def = 30): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 365 ? Math.floor(n) : def;
}

export function createAutonomyRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // Autonomy Health — per-origin lifecycle funnel + where autonomy stalls (manager).
  // `?projectId=` narrows to one project; omitted = the whole tenant.
  router.get('/autonomy', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const windowDays = parseDays(c.req.query('days'));
    const rawProject = Number(c.req.query('projectId'));
    const projectId = Number.isFinite(rawProject) && rawProject > 0 ? Math.floor(rawProject) : null;
    return c.json(await getAutonomySummary(c.env as Env, db, { tenantId, projectId, windowDays }));
  });

  return router;
}
