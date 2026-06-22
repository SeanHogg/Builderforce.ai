import { Hono, type Context } from 'hono';
import { and, count, eq, inArray, max, min } from 'drizzle-orm';
import { ProjectService } from '../../application/project/ProjectService';
import { ensureProjectTemplate } from '../../application/project/projectTemplate';
import type { HonoEnv } from '../../env';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { ProjectStatus, TenantRole } from '../../domain/shared/types';
import { isAgentHostOnline } from '../../domain/agentHost/onlineStatus';
import type { Db } from '../../infrastructure/database/connection';
import { agentHostProjects, agentHosts, projectInsightEvents, projects, sourceControlIntegrations, specs, tasks, tenants, workflows } from '../../infrastructure/database/schema';
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
  router.get('/:id/stream', (c) => {
    if (c.req.header('Upgrade') !== 'websocket') return c.text('Expected WebSocket upgrade', 426);
    const ns = c.env?.SESSION_ROOM;
    if (!ns) return c.text('Realtime unavailable', 503);
    return ns.get(ns.idFromName(projectRoomName(c.req.param('id')))).fetch(c.req.raw);
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
  router.get('/', async (c) => {
    const projectList = await projectService.listProjects(c.get('tenantId'));
    const plainProjects = projectList.map((project) => project.toPlain());

    if (plainProjects.length === 0) {
      return c.json({ projects: [] });
    }

    const projectIds = plainProjects.map((project) => project.id);
    const taskCounts = await db
      .select({
        projectId: tasks.projectId,
        taskCount: count(),
      })
      .from(tasks)
      .where(
        and(
          inArray(tasks.projectId, projectIds),
          eq(tasks.archived, false),
        ),
      )
      .groupBy(tasks.projectId);

    const taskCountByProject = new Map<number, number>(
      taskCounts.map((row) => [row.projectId, Number(row.taskCount)]),
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

    const tenantId = c.get('tenantId');
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

    return c.json({
      projects: plainProjects.map((project) => ({
        ...project,
        taskCount: taskCountByProject.get(project.id) ?? 0,
        workflowCount: workflowCountByProject.get(project.id) ?? 0,
        hasArchitecturePrd: hasArchByProject.has(project.id),
        assignedAgentHost: assignedAgentHostByProject.get(project.id) ?? null,
        startDate: dateRangeByProject.get(project.id)?.startDate ?? null,
        dueDate: dateRangeByProject.get(project.id)?.dueDate ?? null,
      })),
    });
  });

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
      /** IDE project type: 'designer' | 'video' | 'llm'. Defaults to 'designer'. */
      modality?: string | null;
      /** Where the project was born — 'ide' tags it for the Designer badge. */
      origin?: string | null;
    }>();
    const tenantId = c.get('tenantId');
    const name = body.name?.trim();
    if (!name) return c.json({ error: 'name is required' }, 400);

    const guard = buildPlanLimitsGuard(db);
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
    }>();

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
      sourceControlIntegrationId: assignment.value.sourceControlIntegrationId,
      sourceControlProvider: assignment.value.sourceControlProvider,
      sourceControlRepoFullName: assignment.value.sourceControlRepoFullName,
      sourceControlRepoUrl: assignment.value.sourceControlRepoUrl,
      githubRepoUrl: assignment.value.githubRepoUrl,
    }, tenantId);
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
