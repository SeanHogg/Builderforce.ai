/**
 * The AGENT-ASSIGNMENT tools — `project_agents.*` and `agent_assignments.*`, spread into
 * `builtinMcpService`'s `CATALOG`.
 *
 * Every tool runs through THE assignment use case (`AgentAssignmentService`), the same calls
 * `/api/agent-assignments` makes, so a tool write bumps the same cache token and cleans up
 * the same per-agent capabilities and schedules. Who may write which scope is
 * `agentAssignmentPolicy` — the rule the REST router applies — so project staffing and
 * workspace identities need MANAGER+ here too.
 *
 * `project_agents.*` keeps its delivery-surface name (`toolSurfaces` DELIVERY_DOMAINS);
 * since migration 1265 it is the `scope = 'project'` slice of `agent_assignments`.
 * `chat` is not reachable from these tools: chat invites go through the chat tools, which
 * check the caller can open the chat.
 */
import { AgentAssignmentService } from '../agent/AgentAssignmentService';
import { ROUTABLE_SCOPES, type AssignmentScope } from '../agent/agentAssignmentModel';
import { mayWriteAssignmentScope } from '../agent/agentAssignmentPolicy';
import { ForbiddenError } from '../../domain/shared/errors';
import type { BuiltinCtx, BuiltinTool } from './builtinToolContext';

type Json = Record<string, unknown>;

const S = { type: 'string' } as const;
const N = { type: 'number' } as const;
const obj = (properties: Json, required: string[] = []): Json => ({ type: 'object', properties, required });
const str = (v: unknown): string => String(v ?? '');
const num = (v: unknown): number => Number(v);

const service = (ctx: BuiltinCtx) => new AgentAssignmentService(ctx.db, ctx.env);

function routableScope(raw: unknown): AssignmentScope {
  const scope = str(raw) as AssignmentScope;
  if (!ROUTABLE_SCOPES.includes(scope)) throw new Error(`scope must be one of: ${ROUTABLE_SCOPES.join(', ')}`);
  return scope;
}

function requireWriteScope(ctx: BuiltinCtx, scope: AssignmentScope): void {
  if (!mayWriteAssignmentScope(ctx.role, scope)) {
    throw new ForbiddenError(`Writing a '${scope}' agent assignment requires the 'manager' role.`);
  }
}

export const AGENT_ASSIGNMENT_TOOLS: BuiltinTool[] = [
  {
    tool: 'project_agents.list', mutates: false,
    description: 'List agents staffed on a project.',
    parameters: obj({ projectId: N }, ['projectId']),
    run: async (ctx, a) => {
      await ctx.projects.getProject(num(a.projectId), ctx.tenantId); // tenant-ownership guard
      return service(ctx).listForProject(ctx.tenantId, num(a.projectId));
    },
  },
  {
    tool: 'project_agents.add', mutates: true,
    description: 'Staff an agent on a project. agentKind: workforce|registered.',
    parameters: obj({ projectId: N, agentKind: { type: 'string', enum: ['workforce', 'registered'] }, agentRef: S, name: S, role: S }, ['projectId', 'agentKind', 'agentRef', 'name']),
    run: async (ctx, a) => {
      requireWriteScope(ctx, 'project');
      await ctx.projects.getProject(num(a.projectId), ctx.tenantId); // tenant-ownership guard
      return service(ctx).assign(ctx.tenantId, {
        agentKind: str(a.agentKind), agentRef: str(a.agentRef), scope: 'project', scopeId: String(num(a.projectId)),
        name: str(a.name), ...(a.role != null ? { role: str(a.role) } : {}),
      });
    },
  },
  {
    tool: 'project_agents.remove', mutates: true,
    description: 'Remove an agent from a project (by assignment id or its numeric handle).',
    parameters: obj({ id: S }, ['id']),
    run: async (ctx, a) => {
      requireWriteScope(ctx, 'project');
      const svc = service(ctx);
      const row = await svc.find(ctx.tenantId, str(a.id));
      if (!row) return { deleted: null };
      const removed = await svc.unassign(ctx.tenantId, row.id, { scope: 'project' });
      return { deleted: removed ? row.id : null };
    },
  },
  {
    tool: 'agent_assignments.list', mutates: false,
    description: 'List agents assigned to a scope (project/workflow/security/swimlane/brain/global/workspace).',
    parameters: obj({ scope: S, scopeId: S }, ['scope']),
    run: async (ctx, a) => {
      const scope = routableScope(a.scope);
      if (scope === 'project' && a.scopeId != null) await ctx.projects.getProject(num(a.scopeId), ctx.tenantId);
      return service(ctx).list(ctx.tenantId, scope, a.scopeId != null ? str(a.scopeId) : undefined);
    },
  },
  {
    tool: 'agent_assignments.assign', mutates: true,
    description: 'Assign a registered agent to a scope (project/workflow/security/swimlane/brain/global/workspace). A workspace identity takes no scopeId.',
    parameters: obj({ agentKind: S, agentRef: S, scope: S, scopeId: S, role: S }, ['agentKind', 'agentRef', 'scope']),
    run: async (ctx, a) => {
      const scope = routableScope(a.scope);
      requireWriteScope(ctx, scope);
      if (scope === 'workspace' && a.scopeId != null) throw new Error('a workspace identity is tenant-wide; omit scopeId');
      if (scope === 'project') await ctx.projects.getProject(num(a.scopeId), ctx.tenantId); // tenant-ownership guard
      return service(ctx).assign(ctx.tenantId, {
        agentKind: str(a.agentKind), agentRef: str(a.agentRef), scope,
        scopeId: a.scopeId != null ? str(a.scopeId) : null, ...(a.role != null ? { role: str(a.role) } : {}),
      });
    },
  },
  {
    tool: 'agent_assignments.remove', mutates: true,
    description: 'Remove an agent assignment by id.',
    parameters: obj({ id: S }, ['id']),
    run: async (ctx, a) => {
      const svc = service(ctx);
      const row = await svc.find(ctx.tenantId, str(a.id));
      if (!row || !ROUTABLE_SCOPES.includes(row.scope)) return { deleted: null };
      requireWriteScope(ctx, row.scope);
      const removed = await svc.unassign(ctx.tenantId, row.id, { scope: ROUTABLE_SCOPES });
      return { deleted: removed ? row.id : null };
    },
  },
];
