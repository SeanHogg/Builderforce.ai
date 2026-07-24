import { Hono, type Context } from 'hono';
import { and, count, eq, inArray, max, min, sql } from 'drizzle-orm';
import { ProjectService } from '../../application/project/ProjectService';
import { notSystemTask } from '../../application/task/taskScope';
import { ensureProjectTemplate } from '../../application/project/projectTemplate';
import { KanbanTemplateService } from '../../application/kanban/kanbanTemplateService';
import { provisionDefaultProjectEvermind } from '../../application/llm/projectEvermind';
import { DEFAULT_TEMPLATE_ID } from '../../application/kanban/templateCatalog';
import type { HonoEnv } from '../../env';
import type { Env } from '../../env';
import { getCacheVersion, getOrSetCached, bumpCacheVersion, bumpTicketSearchVersion } from '../../infrastructure/cache/readThroughCache';
import { computeProject360, type Project360Aggregate } from '../../application/project/computeProject360';
import { computeProjectDeliverySignals } from '../../application/insights/projectDeliverySignals';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { ProjectStatus, TenantRole } from '../../domain/shared/types';
import { isAgentHostOnline } from '../../domain/agentHost/onlineStatus';
import type { Db } from '../../infrastructure/database/connection';
import { agentHostProjects, agentHosts, objectiveLinks, objectives, projectInsightEvents, projects, sourceControlIntegrations, specs, tasks, tenants, workflows } from '../../infrastructure/database/schema';
import { relayToRoom } from './realtimeRelay';
import { buildPlanLimitsGuard } from '../middleware/planLimitsGuard';
import { projectRoomName } from '../../infrastructure/relay/broadcastRoom';

type SourceControlProvider = 'github' | 'bitbucket';

type ResolvedSourceControlAssignment = {
  sourceControlIntegrationId: number | null;
  sourceControlProvider: SourceControlProvider | null;
  sourceControlRepoFullName: string | null;
  sourceControlRepoUrl: string | null;
  githubRepoUrl: string | null;
};

type AssignmentResolveResult =
  | { ok: true; value: ResolvedSourceControlAssignment }
  | { ok: false; status: 400; message: string };

type ProjectRecommendation = {
  name: string;
  description: string;
};

type ChatCompletionPayload = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

/**
 * Presentation layer: Project HTTP routes.
 *
 * Maps between HTTP request/response and the application service.
 * No business logic lives here.
 */
/** Version-token key for a tenant's cached `/api/projects` list. */
export function projectsListVersionKey(tenantId: number): string {
  return `projects-list:tenant:${tenantId}`;
}

/**
 * Bust the cached `/api/projects` list for a tenant. Call from any write that
 * changes the list rows OR the aggregates it folds in (project CRUD, task
 * count/status/date/archival changes). Bumping a per-tenant version token is one
 * cheap KV write; every list key embedding the old token ages out on its TTL.
 * The KV TTL is the backstop for the rarer aggregates we don't bump explicitly
 * (workflow count, architecture PRD, agent-host assignment, initiative-level
 * goal links) — mirrors the completed-by-assignee convention in reportRoutes.
 */
export async function invalidateProjectsList(env: Env, tenantId: number): Promise<void> {
  // Task/objective/project writes that reshape the list also change what the
  // chat↔ticket link picker can find, so orphan its typeahead cache in the same
  // beat (the picker is a ticket surface, exactly like the projects list).
  await Promise.all([
    bumpCacheVersion(env, projectsListVersionKey(tenantId)),
    bumpTicketSearchVersion(env, tenantId),
  ]);
}

