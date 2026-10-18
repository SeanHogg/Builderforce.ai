import { Hono, type MiddlewareHandler } from 'hono';
import { AgentService } from '../../application/agent/AgentService';
import { TenantRole } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { legacyAliasNotice } from '../middleware/legacyAlias';
import type { Agent } from '../../domain/agent/Agent';

/**
 * Public serialization of an agent. Strips `apiKeyHash` (the SHA-256 of the
 * agent's callback secret) — it is needed internally by the repository's
 * save/update but must NEVER reach a client. Domain `toPlain()` keeps the field
 * so persistence round-trips; the route projection drops it here.
 */
function serializeAgent(agent: Agent): Record<string, unknown> {
  const { apiKeyHash: _apiKeyHash, ...safe } = agent.toPlain();
  return safe;
}

/**
 * Agent & Skill discovery routes.
 *
 * GET   /api/agents              – list agents for caller's tenant
 * POST  /api/agents              – register a new agent (MANAGER+)
 * GET   /api/agents/:id          – get agent details
 * DELETE /api/agents/:id         – deactivate agent (MANAGER+)
 * GET   /api/agents/:id/skills   – list skills for an agent
 * POST  /api/agents/:id/skills   – register a skill for an agent (MANAGER+)
 * GET   /api/skills              – list skills on the caller's tenant's agents
 *
 * The whole surface is the read-only legacy registry: `/api/agent-registrations`
 * is its successor. The reads stay because a `registered` agent ref (chat
 * participants, swimlane assignment) still names a row of this table.
 */

const SUCCESSOR = '/api/agent-registrations';

/** The standard alias stamp (Deprecation + successor Link) plus the published Sunset date. */
const legacyRegistry: MiddlewareHandler<HonoEnv>[] = [
  legacyAliasNotice(SUCCESSOR),
  async (c, next) => { await next(); c.header('Sunset', 'Wed, 31 Dec 2026 23:59:59 GMT'); },
];

export function createAgentRoutes(agentService: AgentService): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware, ...legacyRegistry);

  // List agents for caller's tenant
  router.get('/', async (c) => {
    const agents = await agentService.listAgents(c.get('tenantId'));
    return c.json(agents.map(serializeAgent));
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

  // Get a single agent — tenant-scoped (404 on a cross-tenant id)
  router.get('/:id', async (c) => {
    const agent = await agentService.getAgent(Number(c.req.param('id')), c.get('tenantId'));
    return c.json(serializeAgent(agent));
  });

  // Deactivate an agent (MANAGER+) — tenant-scoped (404 on a cross-tenant id)
  router.delete('/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const agent = await agentService.deactivateAgent(Number(c.req.param('id')), c.get('tenantId'));
    return c.json(serializeAgent(agent));
  });

  // List skills for a specific agent — gated by tenant-scoped agent ownership.
  router.get('/:id/skills', async (c) => {
    const skills = await agentService.listSkills(c.get('tenantId'), Number(c.req.param('id')));
    return c.json(skills.map(s => s.toPlain()));
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

/** Standalone skill discovery endpoint. */
export function createSkillRoutes(agentService: AgentService): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware, ...legacyRegistry);

  // GET /api/skills – every skill on the caller's tenant's agents (the same read
  // as /api/agents/:id/skills without the agent filter).
  router.get('/', async (c) => {
    const skills = await agentService.listSkills(c.get('tenantId'));
    return c.json(skills.map(s => s.toPlain()));
  });

  return router;
}
