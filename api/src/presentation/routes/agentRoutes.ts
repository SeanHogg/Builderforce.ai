import { Hono } from 'hono';
import { AgentService } from '../../application/agent/AgentService';
import { AgentType, TenantRole } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';

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
    return c.json(agents.map(a => a.toPlain()));
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
    return c.json(agent.toPlain(), 201);
  });

  // Get a single agent
  router.get('/:id', async (c) => {
    const agent = await agentService.getAgent(Number(c.req.param('id')));
    return c.json(agent.toPlain());
  });

  // Deactivate an agent (MANAGER+)
  router.delete('/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const agent = await agentService.deactivateAgent(Number(c.req.param('id')));
    return c.json(agent.toPlain());
  });

  // List skills for a specific agent
  router.get('/:id/skills', async (c) => {
    const skills = await agentService.listSkills(Number(c.req.param('id')));
    return c.json(skills.map(s => s.toPlain()));
  });

  // Register a skill for an agent (MANAGER+)
  router.post('/:id/skills', requireRole(TenantRole.MANAGER), async (c) => {
    const agentId = Number(c.req.param('id'));
    const body = await c.req.json<{
      name:          string;
      description?:  string;
      inputSchema?:  string;
      outputSchema?: string;
    }>();
    const skill = await agentService.registerSkill({ agentId, ...body });
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
