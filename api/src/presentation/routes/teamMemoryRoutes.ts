/**
 * Team memory routes – /api/teams/memory (P4-5)
 *
 * Cross-agentHost memory sharing mesh: BuilderForce Agents instances push activity summaries
 * here so all agentHosts in a tenant can recall what peer agentHosts have been working on.
 *
 * Backed by the converged memory store (`agent_memory`, migration 0442 — the old
 * `team_memory` table was dropped by 1131). The write is `memoryService.remember`,
 * which bumps the tenant's memory version; the read is `teamMemoryFeed`, cached on
 * that same version. Both responses are the published `TeamMemoryEntry` contract.
 *
 * POST /api/teams/memory  – store a memory entry (agentHost API key or tenant JWT)
 * GET  /api/teams/memory  – retrieve recent entries (tenant JWT)
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { verifyAgentHostApiKey } from '../../infrastructure/auth/agentHostAuth';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { TeamMemoryEntry } from '../../openapi/schema';
import { remember } from '../../application/memory/memoryService';
import { listTeamMemoryEntries, teamMemoryKey } from '../../application/memory/teamMemoryFeed';
import { limitParam } from './queryParams';

export function createTeamMemoryRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // ── POST /api/teams/memory ────────────────────────────────────────────────
  // AgentHost-auth (Authorization: Bearer <key> + X-AgentHost-Id header) or tenant JWT.
  router.post('/', async (c) => {
    let tenantId: number | null = null;
    let resolvedAgentHostIdStr: string | null = null;

    // Try agentHost-auth first
    const authHeader = c.req.header('Authorization');
    const agentHostIdHeader = c.req.header('X-AgentHost-Id');
    if (authHeader?.startsWith('Bearer ') && agentHostIdHeader) {
      const key = authHeader.slice(7);
      const id = Number(agentHostIdHeader);
      if (Number.isFinite(id) && id > 0) {
        const agentHost = await verifyAgentHostApiKey(db, id, key);
        if (agentHost) {
          tenantId = agentHost.tenantId;
          resolvedAgentHostIdStr = String(agentHost.id);
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
      agentHostId?: string;
      runId: string;
      summary: string;
      tags?: string[];
      timestamp?: string;
    }>();

    if (!body.runId?.trim()) return c.json({ error: 'runId is required' }, 400);
    if (!body.summary?.trim()) return c.json({ error: 'summary is required' }, 400);

    const agentHostId = resolvedAgentHostIdStr ?? body.agentHostId ?? '';
    if (!agentHostId) return c.json({ error: 'agentHostId is required when not using agentHost API key auth' }, 400);

    const runId = body.runId.trim();
    const summary = body.summary.trim();
    const tags = Array.isArray(body.tags) ? body.tags : [];
    const stored = await remember(c.env, db, { tenantId, origin: 'on-prem' }, {
      key: teamMemoryKey(agentHostId, runId), content: summary, tags, scope: 'tenant',
    });
    if (!stored.ok) return c.json({ error: stored.error }, 500);
    const entry: TeamMemoryEntry = { tenantId, agentHostId, runId, summary, tags, timestamp: new Date().toISOString() };
    return c.json(entry, 201);
  });

  // ── GET /api/teams/memory ─────────────────────────────────────────────────
  // Tenant JWT required. Returns recent entries, newest first.
  router.use('*', authMiddleware);

  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const limit = limitParam(c.req.query('limit'), 20, 100);
    const entries: TeamMemoryEntry[] = await listTeamMemoryEntries(c.env as Env, db, tenantId, limit);
    return c.json({ entries, total: entries.length });
  });

  return router;
}
