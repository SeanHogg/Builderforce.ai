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

import { and, eq, desc, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { ProjectService } from '../project/ProjectService';
import { TaskService } from '../task/TaskService';
import { ProjectRepository } from '../../infrastructure/repositories/ProjectRepository';
import { TaskRepository } from '../../infrastructure/repositories/TaskRepository';
import { ProjectStatus, TaskPriority, TaskType } from '../../domain/shared/types';
import { workflows, workflowDefinitions, specs, promptLibraryEntries, promptLibraryVersions, approvalRules, approvals, brainChats, agents, projectAgents, agentAssignments, savedDashboards, dashboardWidgets, alerts, alertEvents, auditEvents, boards, cronJobs, portfolios, initiatives, objectives, objectiveLinks, keyResults, ideAgents, marketplaceSkills, artifactAssignments, socControls, socEvidence, pokerSessions, pokerStories, pokerVotes, retrospectives, retroItems, boardConnections, projectRepositories, pullRequests, chatSessions, chatMessages, swimlanes, swimlaneAgentAssignments, tenants, executions, usageSnapshots, toolAuditEvents, executionMessages, agentHosts, agentHostProjects } from '../../infrastructure/database/schema';
import { resolveSegment } from '../../infrastructure/auth/segmentResolver';
import type { McpToolEntry } from './mcpExtensionService';
import type { Env } from '../../env';
import { integrationCredentials } from '../../infrastructure/database/schema';
import { fetchWebDocument } from '../web/webFetch';
import { encryptCredentials } from '../integrations/credentialCrypto';
import { MigrationService, type ImportMode } from '../migration/MigrationService';
import { createMigrationStore } from '../migration/migrationStore';
import { buildMigrationProviderFactory } from '../migration/buildProviderFactory';
import { BOARD_PROVIDERS, DISCOVERY_PROVIDER_IDS } from '../boardsync/providerCatalog';

/** Sentinel extensionId the gateway routes to this in-process catalog. */
export const BUILTIN_EXTENSION_ID = 'builtin';

type Json = Record<string, unknown>;

interface BuiltinCtx {
  db: Db;
  tenantId: number;
  projects: ProjectService;
  tasks: TaskService;
  /** Worker env — present when the caller threads it (needed by tools that
   *  decrypt integration credentials / reach external providers, e.g. migration). */
  env?: Env;
  /** Authed user id (createdBy on migration runs), when known. */
  userId?: string | null;
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
/** Parse the `tenants.settings` JSON-as-text blob into a mutable object (embed lives at .embed). */
const parseTenantSettings = (raw: string | null | undefined): Json => {
  if (!raw) return {};
  try { const v = JSON.parse(raw); return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {}; } catch { return {}; }
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
    description: 'Create a task on a project board. Set taskType="epic" to create a planning Epic (a DELIVERY container for other tasks), or pass parentTaskId to nest the new task under an existing Epic. An Epic is NOT an OKR/Objective — for OKRs/goals use objectives.create + key_results.create. Assign by passing exactly one of assignedUserId (human member), assignedAgentRef (cloud agent) or assignedAgentHostId (self-hosted runner).',
    parameters: obj({ projectId: N, title: S, description: S, priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] }, dueDate: S, taskType: { type: 'string', enum: ['task', 'epic'] }, parentTaskId: N, assignedUserId: S, assignedAgentRef: S, assignedAgentHostId: N }, ['projectId', 'title']),
    run: (ctx, a) => ctx.tasks.createTask({
      projectId: num(a.projectId),
      title: str(a.title),
      description: a.description != null ? str(a.description) : null,
      priority: a.priority != null ? (str(a.priority) as TaskPriority) : undefined,
      dueDate: a.dueDate != null ? str(a.dueDate) : null,
      taskType: a.taskType != null ? (str(a.taskType) as TaskType) : undefined,
      parentTaskId: a.parentTaskId != null ? num(a.parentTaskId) : undefined,
      assignedUserId: a.assignedUserId != null ? str(a.assignedUserId) : undefined,
      assignedAgentRef: a.assignedAgentRef != null ? str(a.assignedAgentRef) : undefined,
      assignedAgentHostId: a.assignedAgentHostId != null ? num(a.assignedAgentHostId) : undefined,
    }, ctx.tenantId).then((t) => t.toPlain()),
  },
  {
    tool: 'tasks.update', mutates: true,
    description: 'Update a task (title, description, status/lane, priority, dueDate, archived). Reclassify with taskType, re-parent under an Epic with parentTaskId (null to detach), or (re)assign via exactly one of assignedUserId/assignedAgentRef/assignedAgentHostId (null unassigns).',
    parameters: obj({ id: N, title: S, description: S, status: S, priority: S, dueDate: S, archived: B, taskType: { type: 'string', enum: ['task', 'epic'] }, parentTaskId: { type: ['number', 'null'] }, assignedUserId: { type: ['string', 'null'] }, assignedAgentRef: { type: ['string', 'null'] }, assignedAgentHostId: { type: ['number', 'null'] } }, ['id']),
    run: async (ctx, a) => {
      await getTenantTask(ctx, num(a.id)); // tenant-scope guard (service.updateTask doesn't check)
      const updated = await ctx.tasks.updateTask(num(a.id), {
        title: a.title != null ? str(a.title) : undefined,
        description: a.description != null ? str(a.description) : undefined,
        status: a.status != null ? str(a.status) : undefined,
        priority: a.priority != null ? (str(a.priority) as TaskPriority) : undefined,
        dueDate: a.dueDate != null ? str(a.dueDate) : undefined,
        archived: typeof a.archived === 'boolean' ? a.archived : undefined,
        taskType: a.taskType != null ? (str(a.taskType) as TaskType) : undefined,
        parentTaskId: a.parentTaskId !== undefined ? (a.parentTaskId === null ? null : num(a.parentTaskId)) : undefined,
        assignedUserId: a.assignedUserId !== undefined ? (a.assignedUserId === null ? null : str(a.assignedUserId)) : undefined,
        assignedAgentRef: a.assignedAgentRef !== undefined ? (a.assignedAgentRef === null ? null : str(a.assignedAgentRef)) : undefined,
        assignedAgentHostId: a.assignedAgentHostId !== undefined ? (a.assignedAgentHostId === null ? null : num(a.assignedAgentHostId)) : undefined,
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

  // ---- Specs / PRDs (write) ----
  // specs is segment-scoped (tenant_id + segment_id). specs.get/list/create/delete already exist above.
  {
    tool: 'specs.patch', mutates: true,
    description: 'Update a spec / PRD (goal/status/prd).',
    parameters: obj({ id: S, goal: S, status: S, prd: S }, ['id']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { updatedAt: new Date() };
      if (a.goal != null) patch.goal = str(a.goal);
      if (a.status != null) patch.status = str(a.status);
      if (a.prd != null) patch.prd = str(a.prd);
      const [row] = await ctx.db.update(specs).set(patch).where(and(eq(specs.id, str(a.id)), eq(specs.tenantId, ctx.tenantId), eq(specs.segmentId, seg))).returning();
      if (!row) throw new Error('spec not found');
      return row;
    },
  },

  // ---- Approval requests (human-in-the-loop) — the `approvals` REQUEST table, distinct from the
  //       `approvalRules` table the approvals.list/create/delete tools above read. Segment-scoped. ----
  { tool: 'approvals.get', mutates: false, description: 'Get a pending/decided approval request by id.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return (await ctx.db.select().from(approvals).where(and(eq(approvals.id, str(a.id)), eq(approvals.tenantId, ctx.tenantId), eq(approvals.segmentId, seg))).limit(1))[0] ?? null; } },
  {
    tool: 'approvals.decide', mutates: true,
    description: 'Approve, reject, or answer an approval request. status: approved|rejected|answered. (Records the decision; does not itself start any downstream run.)',
    parameters: obj({ id: S, status: { type: 'string', enum: ['approved', 'rejected', 'answered'] }, reviewNote: S, responseText: S }, ['id', 'status']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { status: str(a.status), updatedAt: new Date() };
      if (a.reviewNote != null) patch.reviewNote = str(a.reviewNote);
      if (a.responseText != null) patch.responseText = str(a.responseText);
      const [row] = await ctx.db.update(approvals).set(patch).where(and(eq(approvals.id, str(a.id)), eq(approvals.tenantId, ctx.tenantId), eq(approvals.segmentId, seg))).returning();
      if (!row) throw new Error('approval not found');
      return row;
    },
  },

  // ---- Prompt library (write) — promptLibraryEntries is segment-scoped; versions hang off an
  //       entry (FK entryId), so every version op first asserts the parent entry's tenant+segment. ----
  { tool: 'prompts.get', mutates: false, description: 'Get a prompt-library entry by id.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return (await ctx.db.select().from(promptLibraryEntries).where(and(eq(promptLibraryEntries.id, str(a.id)), eq(promptLibraryEntries.tenantId, ctx.tenantId), eq(promptLibraryEntries.segmentId, seg))).limit(1))[0] ?? null; } },
  { tool: 'prompts.browse_public', mutates: false, description: 'Browse the public prompt gallery (published prompts across all workspaces).', parameters: obj({ q: S, category: S, limit: N }), run: (ctx, a) => ctx.db.select().from(promptLibraryEntries).where(eq(promptLibraryEntries.visibility, 'public')).orderBy(desc(promptLibraryEntries.starCount)).limit(a.limit != null ? num(a.limit) : 100) },
  {
    tool: 'prompts.create', mutates: true,
    description: 'Create a prompt template (title + body). visibility: private|tenant|public.',
    parameters: obj({ title: S, body: S, description: S, category: S, visibility: { type: 'string', enum: ['private', 'tenant', 'public'] } }, ['title', 'body']),
    run: async (ctx, a) => {
      const title = str(a.title).trim(); if (!title) throw new Error('title is required');
      const body = str(a.body); if (!body) throw new Error('body is required');
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 200) || 'prompt'}-${crypto.randomUUID().slice(0, 8)}`;
      const [entry] = await ctx.db.insert(promptLibraryEntries).values({
        tenantId: ctx.tenantId, segmentId: seg, slug, title,
        description: a.description != null ? str(a.description) : null,
        category: a.category != null ? str(a.category) : null,
        ...(a.visibility != null ? { visibility: str(a.visibility) } : {}),
      }).returning();
      if (!entry) throw new Error('failed to create prompt');
      await ctx.db.insert(promptLibraryVersions).values({ entryId: entry.id, version: 1, body }).returning();
      return entry;
    },
  },
  {
    tool: 'prompts.update', mutates: true,
    description: "Update a prompt entry's metadata (title/description/category/visibility).",
    parameters: obj({ id: S, title: S, description: S, category: S, visibility: S }, ['id']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { updatedAt: new Date() };
      if (a.title != null) patch.title = str(a.title);
      if (a.description != null) patch.description = str(a.description);
      if (a.category != null) patch.category = str(a.category);
      if (a.visibility != null) patch.visibility = str(a.visibility);
      const [row] = await ctx.db.update(promptLibraryEntries).set(patch).where(and(eq(promptLibraryEntries.id, str(a.id)), eq(promptLibraryEntries.tenantId, ctx.tenantId), eq(promptLibraryEntries.segmentId, seg))).returning();
      if (!row) throw new Error('prompt not found');
      return row;
    },
  },
  {
    tool: 'prompts.add_version', mutates: true,
    description: 'Add a new version (body) to a prompt entry and make it current.',
    parameters: obj({ id: S, body: S, notes: S }, ['id', 'body']),
    run: async (ctx, a) => {
      const body = str(a.body); if (!body) throw new Error('body is required');
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [entry] = await ctx.db.select().from(promptLibraryEntries).where(and(eq(promptLibraryEntries.id, str(a.id)), eq(promptLibraryEntries.tenantId, ctx.tenantId), eq(promptLibraryEntries.segmentId, seg))).limit(1);
      if (!entry) throw new Error('prompt not found');
      const nextVersion = (entry.currentVersion ?? 0) + 1;
      const [row] = await ctx.db.insert(promptLibraryVersions).values({ entryId: entry.id, version: nextVersion, body, notes: a.notes != null ? str(a.notes) : null }).returning();
      await ctx.db.update(promptLibraryEntries).set({ currentVersion: nextVersion, updatedAt: new Date() }).where(and(eq(promptLibraryEntries.id, entry.id), eq(promptLibraryEntries.tenantId, ctx.tenantId), eq(promptLibraryEntries.segmentId, seg)));
      return row;
    },
  },
  { tool: 'prompts.remove', mutates: true, description: 'Delete a prompt entry (and its versions).', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const [entry] = await ctx.db.select({ id: promptLibraryEntries.id }).from(promptLibraryEntries).where(and(eq(promptLibraryEntries.id, str(a.id)), eq(promptLibraryEntries.tenantId, ctx.tenantId), eq(promptLibraryEntries.segmentId, seg))).limit(1); if (!entry) return { deleted: null }; await ctx.db.delete(promptLibraryVersions).where(eq(promptLibraryVersions.entryId, entry.id)); await ctx.db.delete(promptLibraryEntries).where(and(eq(promptLibraryEntries.id, entry.id), eq(promptLibraryEntries.tenantId, ctx.tenantId), eq(promptLibraryEntries.segmentId, seg))); return { deleted: str(a.id) }; } },

  // ---- Brain chats (CRUD) — segment-scoped. summarize SKIPPED (needs an LLM call, not a table op). ----
  { tool: 'brain.list', mutates: false, description: 'List Brain chats, optionally filtered by project.', parameters: obj({ projectId: N, limit: N }), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const where = a.projectId != null ? and(eq(brainChats.tenantId, ctx.tenantId), eq(brainChats.segmentId, seg), eq(brainChats.projectId, num(a.projectId))) : and(eq(brainChats.tenantId, ctx.tenantId), eq(brainChats.segmentId, seg)); return ctx.db.select().from(brainChats).where(where).orderBy(desc(brainChats.updatedAt)).limit(a.limit != null ? num(a.limit) : 100); } },
  { tool: 'brain.get', mutates: false, description: 'Get a Brain chat by id.', parameters: obj({ id: N }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return (await ctx.db.select().from(brainChats).where(and(eq(brainChats.id, num(a.id)), eq(brainChats.tenantId, ctx.tenantId), eq(brainChats.segmentId, seg))).limit(1))[0] ?? null; } },
  {
    tool: 'brain.create', mutates: true,
    description: 'Create a new Brain chat.',
    parameters: obj({ title: S, projectId: N }),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [row] = await ctx.db.insert(brainChats).values({ tenantId: ctx.tenantId, segmentId: seg, userId: 'system', ...(a.title != null ? { title: str(a.title) } : {}), projectId: a.projectId != null ? num(a.projectId) : null }).returning();
      return row;
    },
  },
  {
    tool: 'brain.update', mutates: true,
    description: 'Rename a Brain chat or move it to a project.',
    parameters: obj({ id: N, title: S, projectId: N }, ['id']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { updatedAt: new Date() };
      if (a.title != null) patch.title = str(a.title);
      if (a.projectId !== undefined) patch.projectId = a.projectId === null ? null : num(a.projectId);
      const [row] = await ctx.db.update(brainChats).set(patch).where(and(eq(brainChats.id, num(a.id)), eq(brainChats.tenantId, ctx.tenantId), eq(brainChats.segmentId, seg))).returning();
      if (!row) throw new Error('chat not found');
      return row;
    },
  },
  { tool: 'brain.delete', mutates: true, description: 'Archive a Brain chat.', parameters: obj({ id: N }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const [row] = await ctx.db.update(brainChats).set({ isArchived: true, updatedAt: new Date() }).where(and(eq(brainChats.id, num(a.id)), eq(brainChats.tenantId, ctx.tenantId), eq(brainChats.segmentId, seg))).returning({ id: brainChats.id }); return { archived: row != null }; } },

  // ---- Agents: registered (read) + per-project + assignments ----
  // registered_agents.list mirrors the existing agents.list (the tenant `agents` table) under the
  // web Brain's domain name so the dispatch layer (keyed on domain.method) reaches it.
  { tool: 'registered_agents.list', mutates: false, description: 'List tenant-registered endpoint agents (claude/openai/ollama/http).', parameters: obj({}), run: (ctx) => ctx.db.select().from(agents).where(eq(agents.tenantId, ctx.tenantId)).limit(200) },
  // project_agents is tenant-scoped (NO segment_id).
  { tool: 'project_agents.list', mutates: false, description: 'List agents attached to a project.', parameters: obj({ projectId: N }, ['projectId']), run: (ctx, a) => ctx.db.select().from(projectAgents).where(and(eq(projectAgents.tenantId, ctx.tenantId), eq(projectAgents.projectId, num(a.projectId)))).limit(200) },
  {
    tool: 'project_agents.add', mutates: true,
    description: 'Attach an agent to a project. agentKind: workforce|registered.',
    parameters: obj({ projectId: N, agentKind: { type: 'string', enum: ['workforce', 'registered'] }, agentRef: S, name: S, role: S }, ['projectId', 'agentKind', 'agentRef', 'name']),
    run: async (ctx, a) => {
      await ctx.projects.getProject(num(a.projectId), ctx.tenantId); // tenant-ownership guard
      const [row] = await ctx.db.insert(projectAgents).values({ tenantId: ctx.tenantId, projectId: num(a.projectId), agentKind: str(a.agentKind), agentRef: str(a.agentRef), name: str(a.name), ...(a.role != null ? { role: str(a.role) } : {}) }).returning();
      return row;
    },
  },
  { tool: 'project_agents.remove', mutates: true, description: 'Detach an agent from a project.', parameters: obj({ id: N }, ['id']), run: async (ctx, a) => { const rows = await ctx.db.delete(projectAgents).where(and(eq(projectAgents.id, num(a.id)), eq(projectAgents.tenantId, ctx.tenantId))).returning({ id: projectAgents.id }); return { deleted: rows.length > 0 ? num(a.id) : null }; } },
  // agent_assignments is segment-scoped.
  { tool: 'agent_assignments.list', mutates: false, description: 'List agents assigned to a scope (project/workflow/security/swimlane/brain/global).', parameters: obj({ scope: S, scopeId: S }, ['scope']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const where = a.scopeId != null ? and(eq(agentAssignments.tenantId, ctx.tenantId), eq(agentAssignments.segmentId, seg), eq(agentAssignments.scope, str(a.scope)), eq(agentAssignments.scopeId, str(a.scopeId))) : and(eq(agentAssignments.tenantId, ctx.tenantId), eq(agentAssignments.segmentId, seg), eq(agentAssignments.scope, str(a.scope))); return ctx.db.select().from(agentAssignments).where(where).limit(200); } },
  {
    tool: 'agent_assignments.assign', mutates: true,
    description: 'Assign a registered agent to a scope (project/workflow/security/swimlane/brain/global).',
    parameters: obj({ agentKind: S, agentRef: S, scope: S, scopeId: S, role: S }, ['agentKind', 'agentRef', 'scope']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [row] = await ctx.db.insert(agentAssignments).values({ tenantId: ctx.tenantId, segmentId: seg, agentKind: str(a.agentKind), agentRef: str(a.agentRef), scope: str(a.scope), scopeId: a.scopeId != null ? str(a.scopeId) : null, ...(a.role != null ? { role: str(a.role) } : {}) }).returning();
      return row;
    },
  },
  { tool: 'agent_assignments.remove', mutates: true, description: 'Remove an agent assignment by id.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const rows = await ctx.db.delete(agentAssignments).where(and(eq(agentAssignments.id, str(a.id)), eq(agentAssignments.tenantId, ctx.tenantId), eq(agentAssignments.segmentId, seg))).returning({ id: agentAssignments.id }); return { deleted: rows.length > 0 ? str(a.id) : null }; } },

  // ---- Saved dashboards (segment-scoped) + widgets (tenant-scoped via parent dashboard) ----
  // data/query SKIPPED — they resolve metric values via computation, not a table read.
  { tool: 'dashboards.list', mutates: false, description: "List the workspace's saved dashboards (with their widgets).", parameters: obj({}), run: async (ctx) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const ds = await ctx.db.select().from(savedDashboards).where(and(eq(savedDashboards.tenantId, ctx.tenantId), eq(savedDashboards.segmentId, seg))).orderBy(desc(savedDashboards.updatedAt)).limit(200); const widgets = await ctx.db.select().from(dashboardWidgets).where(eq(dashboardWidgets.tenantId, ctx.tenantId)); return ds.map((d) => ({ ...d, widgets: widgets.filter((w) => w.dashboardId === d.id) })); } },
  {
    tool: 'dashboards.create', mutates: true,
    description: 'Create a saved dashboard.',
    parameters: obj({ name: S, isDefault: B }, ['name']),
    run: async (ctx, a) => {
      const name = str(a.name).trim(); if (!name) throw new Error('name is required');
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [row] = await ctx.db.insert(savedDashboards).values({ tenantId: ctx.tenantId, segmentId: seg, name, ...(typeof a.isDefault === 'boolean' ? { isDefault: a.isDefault } : {}) }).returning();
      return row;
    },
  },
  {
    tool: 'dashboards.update', mutates: true,
    description: 'Rename a dashboard or set it as the default.',
    parameters: obj({ id: N, name: S, isDefault: B }, ['id']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { updatedAt: new Date() };
      if (a.name != null) patch.name = str(a.name);
      if (typeof a.isDefault === 'boolean') patch.isDefault = a.isDefault;
      const [row] = await ctx.db.update(savedDashboards).set(patch).where(and(eq(savedDashboards.id, num(a.id)), eq(savedDashboards.tenantId, ctx.tenantId), eq(savedDashboards.segmentId, seg))).returning();
      if (!row) throw new Error('dashboard not found');
      return row;
    },
  },
  { tool: 'dashboards.delete', mutates: true, description: 'Delete a saved dashboard (and its widgets).', parameters: obj({ id: N }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const [d] = await ctx.db.select({ id: savedDashboards.id }).from(savedDashboards).where(and(eq(savedDashboards.id, num(a.id)), eq(savedDashboards.tenantId, ctx.tenantId), eq(savedDashboards.segmentId, seg))).limit(1); if (!d) return { deleted: null }; await ctx.db.delete(dashboardWidgets).where(and(eq(dashboardWidgets.dashboardId, d.id), eq(dashboardWidgets.tenantId, ctx.tenantId))); await ctx.db.delete(savedDashboards).where(and(eq(savedDashboards.id, d.id), eq(savedDashboards.tenantId, ctx.tenantId), eq(savedDashboards.segmentId, seg))); return { deleted: num(a.id) }; } },
  {
    tool: 'dashboards.add_widget', mutates: true,
    description: 'Add a widget charting a whitelisted metric to a dashboard. viz: stat|bar|line|gauge.',
    parameters: obj({ dashboardId: N, metricKey: S, viz: { type: 'string', enum: ['stat', 'bar', 'line', 'gauge'] }, title: S, position: N }, ['dashboardId', 'metricKey']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [d] = await ctx.db.select({ id: savedDashboards.id }).from(savedDashboards).where(and(eq(savedDashboards.id, num(a.dashboardId)), eq(savedDashboards.tenantId, ctx.tenantId), eq(savedDashboards.segmentId, seg))).limit(1);
      if (!d) throw new Error('dashboard not found');
      const [row] = await ctx.db.insert(dashboardWidgets).values({ tenantId: ctx.tenantId, dashboardId: d.id, metricKey: str(a.metricKey), ...(a.viz != null ? { viz: str(a.viz) } : {}), title: a.title != null ? str(a.title) : null, ...(a.position != null ? { position: num(a.position) } : {}) }).returning();
      return row;
    },
  },
  {
    tool: 'dashboards.update_widget', mutates: true,
    description: 'Update a dashboard widget (metric, viz, title or position).',
    parameters: obj({ dashboardId: N, widgetId: N, metricKey: S, viz: { type: 'string', enum: ['stat', 'bar', 'line', 'gauge'] }, title: S, position: N }, ['dashboardId', 'widgetId']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [d] = await ctx.db.select({ id: savedDashboards.id }).from(savedDashboards).where(and(eq(savedDashboards.id, num(a.dashboardId)), eq(savedDashboards.tenantId, ctx.tenantId), eq(savedDashboards.segmentId, seg))).limit(1);
      if (!d) throw new Error('dashboard not found');
      const patch: Json = {};
      if (a.metricKey != null) patch.metricKey = str(a.metricKey);
      if (a.viz != null) patch.viz = str(a.viz);
      if (a.title != null) patch.title = str(a.title);
      if (a.position != null) patch.position = num(a.position);
      const [row] = await ctx.db.update(dashboardWidgets).set(patch).where(and(eq(dashboardWidgets.id, num(a.widgetId)), eq(dashboardWidgets.dashboardId, d.id), eq(dashboardWidgets.tenantId, ctx.tenantId))).returning();
      if (!row) throw new Error('widget not found');
      return row;
    },
  },
  { tool: 'dashboards.remove_widget', mutates: true, description: 'Remove a widget from a dashboard.', parameters: obj({ dashboardId: N, widgetId: N }, ['dashboardId', 'widgetId']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const [d] = await ctx.db.select({ id: savedDashboards.id }).from(savedDashboards).where(and(eq(savedDashboards.id, num(a.dashboardId)), eq(savedDashboards.tenantId, ctx.tenantId), eq(savedDashboards.segmentId, seg))).limit(1); if (!d) return { deleted: null }; const rows = await ctx.db.delete(dashboardWidgets).where(and(eq(dashboardWidgets.id, num(a.widgetId)), eq(dashboardWidgets.dashboardId, d.id), eq(dashboardWidgets.tenantId, ctx.tenantId))).returning({ id: dashboardWidgets.id }); return { deleted: rows.length > 0 ? num(a.widgetId) : null }; } },

  // ---- Alerts (segment-scoped rules) + alert events (tenant-scoped) ----
  { tool: 'alerts.list', mutates: false, description: 'List threshold alert rules defined on platform metrics.', parameters: obj({}), run: async (ctx) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(alerts).where(and(eq(alerts.tenantId, ctx.tenantId), eq(alerts.segmentId, seg))).orderBy(desc(alerts.createdAt)).limit(200); } },
  {
    tool: 'alerts.create', mutates: true,
    description: 'Create a threshold alert rule. It fires when metric over windowDays satisfies comparator vs threshold. comparator: gt|lt|gte|lte; scopeKind: tenant|project|team.',
    parameters: obj({ name: S, metric: S, comparator: { type: 'string', enum: ['gt', 'lt', 'gte', 'lte'] }, threshold: N, windowDays: N, scopeKind: { type: 'string', enum: ['tenant', 'project', 'team'] }, notifySlack: B, notifyEmail: B }, ['name', 'metric', 'comparator', 'threshold']),
    run: async (ctx, a) => {
      const name = str(a.name).trim(); if (!name) throw new Error('name is required');
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [row] = await ctx.db.insert(alerts).values({
        tenantId: ctx.tenantId, segmentId: seg, name, metric: str(a.metric), comparator: str(a.comparator), threshold: num(a.threshold),
        ...(a.windowDays != null ? { windowDays: num(a.windowDays) } : {}),
        ...(a.scopeKind != null ? { scopeKind: str(a.scopeKind) } : {}),
        ...(typeof a.notifySlack === 'boolean' ? { notifySlack: a.notifySlack } : {}),
        ...(typeof a.notifyEmail === 'boolean' ? { notifyEmail: a.notifyEmail } : {}),
      }).returning();
      return row;
    },
  },
  {
    tool: 'alerts.update', mutates: true,
    description: 'Update an alert rule (toggle enabled, change threshold/comparator/metric/window/scope/notify channels).',
    parameters: obj({ id: S, name: S, metric: S, comparator: { type: 'string', enum: ['gt', 'lt', 'gte', 'lte'] }, threshold: N, windowDays: N, scopeKind: { type: 'string', enum: ['tenant', 'project', 'team'] }, notifySlack: B, notifyEmail: B, enabled: B, cooldownHours: N }, ['id']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { updatedAt: new Date() };
      if (a.name != null) patch.name = str(a.name);
      if (a.metric != null) patch.metric = str(a.metric);
      if (a.comparator != null) patch.comparator = str(a.comparator);
      if (a.threshold != null) patch.threshold = num(a.threshold);
      if (a.windowDays != null) patch.windowDays = num(a.windowDays);
      if (a.scopeKind != null) patch.scopeKind = str(a.scopeKind);
      if (typeof a.notifySlack === 'boolean') patch.notifySlack = a.notifySlack;
      if (typeof a.notifyEmail === 'boolean') patch.notifyEmail = a.notifyEmail;
      if (typeof a.enabled === 'boolean') patch.enabled = a.enabled;
      if (a.cooldownHours != null) patch.cooldownHours = num(a.cooldownHours);
      const [row] = await ctx.db.update(alerts).set(patch).where(and(eq(alerts.id, str(a.id)), eq(alerts.tenantId, ctx.tenantId), eq(alerts.segmentId, seg))).returning();
      if (!row) throw new Error('alert not found');
      return row;
    },
  },
  { tool: 'alerts.delete', mutates: true, description: 'Delete an alert rule.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const rows = await ctx.db.delete(alerts).where(and(eq(alerts.id, str(a.id)), eq(alerts.tenantId, ctx.tenantId), eq(alerts.segmentId, seg))).returning({ id: alerts.id }); return { deleted: rows.length > 0 ? str(a.id) : null }; } },
  { tool: 'alerts.events', mutates: false, description: 'List recent alert firings (events), optionally filtered by status (triggered|acknowledged|resolved).', parameters: obj({ limit: N, status: { type: 'string', enum: ['triggered', 'acknowledged', 'resolved'] } }), run: (ctx, a) => { const where = a.status != null ? and(eq(alertEvents.tenantId, ctx.tenantId), eq(alertEvents.status, str(a.status))) : eq(alertEvents.tenantId, ctx.tenantId); return ctx.db.select().from(alertEvents).where(where).orderBy(desc(alertEvents.createdAt)).limit(a.limit != null ? num(a.limit) : 100); } },
  { tool: 'alerts.acknowledge', mutates: true, description: 'Acknowledge an alert firing (event).', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const [row] = await ctx.db.update(alertEvents).set({ status: 'acknowledged', acknowledgedAt: new Date() }).where(and(eq(alertEvents.id, str(a.id)), eq(alertEvents.tenantId, ctx.tenantId))).returning(); if (!row) throw new Error('alert event not found'); return row; } },

  // ---- Audit (read; auditEvents is tenant-scoped, no segment_id) ----
  { tool: 'audit.list', mutates: false, description: 'List audit events for the workspace, optionally filtered by eventType / resourceType.', parameters: obj({ limit: N, eventType: S, resourceType: S }), run: (ctx, a) => { const conds: SQL[] = [eq(auditEvents.tenantId, ctx.tenantId)]; if (a.eventType != null) conds.push(eq(auditEvents.eventType, str(a.eventType) as never)); if (a.resourceType != null) conds.push(eq(auditEvents.resourceType, str(a.resourceType))); return ctx.db.select().from(auditEvents).where(and(...conds)).orderBy(desc(auditEvents.createdAt)).limit(a.limit != null ? num(a.limit) : 100); } },

  // ---- Workflow DEFINITIONS (design-time graphs) — distinct from the `workflows` (RUNS) table the
  //       workflows.list/get tools above read. New `workflow_definitions` domain to avoid name collision.
  //       Segment-scoped. (run / import_yaml SKIPPED — they dispatch executions / parse YAML, not table ops.) ----
  { tool: 'workflow_definitions.list', mutates: false, description: 'List workflow DEFINITIONS (the visually-authored agentic graphs), distinct from workflow runs.', parameters: obj({}), run: async (ctx) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(workflowDefinitions).where(and(eq(workflowDefinitions.tenantId, ctx.tenantId), eq(workflowDefinitions.segmentId, seg))).orderBy(desc(workflowDefinitions.updatedAt)).limit(200); } },
  { tool: 'workflow_definitions.get', mutates: false, description: 'Get one workflow definition (with its graph) by id.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return (await ctx.db.select().from(workflowDefinitions).where(and(eq(workflowDefinitions.id, str(a.id)), eq(workflowDefinitions.tenantId, ctx.tenantId), eq(workflowDefinitions.segmentId, seg))).limit(1))[0] ?? null; } },
  {
    tool: 'workflow_definitions.create', mutates: true,
    description: 'Create a workflow definition (name + optional description/project).',
    parameters: obj({ name: S, description: S, projectId: N }, ['name']),
    run: async (ctx, a) => {
      const name = str(a.name).trim(); if (!name) throw new Error('name is required');
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      if (a.projectId != null) await ctx.projects.getProject(num(a.projectId), ctx.tenantId); // tenant-ownership guard
      const [row] = await ctx.db.insert(workflowDefinitions).values({ id: crypto.randomUUID(), tenantId: ctx.tenantId, segmentId: seg, name, description: a.description != null ? str(a.description) : null, projectId: a.projectId != null ? num(a.projectId) : null }).returning();
      return row;
    },
  },
  {
    tool: 'workflow_definitions.update', mutates: true,
    description: 'Update a workflow definition (name/description/project).',
    parameters: obj({ id: S, name: S, description: S, projectId: N }, ['id']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { updatedAt: new Date() };
      if (a.name != null) patch.name = str(a.name);
      if (a.description != null) patch.description = str(a.description);
      if (a.projectId != null) patch.projectId = num(a.projectId);
      const [row] = await ctx.db.update(workflowDefinitions).set(patch).where(and(eq(workflowDefinitions.id, str(a.id)), eq(workflowDefinitions.tenantId, ctx.tenantId), eq(workflowDefinitions.segmentId, seg))).returning();
      if (!row) throw new Error('workflow definition not found');
      return row;
    },
  },
  { tool: 'workflow_definitions.remove', mutates: true, description: 'Delete a workflow definition.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const rows = await ctx.db.delete(workflowDefinitions).where(and(eq(workflowDefinitions.id, str(a.id)), eq(workflowDefinitions.tenantId, ctx.tenantId), eq(workflowDefinitions.segmentId, seg))).returning({ id: workflowDefinitions.id }); return { deleted: rows.length > 0 ? str(a.id) : null }; } },

  // ---- Workflow RUNS (executions) — extends the existing workflows.list/get (the `workflows` table). ----
  { tool: 'workflow_runs.list', mutates: false, description: 'List workflow runs (executions), optionally filtered by status / project.', parameters: obj({ status: S, projectId: N }), run: (ctx, a) => { const conds: SQL[] = [eq(workflows.tenantId, ctx.tenantId)]; if (a.status != null) conds.push(eq(workflows.status, str(a.status) as never)); if (a.projectId != null) conds.push(eq(workflows.projectId, num(a.projectId))); return ctx.db.select().from(workflows).where(and(...conds)).orderBy(desc(workflows.createdAt)).limit(200); } },
  { tool: 'workflow_runs.get', mutates: false, description: 'Get a workflow run by id.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => (await ctx.db.select().from(workflows).where(and(eq(workflows.id, str(a.id)), eq(workflows.tenantId, ctx.tenantId))).limit(1))[0] ?? null },

  // ---- Cron jobs (write) — agentHost-owned schedules. The host association + sync live in the
  //       /api/agent-hosts/:id/cron route; here we persist the tenant-scoped cron_jobs row directly
  //       (segment-scoped). agentHostId is required (cron_jobs.agentHostId is NOT NULL). ----
  {
    tool: 'cron.create', mutates: true,
    description: 'Create a cron job (name + cron schedule) on an agent host.',
    parameters: obj({ agentHostId: N, name: S, schedule: S, taskId: N, projectId: N, enabled: B }, ['agentHostId', 'name', 'schedule']),
    run: async (ctx, a) => {
      const name = str(a.name).trim(); if (!name) throw new Error('name is required');
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [row] = await ctx.db.insert(cronJobs).values({
        tenantId: ctx.tenantId, segmentId: seg, agentHostId: num(a.agentHostId), name, schedule: str(a.schedule),
        taskId: a.taskId != null ? num(a.taskId) : null,
        projectId: a.projectId != null ? num(a.projectId) : null,
        ...(typeof a.enabled === 'boolean' ? { enabled: a.enabled } : {}),
      }).returning();
      return row;
    },
  },
  {
    tool: 'cron.update', mutates: true,
    description: 'Update a cron job (name/schedule/enabled).',
    parameters: obj({ jobId: S, name: S, schedule: S, enabled: B }, ['jobId']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { updatedAt: new Date() };
      if (a.name != null) patch.name = str(a.name);
      if (a.schedule != null) patch.schedule = str(a.schedule);
      if (typeof a.enabled === 'boolean') patch.enabled = a.enabled;
      const [row] = await ctx.db.update(cronJobs).set(patch).where(and(eq(cronJobs.id, str(a.jobId)), eq(cronJobs.tenantId, ctx.tenantId), eq(cronJobs.segmentId, seg))).returning();
      if (!row) throw new Error('cron job not found');
      return row;
    },
  },
  { tool: 'cron.delete', mutates: true, description: 'Delete a cron job by id.', parameters: obj({ jobId: S }, ['jobId']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const rows = await ctx.db.delete(cronJobs).where(and(eq(cronJobs.id, str(a.jobId)), eq(cronJobs.tenantId, ctx.tenantId), eq(cronJobs.segmentId, seg))).returning({ id: cronJobs.id }); return { deleted: rows.length > 0 ? str(a.jobId) : null }; } },

  // ---- Cloud agents (CRUD) — `ide_agents` rows with project_id NULL. Tenant-scoped (NO
  //       segment_id; id is a client-generated UUID stored as text). create/update/delete
  //       are tenant-owned writes; list_mine/list_purchased read this tenant's view. ----
  { tool: 'cloud_agents.list_mine', mutates: false, description: "The workspace's own cloud agents (any publish state).", parameters: obj({}), run: (ctx) => ctx.db.select().from(ideAgents).where(eq(ideAgents.tenantId, ctx.tenantId)).orderBy(desc(ideAgents.createdAt)).limit(200) },
  { tool: 'cloud_agents.list_purchased', mutates: false, description: 'Cloud agents this workspace acquired from the marketplace.', parameters: obj({}), run: async (ctx) => (await ctx.db.execute(sql`SELECT a.* FROM ide_agents a JOIN agent_purchases p ON p.agent_id = a.id WHERE p.tenant_id = ${ctx.tenantId} AND p.unhired_at IS NULL AND a.status = 'active' ORDER BY p.created_at DESC LIMIT 200`)).rows },
  {
    tool: 'cloud_agents.create', mutates: true,
    description: 'Create a cloud agent. engine: builderforce-v2 (Claude Agent SDK) or builderforce-v3 (V2 + limbic affective layer); V1 retired.',
    parameters: obj({ name: S, title: S, bio: S, skills: { type: 'array', items: S }, baseModel: S, engine: { type: 'string', enum: ['builderforce-v2', 'builderforce-v3'] }, published: B }, ['name']),
    run: async (ctx, a) => {
      const name = str(a.name).trim(); if (!name) throw new Error('name is required');
      const engine = a.engine != null && ['builderforce-v2', 'builderforce-v3'].includes(str(a.engine)) ? str(a.engine) : 'builderforce-v2';
      const [row] = await ctx.db.insert(ideAgents).values({
        id: crypto.randomUUID(), tenantId: ctx.tenantId, projectId: null, name,
        title: a.title != null ? str(a.title) : name,
        bio: a.bio != null ? str(a.bio) : '',
        skills: JSON.stringify(Array.isArray(a.skills) ? a.skills : []),
        baseModel: a.baseModel != null ? str(a.baseModel) : 'builderforce-default',
        engine, runtimeSurface: 'durable',
        ...(typeof a.published === 'boolean' ? { published: a.published } : {}),
      }).returning();
      return row;
    },
  },
  {
    tool: 'cloud_agents.update', mutates: true,
    description: 'Update a cloud agent (metadata or publish status).',
    parameters: obj({ agentId: S, name: S, title: S, bio: S, published: B, status: S }, ['agentId']),
    run: async (ctx, a) => {
      const patch: Json = { updatedAt: new Date() };
      if (a.name != null) patch.name = str(a.name);
      if (a.title != null) patch.title = str(a.title);
      if (a.bio != null) patch.bio = str(a.bio);
      if (typeof a.published === 'boolean') patch.published = a.published;
      if (a.status != null) patch.status = str(a.status);
      const [row] = await ctx.db.update(ideAgents).set(patch).where(and(eq(ideAgents.id, str(a.agentId)), eq(ideAgents.tenantId, ctx.tenantId))).returning();
      if (!row) throw new Error('agent not found');
      return row;
    },
  },
  { tool: 'cloud_agents.delete', mutates: true, description: 'Delete a cloud agent.', parameters: obj({ agentId: S }, ['agentId']), run: async (ctx, a) => { const rows = await ctx.db.delete(ideAgents).where(and(eq(ideAgents.id, str(a.agentId)), eq(ideAgents.tenantId, ctx.tenantId))).returning({ id: ideAgents.id }); return { deleted: rows.length > 0 ? str(a.agentId) : null }; } },

  // ---- Marketplace: published agents + skills (PUBLIC, world-readable registries) ----
  // agents_published is the cross-tenant marketplace view of ide_agents (published+active).
  // It is intentionally NOT tenant-scoped — it is the same public registry for everyone
  // (mirrors GET /api/workforce/agents). hire SKIPPED (purchase/billing flow).
  { tool: 'agents_published.list', mutates: false, description: 'List published workforce agents (the public marketplace registry).', parameters: obj({}), run: (ctx) => ctx.db.select().from(ideAgents).where(and(eq(ideAgents.published, true), eq(ideAgents.status, 'active'))).orderBy(desc(ideAgents.hireCount)).limit(200) },
  { tool: 'agents_published.get', mutates: false, description: 'Get a published marketplace agent by id.', parameters: obj({ agentId: S }, ['agentId']), run: async (ctx, a) => (await ctx.db.select().from(ideAgents).where(and(eq(ideAgents.id, str(a.agentId)), eq(ideAgents.published, true), eq(ideAgents.status, 'active'))).limit(1))[0] ?? null },
  // skills_marketplace is the public published-skills catalog (no tenant column).
  { tool: 'skills_marketplace.list', mutates: false, description: 'Browse published marketplace skills (public).', parameters: obj({ category: S, q: S, limit: N }), run: (ctx, a) => ctx.db.select().from(marketplaceSkills).where(a.category != null ? and(eq(marketplaceSkills.published, true), eq(marketplaceSkills.category, str(a.category))) : eq(marketplaceSkills.published, true)).orderBy(desc(marketplaceSkills.downloads)).limit(a.limit != null ? num(a.limit) : 100) },

  // ---- Artifact assignments (skill/persona/content → scope). Tenant-scoped (NO segment_id);
  //       composite PK (tenantId, artifactType, artifactSlug, scope, scopeId). ----
  { tool: 'artifact_assignments.list', mutates: false, description: 'List artifacts (skill/persona/content) assigned to a scope.', parameters: obj({ scope: S, scopeId: N, artifactType: { type: 'string', enum: ['skill', 'persona', 'content'] } }, ['scope', 'scopeId']), run: (ctx, a) => { const conds: SQL[] = [eq(artifactAssignments.tenantId, ctx.tenantId), eq(artifactAssignments.scope, str(a.scope) as never), eq(artifactAssignments.scopeId, num(a.scopeId))]; if (a.artifactType != null) conds.push(eq(artifactAssignments.artifactType, str(a.artifactType) as never)); return ctx.db.select().from(artifactAssignments).where(and(...conds)).limit(200); } },
  {
    tool: 'artifact_assignments.assign', mutates: true,
    description: 'Attach a skill/persona/content artifact to a scope.',
    parameters: obj({ artifactType: { type: 'string', enum: ['skill', 'persona', 'content'] }, artifactSlug: S, scope: S, scopeId: N, config: S }, ['artifactType', 'artifactSlug', 'scope', 'scopeId']),
    run: async (ctx, a) => {
      const [row] = await ctx.db.insert(artifactAssignments).values({ tenantId: ctx.tenantId, artifactType: str(a.artifactType) as never, artifactSlug: str(a.artifactSlug), scope: str(a.scope) as never, scopeId: num(a.scopeId), config: a.config != null ? str(a.config) : null }).onConflictDoUpdate({ target: [artifactAssignments.tenantId, artifactAssignments.artifactType, artifactAssignments.artifactSlug, artifactAssignments.scope, artifactAssignments.scopeId], set: { config: a.config != null ? str(a.config) : null } }).returning();
      return row;
    },
  },
  { tool: 'artifact_assignments.unassign', mutates: true, description: 'Detach an artifact from a scope.', parameters: obj({ artifactType: { type: 'string', enum: ['skill', 'persona', 'content'] }, artifactSlug: S, scope: S, scopeId: N }, ['artifactType', 'artifactSlug', 'scope', 'scopeId']), run: async (ctx, a) => { const rows = await ctx.db.delete(artifactAssignments).where(and(eq(artifactAssignments.tenantId, ctx.tenantId), eq(artifactAssignments.artifactType, str(a.artifactType) as never), eq(artifactAssignments.artifactSlug, str(a.artifactSlug)), eq(artifactAssignments.scope, str(a.scope) as never), eq(artifactAssignments.scopeId, num(a.scopeId)))).returning({ slug: artifactAssignments.artifactSlug }); return { deleted: rows.length > 0 ? str(a.artifactSlug) : null }; } },

  // ---- Governance (SOC 2) — soc_controls + soc_evidence. Both segment-scoped. The
  //       finops collision table was renamed to finops_soc_controls (mig 0254); these
  //       are the GOVERNANCE tables. seed SKIPPED (bulk control-set generation). ----
  { tool: 'governance_soc.list_controls', mutates: false, description: 'List SOC 2 controls and their status.', parameters: obj({}), run: async (ctx) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(socControls).where(and(eq(socControls.tenantId, ctx.tenantId), eq(socControls.segmentId, seg))).orderBy(socControls.controlRef).limit(500); } },
  {
    tool: 'governance_soc.patch_control', mutates: true,
    description: 'Update a SOC 2 control (status/owner/notes). status: not_started|in_progress|ready|out_of_scope.',
    parameters: obj({ id: S, status: { type: 'string', enum: ['not_started', 'in_progress', 'ready', 'out_of_scope'] }, ownerId: S, notes: S }, ['id']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { updatedAt: new Date() };
      if (a.status != null) patch.status = str(a.status);
      if (a.ownerId != null) patch.ownerId = str(a.ownerId);
      if (a.notes != null) patch.notes = str(a.notes);
      const [row] = await ctx.db.update(socControls).set(patch).where(and(eq(socControls.id, str(a.id)), eq(socControls.tenantId, ctx.tenantId), eq(socControls.segmentId, seg))).returning();
      if (!row) throw new Error('control not found');
      return row;
    },
  },
  {
    tool: 'governance_soc.add_evidence', mutates: true,
    description: 'Attach evidence to a SOC 2 control (verified via the parent control, tenant+segment-scoped).',
    parameters: obj({ id: S, title: S, evidenceType: S, url: S, note: S }, ['id', 'title', 'evidenceType']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [control] = await ctx.db.select({ id: socControls.id }).from(socControls).where(and(eq(socControls.id, str(a.id)), eq(socControls.tenantId, ctx.tenantId), eq(socControls.segmentId, seg))).limit(1);
      if (!control) throw new Error('control not found');
      const [row] = await ctx.db.insert(socEvidence).values({ tenantId: ctx.tenantId, segmentId: seg, controlId: control.id, title: str(a.title), evidenceType: str(a.evidenceType), url: a.url != null ? str(a.url) : null, note: a.note != null ? str(a.note) : null }).returning();
      return row;
    },
  },

  // ---- Agile: planning poker — sessions + stories + votes. All segment-scoped; stories/votes
  //       are verified via their tenant+segment-scoped parent before any child write. ----
  { tool: 'poker.list_sessions', mutates: false, description: 'List planning-poker sessions.', parameters: obj({}), run: async (ctx) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(pokerSessions).where(and(eq(pokerSessions.tenantId, ctx.tenantId), eq(pokerSessions.segmentId, seg))).orderBy(desc(pokerSessions.updatedAt)).limit(200); } },
  {
    tool: 'poker.create_session', mutates: true,
    description: 'Create a planning-poker session. votingSystem: fibonacci|t_shirt|powers_of_2 (default fibonacci).',
    parameters: obj({ name: S, votingSystem: S }, ['name']),
    run: async (ctx, a) => {
      const name = str(a.name).trim(); if (!name) throw new Error('name is required');
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [row] = await ctx.db.insert(pokerSessions).values({ tenantId: ctx.tenantId, segmentId: seg, name, ...(a.votingSystem != null ? { votingSystem: str(a.votingSystem) } : {}) }).returning();
      return row;
    },
  },
  { tool: 'poker.get_session', mutates: false, description: 'Get a poker session (with its stories).', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const [session] = await ctx.db.select().from(pokerSessions).where(and(eq(pokerSessions.id, str(a.id)), eq(pokerSessions.tenantId, ctx.tenantId), eq(pokerSessions.segmentId, seg))).limit(1); if (!session) return null; const stories = await ctx.db.select().from(pokerStories).where(and(eq(pokerStories.sessionId, session.id), eq(pokerStories.tenantId, ctx.tenantId), eq(pokerStories.segmentId, seg))).orderBy(pokerStories.position); return { ...session, stories }; } },
  {
    tool: 'poker.add_story', mutates: true,
    description: 'Add a story to a poker session.',
    parameters: obj({ sessionId: S, title: S, description: S }, ['sessionId', 'title']),
    run: async (ctx, a) => {
      const title = str(a.title).trim(); if (!title) throw new Error('title is required');
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [session] = await ctx.db.select({ id: pokerSessions.id }).from(pokerSessions).where(and(eq(pokerSessions.id, str(a.sessionId)), eq(pokerSessions.tenantId, ctx.tenantId), eq(pokerSessions.segmentId, seg))).limit(1);
      if (!session) throw new Error('session not found');
      const [row] = await ctx.db.insert(pokerStories).values({ tenantId: ctx.tenantId, segmentId: seg, sessionId: session.id, title, description: a.description != null ? str(a.description) : null }).returning();
      return row;
    },
  },
  {
    tool: 'poker.vote', mutates: true,
    description: 'Cast a vote on a story (system user). One vote per story is kept (upsert by story).',
    parameters: obj({ storyId: S, value: S }, ['storyId', 'value']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [story] = await ctx.db.select({ id: pokerStories.id }).from(pokerStories).where(and(eq(pokerStories.id, str(a.storyId)), eq(pokerStories.tenantId, ctx.tenantId), eq(pokerStories.segmentId, seg))).limit(1);
      if (!story) throw new Error('story not found');
      const [row] = await ctx.db.insert(pokerVotes).values({ tenantId: ctx.tenantId, segmentId: seg, storyId: story.id, userId: 'system', value: str(a.value) }).returning();
      return row;
    },
  },
  {
    tool: 'poker.reveal', mutates: true,
    description: 'Reveal all votes on a story.',
    parameters: obj({ storyId: S }, ['storyId']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [story] = await ctx.db.select({ id: pokerStories.id }).from(pokerStories).where(and(eq(pokerStories.id, str(a.storyId)), eq(pokerStories.tenantId, ctx.tenantId), eq(pokerStories.segmentId, seg))).limit(1);
      if (!story) throw new Error('story not found');
      await ctx.db.update(pokerVotes).set({ isRevealed: true, updatedAt: new Date() }).where(and(eq(pokerVotes.storyId, story.id), eq(pokerVotes.tenantId, ctx.tenantId), eq(pokerVotes.segmentId, seg)));
      return { revealed: str(a.storyId) };
    },
  },

  // ---- Agile: retrospectives — retros + items. Both segment-scoped; items verified via parent. ----
  { tool: 'retro.list', mutates: false, description: 'List retrospectives.', parameters: obj({}), run: async (ctx) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(retrospectives).where(and(eq(retrospectives.tenantId, ctx.tenantId), eq(retrospectives.segmentId, seg))).orderBy(desc(retrospectives.updatedAt)).limit(200); } },
  {
    tool: 'retro.create', mutates: true,
    description: 'Create a retrospective. template: start_stop_continue|mad_sad_glad|4ls (default start_stop_continue).',
    parameters: obj({ name: S, template: S }, ['name']),
    run: async (ctx, a) => {
      const name = str(a.name).trim(); if (!name) throw new Error('name is required');
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [row] = await ctx.db.insert(retrospectives).values({ tenantId: ctx.tenantId, segmentId: seg, name, ...(a.template != null ? { template: str(a.template) } : {}) }).returning();
      return row;
    },
  },
  { tool: 'retro.get', mutates: false, description: 'Get a retrospective (with its items).', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const [retro] = await ctx.db.select().from(retrospectives).where(and(eq(retrospectives.id, str(a.id)), eq(retrospectives.tenantId, ctx.tenantId), eq(retrospectives.segmentId, seg))).limit(1); if (!retro) return null; const items = await ctx.db.select().from(retroItems).where(and(eq(retroItems.retroId, retro.id), eq(retroItems.tenantId, ctx.tenantId), eq(retroItems.segmentId, seg))).orderBy(desc(retroItems.createdAt)); return { ...retro, items }; } },
  {
    tool: 'retro.add_item', mutates: true,
    description: 'Add an item to a retrospective (category matches the template column, e.g. start/stop/continue).',
    parameters: obj({ retroId: S, category: S, content: S }, ['retroId', 'category', 'content']),
    run: async (ctx, a) => {
      const content = str(a.content).trim(); if (!content) throw new Error('content is required');
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [retro] = await ctx.db.select({ id: retrospectives.id }).from(retrospectives).where(and(eq(retrospectives.id, str(a.retroId)), eq(retrospectives.tenantId, ctx.tenantId), eq(retrospectives.segmentId, seg))).limit(1);
      if (!retro) throw new Error('retro not found');
      const [row] = await ctx.db.insert(retroItems).values({ tenantId: ctx.tenantId, segmentId: seg, retroId: retro.id, category: str(a.category), content }).returning();
      return row;
    },
  },

  // ---- External board connections (Jira/GitHub PM sync). Segment-scoped. sync SKIPPED
  //       (triggers an external provider sync, a side-effect; not a table op). ----
  { tool: 'board_connections.list', mutates: false, description: 'List external board connections (Jira/GitHub PM sync), optionally by project.', parameters: obj({ projectId: N }), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const conds: SQL[] = [eq(boardConnections.tenantId, ctx.tenantId), eq(boardConnections.segmentId, seg)]; if (a.projectId != null) conds.push(eq(boardConnections.projectId, num(a.projectId))); return ctx.db.select().from(boardConnections).where(and(...conds)).orderBy(desc(boardConnections.createdAt)).limit(200); } },
  {
    tool: 'board_connections.create', mutates: true,
    description: 'Create an external board connection on a project.',
    parameters: obj({ projectId: N, provider: S, credentialId: S, externalBoardId: S }, ['projectId', 'provider']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      await ctx.projects.getProject(num(a.projectId), ctx.tenantId); // tenant-ownership guard
      const [row] = await ctx.db.insert(boardConnections).values({ tenantId: ctx.tenantId, segmentId: seg, projectId: num(a.projectId), provider: str(a.provider), credentialId: a.credentialId != null ? str(a.credentialId) : null, externalBoardId: a.externalBoardId != null ? str(a.externalBoardId) : null }).returning();
      return row;
    },
  },
  {
    tool: 'board_connections.update', mutates: true,
    description: 'Update an external board connection (status/externalBoardId).',
    parameters: obj({ id: S, status: S, externalBoardId: S }, ['id']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { updatedAt: new Date() };
      if (a.status != null) patch.status = str(a.status);
      if (a.externalBoardId != null) patch.externalBoardId = str(a.externalBoardId);
      const [row] = await ctx.db.update(boardConnections).set(patch).where(and(eq(boardConnections.id, str(a.id)), eq(boardConnections.tenantId, ctx.tenantId), eq(boardConnections.segmentId, seg))).returning();
      if (!row) throw new Error('board connection not found');
      return row;
    },
  },
  { tool: 'board_connections.remove', mutates: true, description: 'Delete an external board connection.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const rows = await ctx.db.delete(boardConnections).where(and(eq(boardConnections.id, str(a.id)), eq(boardConnections.tenantId, ctx.tenantId), eq(boardConnections.segmentId, seg))).returning({ id: boardConnections.id }); return { deleted: rows.length > 0 ? str(a.id) : null }; } },

  // ---- Repos (project_repositories) + pull_requests. Both segment-scoped. These are plain
  //       table rows (the git/provider calls happen on separate routes). ----
  { tool: 'repos.list', mutates: false, description: 'List git repositories linked to a project.', parameters: obj({ projectId: N }, ['projectId']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(projectRepositories).where(and(eq(projectRepositories.tenantId, ctx.tenantId), eq(projectRepositories.segmentId, seg), eq(projectRepositories.projectId, num(a.projectId)))).orderBy(desc(projectRepositories.createdAt)).limit(200); } },
  { tool: 'repos.list_pull_requests', mutates: false, description: 'List pull requests for a project.', parameters: obj({ projectId: N }, ['projectId']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(pullRequests).where(and(eq(pullRequests.tenantId, ctx.tenantId), eq(pullRequests.segmentId, seg), eq(pullRequests.projectId, num(a.projectId)))).orderBy(desc(pullRequests.createdAt)).limit(200); } },
  {
    tool: 'repos.add', mutates: true,
    description: 'Link a git repository to a project (a plain catalog row). provider: github|gitlab|bitbucket. Pass credentialId to bind an access key.',
    parameters: obj({ projectId: N, provider: S, owner: S, repo: S, defaultBranch: S, isDefault: B, credentialId: S }, ['projectId', 'provider', 'owner', 'repo']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      await ctx.projects.getProject(num(a.projectId), ctx.tenantId); // tenant-ownership guard
      const [row] = await ctx.db.insert(projectRepositories).values({ tenantId: ctx.tenantId, segmentId: seg, projectId: num(a.projectId), provider: str(a.provider), owner: str(a.owner), repo: str(a.repo), defaultBranch: a.defaultBranch != null ? str(a.defaultBranch) : null, ...(typeof a.isDefault === 'boolean' ? { isDefault: a.isDefault } : {}), credentialId: a.credentialId != null ? str(a.credentialId) : null }).returning();
      return row;
    },
  },
  {
    tool: 'repos.update', mutates: true,
    description: 'Update a linked repository (defaultBranch/isDefault/credentialId).',
    parameters: obj({ id: S, defaultBranch: S, isDefault: B, credentialId: S }, ['id']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { updatedAt: new Date() };
      if (a.defaultBranch != null) patch.defaultBranch = str(a.defaultBranch);
      if (typeof a.isDefault === 'boolean') patch.isDefault = a.isDefault;
      if (a.credentialId != null) patch.credentialId = str(a.credentialId);
      const [row] = await ctx.db.update(projectRepositories).set(patch).where(and(eq(projectRepositories.id, str(a.id)), eq(projectRepositories.tenantId, ctx.tenantId), eq(projectRepositories.segmentId, seg))).returning();
      if (!row) throw new Error('repository not found');
      return row;
    },
  },
  {
    tool: 'repos.set_default', mutates: true,
    description: 'Mark a repository as the project default (clears the flag on the project’s other repos).',
    parameters: obj({ id: S }, ['id']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [repo] = await ctx.db.select({ id: projectRepositories.id, projectId: projectRepositories.projectId }).from(projectRepositories).where(and(eq(projectRepositories.id, str(a.id)), eq(projectRepositories.tenantId, ctx.tenantId), eq(projectRepositories.segmentId, seg))).limit(1);
      if (!repo) throw new Error('repository not found');
      await ctx.db.update(projectRepositories).set({ isDefault: false, updatedAt: new Date() }).where(and(eq(projectRepositories.tenantId, ctx.tenantId), eq(projectRepositories.segmentId, seg), eq(projectRepositories.projectId, repo.projectId)));
      const [row] = await ctx.db.update(projectRepositories).set({ isDefault: true, updatedAt: new Date() }).where(and(eq(projectRepositories.id, repo.id), eq(projectRepositories.tenantId, ctx.tenantId), eq(projectRepositories.segmentId, seg))).returning();
      return row;
    },
  },
  { tool: 'repos.remove', mutates: true, description: 'Unlink a repository.', parameters: obj({ id: S }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const rows = await ctx.db.delete(projectRepositories).where(and(eq(projectRepositories.id, str(a.id)), eq(projectRepositories.tenantId, ctx.tenantId), eq(projectRepositories.segmentId, seg))).returning({ id: projectRepositories.id }); return { deleted: rows.length > 0 ? str(a.id) : null }; } },

  // ---- Chat sessions (agent-host messaging) — chat_sessions + chat_messages. Segment-scoped.
  //       provider_keys.list / my_sessions / channels / embed are handled below or SKIPPED. ----
  { tool: 'chat_sessions.list', mutates: false, description: 'List chat sessions on an agent host.', parameters: obj({ agentHostId: N }, ['agentHostId']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(chatSessions).where(and(eq(chatSessions.tenantId, ctx.tenantId), eq(chatSessions.segmentId, seg), eq(chatSessions.agentHostId, num(a.agentHostId)))).orderBy(desc(chatSessions.startedAt)).limit(200); } },
  { tool: 'chat_sessions.list_all', mutates: false, description: 'Recent chat sessions across the workspace.', parameters: obj({ limit: N }), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(chatSessions).where(and(eq(chatSessions.tenantId, ctx.tenantId), eq(chatSessions.segmentId, seg))).orderBy(desc(chatSessions.startedAt)).limit(a.limit != null ? num(a.limit) : 100); } },
  { tool: 'chat_sessions.get_messages', mutates: false, description: 'Messages in a chat session (verified via the tenant+segment-scoped parent session).', parameters: obj({ sessionId: N, limit: N }, ['sessionId']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const [session] = await ctx.db.select({ id: chatSessions.id }).from(chatSessions).where(and(eq(chatSessions.id, num(a.sessionId)), eq(chatSessions.tenantId, ctx.tenantId), eq(chatSessions.segmentId, seg))).limit(1); if (!session) return []; return ctx.db.select().from(chatMessages).where(and(eq(chatMessages.sessionId, session.id), eq(chatMessages.tenantId, ctx.tenantId), eq(chatMessages.segmentId, seg))).orderBy(chatMessages.seq).limit(a.limit != null ? num(a.limit) : 100); } },

  // ---- Provider keys (read only — which LLM providers are configured; NEVER returns the
  //       secret key material). Backed by the raw-SQL tenant_llm_provider_keys table. ----
  { tool: 'provider_keys.list', mutates: false, description: 'Which LLM providers the workspace has a key configured for (no secrets returned).', parameters: obj({}), run: async (ctx) => (await ctx.db.execute(sql`SELECT provider, auth_type FROM tenant_llm_provider_keys WHERE tenant_id = ${ctx.tenantId}`)).rows },

  // ---- Embed config — stored on tenants.settings.embed (JSON-as-text). Read + write the
  //       embed slice only, leaving the rest of the settings blob untouched. ----
  { tool: 'embed.get_config', mutates: false, description: 'Get the workspace embed configuration (enabled + capabilities).', parameters: obj({}), run: async (ctx) => { const [row] = await ctx.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, ctx.tenantId)).limit(1); const settings = parseTenantSettings(row?.settings); const embed = (settings.embed ?? {}) as Json; return { enabled: embed.enabled === true, capabilities: Array.isArray(embed.capabilities) ? embed.capabilities : [] }; } },
  {
    tool: 'embed.set_config', mutates: true,
    description: 'Enable/disable embed + set capabilities. capabilities is a subset of product|agile|security.',
    parameters: obj({ enabled: B, capabilities: { type: 'array', items: { type: 'string', enum: ['product', 'agile', 'security'] } }, consentAcknowledged: B }, ['enabled', 'capabilities']),
    run: async (ctx, a) => {
      const [row] = await ctx.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, ctx.tenantId)).limit(1);
      if (!row) throw new Error('tenant not found');
      const settings = parseTenantSettings(row.settings);
      const enabled = a.enabled === true;
      const capabilities = (Array.isArray(a.capabilities) ? a.capabilities : []).map(str).filter((c) => ['product', 'agile', 'security'].includes(c));
      settings.embed = { ...(typeof settings.embed === 'object' && settings.embed != null ? settings.embed : {}), enabled, capabilities, ...(a.consentAcknowledged === true ? { consentedAt: new Date().toISOString() } : {}) };
      await ctx.db.update(tenants).set({ settings: JSON.stringify(settings), updatedAt: new Date() }).where(eq(tenants.id, ctx.tenantId));
      return { enabled, capabilities };
    },
  },

  // ---- Autonomous boards + swimlanes + swimlane agents. All segment-scoped; child writes
  //       are verified through their tenant+segment-scoped parent. boards.dispatches SKIPPED
  //       (computed live per-agent status across ticket_runs/agent_dispatches, not a table read). ----
  { tool: 'boards.get', mutates: false, description: 'Get an autonomous board (with its swimlanes).', parameters: obj({ boardId: S }, ['boardId']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const [board] = await ctx.db.select().from(boards).where(and(eq(boards.id, str(a.boardId)), eq(boards.tenantId, ctx.tenantId), eq(boards.segmentId, seg))).limit(1); if (!board) return null; const lanes = await ctx.db.select().from(swimlanes).where(and(eq(swimlanes.boardId, board.id), eq(swimlanes.tenantId, ctx.tenantId), eq(swimlanes.segmentId, seg))).orderBy(swimlanes.position); return { ...board, swimlanes: lanes }; } },
  {
    tool: 'boards.create', mutates: true,
    description: 'Find-or-create the autonomous board for a project (one board per project — returns the existing board if one already exists).',
    parameters: obj({ projectId: N, name: S, maxConcurrentTickets: N }, ['projectId', 'name']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      await ctx.projects.getProject(num(a.projectId), ctx.tenantId); // tenant-ownership guard
      const [existing] = await ctx.db.select().from(boards).where(and(eq(boards.projectId, num(a.projectId)), eq(boards.tenantId, ctx.tenantId), eq(boards.segmentId, seg))).limit(1);
      if (existing) return existing;
      const [row] = await ctx.db.insert(boards).values({ tenantId: ctx.tenantId, segmentId: seg, projectId: num(a.projectId), name: str(a.name), ...(a.maxConcurrentTickets != null ? { maxConcurrentTickets: num(a.maxConcurrentTickets) } : {}) }).returning();
      return row;
    },
  },
  {
    tool: 'boards.update', mutates: true,
    description: 'Update a board (name/maxConcurrentTickets).',
    parameters: obj({ boardId: S, name: S, maxConcurrentTickets: N }, ['boardId']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const patch: Json = { updatedAt: new Date() };
      if (a.name != null) patch.name = str(a.name);
      if (a.maxConcurrentTickets != null) patch.maxConcurrentTickets = num(a.maxConcurrentTickets);
      const [row] = await ctx.db.update(boards).set(patch).where(and(eq(boards.id, str(a.boardId)), eq(boards.tenantId, ctx.tenantId), eq(boards.segmentId, seg))).returning();
      if (!row) throw new Error('board not found');
      return row;
    },
  },
  { tool: 'boards.remove', mutates: true, description: 'Delete a board.', parameters: obj({ boardId: S }, ['boardId']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const rows = await ctx.db.delete(boards).where(and(eq(boards.id, str(a.boardId)), eq(boards.tenantId, ctx.tenantId), eq(boards.segmentId, seg))).returning({ id: boards.id }); return { deleted: rows.length > 0 ? str(a.boardId) : null }; } },

  { tool: 'swimlanes.list', mutates: false, description: "List a board's swimlanes.", parameters: obj({ boardId: S }, ['boardId']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const [board] = await ctx.db.select({ id: boards.id }).from(boards).where(and(eq(boards.id, str(a.boardId)), eq(boards.tenantId, ctx.tenantId), eq(boards.segmentId, seg))).limit(1); if (!board) return []; return ctx.db.select().from(swimlanes).where(and(eq(swimlanes.boardId, board.id), eq(swimlanes.tenantId, ctx.tenantId), eq(swimlanes.segmentId, seg))).orderBy(swimlanes.position); } },
  {
    tool: 'swimlanes.create', mutates: true,
    description: 'Create a swimlane (stage) on a board.',
    parameters: obj({ boardId: S, key: S, name: S, position: N }, ['boardId', 'key', 'name']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [board] = await ctx.db.select({ id: boards.id }).from(boards).where(and(eq(boards.id, str(a.boardId)), eq(boards.tenantId, ctx.tenantId), eq(boards.segmentId, seg))).limit(1);
      if (!board) throw new Error('board not found');
      const [row] = await ctx.db.insert(swimlanes).values({ tenantId: ctx.tenantId, segmentId: seg, boardId: board.id, key: str(a.key), name: str(a.name), ...(a.position != null ? { position: num(a.position) } : {}) }).returning();
      return row;
    },
  },
  { tool: 'swimlanes.remove', mutates: true, description: 'Delete a swimlane.', parameters: obj({ boardId: S, laneId: S }, ['boardId', 'laneId']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const [board] = await ctx.db.select({ id: boards.id }).from(boards).where(and(eq(boards.id, str(a.boardId)), eq(boards.tenantId, ctx.tenantId), eq(boards.segmentId, seg))).limit(1); if (!board) return { deleted: null }; const rows = await ctx.db.delete(swimlanes).where(and(eq(swimlanes.id, str(a.laneId)), eq(swimlanes.boardId, board.id), eq(swimlanes.tenantId, ctx.tenantId), eq(swimlanes.segmentId, seg))).returning({ id: swimlanes.id }); return { deleted: rows.length > 0 ? str(a.laneId) : null }; } },

  { tool: 'swimlane_agents.list', mutates: false, description: 'Agents assigned to a swimlane.', parameters: obj({ boardId: S, laneId: S }, ['boardId', 'laneId']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const [lane] = await ctx.db.select({ id: swimlanes.id }).from(swimlanes).innerJoin(boards, eq(swimlanes.boardId, boards.id)).where(and(eq(swimlanes.id, str(a.laneId)), eq(boards.id, str(a.boardId)), eq(swimlanes.tenantId, ctx.tenantId), eq(swimlanes.segmentId, seg))).limit(1); if (!lane) return []; return ctx.db.select().from(swimlaneAgentAssignments).where(and(eq(swimlaneAgentAssignments.swimlaneId, lane.id), eq(swimlaneAgentAssignments.tenantId, ctx.tenantId), eq(swimlaneAgentAssignments.segmentId, seg))).orderBy(swimlaneAgentAssignments.position); } },
  {
    tool: 'swimlane_agents.create', mutates: true,
    description: 'Assign an agent to a swimlane. agentKind: workforce|registered.',
    parameters: obj({ boardId: S, laneId: S, agentKind: { type: 'string', enum: ['workforce', 'registered'] }, agentRef: S, role: S, model: S }, ['boardId', 'laneId', 'agentKind', 'agentRef']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const [lane] = await ctx.db.select({ id: swimlanes.id }).from(swimlanes).innerJoin(boards, eq(swimlanes.boardId, boards.id)).where(and(eq(swimlanes.id, str(a.laneId)), eq(boards.id, str(a.boardId)), eq(swimlanes.tenantId, ctx.tenantId), eq(swimlanes.segmentId, seg))).limit(1);
      if (!lane) throw new Error('swimlane not found');
      const [row] = await ctx.db.insert(swimlaneAgentAssignments).values({ tenantId: ctx.tenantId, segmentId: seg, swimlaneId: lane.id, agentKind: str(a.agentKind), agentRef: str(a.agentRef), role: a.role != null ? str(a.role) : 'agent', ...(a.model != null ? { model: str(a.model) } : {}) }).returning();
      return row;
    },
  },
  { tool: 'swimlane_agents.remove', mutates: true, description: 'Unassign an agent from a swimlane.', parameters: obj({ boardId: S, laneId: S, id: S }, ['boardId', 'laneId', 'id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); const [lane] = await ctx.db.select({ id: swimlanes.id }).from(swimlanes).innerJoin(boards, eq(swimlanes.boardId, boards.id)).where(and(eq(swimlanes.id, str(a.laneId)), eq(boards.id, str(a.boardId)), eq(swimlanes.tenantId, ctx.tenantId), eq(swimlanes.segmentId, seg))).limit(1); if (!lane) return { deleted: null }; const rows = await ctx.db.delete(swimlaneAgentAssignments).where(and(eq(swimlaneAgentAssignments.id, str(a.id)), eq(swimlaneAgentAssignments.swimlaneId, lane.id), eq(swimlaneAgentAssignments.tenantId, ctx.tenantId), eq(swimlaneAgentAssignments.segmentId, seg))).returning({ id: swimlaneAgentAssignments.id }); return { deleted: rows.length > 0 ? str(a.id) : null }; } },

  // ---- Integrations + Platform migration (Jira/Monday/Rally/GitLab/Bitbucket/GitHub → BuilderForce) ----
  // The Brain can drive the whole "connect → test → migrate" flow: create a
  // credential, validate it, then discover→map→stage→commit a migration run.
  { tool: 'integrations.providers', mutates: false, description: 'List external systems that can be connected/migrated, with which support the migration wizard (discovery).', parameters: obj({}), run: async () => ({ providers: BOARD_PROVIDERS, migratable: DISCOVERY_PROVIDER_IDS }) },
  { tool: 'integrations.list', mutates: false, description: 'List this workspace\'s integration credentials (no secrets).', parameters: obj({}), run: (ctx) => ctx.db.select({ id: integrationCredentials.id, provider: integrationCredentials.provider, name: integrationCredentials.name, baseUrl: integrationCredentials.baseUrl, lastTestOk: integrationCredentials.lastTestOk, lastTestedAt: integrationCredentials.lastTestedAt }).from(integrationCredentials).where(eq(integrationCredentials.tenantId, ctx.tenantId)).orderBy(desc(integrationCredentials.createdAt)).limit(200) },
  {
    tool: 'integrations.create_credential', mutates: true,
    description: 'Store an encrypted integration credential (e.g. connect Bitbucket with an access token). credentials is a provider-specific bag — e.g. Jira {email,apiToken}+baseUrl; GitHub/Bitbucket/GitLab {accessToken}; monday/ClickUp {token}.',
    parameters: obj({ provider: S, name: S, baseUrl: S, credentials: { type: 'object' } }, ['provider', 'name', 'credentials']),
    run: async (ctx, a) => {
      const env = requireEnv(ctx);
      const secret = env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET;
      const { enc, iv } = await encryptCredentials(a.credentials as Record<string, unknown>, secret, ctx.tenantId);
      const [row] = await ctx.db.insert(integrationCredentials).values({ tenantId: ctx.tenantId, provider: str(a.provider) as never, name: str(a.name).trim(), baseUrl: a.baseUrl != null ? str(a.baseUrl) : null, credentialsEnc: enc, iv, isEnabled: true }).returning({ id: integrationCredentials.id, provider: integrationCredentials.provider, name: integrationCredentials.name });
      return row;
    },
  },
  {
    tool: 'integrations.test', mutates: true,
    description: 'Validate/test a stored integration credential by connecting to the provider. Returns { ok, message, projectCount? }.',
    parameters: obj({ credentialId: S }, ['credentialId']),
    run: async (ctx, a) => {
      const env = requireEnv(ctx);
      const [cred] = await ctx.db.select().from(integrationCredentials).where(and(eq(integrationCredentials.id, str(a.credentialId)), eq(integrationCredentials.tenantId, ctx.tenantId))).limit(1);
      if (!cred) throw new Error('Integration credential not found');
      const factory = await buildMigrationProviderFactory(ctx.db, env, ctx.tenantId, cred.provider, cred.id);
      if (!factory) { await markTested(ctx, cred.id, false); return { ok: false, message: 'Could not load credential' }; }
      try {
        const provider = factory(null);
        let projectCount: number | undefined;
        if (typeof provider.discover === 'function') projectCount = (await provider.discover()).projects.length;
        else await provider.fetchTicketsSince(null);
        await markTested(ctx, cred.id, true);
        return { ok: true, message: 'Connected', ...(projectCount != null ? { projectCount } : {}) };
      } catch (e) {
        await markTested(ctx, cred.id, false);
        return { ok: false, message: e instanceof Error ? e.message : 'Connection failed' };
      }
    },
  },
  {
    tool: 'migrations.start', mutates: true,
    description: 'Start a migration run: discover an external system\'s projects, item types and users into staging (nothing is imported yet). mode: migrate (one-time) | sync (ongoing) | both.',
    parameters: obj({ provider: S, credentialId: S, mode: S }, ['provider', 'credentialId']),
    run: async (ctx, a) => {
      const env = requireEnv(ctx);
      if (!DISCOVERY_PROVIDER_IDS.includes(str(a.provider))) throw new Error(`Migration is available for: ${DISCOVERY_PROVIDER_IDS.join(', ')}`);
      const factory = await buildMigrationProviderFactory(ctx.db, env, ctx.tenantId, str(a.provider), str(a.credentialId));
      if (!factory) throw new Error('Could not load integration credentials');
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const svc = new MigrationService(createMigrationStore(ctx.db));
      const mode = (['migrate', 'sync', 'both'] as ImportMode[]).includes(a.mode as ImportMode) ? (a.mode as ImportMode) : 'both';
      return svc.startRun({ tenantId: ctx.tenantId, segmentId: seg, provider: str(a.provider), credentialId: str(a.credentialId), mode, createdBy: ctx.userId ?? null }, factory(null));
    },
  },
  { tool: 'migrations.list', mutates: false, description: 'List migration runs (history) for the workspace.', parameters: obj({}), run: (ctx) => new MigrationService(createMigrationStore(ctx.db)).listRuns(ctx.tenantId) },
  { tool: 'migrations.get', mutates: false, description: 'Get the full staging snapshot of a migration run (projects, item types, users, staged items).', parameters: obj({ id: S }, ['id']), run: (ctx, a) => new MigrationService(createMigrationStore(ctx.db)).getDetail(str(a.id), ctx.tenantId) },
  {
    tool: 'migrations.set_mappings', mutates: true,
    description: 'Set project (create/map/skip — map several external projects to the same BF project to COMBINE), item-type, user (invite/map/skip) and item-include mappings for a run.',
    parameters: obj({ id: S, projects: { type: 'array' }, types: { type: 'array' }, users: { type: 'array' }, items: { type: 'array' } }, ['id']),
    run: (ctx, a) => new MigrationService(createMigrationStore(ctx.db)).setMappings(str(a.id), ctx.tenantId, { projects: a.projects as never, types: a.types as never, users: a.users as never, items: a.items as never }),
  },
  {
    tool: 'migrations.stage', mutates: true,
    description: 'Pull the items for every non-skipped project into staging so they can be reviewed before import.',
    parameters: obj({ id: S }, ['id']),
    run: async (ctx, a) => {
      const env = requireEnv(ctx);
      const svc = new MigrationService(createMigrationStore(ctx.db));
      const detail = await svc.getDetail(str(a.id), ctx.tenantId);
      if (!detail) throw new Error('Migration run not found');
      const factory = await buildMigrationProviderFactory(ctx.db, env, ctx.tenantId, detail.run.provider, detail.run.credentialId);
      if (!factory) throw new Error('Could not load integration credentials');
      return svc.stageItems(str(a.id), ctx.tenantId, factory);
    },
  },
  {
    tool: 'migrations.commit', mutates: true,
    description: 'Promote the staged data into real projects/tasks/members (and create ongoing sync connections when mode includes sync). This is the irreversible import step.',
    parameters: obj({ id: S }, ['id']),
    run: async (ctx, a) => {
      const env = requireEnv(ctx);
      const svc = new MigrationService(createMigrationStore(ctx.db));
      const detail = await svc.getDetail(str(a.id), ctx.tenantId);
      if (!detail) throw new Error('Migration run not found');
      const factory = await buildMigrationProviderFactory(ctx.db, env, ctx.tenantId, detail.run.provider, detail.run.credentialId);
      if (!factory) throw new Error('Could not load integration credentials');
      return svc.commit(str(a.id), ctx.tenantId, factory);
    },
  },

  // ---- Web (server-side fetch) — read an external URL behind the SSRF guard and return its
  //       readable text. No DB; delegates to fetchWebDocument (assertSafeUrl + HTML→text + size cap).
  //       The browser Brain can't fetch cross-origin URLs (CORS), so the gateway does it here. ----
  { tool: 'web.fetch', mutates: false, description: 'Read an external URL, file, or website (e.g. a GitHub file like https://github.com/owner/repo/blob/main/ROADMAP.md, a docs page, or an article). The platform fetches it server-side and returns its text content (HTML is stripped to readable text; GitHub/GitLab "blob" links are resolved to the raw file automatically). Use this whenever the user pastes a link and asks you to read, summarize, or work from it — do NOT claim you cannot access external URLs. Returns { url, title, text, truncated }.', parameters: obj({ url: { ...S, description: 'Absolute http(s) URL to fetch.' } }, ['url']), run: (_ctx, a) => fetchWebDocument(str(a.url)) },

  // ---- Executions (agent-runtime runs) — READS only. The `executions` table is tenant- AND
  //       segment-scoped. submit/cancel/post_message are SKIPPED (side-effects: they dispatch /
  //       steer live runs, not table ops). `trace` is computed by reading the same tenant+segment
  //       -scoped telemetry tables the /executions/:id/trace route reads (usage_snapshots +
  //       tool_audit_events + execution_messages — execution_messages is tenant-scoped, NO
  //       segment_id). `task_file_changes` reads the raw-SQL task_file_changes table (no drizzle
  //       model), tenant-scoped by task_id + tenant_id. ----
  { tool: 'executions.list_recent', mutates: false, description: 'Recent executions across the workspace.', parameters: obj({ limit: N }), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(executions).where(and(eq(executions.tenantId, ctx.tenantId), eq(executions.segmentId, seg))).orderBy(desc(executions.createdAt)).limit(a.limit != null ? num(a.limit) : 200); } },
  { tool: 'executions.list_active', mutates: false, description: "What's running right now across the fleet (pending / running executions).", parameters: obj({}), run: async (ctx) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(executions).where(and(eq(executions.tenantId, ctx.tenantId), eq(executions.segmentId, seg), sql`${executions.status} IN ('pending','running')`)).orderBy(desc(executions.createdAt)).limit(200); } },
  { tool: 'executions.get', mutates: false, description: 'Get one execution by id.', parameters: obj({ id: N }, ['id']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return (await ctx.db.select().from(executions).where(and(eq(executions.id, num(a.id)), eq(executions.tenantId, ctx.tenantId), eq(executions.segmentId, seg))).limit(1))[0] ?? null; } },
  { tool: 'executions.list_for_task', mutates: false, description: 'Execution history for a task.', parameters: obj({ taskId: N }, ['taskId']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(executions).where(and(eq(executions.taskId, num(a.taskId)), eq(executions.tenantId, ctx.tenantId), eq(executions.segmentId, seg))).orderBy(desc(executions.createdAt)).limit(200); } },
  {
    tool: 'executions.trace', mutates: false,
    description: 'Execution trace: usage snapshots + tool-call audit (+ the durable steering thread).',
    parameters: obj({ id: N }, ['id']),
    run: async (ctx, a) => {
      const seg = await resolveSegment(ctx.db, ctx.tenantId);
      const id = num(a.id);
      const [execution] = await ctx.db.select().from(executions).where(and(eq(executions.id, id), eq(executions.tenantId, ctx.tenantId), eq(executions.segmentId, seg))).limit(1);
      if (!execution) return null;
      // Cloud runs are keyed by execution_id; host runs by (agent_host_id, session_key). All
      // telemetry tables are tenant+segment-scoped, so guard tenant+segment in every filter.
      const isCloudRun = execution.agentHostId == null || !execution.sessionId;
      const usageFilter = isCloudRun
        ? and(eq(usageSnapshots.tenantId, ctx.tenantId), eq(usageSnapshots.segmentId, seg), eq(usageSnapshots.executionId, id))
        : and(eq(usageSnapshots.tenantId, ctx.tenantId), eq(usageSnapshots.segmentId, seg), eq(usageSnapshots.agentHostId, execution.agentHostId!), eq(usageSnapshots.sessionKey, execution.sessionId!));
      const toolFilter = isCloudRun
        ? and(eq(toolAuditEvents.tenantId, ctx.tenantId), eq(toolAuditEvents.segmentId, seg), eq(toolAuditEvents.executionId, id))
        : and(eq(toolAuditEvents.tenantId, ctx.tenantId), eq(toolAuditEvents.segmentId, seg), eq(toolAuditEvents.agentHostId, execution.agentHostId!), eq(toolAuditEvents.sessionKey, execution.sessionId!));
      const usage = await ctx.db.select().from(usageSnapshots).where(usageFilter).orderBy(desc(usageSnapshots.ts)).limit(500);
      const toolEvents = await ctx.db.select().from(toolAuditEvents).where(toolFilter).orderBy(desc(toolAuditEvents.ts)).limit(500);
      const messages = await ctx.db.select().from(executionMessages).where(and(eq(executionMessages.executionId, id), eq(executionMessages.tenantId, ctx.tenantId))).orderBy(executionMessages.createdAt).limit(500);
      return { execution, trace: { source: isCloudRun ? 'cloud-telemetry' : 'runtime-fallback', usageSnapshots: usage, toolEvents, messages } };
    },
  },
  { tool: 'executions.task_file_changes', mutates: false, description: 'Files an agent created/modified/deleted for a task.', parameters: obj({ taskId: N }, ['taskId']), run: async (ctx, a) => (await ctx.db.execute(sql`SELECT path, change, agent, execution_id AS "executionId", created_at AS "createdAt" FROM task_file_changes WHERE task_id = ${num(a.taskId)} AND tenant_id = ${ctx.tenantId} ORDER BY created_at DESC LIMIT 500`)).rows },

  // ---- Integrations (read): integrations.list already exists above (line ~1088, secret-safe,
  //       tenant-scoped) — not re-added here to keep advertised names unique. ----

  // ---- Agent hosts (self-hosted runners) — agent_hosts is tenant- AND segment-scoped. register /
  //       deregister SKIPPED (mint/revoke API keys). ----
  { tool: 'agent_hosts.list', mutates: false, description: 'List registered self-hosted agent hosts.', parameters: obj({}), run: async (ctx) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(agentHosts).where(and(eq(agentHosts.tenantId, ctx.tenantId), eq(agentHosts.segmentId, seg))).orderBy(desc(agentHosts.createdAt)).limit(200); } },
  // agent_host_projects is tenant- AND segment-scoped (composite PK tenantId+agentHostId+projectId).
  { tool: 'agent_host_projects.list', mutates: false, description: 'Projects associated with an agent host.', parameters: obj({ agentHostId: N }, ['agentHostId']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(agentHostProjects).where(and(eq(agentHostProjects.tenantId, ctx.tenantId), eq(agentHostProjects.segmentId, seg), eq(agentHostProjects.agentHostId, num(a.agentHostId)))).limit(200); } },
  // usage_snapshots is tenant- AND segment-scoped; filtered to one host's token telemetry.
  { tool: 'usage_snapshots.list', mutates: false, description: 'Token usage snapshots for an agent host.', parameters: obj({ agentHostId: N, limit: N }, ['agentHostId']), run: async (ctx, a) => { const seg = await resolveSegment(ctx.db, ctx.tenantId); return ctx.db.select().from(usageSnapshots).where(and(eq(usageSnapshots.tenantId, ctx.tenantId), eq(usageSnapshots.segmentId, seg), eq(usageSnapshots.agentHostId, num(a.agentHostId)))).orderBy(desc(usageSnapshots.ts)).limit(a.limit != null ? num(a.limit) : 50); } },
];

/** Assert the worker env was threaded (tools that decrypt credentials / reach
 *  external providers need it; tests + the no-env path get a clear error). */
function requireEnv(ctx: BuiltinCtx): Env {
  if (!ctx.env) throw new Error('This tool requires the worker environment (credential access) and is unavailable in this context');
  return ctx.env;
}

/** Persist an integration credential's connectivity-test result. */
async function markTested(ctx: BuiltinCtx, credentialId: string, ok: boolean): Promise<void> {
  await ctx.db.update(integrationCredentials).set({ lastTestedAt: new Date(), lastTestOk: ok, updatedAt: new Date() }).where(and(eq(integrationCredentials.id, credentialId), eq(integrationCredentials.tenantId, ctx.tenantId)));
}

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

function buildCtx(db: Db, tenantId: number, opts?: { env?: Env; userId?: string | null }): BuiltinCtx {
  const projectRepo = new ProjectRepository(db);
  const taskRepo = new TaskRepository(db);
  return {
    db,
    tenantId,
    projects: new ProjectService(projectRepo),
    tasks: new TaskService(taskRepo, projectRepo),
    env: opts?.env,
    userId: opts?.userId ?? null,
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
  args: { tenantId: number; tool: string; arguments: unknown; env?: Env; userId?: string | null },
): Promise<unknown> {
  const entry = CATALOG.find((t) => t.tool === args.tool);
  if (!entry) throw new Error(`Unknown built-in tool '${args.tool}'`);
  const ctx = buildCtx(db, args.tenantId, { env: args.env, userId: args.userId });
  return entry.run(ctx, (args.arguments ?? {}) as Json);
}
