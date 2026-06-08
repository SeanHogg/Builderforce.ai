/**
 * First-party (built-in) MCP server — exposes the platform's OWN capabilities
 * (projects, tasks, …) as MCP tools through the same gateway endpoints that
 * relay external tenant MCP servers (`GET /v1/mcp/tools`, `POST /v1/mcp/call`).
 *
 * Unlike {@link mcpExtensionService} (which proxies a customer's remote server),
 * these tools run IN-PROCESS against the application services, scoped to the
 * caller's tenant. That makes platform actions callable from the browser Brain,
 * external MCP clients, and the agent-runtime alike — the server-side twin of
 * the frontend's `platformActions` manifest.
 *
 * Catalog scope: projects + tasks (full CRUD). The dispatch + advertise wiring
 * is the reusable part; adding a domain is one `CATALOG` entry. Remaining
 * domains are tracked in the README Consolidated Gap Register.
 */

import type { Db } from '../../infrastructure/database/connection';
import { ProjectService } from '../project/ProjectService';
import { TaskService } from '../task/TaskService';
import { ProjectRepository } from '../../infrastructure/repositories/ProjectRepository';
import { TaskRepository } from '../../infrastructure/repositories/TaskRepository';
import { buildProjectKey } from '../project/projectKey';
import { ProjectStatus, TaskPriority } from '../../domain/shared/types';
import type { McpToolEntry } from './mcpExtensionService';

/** Sentinel extensionId the gateway routes to this in-process catalog. */
export const BUILTIN_EXTENSION_ID = 'builtin';

type Json = Record<string, unknown>;

interface BuiltinCtx {
  db: Db;
  tenantId: number;
  projects: ProjectService;
  tasks: TaskService;
}

interface BuiltinTool {
  /** `<domain>.<method>` — the relay name passed back on /v1/mcp/call. */
  tool: string;
  description: string;
  parameters: Json;
  /** Whether the tool changes state (parity with the frontend manifest). */
  mutates: boolean;
  run: (ctx: BuiltinCtx, args: Json) => Promise<unknown>;
}

// --- tiny JSON-schema helpers ----------------------------------------------
const S = { type: 'string' } as const;
const N = { type: 'number' } as const;
const B = { type: 'boolean' } as const;
const obj = (properties: Json, required: string[] = []): Json => ({ type: 'object', properties, required });
const num = (v: unknown): number => Number(v);
const str = (v: unknown): string => String(v ?? '');

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