export function createProjectRoutes(projectService: ProjectService, db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // Live board channel: a single WebSocket per project over which every
  // project-scoped change is pushed as `{type:"changed"}`, so the board / kanban /
  // calendar / list and any open task drawer re-fetch in real time when a teammate
  // OR an agent mutates the project. Mirrors the poker/retro/ceremony rooms: the DO
  // is a dumb fan-out relay (no domain data flows through it), and the authed REST
  // routes stay the source of truth. The browser passes its JWT as `?token=` since
  // it can't set WS headers (authMiddleware already accepts the query param).
  // The room is tenant-scoped (`project:<tenantId>:<id>`), so before wiring the
  // stream we resolve the project THROUGH the caller's tenant — getProject throws
  // (404) when the id isn't in this tenant, which stops tenant B subscribing to
  // tenant A's change-events. We key the room off the resolved integer id so it
  // matches the publish side (broadcastProjectChanged always uses the integer id)
  // even when the caller addressed the project by its public UUID.
  router.get('/:id/stream', async (c) => {
    const tenantId = c.get('tenantId');
    const project = await projectService.getProject(c.req.param('id'), tenantId);
    return relayToRoom(c, c.env?.SESSION_ROOM, projectRoomName(tenantId, project.id));
  });

  const normalizeName = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

  const deriveProjectName = (prompt: string) => {
    const cleaned = prompt
      .replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) return 'New Project';
    const title = cleaned.split(/[.!?]/)[0]?.trim() ?? cleaned;
    return title.split(' ').slice(0, 6).join(' ').replace(/^[a-z]/, (c) => c.toUpperCase());
  };

  const deriveFallbackNameFromPrompt = (prompt: string) => {
    const domainMatch = prompt.match(/https?:\/\/(?:www\.)?([a-zA-Z0-9-]+)(?:\.[a-zA-Z0-9.-]+)+/);
    if (domainMatch?.[1]) {
      return domainMatch[1].trim();
    }
    return deriveProjectName(prompt);
  };

  const extractJsonObject = (content: string): string | null => {
    const trimmed = content.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    return trimmed.slice(start, end + 1);
  };

  const summarizePrompt = (prompt: string) => {
    const singleLine = prompt.replace(/\s+/g, ' ').trim();
    return singleLine.length > 420 ? `${singleLine.slice(0, 417)}...` : singleLine;
  };

  const recommendProjectFromPrompt = async (
    c: Context<HonoEnv>,
    prompt: string,
  ): Promise<ProjectRecommendation | null> => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) return null;

    const llmUrl = new URL('/llm/v1/chat/completions', c.req.url).toString();
    const systemPrompt = [
      'You are a product planning assistant for software projects.',
      'Given a raw user prompt, produce a concise project name and summary.',
      'Return ONLY valid JSON with this exact shape:',
      '{"name":"string","description":"string"}',
      'Rules:',
      '- name: 1-4 words, concise, product-like, no punctuation suffixes.',
      '- If a domain is provided (e.g. burnrateos.com), infer the product name from it.',
      '- description: 1-3 sentences summarizing what should be built.',
      '- Do not include markdown or code fences.',
    ].join('\n');

    const llmResponse = await fetch(llmUrl, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        stream: false,
        temperature: 0.2,
        max_tokens: 280,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!llmResponse.ok) return null;

    const payload = await llmResponse.json() as ChatCompletionPayload;
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) return null;

    const candidateJson = extractJsonObject(content);
    if (!candidateJson) return null;

    const parsed = JSON.parse(candidateJson) as Partial<ProjectRecommendation>;
    const name = parsed.name?.trim();
    const description = parsed.description?.trim();
    if (!name || !description) return null;

    return { name, description };
  };

  const resolveSourceControlAssignment = async (
    tenantId: number,
    input: {
      sourceControlIntegrationId?: number | null;
      sourceControlRepoFullName?: string | null;
      sourceControlRepoUrl?: string | null;
      githubRepoUrl?: string | null;
    },
    existing?: {
      sourceControlIntegrationId: number | null;
      sourceControlProvider: SourceControlProvider | null;
      sourceControlRepoFullName: string | null;
      sourceControlRepoUrl: string | null;
      githubRepoUrl: string | null;
    },
  ): Promise<AssignmentResolveResult> => {
    const hasScmInput =
      input.sourceControlIntegrationId !== undefined
      || input.sourceControlRepoFullName !== undefined
      || input.sourceControlRepoUrl !== undefined;

    if (!hasScmInput && input.githubRepoUrl === undefined) {
      return {
        ok: true,
        value: {
          sourceControlIntegrationId: existing?.sourceControlIntegrationId ?? null,
          sourceControlProvider: existing?.sourceControlProvider ?? null,
          sourceControlRepoFullName: existing?.sourceControlRepoFullName ?? null,
          sourceControlRepoUrl: existing?.sourceControlRepoUrl ?? null,
          githubRepoUrl: existing?.githubRepoUrl ?? null,
        },
      };
    }

    const integrationId = input.sourceControlIntegrationId !== undefined
      ? input.sourceControlIntegrationId
      : existing?.sourceControlIntegrationId ?? null;

    const repoFullName = input.sourceControlRepoFullName !== undefined
      ? input.sourceControlRepoFullName?.trim() || null
      : existing?.sourceControlRepoFullName ?? null;

    const explicitRepoUrl = input.sourceControlRepoUrl !== undefined
      ? input.sourceControlRepoUrl?.trim() || null
      : existing?.sourceControlRepoUrl ?? null;

    const explicitGithubRepoUrl = input.githubRepoUrl !== undefined
      ? input.githubRepoUrl?.trim() || null
      : existing?.githubRepoUrl ?? null;

    if (!integrationId) {
      return {
        ok: true,
        value: {
          sourceControlIntegrationId: null,
          sourceControlProvider: null,
          sourceControlRepoFullName: null,
          sourceControlRepoUrl: null,
          githubRepoUrl: explicitGithubRepoUrl,
        },
      };
    }

    const [integration] = await db
      .select({
        id: sourceControlIntegrations.id,
        provider: sourceControlIntegrations.provider,
      })
      .from(sourceControlIntegrations)
      .where(
        and(
          eq(sourceControlIntegrations.id, integrationId),
          eq(sourceControlIntegrations.tenantId, tenantId),
          eq(sourceControlIntegrations.isActive, true),
        ),
      )
      .limit(1);

    if (!integration) {
      return { ok: false, status: 400, message: 'Selected integration is not available for this workspace' };
    }

    if (!repoFullName) {
      return { ok: false, status: 400, message: 'sourceControlRepoFullName is required when assigning an integration' };
    }

    const provider = integration.provider as SourceControlProvider;
    const sourceControlRepoUrl = explicitRepoUrl
      ?? (provider === 'github'
        ? `https://github.com/${repoFullName}`
        : `https://bitbucket.org/${repoFullName}`);

    return {
      ok: true,
      value: {
        sourceControlIntegrationId: integration.id,
        sourceControlProvider: provider,
        sourceControlRepoFullName: repoFullName,
        sourceControlRepoUrl,
        githubRepoUrl: provider === 'github' ? (explicitGithubRepoUrl ?? sourceControlRepoUrl) : null,
      },
    };
  };

  // GET /api/projects
  // Read-through cached per tenant + version token: ~7 grouped aggregates is too
  // much to recompute on every dashboard/projects load. Writes bump the token via
  // invalidateProjectsList() so the next read recomputes; the KV TTL backstops the
  // rarer aggregates we don't bump explicitly.
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId');
    const version = await getCacheVersion(c.env as Env, projectsListVersionKey(tenantId));
    const projects = await getOrSetCached(
      c.env as Env,
      `${projectsListVersionKey(tenantId)}:v:${version}`,
      () => buildProjectsList(tenantId),
    );
    return c.json({ projects });
  });

  /** Window for the per-project delivery-health signals — matches the delivery
   *  tab's default so the card and the tab agree for a single-project tenant. */
  const DELIVERY_SIGNAL_WINDOW_DAYS = 30;

  /** Compute the full projects-list payload (base rows + all card aggregates). */
  async function buildProjectsList(tenantId: number) {
    const projectList = await projectService.listProjects(tenantId);
    const plainProjects = projectList.map((project) => project.toPlain());

    if (plainProjects.length === 0) {
      return [];
    }

    const projectIds = plainProjects.map((project) => project.id);
    // One grouped aggregate over the project's tasks → total + the status/timeliness
    // breakdown that drives the card's health speedometer and % done ring. Postgres
    // FILTER keeps this a SINGLE query (no N+1, no extra round-trips vs. the prior
    // plain count). `done` spans the canonical + common imported-board "completed"
    // statuses; `overdue` = past-due work not yet resolved.
    const DONE_SQL = sql`${tasks.status} in ('done', 'completed', 'closed', 'merged', 'resolved')`;
    const TERMINAL_SQL = sql`${tasks.status} in ('done', 'completed', 'closed', 'merged', 'resolved', 'cancelled')`;
    const taskCounts = await db
      .select({
        projectId: tasks.projectId,
        taskCount: count(),
        doneCount: sql<number>`count(*) filter (where ${DONE_SQL})`,
        blockedCount: sql<number>`count(*) filter (where ${tasks.status} = 'blocked')`,
        cancelledCount: sql<number>`count(*) filter (where ${tasks.status} = 'cancelled')`,
        overdueCount: sql<number>`count(*) filter (where ${tasks.dueDate} < now() and not (${TERMINAL_SQL}))`,
      })
      .from(tasks)
      .where(
        and(
          inArray(tasks.projectId, projectIds),
          eq(tasks.archived, false),
          notSystemTask,
        ),
      )
      .groupBy(tasks.projectId);

    interface TaskBreakdown { total: number; done: number; blocked: number; cancelled: number; overdue: number }
    const taskBreakdownByProject = new Map<number, TaskBreakdown>(
      taskCounts.map((row) => [row.projectId, {
        total: Number(row.taskCount),
        done: Number(row.doneCount),
        blocked: Number(row.blockedCount),
        cancelled: Number(row.cancelledCount),
        overdue: Number(row.overdueCount),
      }]),
    );

    // Project timelines are derived from their tasks: a project has no date column
    // of its own, so its schedule spans the earliest task start (falling back to the
    // earliest due date) through the latest task due date. Powers the calendar/Gantt views.
    const dateRanges = await db
      .select({
        projectId: tasks.projectId,
        minStart: min(tasks.startDate),
        minDue: min(tasks.dueDate),
        maxDue: max(tasks.dueDate),
      })
      .from(tasks)
      .where(
        and(
          inArray(tasks.projectId, projectIds),
          eq(tasks.archived, false),
          notSystemTask,
        ),
      )
      .groupBy(tasks.projectId);

    const toIso = (value: Date | string | null): string | null =>
      value ? new Date(value).toISOString() : null;
    const dateRangeByProject = new Map<number, { startDate: string | null; dueDate: string | null }>(
      dateRanges.map((row) => [
        row.projectId,
        { startDate: toIso(row.minStart ?? row.minDue), dueDate: toIso(row.maxDue) },
      ]),
    );

    const assignedAgentHostRows = await db
      .select({
        projectId: agentHostProjects.projectId,
        agentHostId: agentHosts.id,
        agentHostName: agentHosts.name,
      })
      .from(agentHostProjects)
      .innerJoin(agentHosts, eq(agentHostProjects.agentHostId, agentHosts.id))
      .where(and(eq(agentHostProjects.tenantId, tenantId), inArray(agentHostProjects.projectId, projectIds)));
    const assignedAgentHostByProject = new Map<number, { id: number; name: string }>();
    for (const row of assignedAgentHostRows) {
      if (!assignedAgentHostByProject.has(row.projectId)) {
        assignedAgentHostByProject.set(row.projectId, { id: row.agentHostId, name: row.agentHostName });
      }
    }

    // Workflow counts per project — powers the "N workflows" badge + View button.
    const workflowCounts = await db
      .select({ projectId: workflows.projectId, workflowCount: count() })
      .from(workflows)
      .where(and(eq(workflows.tenantId, tenantId), inArray(workflows.projectId, projectIds)))
      .groupBy(workflows.projectId);
    const workflowCountByProject = new Map<number, number>(
      workflowCounts
        .filter((row) => row.projectId != null)
        .map((row) => [row.projectId as number, Number(row.workflowCount)]),
    );

    // Which projects already have an architecture PRD (Architect analysis output).
    // Drives the "Run Architecture Analysis" vs "View Arch Analysis" button. Single
    // grouped query — no per-project round trip.
    const archSpecRows = await db
      .select({ projectId: specs.projectId })
      .from(specs)
      .where(and(eq(specs.tenantId, tenantId), inArray(specs.projectId, projectIds), eq(specs.kind, 'architecture')))
      .groupBy(specs.projectId);
    const hasArchByProject = new Set<number>(
      archSpecRows.filter((row) => row.projectId != null).map((row) => row.projectId as number),
    );

    // Distinct objectives/OKRs linked to each project — the "is the need defined"
    // (goals) signal behind the inspection's Direction dimension. A project's goals
    // come from TWO edges: objectives linked to its TASKS, and objectives linked to
    // the INITIATIVE it rolls up to. We union both into a distinct count per project
    // (two grouped reads, no per-project round trip; merged in memory).
    const initiativeByProject = new Map<number, string>();
    for (const project of plainProjects) {
      if (project.initiativeId) initiativeByProject.set(project.id, project.initiativeId);
    }

    const taskGoalRows = await db
      .select({ projectId: tasks.projectId, objectiveId: objectiveLinks.objectiveId })
      .from(objectiveLinks)
      .innerJoin(tasks, eq(objectiveLinks.taskId, tasks.id))
      .where(and(
        eq(objectiveLinks.tenantId, tenantId),
        eq(objectiveLinks.linkKind, 'task'),
        inArray(tasks.projectId, projectIds),
      ));

    const initiativeIds = [...new Set(initiativeByProject.values())];
    const initiativeGoalRows = initiativeIds.length
      ? await db
          .select({ initiativeId: objectiveLinks.initiativeId, objectiveId: objectiveLinks.objectiveId })
          .from(objectiveLinks)
          .where(and(
            eq(objectiveLinks.tenantId, tenantId),
            eq(objectiveLinks.linkKind, 'initiative'),
            inArray(objectiveLinks.initiativeId, initiativeIds),
          ))
      : [];
    const objectivesByInitiative = new Map<string, Set<string>>();
    for (const row of initiativeGoalRows) {
      if (!row.initiativeId || !row.objectiveId) continue;
      const set = objectivesByInitiative.get(row.initiativeId) ?? new Set<string>();
      set.add(row.objectiveId);
      objectivesByInitiative.set(row.initiativeId, set);
    }

    const goalObjectivesByProject = new Map<number, Set<string>>();
    const goalSet = (projectId: number): Set<string> => {
      const set = goalObjectivesByProject.get(projectId) ?? new Set<string>();
      goalObjectivesByProject.set(projectId, set);
      return set;
    };
    for (const row of taskGoalRows) {
      if (row.objectiveId) goalSet(row.projectId).add(row.objectiveId);
    }
    for (const [projectId, initiativeId] of initiativeByProject) {
      const initiativeObjectives = objectivesByInitiative.get(initiativeId);
      if (initiativeObjectives) for (const objectiveId of initiativeObjectives) goalSet(projectId).add(objectiveId);
    }
    // Third edge (0268): objectives scoped DIRECTLY to a project — the Brain's
    // `objectives.create` with a projectId, or the OKR tab's project scope. Merged
    // into the same distinct set so a project counts each linked objective once.
    const projectScopedGoalRows = await db
      .select({ projectId: objectives.projectId, objectiveId: objectives.id })
      .from(objectives)
      .where(and(eq(objectives.tenantId, tenantId), inArray(objectives.projectId, projectIds)));
    for (const row of projectScopedGoalRows) {
      if (row.projectId != null) goalSet(row.projectId).add(row.objectiveId);
    }
    const goalCountByProject = new Map<number, number>(
      [...goalObjectivesByProject].map(([projectId, set]) => [projectId, set.size]),
    );

    // Per-project delivery signals (DORA + cycle time + flow) over the standard
    // 30-day window — the compact inputs the frontend runs through the SAME
    // computeDeliveryVerdict the /insights/delivery banner uses, so a project's
    // health score is identical on its card and on the delivery tab. One bounded
    // grouped pass (no N+1); the whole list payload is version-token cached.
    const deliverySignalsByProject = await computeProjectDeliverySignals(db, tenantId, DELIVERY_SIGNAL_WINDOW_DAYS);

    return plainProjects.map((project) => {
      const b = taskBreakdownByProject.get(project.id);
      return {
        ...project,
        taskCount: b?.total ?? 0,
        // Status/timeliness breakdown for the health speedometer + % done ring
        // (frontend derives the score via the shared computeProjectHealth helper).
        completedTaskCount: b?.done ?? 0,
        openTaskCount: b ? Math.max(0, b.total - b.done - b.cancelled) : 0,
        blockedTaskCount: b?.blocked ?? 0,
        overdueTaskCount: b?.overdue ?? 0,
        // Delivery-health inputs — the frontend fuses these via the shared verdict
        // so the card's health matches the /insights/delivery gauge (null = no
        // deploys/throughput yet → the card shows a neutral "no data" health).
        deliverySignals: deliverySignalsByProject.get(project.id) ?? null,
        workflowCount: workflowCountByProject.get(project.id) ?? 0,
        hasArchitecturePrd: hasArchByProject.has(project.id),
        // Goal/OKR linkage + planning-spine membership — the inspection Direction
        // dimension treats a project with linked objectives or an initiative as
        // having a defined "need" (the platform North Star).
        linkedGoalCount: goalCountByProject.get(project.id) ?? 0,
        initiativeId: project.initiativeId ?? null,
        assignedAgentHost: assignedAgentHostByProject.get(project.id) ?? null,
        startDate: dateRangeByProject.get(project.id)?.startDate ?? null,
        // Effective deadline drives the calendar/Gantt: the PM's explicit project
        // due date (0255) when set, else the derived latest-task-due-date.
        dueDate: toIso(project.dueDate) ?? dateRangeByProject.get(project.id)?.dueDate ?? null,
        // The explicit value alone, so the details editor can distinguish "set by a
        // PM" from "auto-derived from tasks" and seed its date input correctly.
        projectDueDate: toIso(project.dueDate),
      };
    });
  }

  // GET /api/projects/check-key?key=SOMEKEY[&excludeId=123] — returns { available: boolean }
  router.get('/check-key', async (c) => {
    const key = (c.req.query('key') ?? '').trim().toUpperCase();
    const excludeId = c.req.query('excludeId') ? Number(c.req.query('excludeId')) : null;
    if (!key) return c.json({ available: false, error: 'key is required' }, 400);
    const existing = await projectService.findByKey(key);
    const available = !existing || (excludeId !== null && existing.id === excludeId);
    return c.json({ available, key });
  });

  // GET /api/projects/:id (accepts integer id or public UUID)
  router.get('/:id', async (c) => {
    const project = await projectService.getProject(c.req.param('id'), c.get('tenantId'));
    return c.json(project.toPlain());
  });

  /**
   * GET /api/projects/:id/360 — the whole-picture health rollup (Project 360): four
   * pillars × eight dimensions, the missing-item "improve" checklist, and the LIVE
   * workforce (who's working / idle and why). The single source of truth the VS Code
   * native panel renders — the web app can render the SAME payload later.
   *
   * Reuses the already-cached projects-list aggregate for the expensive grouped task
   * counts (no re-count), then composes the live signals (per-task assignment,
   * non-terminal executions, availability). The composed result rides a DELIBERATELY
   * SHORT read-through cache (5s L1 / 10s KV, keyed by the projects-list version so a
   * task write busts it) — enough to absorb open/refresh storms without serving stale
   * "who's working": an explicit refresh sends `?fresh=1` to bypass it entirely.
   */
  router.get('/:id/360', async (c) => {
    const tenantId = c.get('tenantId');
    const project = await projectService.getProject(c.req.param('id'), tenantId);
    const version = await getCacheVersion(c.env as Env, projectsListVersionKey(tenantId));
    const list = await getOrSetCached(
      c.env as Env,
      `${projectsListVersionKey(tenantId)}:v:${version}`,
      () => buildProjectsList(tenantId),
    );
    const row = list.find((p) => p.id === project.id);
    if (!row) return c.json({ error: 'project not found' }, 404);
    const aggregate: Project360Aggregate = {
      id: row.id,
      name: row.name,
      key: row.key ?? null,
      status: row.status ?? null,
      taskCount: row.taskCount,
      completedTaskCount: row.completedTaskCount,
      openTaskCount: row.openTaskCount,
      blockedTaskCount: row.blockedTaskCount,
      overdueTaskCount: row.overdueTaskCount,
      linkedGoalCount: row.linkedGoalCount,
      initiativeId: row.initiativeId ?? null,
      hasArchitecturePrd: row.hasArchitecturePrd,
      assignedAgentHost: row.assignedAgentHost ?? null,
    };
    const fresh = c.req.query('fresh') === '1';
    if (fresh) return c.json(await computeProject360(db, tenantId, aggregate));
    const model = await getOrSetCached(
      c.env as Env,
      `project-360:tenant:${tenantId}:project:${project.id}:v:${version}`,
      () => computeProject360(db, tenantId, aggregate),
      { l1TtlMs: 5_000, kvTtlSeconds: 10 },
    );
    return c.json(model);
  });

  // NOTE: the per-project chat CRUD (`GET/POST /:id/chats`, `GET/PATCH
  // /:id/chats/:chatId`) was removed [1436] — all chat traffic now goes through
  // the canonical BrainService (`/api/brain/chats*`); these handlers had no
  // remaining caller and duplicated query paths over the same tables.

  // POST /api/projects/:id/insights/code-changes
  // Record code-change deltas for project interactions (Insights is available on all plans)
  router.post('/:id/insights/code-changes', async (c) => {
    const tenantId = c.get('tenantId');
    const userId = c.get('userId') as string;
    const body = await c.req.json<{ codeChanges?: number; executionId?: number | null }>();

    if (!Number.isFinite(body.codeChanges)) {
      return c.json({ error: 'codeChanges is required' }, 400);
    }

    const projectObj = await projectService.getProject(c.req.param('id'), tenantId);
    const projectId = projectObj.id;
    const codeChanges = Math.max(0, Math.floor(Number(body.codeChanges)));

    await db.insert(projectInsightEvents).values({
      tenantId,
      projectId,
      userId,
      executionId: body.executionId ?? null,
      codeChanges,
    });

    return c.json({ ok: true, projectId, codeChanges });
  });

  // POST /api/projects
  router.post('/', async (c) => {
    const body = await c.req.json<{
      key?: string;
      name: string;
      description?: string | null;
      /** IDE: template to seed initial files (e.g. "vanilla"). */
      template?: string | null;
      rootWorkingDirectory?: string | null;
      sourceControlIntegrationId?: number | null;
      sourceControlRepoFullName?: string | null;
      sourceControlRepoUrl?: string | null;
      githubRepoUrl?: string | null;
      governance?: string | null;
      /** IDE project type: 'designer' | 'video' | 'evermind' | 'finetune' | 'voice'. Defaults to 'designer'. */
      modality?: string | null;
      /** Where the project was born — 'ide' tags it for the Designer badge. */
      origin?: string | null;
    }>();
    const tenantId = c.get('tenantId');
    const name = body.name?.trim();
    if (!name) return c.json({ error: 'name is required' }, 400);

    const guard = buildPlanLimitsGuard(db, c.env as Env);
    const limitErr = await guard.checkProjectLimit(tenantId);
    if (limitErr) return c.json(limitErr, 402);

    const assignment = await resolveSourceControlAssignment(tenantId, {
      sourceControlIntegrationId: body.sourceControlIntegrationId,
      sourceControlRepoFullName: body.sourceControlRepoFullName,
      sourceControlRepoUrl: body.sourceControlRepoUrl,
      githubRepoUrl: body.githubRepoUrl,
    });
    if (!assignment.ok) return c.json({ error: assignment.message }, assignment.status);

    const project = await projectService.createProject({
      key:           body.key?.trim() || (await projectService.buildUniqueKey(tenantId, name)),
      name,
      description:   body.description,
      template:      body.template ?? null,
      rootWorkingDirectory: body.rootWorkingDirectory,
      sourceControlIntegrationId: assignment.value.sourceControlIntegrationId,
      sourceControlProvider: assignment.value.sourceControlProvider,
      sourceControlRepoFullName: assignment.value.sourceControlRepoFullName,
      sourceControlRepoUrl: assignment.value.sourceControlRepoUrl,
      githubRepoUrl: assignment.value.githubRepoUrl,
      governance: body.governance ?? null,
      modality: body.modality ?? null,
      origin: body.origin ?? null,
      tenantId,
    });
    await ensureProjectTemplate(c.env.UPLOADS, project);
    // Provision the project's board from a kanban template so its lanes carry role
    // ownership + per-lane requirements from day one (the onboarding "recommended
    // roster" reads from this). Defaults to the Standard SWE board; best-effort so a
    // template failure never blocks project creation.
    {
      const plain = project.toPlain();
      const templateId = (body as { kanbanTemplateId?: string }).kanbanTemplateId?.trim() || DEFAULT_TEMPLATE_ID;
      await new KanbanTemplateService(db)
        .applyToProject(c.env as Env, tenantId, plain.id, templateId, plain.name)
        .catch(() => {});
    }
    // Give the project a DEFAULT Evermind so it always has a self-learning model to
    // run/learn/edit — even when the manager never seeds one from a Studio model.
    // Best-effort (never blocks creation); inference stays OFF until opted in.
    await provisionDefaultProjectEvermind(c.env as Env, db, tenantId, project.toPlain().id, name);
    await invalidateProjectsList(c.env as Env, tenantId).catch(() => {});
    return c.json(project.toPlain(), 201);
  });

  // POST /api/projects/upsert
  router.post('/upsert', async (c) => {
    const tenantId = c.get('tenantId');
    const body = await c.req.json<{
      name: string;
      description?: string | null;
      rootWorkingDirectory?: string | null;
      sourceControlIntegrationId?: number | null;
      sourceControlRepoFullName?: string | null;
      sourceControlRepoUrl?: string | null;
      githubRepoUrl?: string | null;
      governance?: string | null;
    }>();

    const name = body.name?.trim();
    if (!name) return c.json({ error: 'name is required' }, 400);

    const projects = await projectService.listProjects(tenantId);
    const existing = projects.find((project) => normalizeName(project.name) === normalizeName(name));

    const assignment = await resolveSourceControlAssignment(
      tenantId,
      {
        sourceControlIntegrationId: body.sourceControlIntegrationId,
        sourceControlRepoFullName: body.sourceControlRepoFullName,
        sourceControlRepoUrl: body.sourceControlRepoUrl,
        githubRepoUrl: body.githubRepoUrl,
      },
      existing ? {
        sourceControlIntegrationId: existing.sourceControlIntegrationId,
        sourceControlProvider: existing.sourceControlProvider,
        sourceControlRepoFullName: existing.sourceControlRepoFullName,
        sourceControlRepoUrl: existing.sourceControlRepoUrl,
        githubRepoUrl: existing.githubRepoUrl,
      } : undefined,
    );
    if (!assignment.ok) return c.json({ error: assignment.message }, assignment.status);

    if (existing) {
      const updated = await projectService.updateProject(
        existing.id,
        {
          name,
          description: body.description,
          rootWorkingDirectory: body.rootWorkingDirectory,
          sourceControlIntegrationId: assignment.value.sourceControlIntegrationId,
          sourceControlProvider: assignment.value.sourceControlProvider,
          sourceControlRepoFullName: assignment.value.sourceControlRepoFullName,
          sourceControlRepoUrl: assignment.value.sourceControlRepoUrl,
          githubRepoUrl: assignment.value.githubRepoUrl,
        },
        tenantId,
      );
      await invalidateProjectsList(c.env as Env, tenantId).catch(() => {});
      return c.json({ action: 'updated', project: updated.toPlain() });
    }

    const created = await projectService.createProject({
      tenantId,
      key: await projectService.buildUniqueKey(tenantId, name),
      name,
      description: body.description,
      rootWorkingDirectory: body.rootWorkingDirectory,
      sourceControlIntegrationId: assignment.value.sourceControlIntegrationId,
      sourceControlProvider: assignment.value.sourceControlProvider,
      sourceControlRepoFullName: assignment.value.sourceControlRepoFullName,
      sourceControlRepoUrl: assignment.value.sourceControlRepoUrl,
      githubRepoUrl: assignment.value.githubRepoUrl,
    });

    await ensureProjectTemplate(c.env.UPLOADS, created);
    // Default Evermind for every newly-created project (see POST / above).
    await provisionDefaultProjectEvermind(c.env as Env, db, tenantId, created.toPlain().id, name);
    await invalidateProjectsList(c.env as Env, tenantId).catch(() => {});
    return c.json({ action: 'created', project: created.toPlain() }, 201);
  });

  // PATCH /api/projects/:id
  router.patch('/:id', async (c) => {
    const rawId = c.req.param('id');
    const tenantId = c.get('tenantId');
    const body = await c.req.json<{
      key?: string;
      name?: string;
      description?: string | null;
      template?: string | null;
      rootWorkingDirectory?: string | null;
      status?: ProjectStatus;
      sourceControlIntegrationId?: number | null;
      sourceControlRepoFullName?: string | null;
      sourceControlRepoUrl?: string | null;
      githubRepoUrl?: string | null;
      modality?: string | null;
      /** Explicit project deadline as an ISO/date string, or null to clear it. */
      dueDate?: string | null;
    }>();

    // Parse the explicit deadline: a non-empty string → Date, explicit null → clear,
    // omitted (undefined) → leave unchanged. An unparseable string is treated as
    // "leave unchanged" rather than silently writing an Invalid Date.
    let dueDate: Date | null | undefined;
    if (body.dueDate === null) {
      dueDate = null;
    } else if (typeof body.dueDate === 'string' && body.dueDate.trim()) {
      const parsed = new Date(body.dueDate);
      dueDate = Number.isNaN(parsed.getTime()) ? undefined : parsed;
    }

    const existing = await projectService.getProject(rawId, tenantId);
    const assignment = await resolveSourceControlAssignment(
      tenantId,
      {
        sourceControlIntegrationId: body.sourceControlIntegrationId,
        sourceControlRepoFullName: body.sourceControlRepoFullName,
        sourceControlRepoUrl: body.sourceControlRepoUrl,
        githubRepoUrl: body.githubRepoUrl,
      },
      {
        sourceControlIntegrationId: existing.sourceControlIntegrationId,
        sourceControlProvider: existing.sourceControlProvider,
        sourceControlRepoFullName: existing.sourceControlRepoFullName,
        sourceControlRepoUrl: existing.sourceControlRepoUrl,
        githubRepoUrl: existing.githubRepoUrl,
      },
    );
    if (!assignment.ok) return c.json({ error: assignment.message }, assignment.status);

    const project = await projectService.updateProject(existing.id, {
      ...body,
      dueDate,
      sourceControlIntegrationId: assignment.value.sourceControlIntegrationId,
      sourceControlProvider: assignment.value.sourceControlProvider,
      sourceControlRepoFullName: assignment.value.sourceControlRepoFullName,
      sourceControlRepoUrl: assignment.value.sourceControlRepoUrl,
      githubRepoUrl: assignment.value.githubRepoUrl,
    }, tenantId);
    await invalidateProjectsList(c.env as Env, tenantId).catch(() => {});
    // A Project Key change re-keys every task (`<oldKey>-NNN` → `<newKey>-NNN`) in
    // updateProject; bust the cached Epic trees for this project so they don't
    // serve stale keys. Task-list reads are uncached, so they reflect it already.
    if (project.key !== existing.key) {
      await bumpCacheVersion(c.env as Env, `task-tree-version:project:${existing.id}`).catch(() => {});
    }
    return c.json(project.toPlain());
  });

  // POST /api/projects/scaffold
  router.post('/scaffold', async (c) => {
    const tenantId = c.get('tenantId');
    const body = await c.req.json<{
      prompt: string;
      rootWorkingDirectory?: string | null;
      agentHostId?: number | null;
    }>();

    const prompt = body.prompt?.trim();
    if (!prompt) return c.json({ error: 'prompt is required' }, 400);

    let recommendation: ProjectRecommendation | null = null;
    try {
      recommendation = await recommendProjectFromPrompt(c, prompt);
    } catch {
      recommendation = null;
    }

    const name = recommendation?.name?.trim() || deriveFallbackNameFromPrompt(prompt);
    const description = recommendation?.description?.trim() || summarizePrompt(prompt);
    const rootWorkingDirectory = body.rootWorkingDirectory?.trim() || null;

    const existingProjects = await projectService.listProjects(tenantId);
    const existing = existingProjects.find((project) => normalizeName(project.name) === normalizeName(name));

    const project = existing
      ? await projectService.updateProject(
          existing.id,
          { description, rootWorkingDirectory },
          tenantId,
        )
      : await projectService.createProject({
          tenantId,
          key: await projectService.buildUniqueKey(tenantId, name),
          name,
          description,
          rootWorkingDirectory,
        });

    // Newly scaffolded (non-repo, default designer) projects get the starter
    // template so the IDE opens runnable — updates of an existing project keep
    // whatever files it already has.
    if (!existing) await ensureProjectTemplate(c.env.UPLOADS, project);
    // Default Evermind for a freshly-scaffolded project (see POST / above).
    if (!existing) await provisionDefaultProjectEvermind(c.env as Env, db, tenantId, project.id, name);

    let selectedAgentHostId: number | null = null;

    const [projectAssigned] = await db
      .select({ agentHostId: agentHostProjects.agentHostId })
      .from(agentHostProjects)
      .where(and(eq(agentHostProjects.tenantId, tenantId), eq(agentHostProjects.projectId, project.id)))
      .limit(1);

    if (projectAssigned) {
      selectedAgentHostId = projectAssigned.agentHostId;
    } else {
      const requestedAgentHostId = body.agentHostId ?? null;
      const [tenantRow] = await db
        .select({ defaultAgentHostId: tenants.defaultAgentHostId })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);

      const defaultCandidate = requestedAgentHostId ?? tenantRow?.defaultAgentHostId ?? null;
      if (defaultCandidate) {
        const [agentHost] = await db
          .select({ id: agentHosts.id })
          .from(agentHosts)
          .where(and(eq(agentHosts.id, defaultCandidate), eq(agentHosts.tenantId, tenantId)))
          .limit(1);

        if (agentHost) {
          selectedAgentHostId = agentHost.id;
          await db
            .insert(agentHostProjects)
            .values({ tenantId, agentHostId: agentHost.id, projectId: project.id, role: 'default' })
            .onConflictDoUpdate({
              target: [agentHostProjects.tenantId, agentHostProjects.agentHostId, agentHostProjects.projectId],
              set: { updatedAt: new Date() },
            });
        }
      }
    }

    const finalProject = selectedAgentHostId === null
      ? await projectService.updateProject(project.id, { status: ProjectStatus.ON_HOLD }, tenantId)
      : await projectService.updateProject(project.id, { status: ProjectStatus.ACTIVE }, tenantId);

    await invalidateProjectsList(c.env as Env, tenantId).catch(() => {});
    return c.json({
      project: finalProject.toPlain(),
      scaffold: {
        agentHostId: selectedAgentHostId,
        wip: selectedAgentHostId === null,
        synced: selectedAgentHostId !== null,
      },
    });
  });

  // DELETE /api/projects/:id
  router.delete('/:id', async (c) => {
    const tenantId = c.get('tenantId');
    const project = await projectService.getProject(c.req.param('id'), tenantId);
    await projectService.deleteProject(project.id, tenantId);
    await invalidateProjectsList(c.env as Env, tenantId).catch(() => {});
    return c.body(null, 204);
  });

  // GET /api/projects/:id/agentHosts — list agentHosts associated with a project
  router.get('/:id/agentHosts', async (c) => {
    const tenantId = c.get('tenantId');
    const proj = await projectService.getProject(c.req.param('id'), tenantId);
    const projectId = proj.id;

    const rows = await db
      .select({
        id:          agentHosts.id,
        name:        agentHosts.name,
        slug:        agentHosts.slug,
        status:      agentHosts.status,
        connectedAt: agentHosts.connectedAt,
        lastSeenAt:  agentHosts.lastSeenAt,
        createdAt:   agentHosts.createdAt,
      })
      .from(agentHostProjects)
      .innerJoin(agentHosts, eq(agentHostProjects.agentHostId, agentHosts.id))
      .where(and(
        eq(agentHostProjects.projectId, projectId),
        eq(agentHostProjects.tenantId, tenantId),
      ));

    return c.json({
      agentHosts: rows.map((r) => ({
        id:          String(r.id),
        name:        r.name,
        slug:        r.slug,
        status:      r.status,
        online:      isAgentHostOnline(r),
        connectedAt: r.connectedAt?.toISOString() ?? null,
        lastSeenAt:  r.lastSeenAt?.toISOString() ?? null,
        createdAt:   r.createdAt.toISOString(),
      })),
    });
  });

  return router;
}
