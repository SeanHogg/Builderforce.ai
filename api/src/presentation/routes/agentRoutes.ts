import { Hono, type MiddlewareHandler } from 'hono';
import type { Db } from '../../infrastructure/database/connection';
import { TenantRole } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { legacyAliasNotice } from '../middleware/legacyAlias';
import { agentRegistrations, skills } from '../../infrastructure/database/schema';
import { and, eq, inArray } from 'drizzle-orm';

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
 * is the successor.
 */

const SUCCESSOR = '/api/agent-registrations';

/** The standard alias stamp (Deprecation + successor Link) plus the published Sunset date. */
const legacyRegistry: MiddlewareHandler<HonoEnv>[] = [
  legacyAliasNotice(SUCCESSOR),
  async (c, next) => { await next(); c.header('Sunset', 'Wed, 31 Dec 2026 23:59:59 GMT'); },
];

/** One folded agent row, shaped exactly like the legacy domain `toPlain()` projection. */
type AgentRow = typeof agentRegistrations.$inferSelect;

/** Strips nothing the legacy route did not already strip; matches the old projection. */
function serializeAgent(row: AgentRow): Record<string, unknown> {
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

function serializeSkill(row: typeof skills.$inferSelect): Record<string, unknown> {
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
  router.use('*', authMiddleware, ...legacyRegistry);

  const tenantId = (c: { get(key: 'tenantId'): number }) => c.get('tenantId');

  const findByLegacyId = async (c: { get(key: 'tenantId'): number }, id: number) => {
    const [row] = await db
      .select().from(agentRegistrations)
      .where(and(eq(agentRegistrations.legacyAgentId, id), eq(agentRegistrations.tenantId, tenantId(c))))
      .limit(1);
    return row ?? null;
  };

  // List agents for caller's tenant — ordered by the numeric id the clients sort on.
  router.get('/', async (c) => {
    const rows = await db
      .select().from(agentRegistrations)
      .where(eq(agentRegistrations.tenantId, tenantId(c)))
      .orderBy(agentRegistrations.legacyAgentId);
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
    const row = await findByLegacyId(c, Number(c.req.param('id')));
    if (!row) return c.json({ error: 'Agent not found' }, 404);
    return c.json(serializeAgent(row));
  });

  // Deactivate an agent (MANAGER+) — tenant-scoped (404 on a cross-tenant id).
  // Sets status on the canonical registration; the response still carries the
  // legacy projection (id = legacy_agent_id) so old clients see the same shape.
  router.delete('/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const row = await findByLegacyId(c, Number(c.req.param('id')));
    if (!row) return c.json({ error: 'Agent not found' }, 404);
    const [updated] = await db
      .update(agentRegistrations)
      .set({ status: 'inactive', updatedAt: new Date() })
      .where(eq(agentRegistrations.id, row.id))
      .returning();
    return c.json(serializeAgent(updated!));
  });

  // List skills for a specific agent, gated by tenant-scoped ownership.
  router.get('/:id/skills', async (c) => {
    const id = Number(c.req.param('id'));
    const row = await findByLegacyId(c, id);
    if (!row) return c.json({ error: 'Agent not found' }, 404);
    const rows = await db
      .select().from(skills)
      .where(eq(skills.agentRegistrationId, row.id))
      .orderBy(skills.id);
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
  router.use('*', authMiddleware, ...legacyRegistry);

  // GET /api/skills – every skill on the caller's tenant's registrations (the same read
  // as /api/agents/:id/skills without the agent filter).
  router.get('/', async (c) => {
    const registrations = await db
      .select({ id: agentRegistrations.id })
      .from(agentRegistrations)
      .where(eq(agentRegistrations.tenantId, c.get('tenantId')));
    const registrationIds = registrations.map((r) => r.id);
    if (registrationIds.length === 0) return c.json([]);
    const rows = await db
      .select().from(skills)
      .where(inArray(skills.agentRegistrationId, registrationIds))
      .orderBy(skills.id);
    return c.json(rows.map(serializeSkill));
  });

  return router;
}
