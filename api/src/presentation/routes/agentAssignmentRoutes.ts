/**
 * Agent assignment routes – /api/agent-assignments
 *
 * The single surface for the canonical agent-assignment model: assign a tenant agent
 * (agentKind+agentRef) to any platform aspect — project staffing, a workspace identity,
 * workflow, security, swimlane, brain, global — list those assignments, and set an
 * agent's per-agent governance. All reads and writes go through AgentAssignmentService.
 *
 *   GET    /api/agent-assignments?scope=&scopeId=   list assignments for a scope
 *   POST   /api/agent-assignments                   assign (idempotent upsert)
 *   DELETE /api/agent-assignments/:id               unassign (uuid, or integer handle)
 *   PUT    /api/agent-assignments/:id/governance    set per-agent governance (MANAGER+)
 *
 * `/api/project-agents` is a DEPRECATED alias of this router (mounted through
 * `mountWithLegacyAliases`, so its responses carry `Deprecation` + a successor `Link`).
 * Its contract — `?projectId=`, a body with `projectId` + `name`, numeric ids — is
 * accepted here as the project-scope shorthand, and a request made in that shape also
 * gets the legacy `agent`/`agents` keys (id = the integer handle) so deployed callers
 * keep working until they move.
 *
 * The alias also keeps the old project-agents STATUS contract: DELETE answers 204, and
 * POST answers 200 leaving an existing attachment untouched.
 *
 * Who may write which scope is `agentAssignmentPolicy` — shared with the Brain/MCP tools.
 * `chat` is not routable here: chat invites are removed through the chat routes, which
 * check the caller can open that chat, so a chat assignment id is refused on this router.
 */
import { Hono, type Context } from 'hono';
import { authMiddleware, requestActor } from '../middleware/authMiddleware';
import { LEGACY_AGENT_ASSIGNMENT_PATHS } from '../middleware/legacyAlias';
import { AgentAssignmentService } from '../../application/agent/AgentAssignmentService';
import {
  AGENT_KINDS,
  CONFIGURABLE_SCOPES,
  ROUTABLE_SCOPES,
  normaliseScopeId,
  type AgentAssignment,
  type AgentKind,
  type AssignmentScope,
} from '../../application/agent/agentAssignmentModel';
import { mayWriteAssignmentScope } from '../../application/agent/agentAssignmentPolicy';
import type { TenantRole } from '../../domain/shared/types';
import { projectInTenant, projectInTenantCached } from '../../application/project/projectOwnership';
import { ForbiddenError } from '../../domain/shared/errors';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { parseBody, z } from './requestBody';

/** `POST /` — canonical (`scope`/`scopeId`) or the legacy project shorthand (`projectId`). */
const AssignBody = z.object({
  agentKind: z.string().nullish(),
  agentRef: z.string().nullish(),
  scope: z.enum(ROUTABLE_SCOPES as [AssignmentScope, ...AssignmentScope[]]).optional(),
  scopeId: z.string().nullish(),
  projectId: z.number().nullish(),
  executionScope: z.enum(['project', 'global']).optional(),
  role: z.string().nullish(),
  name: z.string().nullish(),
});

/** `PUT /:id/governance` — absent/`null` clears it. */
const GovernanceBody = z.object({ governance: z.string().nullish() });

