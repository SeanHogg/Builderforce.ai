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
 * Catalog scope: projects + tasks (CRUD), specs/workflows/prompts/approvals/
 * agents/boards/cron (read or simple CRUD), and the full strategy tier —
 * portfolios, initiatives, OKR objectives + key results + lineage links (CRUD,
 * segment-scoped). The dispatch + advertise wiring is the reusable part; adding a
 * domain is one `CATALOG` entry. Remaining web-Brain domains still to port (so
 * the web Brain can drop its client-side manifest) are tracked in the ROADMAP
 * Consolidated Gap Register.
 */

import { and, eq, desc } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { ProjectService } from '../project/ProjectService';
import { TaskService } from '../task/TaskService';
import { ProjectRepository } from '../../infrastructure/repositories/ProjectRepository';
import { TaskRepository } from '../../infrastructure/repositories/TaskRepository';
import { ProjectStatus, TaskPriority } from '../../domain/shared/types';
import { workflows, specs, promptLibraryEntries, approvalRules, agents, boards, cronJobs, portfolios, initiatives, objectives, objectiveLinks, keyResults } from '../../infrastructure/database/schema';
import { resolveSegment } from '../../infrastructure/auth/segmentResolver';
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
/** Coerce an ISO date string arg to a Date for a timestamp column (undefined when absent/invalid). */
const dt = (v: unknown): Date | undefined => {
  if (v == null || str(v) === '') return undefined;
  const d = new Date(str(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
};

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
    run: async (ctx, a) => {
      const name = str(a.name).trim();
      if (!name) throw new Error('name is required');
      const p = await ctx.projects.createProject({
        tenantId: ctx.tenantId,
        key: await ctx.projects.buildUniqueKey(ctx.tenantId, name),
        name,
        description: a.description != null ? str(a.description) : null,
        template: a.template != null ? str(a.template) : null,
        modality: a.modality != null ? str(a.modality) : null,
      });
      return p.toPlain();
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

  // ---- Workflows (read) — tenant-scoped direct queries [1296] ----
  { tool: 'workflows.list', mutates: false, description: 'List workflows in the workspace.', parameters: obj({}), run: (ctx) => ctx.db.select().from(workflows).where(eq(workflows.tenantId, ctx.tenantId)).orderBy(desc(workflows.updatedAt)).limit(200) },
  { tool: 'workflows.get', mutates: false, description: 'Get one workflow by id.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => (await ctx.db.select().from(workflows).where(and(eq(workflows.id, str(a.id)), eq(workflows.tenantId, ctx.tenantId))).limit(1))[0] ?? null },

  // ---- Specs / PRDs (read) ----
  { tool: 'specs.list', mutates: false, description: 'List specs / PRDs, optionally filtered by project.', parameters: obj({ projectId: N }), run: (ctx, a) => ctx.db.select().from(specs).where(a.projectId != null ? and(eq(specs.tenantId, ctx.tenantId), eq(specs.projectId, num(a.projectId))) : eq(specs.tenantId, ctx.tenantId)).orderBy(desc(specs.updatedAt)).limit(200) },
  { tool: 'specs.get', mutates: false, description: 'Get one spec / PRD by id.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => (await ctx.db.select().from(specs).where(and(eq(specs.id, str(a.id)), eq(specs.tenantId, ctx.tenantId))).limit(1))[0] ?? null },
  {
    tool: 'specs.create', mutates: true,
    description: 'Create a spec / PRD. goal is required; optionally attach to a project and include the PRD body.',
    parameters: obj({ goal: S, projectId: N, prd: S }, ['goal']),
    run: async (ctx, a) => {
      const goal = str(a.goal).trim();
      if (!goal) throw new Error('goal is required');
      if (a.projectId != null) await ctx.projects.getProject(num(a.projectId), ctx.tenantId); // tenant-ownership guard (no cross-tenant attach)
      const [row] = await ctx.db.insert(specs).values({
        id: crypto.randomUUID(),
        tenantId: ctx.tenantId,
        goal,
        projectId: a.projectId != null ? num(a.projectId) : null,
        prd: a.prd != null ? str(a.prd) : null,
      }).returning();
      return row;
    },
  },
  { tool: 'specs.delete', mutates: true, description: 'Delete a spec / PRD by id.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const rows = await ctx.db.delete(specs).where(and(eq(specs.id, str(a.id)), eq(specs.tenantId, ctx.tenantId))).returning({ id: specs.id }); return { deleted: rows.length > 0 ? str(a.id) : null }; } },

  // ---- Strategy: Portfolios ▸ Initiatives ▸ OKRs (objectives + key results) ----
  // OKRs live in their OWN tables (segment-scoped), NOT on the task board. A board
  // Epic is a delivery container; an Objective is a strategic goal whose progress
  // rolls up from its Key Results. Capture OKRs with objectives.create +
  // key_results.create, then link the delivering epics/initiatives via
  // objectives.add_link. This is the single server-side source both the web Brain
  // and the VS Code chat consume.
  { tool: 'portfolios.list', mutates: false, description: 'List portfolios (top of the strategy hierarchy).', parameters: obj({}), run: async (ctx) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(portfolios).where(and(eq(portfolios.tenantId, ctx.tenantId), eq(portfolios.segmentId, seg))).orderBy(desc(portfolios.updatedAt)).limit(200); } },
  {
    tool: 'portfolios.create', mutates: true,
    description: 'Create a portfolio (a strategic grouping that initiatives and OKRs attach to).',
    parameters: obj({ name: S, description: S, status: S, targetDate: S }, ['name']),
    run: async (ctx, a) => {
      const name = str(a.name).trim(); if (!name) throw new Error('name is required');
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [row] = await ctx.db.insert(portfolios).values({ tenantId: ctx.tenantId, segmentId: seg, name, description: a.description != null ? str(a.description) : null, ...(a.status != null ? { status: str(a.status) } : {}), targetDate: dt(a.targetDate) }).returning();
      return row;
    },
  },
  {
    tool: 'portfolios.update', mutates: true,
    description: "Update a portfolio (name/description/status/targetDate).",
    parameters: obj({ id: S, name: S, description: S, status: S, targetDate: S }, ['id']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { updatedAt: new Date() };
      if (a.name != null) patch.name = str(a.name);
      if (a.description != null) patch.description = str(a.description);
      if (a.status != null) patch.status = str(a.status);
      if (a.targetDate != null) patch.targetDate = dt(a.targetDate);
      const [row] = await ctx.db.update(portfolios).set(patch).where(and(eq(portfolios.id, str(a.id)), eq(portfolios.tenantId, ctx.tenantId), eq(portfolios.segmentId, seg))).returning();
      if (!row) throw new Error('portfolio not found');
      return row;
    },
  },
  { tool: 'portfolios.delete', mutates: true, description: 'Delete a portfolio.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const rows = await ctx.db.delete(portfolios).where(and(eq(portfolios.id, str(a.id)), eq(portfolios.tenantId, ctx.tenantId), eq(portfolios.segmentId, seg))).returning({ id: portfolios.id }); return { deleted: rows.length > 0 ? str(a.id) : null }; } },

  { tool: 'initiatives.list', mutates: false, description: 'List initiatives (programs of work under a portfolio).', parameters: obj({}), run: async (ctx) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(initiatives).where(and(eq(initiatives.tenantId, ctx.tenantId), eq(initiatives.segmentId, seg))).orderBy(desc(initiatives.updatedAt)).limit(200); } },
  {
    tool: 'initiatives.create', mutates: true,
    description: 'Create an initiative under a portfolio (pass portfolioId).',
    parameters: obj({ name: S, description: S, status: S, portfolioId: S, startDate: S, targetDate: S }, ['name']),
    run: async (ctx, a) => {
      const name = str(a.name).trim(); if (!name) throw new Error('name is required');
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [row] = await ctx.db.insert(initiatives).values({ tenantId: ctx.tenantId, segmentId: seg, name, description: a.description != null ? str(a.description) : null, ...(a.status != null ? { status: str(a.status) } : {}), portfolioId: a.portfolioId != null ? str(a.portfolioId) : null, startDate: dt(a.startDate), targetDate: dt(a.targetDate) }).returning();
      return row;
    },
  },
  {
    tool: 'initiatives.update', mutates: true,
    description: 'Update an initiative (name/description/status/portfolioId/dates).',
    parameters: obj({ id: S, name: S, description: S, status: S, portfolioId: S, startDate: S, targetDate: S }, ['id']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { updatedAt: new Date() };
      if (a.name != null) patch.name = str(a.name);
      if (a.description != null) patch.description = str(a.description);
      if (a.status != null) patch.status = str(a.status);
      if (a.portfolioId != null) patch.portfolioId = str(a.portfolioId);
      if (a.startDate != null) patch.startDate = dt(a.startDate);
      if (a.targetDate != null) patch.targetDate = dt(a.targetDate);
      const [row] = await ctx.db.update(initiatives).set(patch).where(and(eq(initiatives.id, str(a.id)), eq(initiatives.tenantId, ctx.tenantId), eq(initiatives.segmentId, seg))).returning();
      if (!row) throw new Error('initiative not found');
      return row;
    },
  },
  { tool: 'initiatives.delete', mutates: true, description: 'Delete an initiative.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const rows = await ctx.db.delete(initiatives).where(and(eq(initiatives.id, str(a.id)), eq(initiatives.tenantId, ctx.tenantId), eq(initiatives.segmentId, seg))).returning({ id: initiatives.id }); return { deleted: rows.length > 0 ? str(a.id) : null }; } },

  { tool: 'objectives.list', mutates: false, description: 'List OKR objectives — the strategic goals on the Portfolio ▸ OKRs tab, NOT board Epics.', parameters: obj({}), run: async (ctx) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(objectives).where(and(eq(objectives.tenantId, ctx.tenantId), eq(objectives.segmentId, seg))).orderBy(desc(objectives.updatedAt)).limit(200); } },
  {
    tool: 'objectives.create', mutates: true,
    description: 'Create an OKR Objective — a strategic, qualitative goal (e.g. "Unlock recurring revenue"). This populates the Portfolio ▸ OKRs tab. Do NOT model OKRs as board Epics. Attach with portfolioId or initiativeId (omit both for a workspace/org-level objective). Then add measurable targets with key_results.create and link the delivering epics/initiatives with objectives.add_link. status: active|achieved|missed|archived; period is an optional label like "2026-Q2".',
    parameters: obj({ title: S, description: S, period: S, status: { type: 'string', enum: ['active', 'achieved', 'missed', 'archived'] }, portfolioId: S, initiativeId: S, startDate: S, endDate: S }, ['title']),
    run: async (ctx, a) => {
      const title = str(a.title).trim(); if (!title) throw new Error('title is required');
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [row] = await ctx.db.insert(objectives).values({
        tenantId: ctx.tenantId, segmentId: seg, title,
        description: a.description != null ? str(a.description) : null,
        period: a.period != null ? str(a.period) : null,
        ...(a.status != null ? { status: str(a.status) } : {}),
        portfolioId: a.portfolioId != null ? str(a.portfolioId) : null,
        initiativeId: a.initiativeId != null ? str(a.initiativeId) : null,
        startDate: dt(a.startDate), endDate: dt(a.endDate),
      }).returning();
      return row;
    },
  },
  {
    tool: 'objectives.update', mutates: true,
    description: 'Update an OKR objective (title/description/status/period/scope/dates).',
    parameters: obj({ id: S, title: S, description: S, period: S, status: { type: 'string', enum: ['active', 'achieved', 'missed', 'archived'] }, portfolioId: S, initiativeId: S, startDate: S, endDate: S }, ['id']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { updatedAt: new Date() };
      if (a.title != null) patch.title = str(a.title);
      if (a.description != null) patch.description = str(a.description);
      if (a.period != null) patch.period = str(a.period);
      if (a.status != null) patch.status = str(a.status);
      if (a.portfolioId != null) patch.portfolioId = str(a.portfolioId);
      if (a.initiativeId != null) patch.initiativeId = str(a.initiativeId);
      if (a.startDate != null) patch.startDate = dt(a.startDate);
      if (a.endDate != null) patch.endDate = dt(a.endDate);
      const [row] = await ctx.db.update(objectives).set(patch).where(and(eq(objectives.id, str(a.id)), eq(objectives.tenantId, ctx.tenantId), eq(objectives.segmentId, seg))).returning();
      if (!row) throw new Error('objective not found');
      return row;
    },
  },
  { tool: 'objectives.delete', mutates: true, description: 'Delete an OKR objective (and its key results).', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const rows = await ctx.db.delete(objectives).where(and(eq(objectives.id, str(a.id)), eq(objectives.tenantId, ctx.tenantId), eq(objectives.segmentId, seg))).returning({ id: objectives.id }); return { deleted: rows.length > 0 ? str(a.id) : null }; } },
  {
    tool: 'objectives.add_link', mutates: true,
    description: 'Link a delivery work-item to an OKR objective — the lineage edge. linkKind="initiative" needs initiativeId; "epic"/"task" needs the numeric taskId (an Epic IS a task with taskType="epic"). Connects board work to the objective it advances.',
    parameters: obj({ objectiveId: S, linkKind: { type: 'string', enum: ['initiative', 'epic', 'task'] }, initiativeId: S, taskId: N }, ['objectiveId', 'linkKind']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [own] = await ctx.db.select({ id: objectives.id }).from(objectives).where(and(eq(objectives.id, str(a.objectiveId)), eq(objectives.tenantId, ctx.tenantId), eq(objectives.segmentId, seg))).limit(1);
      if (!own) throw new Error('objective not found');
      const linkKind = str(a.linkKind);
      const [row] = await ctx.db.insert(objectiveLinks).values({
        tenantId: ctx.tenantId, segmentId: seg, objectiveId: str(a.objectiveId), linkKind,
        initiativeId: linkKind === 'initiative' && a.initiativeId != null ? str(a.initiativeId) : null,
        taskId: (linkKind === 'epic' || linkKind === 'task') && a.taskId != null ? num(a.taskId) : null,
      }).returning();
      return row;
    },
  },
  { tool: 'objectives.remove_link', mutates: true, description: 'Remove an objective ▸ work-item link by linkId.', parameters: obj({ objectiveId: S, linkId: S }, ['objectiveId', 'linkId']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const rows = await ctx.db.delete(objectiveLinks).where(and(eq(objectiveLinks.id, str(a.linkId)), eq(objectiveLinks.objectiveId, str(a.objectiveId)), eq(objectiveLinks.tenantId, ctx.tenantId), eq(objectiveLinks.segmentId, seg))).returning({ id: objectiveLinks.id }); return { deleted: rows.length > 0 ? str(a.linkId) : null }; } },

  { tool: 'key_results.list', mutates: false, description: 'List key results (the measurable targets under OKR objectives).', parameters: obj({}), run: async (ctx) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(keyResults).where(and(eq(keyResults.tenantId, ctx.tenantId), eq(keyResults.segmentId, seg))).orderBy(desc(keyResults.updatedAt)).limit(500); } },
  {
    tool: 'key_results.create', mutates: true,
    description: 'Create a measurable Key Result under an Objective (objectiveId). A KR moves startValue→targetValue; progress rolls up into the objective and the OKR dashboard. metricType: number|percent|currency|boolean; status: on_track|at_risk|off_track|done. Give each objective 2–5.',
    parameters: obj({ objectiveId: S, title: S, metricType: { type: 'string', enum: ['number', 'percent', 'currency', 'boolean'] }, startValue: N, targetValue: N, currentValue: N, unit: S, status: { type: 'string', enum: ['on_track', 'at_risk', 'off_track', 'done'] } }, ['objectiveId', 'title']),
    run: async (ctx, a) => {
      const title = str(a.title).trim(); if (!title) throw new Error('title is required');
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [own] = await ctx.db.select({ id: objectives.id }).from(objectives).where(and(eq(objectives.id, str(a.objectiveId)), eq(objectives.tenantId, ctx.tenantId), eq(objectives.segmentId, seg))).limit(1);
      if (!own) throw new Error('objective not found');
      const [row] = await ctx.db.insert(keyResults).values({
        tenantId: ctx.tenantId, segmentId: seg, objectiveId: str(a.objectiveId), title,
        ...(a.metricType != null ? { metricType: str(a.metricType) } : {}),
        ...(a.startValue != null ? { startValue: num(a.startValue) } : {}),
        ...(a.targetValue != null ? { targetValue: num(a.targetValue) } : {}),
        ...(a.currentValue != null ? { currentValue: num(a.currentValue) } : {}),
        unit: a.unit != null ? str(a.unit) : null,
        ...(a.status != null ? { status: str(a.status) } : {}),
      }).returning();
      return row;
    },
  },
  {
    tool: 'key_results.update', mutates: true,
    description: 'Update a key result — most often currentValue to record progress (also title/metricType/start/target/unit/status).',
    parameters: obj({ id: S, title: S, metricType: { type: 'string', enum: ['number', 'percent', 'currency', 'boolean'] }, startValue: N, targetValue: N, currentValue: N, unit: S, status: { type: 'string', enum: ['on_track', 'at_risk', 'off_track', 'done'] } }, ['id']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { updatedAt: new Date() };
      if (a.title != null) patch.title = str(a.title);
      if (a.metricType != null) patch.metricType = str(a.metricType);
      if (a.startValue != null) patch.startValue = num(a.startValue);
      if (a.targetValue != null) patch.targetValue = num(a.targetValue);
      if (a.currentValue != null) patch.currentValue = num(a.currentValue);
      if (a.unit != null) patch.unit = str(a.unit);
      if (a.status != null) patch.status = str(a.status);
      const [row] = await ctx.db.update(keyResults).set(patch).where(and(eq(keyResults.id, str(a.id)), eq(keyResults.tenantId, ctx.tenantId), eq(keyResults.segmentId, seg))).returning();
      if (!row) throw new Error('key result not found');
      return row;
    },
  },
  { tool: 'key_results.delete', mutates: true, description: 'Delete a key result.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const rows = await ctx.db.delete(keyResults).where(and(eq(keyResults.id, str(a.id)), eq(keyResults.tenantId, ctx.tenantId), eq(keyResults.segmentId, seg))).returning({ id: keyResults.id }); return { deleted: rows.length > 0 ? str(a.id) : null }; } },

  // ---- Prompt library (read) ----
  { tool: 'prompts.list', mutates: false, description: 'List prompt-library entries in the workspace.', parameters: obj({}), run: (ctx) => ctx.db.select().from(promptLibraryEntries).where(eq(promptLibraryEntries.tenantId, ctx.tenantId)).orderBy(desc(promptLibraryEntries.updatedAt)).limit(200) },

  // ---- Approval rules (CRUD — simple single-table domain, segment_id auto-filled by the 0056 trigger) ----
  { tool: 'approvals.list', mutates: false, description: 'List the workspace approval rules.', parameters: obj({}), run: (ctx) => ctx.db.select().from(approvalRules).where(eq(approvalRules.tenantId, ctx.tenantId)).limit(200) },
  {
    tool: 'approvals.create', mutates: true,
    description: 'Create an approval rule. Auto-approve when estimated cost / files-changed are at or below the given caps; null = ignore that cap.',
    parameters: obj({ name: S, actionType: S, maxEstimatedCost: N, maxFilesChanged: N, isEnabled: B }, ['name']),
    run: async (ctx, a) => {
      const name = str(a.name).trim();
      if (!name) throw new Error('name is required');
      const [row] = await ctx.db.insert(approvalRules).values({
        tenantId: ctx.tenantId,
        name,
        actionType: a.actionType != null ? str(a.actionType) : null,
        maxEstimatedCost: a.maxEstimatedCost != null ? num(a.maxEstimatedCost) : null,
        maxFilesChanged: a.maxFilesChanged != null ? num(a.maxFilesChanged) : null,
        ...(typeof a.isEnabled === 'boolean' ? { isEnabled: a.isEnabled } : {}),
      }).returning();
      return row;
    },
  },
  { tool: 'approvals.delete', mutates: true, description: 'Delete an approval rule by id.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const rows = await ctx.db.delete(approvalRules).where(and(eq(approvalRules.id, str(a.id)), eq(approvalRules.tenantId, ctx.tenantId))).returning({ id: approvalRules.id }); return { deleted: rows.length > 0 ? str(a.id) : null }; } },

  // ---- Registered agents (read) ----
  { tool: 'agents.list', mutates: false, description: 'List registered agents in the workspace.', parameters: obj({}), run: (ctx) => ctx.db.select().from(agents).where(eq(agents.tenantId, ctx.tenantId)).limit(200) },

  // ---- Boards (read) ----
  { tool: 'boards.list', mutates: false, description: 'List project boards in the workspace.', parameters: obj({}), run: (ctx) => ctx.db.select().from(boards).where(eq(boards.tenantId, ctx.tenantId)).limit(200) },

  // ---- Cron jobs (read) ----
  { tool: 'cron.list', mutates: false, description: 'List scheduled cron jobs in the workspace.', parameters: obj({}), run: (ctx) => ctx.db.select().from(cronJobs).where(eq(cronJobs.tenantId, ctx.tenantId)).limit(200) },
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
    mutates: t.mutates,
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
