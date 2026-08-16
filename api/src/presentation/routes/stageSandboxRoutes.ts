/**
 * The Stage Sandbox container's own two callback routes — `/api/creation-
 * listings/sandbox`. The caller is a machine identity (the run-scoped token
 * `mintStageSandboxToken` mints), never a seller, so this mirrors QA's findings
 * intake (`qaRoutes.ts`): base `authMiddleware` only, no `requireRole` — the
 * token's `tid` is the only authority, and every query is scoped by it.
 *
 * This is a presentation adapter and holds no data access of its own beyond
 * reading the snapshot payload the claim response hands the container; the run
 * row itself is owned entirely by `application/marketplace/stageSandboxRuns.ts`.
 */

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { snapshots } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { authMiddleware } from '../middleware/authMiddleware';
import { claimStageSandboxRun, completeStageSandboxRun } from '../../application/marketplace/stageSandboxRuns';
import type { StageCheck } from '@builderforce/creation-canvas-contract';

export function createStageSandboxRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  /** The container's claim — flips `queued → running` and hands back the exact
   *  payload objects a buyer would receive, so the container drives the SAME
   *  copy `stageChecks.ts` reads rather than re-deriving one. */
  router.get('/:runId/claim', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const claimed = await claimStageSandboxRun(db, { runId: c.req.param('runId'), tenantId });
    if (!claimed) return c.json({ harness: null }, 200); // already claimed, or gone — nothing to do

    const [row] = await db
      .select({ payload: snapshots.payload })
      .from(snapshots)
      .where(and(eq(snapshots.id, claimed.snapshotId), scopedToTenant(snapshots, tenantId)))
      .limit(1);
    const objects = (row?.payload as { objects?: unknown } | null)?.objects ?? [];
    return c.json({ harness: claimed.harness, objects });
  });

  /** The container's result report. */
  router.patch('/:runId', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{
      status?: string;
      findings?: StageCheck[];
      summary?: string | null;
      errorMessage?: string | null;
      durationMs?: number | null;
    }>();
    const status = body.status === 'passed' || body.status === 'failed' ? body.status : 'error';
    const ok = await completeStageSandboxRun(db, {
      runId: c.req.param('runId'),
      tenantId,
      status,
      findings: Array.isArray(body.findings) ? body.findings : undefined,
      summary: body.summary ?? null,
      errorMessage: body.errorMessage ?? null,
      durationMs: typeof body.durationMs === 'number' ? body.durationMs : null,
    });
    return c.json({ ok });
  });

  return router;
}