/** The pre-1265 `project_agents` row shape, served only to legacy-shaped requests. */
function legacyProjectAgent(tenantId: number, a: AgentAssignment) {
  return {
    id: a.agentHandle,
    assignmentId: a.id,
    tenantId,
    projectId: a.projectId,
    agentKind: a.agentKind,
    agentRef: a.agentRef,
    name: a.name ?? a.agentRef,
    role: a.role,
    governance: a.governance,
    addedBy: a.addedBy,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

function requireWriteScope(c: Context<HonoEnv>, scope: AssignmentScope): void {
  const role = c.get('role') as TenantRole | undefined;
  if (!mayWriteAssignmentScope(role, scope)) {
    throw new ForbiddenError(`Requires at least 'manager' role, caller has '${String(role)}'`);
  }
}

/** True when the request arrived on the deprecated `/api/project-agents` mount. */
const viaLegacyPath = (c: Context<HonoEnv>): boolean =>
  LEGACY_AGENT_ASSIGNMENT_PATHS.some((p) => c.req.path === p || c.req.path.startsWith(`${p}/`));

export function createAgentAssignmentRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  const svc = (c: Context<HonoEnv>) => new AgentAssignmentService(db, c.env as Env);

  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const legacyProjectId = c.req.query('projectId');
    const scope = (legacyProjectId != null ? 'project' : c.req.query('scope')) as AssignmentScope | undefined;
    if (!scope || !ROUTABLE_SCOPES.includes(scope)) {
      return c.json({ error: `scope must be one of: ${ROUTABLE_SCOPES.join(', ')}` }, 400);
    }
    const rawScopeId = legacyProjectId ?? c.req.query('scopeId') ?? undefined;
    if (scope === 'project' && rawScopeId != null) {
      if (!/^\d{1,9}$/.test(rawScopeId) || !(await projectInTenantCached(c.env as Env, db, tenantId, Number(rawScopeId)))) {
        return c.json({ error: 'Project not found' }, 404);
      }
    }
    const assignments = await svc(c).list(tenantId, scope, rawScopeId);
    if (legacyProjectId != null) {
      return c.json({ assignments, agents: assignments.map((a) => legacyProjectAgent(tenantId, a)) });
    }
    return c.json({ assignments });
  });

  router.post('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    // A machine or agent principal's subject is not a users.id — record no adder.
    const addedBy = requestActor(c).actorUserId ?? null;
    const body = await parseBody(c, AssignBody);
    const legacy = body.scope == null && body.projectId != null;
    const scope: AssignmentScope | undefined = body.scope ?? (body.projectId != null ? 'project' : undefined);

    if (!scope) return c.json({ error: `scope must be one of: ${ROUTABLE_SCOPES.join(', ')}` }, 400);
    if (!body.agentKind || !body.agentRef) return c.json({ error: 'agentKind and agentRef are required' }, 400);
    if (scope === 'workspace' && body.scopeId != null) {
      return c.json({ error: 'a workspace identity is tenant-wide; scopeId must be omitted' }, 400);
    }

    requireWriteScope(c, scope);
    if (CONFIGURABLE_SCOPES.includes(scope) && !AGENT_KINDS.includes(body.agentKind as AgentKind)) {
      return c.json({ error: 'agentKind is required (workforce|registered)' }, 400);
    }

    const rawScopeId = body.scopeId ?? (body.projectId != null ? String(body.projectId) : null);
    if (scope === 'project' && (rawScopeId == null || !/^\d{1,9}$/.test(rawScopeId.trim()))) {
      return c.json({ error: 'projectId is required' }, 400);
    }
    const scopeId = normaliseScopeId(scope, rawScopeId);
    if (scope === 'project' && !(await projectInTenant(db, tenantId, Number(scopeId)))) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const assignment = await svc(c).assign(tenantId, {
      agentKind: body.agentKind,
      agentRef: body.agentRef,
      scope,
      scopeId,
      executionScope: body.executionScope,
      role: body.role ?? undefined,
      name: body.name ?? null,
      addedBy,
      // The old attach was insert-or-return-existing: re-attaching never rewrote a row.
      onExisting: legacy ? 'keep' : 'update',
    });
    if (legacy) return c.json({ assignment, agent: legacyProjectAgent(tenantId, assignment) }, 200);
    return c.json({ assignment }, 201);
  });

  router.delete('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const legacyPath = viaLegacyPath(c);
    // The legacy mount only ever detached project agents; the canonical one any routable
    // scope — never a chat invite (see the module note).
    const allowed: readonly AssignmentScope[] = legacyPath ? CONFIGURABLE_SCOPES : ROUTABLE_SCOPES;
    const service = svc(c);
    const target = await service.find(tenantId, c.req.param('id'));
    if (!target || !allowed.includes(target.scope)) return c.json({ error: 'Assignment not found' }, 404);
    requireWriteScope(c, target.scope);
    const removed = await service.unassign(tenantId, target.id, { scope: allowed });
    if (!removed) return c.json({ error: 'Assignment not found' }, 404);
    return legacyPath ? c.body(null, 204) : c.json({ ok: true });
  });

  router.put('/:id/governance', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await parseBody(c, GovernanceBody);
    const service = svc(c);
    const target = await service.find(tenantId, c.req.param('id'));
    if (!target || !CONFIGURABLE_SCOPES.includes(target.scope)) return c.json({ error: 'Agent not found' }, 404);
    requireWriteScope(c, target.scope);
    const updated = await service.setGovernance(tenantId, target.id, body.governance ?? null);
    if (!updated) return c.json({ error: 'Agent not found' }, 404);
    return c.json({ assignment: updated, agent: legacyProjectAgent(tenantId, updated) });
  });

  return router;
}
