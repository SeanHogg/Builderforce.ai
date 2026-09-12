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
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { authMiddleware } from '../middleware/authMiddleware';
import { claimStageSandboxRunBundle, completeStageSandboxRun } from '../../application/marketplace/stageSandboxRuns';
import { parseBody, z } from './requestBody';

/**
 * The container's result report. Every field is read defensively by the handler
 * (an unknown status is `error`, a non-array `findings` is ignored, a non-number
 * duration is `null`), so only the text fields are typed.
 */
const SandboxResultBody = z.object({
  status: z.unknown().optional(),
  findings: z.unknown().optional(),
  summary: z.string().nullish(),
  errorMessage: z.string().nullish(),
  durationMs: z.unknown().optional(),
});

export function createStageSandboxRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  /** The container's claim — flips `queued → running` and hands back the exact
   *  payload objects a buyer would receive, so the container drives the SAME
   *  copy `stageChecks.ts` reads rather than re-deriving one. */
  router.get('/:runId/claim', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const bundle = await claimStageSandboxRunBundle(db, { runId: c.req.param('runId'), tenantId });
    if (!bundle) return c.json({ harness: null }, 200); // already claimed, or gone — nothing to do
    return c.json(bundle);
  });

  /** The container's result report. */
  router.patch('/:runId', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await parseBody(c, SandboxResultBody);
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
