import { Hono, type MiddlewareHandler } from 'hono';
import type { Db } from '../../infrastructure/database/connection';
import { TenantRole } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { legacyAliasNotice } from '../middleware/legacyAlias';
import {
  LegacyAgentRegistry,
  type LegacyAgentRow,
  type LegacySkillRow,
} from '../../application/agent/legacyAgentRegistry';

/**
 * Legacy agent & skill discovery routes, now served from the canonical
 * `agent_registrations` registry.
 *
 * GET   /api/agents              – list agents for caller's tenant
 * POST  /api/agents              – closed (410; the registry is read-only here)
 * GET   /api/agents/:id          – get agent details
 * DELETE /api/agents/:id         – closed (410; deactivate on /api/agent-registrations)
 * GET   /api/agents/:id/skills   – list skills for an agent
 * POST  /api/agents/:id/skills   – closed (410)
 * GET   /api/skills              – list skills on the caller's tenant's agents
 *
 * PRD 39 §3 push 1: a numeric `:id` is the folded `legacy_agent_id`
 * (migration 0394), so the response is unchanged for a tenant with legacy rows
 * while no `agents` table sits behind it. Writes stay closed. `/api/agent-registrations`
 * is the successor. Every read is tenant-scoped in {@link LegacyAgentRegistry}.
 */

const SUCCESSOR = '/api/agent-registrations';

/** The standard alias stamp (Deprecation + successor Link) plus the published Sunset date. */
const legacyRegistry: MiddlewareHandler<HonoEnv>[] = [
  legacyAliasNotice(SUCCESSOR),
  async (c, next) => { await next(); c.header('Sunset', 'Wed, 31 Dec 2026 23:59:59 GMT'); },
];

/** Strips nothing the legacy route did not already strip; matches the old projection. */
function serializeAgent(row: LegacyAgentRow): Record<string, unknown> {
  return {
    id: row.legacyAgentId,
    tenantId: row.tenantId,
    name: row.name,
    type: row.framework,
    endpoint: row.endpoint,
    isActive: row.status === 'active',
    config: null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializeSkill(row: LegacySkillRow): Record<string, unknown> {
  return {
    id: row.id,
    agentId: row.agentId,
    name: row.name,
    description: row.description,
    inputSchema: row.inputSchema,
    outputSchema: row.outputSchema,
    createdAt: row.createdAt,
  };
}

export function createAgentRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  const registry = new LegacyAgentRegistry(db);
  router.use('*', authMiddleware, ...legacyRegistry);

  // List agents for caller's tenant — ordered by the numeric id the clients sort on.
  router.get('/', async (c) => {
    const rows = await registry.listAgents(c.get('tenantId'));
    return c.json(rows.map(serializeAgent));
  });

  // Legacy writes are intentionally closed. Keeping the route with an explicit
  // successor is safer for older clients than silently accepting more enum-bound rows.
  router.post('/', requireRole(TenantRole.MANAGER), (c) => {
    return c.json({
      error: 'The legacy agents registry is read-only',
      code: 'LEGACY_AGENTS_DEPRECATED',
      successor: SUCCESSOR,
    }, 410);
  });

  // Get a single agent by its legacy (numeric) id — tenant-scoped (404 cross-tenant).
  router.get('/:id', async (c) => {
    const row = await registry.findAgent(c.get('tenantId'), Number(c.req.param('id')));
    if (!row) return c.json({ error: 'Agent not found' }, 404);
    return c.json(serializeAgent(row));
  });

  // Deactivate an agent (MANAGER+) — tenant-scoped (404 on a cross-tenant id).
  // Sets status on the canonical registration; the response still carries the
  // legacy projection (id = legacy_agent_id) so old clients see the same shape.
  router.delete('/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const updated = await registry.deactivateAgent(c.get('tenantId'), Number(c.req.param('id')));
    if (!updated) return c.json({ error: 'Agent not found' }, 404);
    return c.json(serializeAgent(updated));
  });

  // List skills for a specific agent, gated by tenant-scoped ownership.
  router.get('/:id/skills', async (c) => {
    const tenantId = c.get('tenantId');
    const row = await registry.findAgent(tenantId, Number(c.req.param('id')));
    if (!row) return c.json({ error: 'Agent not found' }, 404);
    const rows = await registry.listAgentSkills(tenantId, row.id);
    return c.json(rows.map(serializeSkill));
  });

  router.post('/:id/skills', requireRole(TenantRole.MANAGER), (c) => {
    return c.json({
      error: 'Legacy skills are read-only; report capabilities on the canonical registration',
      code: 'LEGACY_AGENTS_DEPRECATED',
      successor: SUCCESSOR,
    }, 410);
  });

  return router;
}

/** Standalone skill discovery endpoint — joins skills to the tenant through the registration. */
export function createSkillRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  const registry = new LegacyAgentRegistry(db);
  router.use('*', authMiddleware, ...legacyRegistry);

  // GET /api/skills – every skill on the caller's tenant's registrations (the same read
  // as /api/agents/:id/skills without the agent filter).
  router.get('/', async (c) => {
    const rows = await registry.listTenantSkills(c.get('tenantId'));
    return c.json(rows.map(serializeSkill));
  });

  return router;
}
