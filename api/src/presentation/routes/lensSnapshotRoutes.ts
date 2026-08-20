/**
 * Lens snapshot routes — /api/insights/snapshots
 *
 * The read + capture surface for the annual-calendar cadence (periodic monthly /
 * quarterly / annual review snapshots of an insight lens). The cron sweep
 * (dueSnapshots) writes rolling snapshots automatically; these routes let a
 * manager LIST what's been captured, read one period's frozen payload, and force
 * a capture-now. Reads are MANAGER+ (mirrors the underlying lens gates).
 *
 *   GET  /api/insights/snapshots               list snapshots (?lens=&period=)
 *   GET  /api/insights/snapshots/:id           one snapshot's frozen payload
 *   POST /api/insights/snapshots/capture       capture-now { lens, period? } (MANAGER+)
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import {
  captureLensSnapshot, isSnapshotableLens, cadenceOfPeriod, periodFor,
  listLensSnapshots, getLensSnapshot,
  SNAPSHOTABLE_LENSES, SNAPSHOT_CADENCES, type SnapshotCadence,
} from '../../application/reports/lensSnapshots';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const CADENCES = SNAPSHOT_CADENCES;

export function createLensSnapshotRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // ── GET /snapshots — list captured snapshots (metadata only, no payloads) ──
  router.get('/snapshots', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const snapshots = await listLensSnapshots(db, tenantId, {
      lens: c.req.query('lens'),
      period: c.req.query('period'),
    });

    return c.json({ snapshotableLenses: SNAPSHOTABLE_LENSES, cadences: CADENCES, snapshots });
  });

  // ── GET /snapshots/:id — one frozen payload ───────────────────────────────
  router.get('/snapshots/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const snapshot = await getLensSnapshot(db, tenantId, c.req.param('id'));
    if (!snapshot) return c.json({ error: 'snapshot not found' }, 404);
    return c.json({ snapshot });
  });

  // ── POST /snapshots/capture — capture-now for a lens/period ───────────────
  router.post('/snapshots/capture', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    type CaptureBody = { lens?: string; period?: string; cadence?: SnapshotCadence };
    const body = await c.req.json<CaptureBody>().catch(() => ({} as CaptureBody));
    const lens = body.lens;
    if (!lens || !isSnapshotableLens(lens)) {
      return c.json({ error: `lens must be one of: ${SNAPSHOTABLE_LENSES.join(', ')}` }, 400);
    }
    const now = new Date();
    // period: explicit label, else derive from the requested cadence (default monthly).
    const cadence: SnapshotCadence = CADENCES.includes(body.cadence as SnapshotCadence) ? body.cadence as SnapshotCadence : 'monthly';
    const period = body.period && cadenceOfPeriod(body.period) ? body.period : periodFor(cadence, now);

    const payload = await captureLensSnapshot(db, tenantId, lens, period, now);
    return c.json({ captured: true, lens, period, cadence: cadenceOfPeriod(period), payload }, 201);
  });

  return router;
}
