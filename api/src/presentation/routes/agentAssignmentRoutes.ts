/**
 * Agent assignment routes – /api/agent-assignments
 *
 * The single surface for the canonical agent-assignment model: assign a
 * tenant-registered agent (agentKind+agentRef) to any platform aspect (project,
 * workflow, security, swimlane, brain, global) and list those assignments. All
 * reads go through AgentAssignmentService's read-through cache.
 *
 *   GET    /api/agent-assignments?scope=&scopeId=   list assignments for a scope
 *   POST   /api/agent-assignments                   assign (idempotent upsert)
 *   DELETE /api/agent-assignments/:id               unassign
 */
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import {
  AgentAssignmentService,
  type AssignmentScope,
  type ExecutionScope,
} from '../../application/agent/AgentAssignmentService';
import type { HonoEnv } from '../../env';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const SCOPES: AssignmentScope[] = [
  'project',
  'workflow',
  'security',
  'swimlane',
  'brain',
  'global',
];

export function createAgentAssignmentRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  const svc = (env: unknown) => new AgentAssignmentService(db, env as Env);

  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const scope = c.req.query('scope');
    if (!scope || !SCOPES.includes(scope as AssignmentScope)) {
      return c.json({ error: `scope must be one of: ${SCOPES.join(', ')}` }, 400);
    }
    const scopeId = c.req.query('scopeId') ?? undefined;
    const assignments = await svc(c.env).list(tenantId, scope as AssignmentScope, scopeId);
    return c.json({ assignments });
  });

  router.post('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{
      agentKind: string;
      agentRef: string;
      scope: AssignmentScope;
      scopeId?: string | null;
      executionScope?: ExecutionScope;
      role?: string;
    }>();
    if (!body.agentKind || !body.agentRef) return c.json({ error: 'agentKind and agentRef are required' }, 400);
    if (!SCOPES.includes(body.scope)) return c.json({ error: `scope must be one of: ${SCOPES.join(', ')}` }, 400);

    const assignment = await svc(c.env).assign(tenantId, {
      agentKind: body.agentKind,
      agentRef: body.agentRef,
      scope: body.scope,
      scopeId: body.scopeId ?? null,
      executionScope: body.executionScope,
      role: body.role,
    });
    return c.json({ assignment }, 201);
  });

  router.delete('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const ok = await svc(c.env).unassign(tenantId, c.req.param('id'));
    if (!ok) return c.json({ error: 'Assignment not found' }, 404);
    return c.json({ ok: true });
  });

  return router;
}
