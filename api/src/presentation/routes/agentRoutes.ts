import { Hono } from 'hono';
import { AgentService } from '../../application/agent/AgentService';
import { AgentType, TenantRole } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
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
 * GET   /api/skills              – list all skills across all agents
 */
export function createAgentRoutes(agentService: AgentService): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // List agents for caller's tenant
  router.get('/', async (c) => {
    const agents = await agentService.listAgents(c.get('tenantId'));
    return c.json(agents.map(serializeAgent));
  });

  // Register an agent (MANAGER+)
  router.post('/', requireRole(TenantRole.MANAGER), async (c) => {
    const body = await c.req.json<{
      name:     string;
      type:     AgentType;
      endpoint: string;
      apiKey?:  string;
      config?:  string;
    }>();
    const agent = await agentService.registerAgent({
      ...body,
      tenantId:    c.get('tenantId'),
      submittedBy: c.get('userId'),
    });
    return c.json(serializeAgent(agent), 201);
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
    const agentId = Number(c.req.param('id'));
    await agentService.getAgent(agentId, c.get('tenantId')); // 404s if the agent isn't in the caller's tenant
    const skills = await agentService.listSkills(agentId);
    return c.json(skills.map(s => s.toPlain()));
  });

  // Register a skill for an agent (MANAGER+) — tenant-scoped guard inside registerSkill
  router.post('/:id/skills', requireRole(TenantRole.MANAGER), async (c) => {
    const agentId = Number(c.req.param('id'));
    const body = await c.req.json<{
      name:          string;
      description?:  string;
      inputSchema?:  string;
      outputSchema?: string;
    }>();
    const skill = await agentService.registerSkill({ agentId, ...body }, c.get('tenantId'));
    return c.json(skill.toPlain(), 201);
  });

  return router;
}

/** Standalone skill discovery endpoint. */
export function createSkillRoutes(agentService: AgentService): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // GET /api/skills – all skills across all agents
  router.get('/', async (c) => {
    const skills = await agentService.listSkills();
    return c.json(skills.map(s => s.toPlain()));
  });

  return router;
}
