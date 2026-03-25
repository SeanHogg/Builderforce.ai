/**
 * Team memory routes – /api/teams/memory (P4-5)
 *
 * Cross-claw memory sharing mesh: CoderClaw instances push activity summaries
 * here so all claws in a tenant can recall what peer claws have been working on.
 *
 * POST /api/teams/memory  – store a memory entry (claw API key or tenant JWT)
 * GET  /api/teams/memory  – retrieve recent entries (tenant JWT)
 */

import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { coderclawInstances, teamMemory } from '../../infrastructure/database/schema';
import { verifySecret } from '../../infrastructure/auth/HashService';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

async function verifyClawApiKey(
  db: Db,
  clawId: number,
  key: string | undefined,
): Promise<{ id: number; tenantId: number } | null> {
  if (!key) return null;
  const [claw] = await db
    .select({ id: coderclawInstances.id, tenantId: coderclawInstances.tenantId, apiKeyHash: coderclawInstances.apiKeyHash })
    .from(coderclawInstances)
    .where(eq(coderclawInstances.id, clawId));
  if (!claw) return null;
  const valid = await verifySecret(key, claw.apiKeyHash);
  return valid ? claw : null;
}

export function createTeamMemoryRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // ── POST /api/teams/memory ────────────────────────────────────────────────
  // Claw-auth (Authorization: Bearer <key> + X-Claw-Id header) or tenant JWT.
  router.post('/', async (c) => {
    let tenantId: number | null = null;
    let resolvedClawIdStr: string | null = null;

    // Try claw-auth first
    const authHeader = c.req.header('Authorization');
    const clawIdHeader = c.req.header('X-Claw-Id');
    if (authHeader?.startsWith('Bearer ') && clawIdHeader) {
      const key = authHeader.slice(7);
      const id = Number(clawIdHeader);
      if (Number.isFinite(id) && id > 0) {
        const claw = await verifyClawApiKey(db, id, key);
        if (claw) {
          tenantId = claw.tenantId;
          resolvedClawIdStr = String(claw.id);
        }
      }
    }

    // Fall back to tenant JWT
    if (!tenantId) {
      await authMiddleware(c as unknown as Parameters<typeof authMiddleware>[0], async () => {});
      const tid = (c as unknown as { get: (k: string) => unknown }).get('tenantId');
      if (typeof tid === 'number') tenantId = tid;
    }

    if (!tenantId) return c.text('Unauthorized', 401);

    const body = await c.req.json<{
      clawId?: string;
      runId: string;
      summary: string;
      tags?: string[];
      timestamp?: string;
    }>();

    if (!body.runId?.trim()) return c.json({ error: 'runId is required' }, 400);
    if (!body.summary?.trim()) return c.json({ error: 'summary is required' }, 400);

    const clawId = resolvedClawIdStr ?? body.clawId ?? '';
    if (!clawId) return c.json({ error: 'clawId is required when not using claw API key auth' }, 400);

    const [row] = await db
      .insert(teamMemory)
      .values({
        tenantId,
        clawId,
        runId:     body.runId.trim(),
        summary:   body.summary.trim(),
        tags:      JSON.stringify(Array.isArray(body.tags) ? body.tags : []),
        timestamp: body.timestamp ?? new Date().toISOString(),
      })
      .returning();

    return c.json({
      ...row,
      tags: JSON.parse(row?.tags ?? '[]') as string[],
    }, 201);
  });

  // ── GET /api/teams/memory ─────────────────────────────────────────────────
  // Tenant JWT required. Returns recent entries, newest first.
  router.use('*', authMiddleware);

  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const limit = Math.min(Number(c.req.query('limit') ?? '20'), 100);

    const rows = await db
      .select()
      .from(teamMemory)
      .where(eq(teamMemory.tenantId, tenantId))
      .orderBy(desc(teamMemory.createdAt))
      .limit(limit);

    const entries = rows.map((r) => ({
      ...r,
      tags: (() => { try { return JSON.parse(r.tags) as string[]; } catch { return [] as string[]; } })(),
    }));

    return c.json({ entries, total: entries.length });
  });

  return router;
}