const CATALOG: BuiltinTool[] = [
  // ---- Projects ----
  { tool: 'projects.list', mutates: false, description: 'List all projects in the workspace.', parameters: obj({}), run: (ctx) => ctx.projects.listProjects(ctx.tenantId).then((ps) => ps.map((p) => p.toPlain())) },
  { tool: 'projects.get', mutates: false, description: 'Get one project by id.', parameters: obj({ id: N }, ['id']), run: (ctx, a) => ctx.projects.getProject(num(a.id), ctx.tenantId).then((p) => p.toPlain()) },
  {
    tool: 'projects.create', mutates: true,
    description: 'Create a new project. modality: designer (app builder) | video | llm.',
    parameters: obj({ name: S, description: S, template: S, modality: { type: 'string', enum: ['designer', 'video', 'llm'] } }, ['name']),
    run: (ctx, a) => {
      const name = str(a.name).trim();
      if (!name) throw new Error('name is required');
      return ctx.projects.createProject({
        tenantId: ctx.tenantId,
        key: buildProjectKey(ctx.tenantId, name),
        name,
        description: a.description != null ? str(a.description) : null,
        template: a.template != null ? str(a.template) : null,
        modality: a.modality != null ? str(a.modality) : null,
      }).then((p) => p.toPlain());
    },
  },
  {
    tool: 'projects.update', mutates: true,
    description: "Update a project's name/description/status/modality.",
    parameters: obj({ id: N, name: S, description: S, status: S, modality: S }, ['id']),
    run: (ctx, a) => ctx.projects.updateProject(num(a.id), {
      name: a.name != null ? str(a.name) : undefined,
      description: a.description != null ? str(a.description) : undefined,
      status: a.status != null ? (str(a.status) as ProjectStatus) : undefined,
      modality: a.modality != null ? str(a.modality) : undefined,
    }, ctx.tenantId).then((p) => p.toPlain()),
  },
  { tool: 'projects.delete', mutates: true, description: 'Delete a project permanently.', parameters: obj({ id: N }, ['id']), run: (ctx, a) => ctx.projects.deleteProject(num(a.id), ctx.tenantId).then(() => ({ deleted: num(a.id) })) },

  // ---- Tasks ----
  { tool: 'tasks.list', mutates: false, description: 'List tasks, optionally filtered by project.', parameters: obj({ projectId: N }), run: (ctx, a) => ctx.tasks.listTasks(ctx.tenantId, a.projectId != null ? num(a.projectId) : undefined).then((ts) => ts.map((t) => t.toPlain())) },
  { tool: 'tasks.get', mutates: false, description: 'Get a task by id.', parameters: obj({ id: N }, ['id']), run: async (ctx, a) => (await getTenantTask(ctx, num(a.id))).toPlain() },
  {
    tool: 'tasks.create', mutates: true,
    description: 'Create a task on a project board.',
    parameters: obj({ projectId: N, title: S, description: S, priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] }, dueDate: S }, ['projectId', 'title']),
    run: (ctx, a) => ctx.tasks.createTask({
      projectId: num(a.projectId),
      title: str(a.title),
      description: a.description != null ? str(a.description) : null,
      priority: a.priority != null ? (str(a.priority) as TaskPriority) : undefined,
      dueDate: a.dueDate != null ? str(a.dueDate) : null,
    }, ctx.tenantId).then((t) => t.toPlain()),
  },
  {
    tool: 'tasks.update', mutates: true,
    description: 'Update a task (title, description, status/lane, priority, dueDate, archived).',
    parameters: obj({ id: N, title: S, description: S, status: S, priority: S, dueDate: S, archived: B }, ['id']),
    run: async (ctx, a) => {
      await getTenantTask(ctx, num(a.id)); // tenant-scope guard (service.updateTask doesn't check)
      const updated = await ctx.tasks.updateTask(num(a.id), {
        title: a.title != null ? str(a.title) : undefined,
        description: a.description != null ? str(a.description) : undefined,
        status: a.status != null ? str(a.status) : undefined,
        priority: a.priority != null ? (str(a.priority) as TaskPriority) : undefined,
        dueDate: a.dueDate != null ? str(a.dueDate) : undefined,
        archived: typeof a.archived === 'boolean' ? a.archived : undefined,
      });
      return updated.toPlain();
    },
  },
  { tool: 'tasks.delete', mutates: true, description: 'Delete a task.', parameters: obj({ id: N }, ['id']), run: async (ctx, a) => { await getTenantTask(ctx, num(a.id)); await ctx.tasks.deleteTask(num(a.id)); return { deleted: num(a.id) }; } },
  { tool: 'tasks.move', mutates: true, description: 'Move a task to another project board (re-keys it).', parameters: obj({ id: N, projectId: N }, ['id', 'projectId']), run: (ctx, a) => ctx.tasks.moveTask(num(a.id), num(a.projectId), ctx.tenantId).then((t) => t.toPlain()) },
];

/** Load a task and assert it belongs to the caller's tenant (services that take
 *  only a task id don't verify ownership — the project lookup throws if not). */
async function getTenantTask(ctx: BuiltinCtx, id: number) {
  const task = await ctx.tasks.getTask(id);
  await ctx.projects.getProject(task.projectId, ctx.tenantId); // throws Forbidden/NotFound on mismatch
  return task;
}

/** Flat, gateway-safe advertised name: `builtin_projects_list` (no dots). */
function advertisedName(tool: string): string {
  return `builtin_${tool.replace(/[^a-zA-Z0-9]+/g, '_')}`;
}

function buildCtx(db: Db, tenantId: number): BuiltinCtx {
  const projectRepo = new ProjectRepository(db);
  const taskRepo = new TaskRepository(db);
  return {
    db,
    tenantId,
    projects: new ProjectService(projectRepo),
    tasks: new TaskService(taskRepo, projectRepo),
  };
}

/** Advertise the built-in platform tools (static metadata; no DB hit). */
export function listBuiltinTools(): McpToolEntry[] {
  return CATALOG.map((t) => ({
    extensionId: BUILTIN_EXTENSION_ID,
    tool: t.tool,
    name: advertisedName(t.tool),
    description: t.description,
    parameters: t.parameters,
  }));
}

/** Run one built-in tool in-process, tenant-scoped. Throws on unknown tool. */
export async function callBuiltinTool(
  db: Db,
  args: { tenantId: number; tool: string; arguments: unknown },
): Promise<unknown> {
  const entry = CATALOG.find((t) => t.tool === args.tool);
  if (!entry) throw new Error(`Unknown built-in tool '${args.tool}'`);
  const ctx = buildCtx(db, args.tenantId);
  return entry.run(ctx, (args.arguments ?? {}) as Json);
}
