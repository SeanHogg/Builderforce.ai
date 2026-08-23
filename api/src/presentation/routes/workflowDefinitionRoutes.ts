/**
 * Workflow Definition routes — /api/workflow-definitions
 *
 * CRUD for the reusable, visually-authored agentic workflow graphs produced by
 * the builder canvas, plus a `run` endpoint that compiles a definition into
 * orchestrator steps and instantiates it as a regular `workflows` execution
 * record (so it appears in the existing monitoring + telemetry-graph surfaces).
 *
 *   GET    /api/workflow-definitions          List definitions for the tenant
 *   POST   /api/workflow-definitions          Create a definition
 *   GET    /api/workflow-definitions/:id       Get one definition
 *   PATCH  /api/workflow-definitions/:id       Update name/description/graph
 *   DELETE /api/workflow-definitions/:id       Delete a definition
 *   POST   /api/workflow-definitions/:id/run   Compile + instantiate an execution run
 */
import { Hono } from 'hono';
import { eq, and, desc, sql } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { workflowDefinitions, workflowTriggers, agentHosts, projects, workflows, telemetrySpans } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { MILLICENTS_PER_USD } from '../../domain/shared/money';
import {
  definitionToYaml,
  parseDefinition,
  validateDefinition,
  yamlToDefinition,
  type WorkflowDefinition,
} from '../../domain/workflowGraph';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import {
  instantiateWorkflowRun,
  runTargetFromDefinition,
  type RunTarget,
} from '../../application/workflow/instantiateRun';
import {
  coerceApprovalMode,
  coerceExecutionScope,
  coerceRunTarget,
  createWorkflowDefinition,
  scopeFromProject,
  workflowDefinitionListCacheKey as listCacheKey,
} from '../../application/workflow/definitionStore';
import { resolveCanvasRunTarget } from '../../application/workflow/canvasRunTarget';
import { evaluateWorkflowRunApprovalGate } from '../../application/workflow/workflowRunApproval';
import { notifyApprovalRequested } from '../../application/approval/approvalNotifier';
import { syncDefinitionTriggers } from '../../application/workflow/triggerSync';
import { bumpEventTriggerListeners } from '../../application/workflow/eventTriggers';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

/** Normalize an incoming graph payload to a well-formed WorkflowDefinition. */
function coerceDefinition(input: unknown): WorkflowDefinition {
  if (input && typeof input === 'object') {
    const v = input as Partial<WorkflowDefinition>;
    return {
      nodes: Array.isArray(v.nodes) ? v.nodes : [],
      edges: Array.isArray(v.edges) ? v.edges : [],
    };
  }
  return { nodes: [], edges: [] };
}

interface RunTargetInput {
  runTargetRuntime?: string;
  runTargetAgentHostId?: number | null;
  runTargetCloudAgentRef?: string | null;
  /** Project this workflow belongs to; null = tenant-wide (independent). */
  projectId?: number | null;
  /** 'project' = runs under the bound project; 'global' = tenant-wide. */
  executionScope?: string;
}

export function createWorkflowDefinitionRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // GET / — list this tenant's definitions (newest first), enriched for the
  // unified Workflows page: the bound project's name, the run-target agent's
  // display name (self-hosted host OR cloud agent), and the execution scope —
  // so each workflow card/row reads like a Project card. Read-through cached;
  // invalidated by every create/update/delete below.
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const definitions = await getOrSetCached(c.env as Env, listCacheKey(tenantId), async () => {
      const rows = await db
        .select({
          id: workflowDefinitions.id,
          name: workflowDefinitions.name,
          description: workflowDefinitions.description,
          projectId: workflowDefinitions.projectId,
          projectName: projects.name,
          runTargetRuntime: workflowDefinitions.runTargetRuntime,
          runTargetAgentHostId: workflowDefinitions.runTargetAgentHostId,
          runTargetCloudAgentRef: workflowDefinitions.runTargetCloudAgentRef,
          agentHostName: agentHosts.name,
          executionScope: workflowDefinitions.executionScope,
          createdAt: workflowDefinitions.createdAt,
          updatedAt: workflowDefinitions.updatedAt,
        })
        .from(workflowDefinitions)
        .leftJoin(projects, eq(projects.id, workflowDefinitions.projectId))
        .leftJoin(agentHosts, eq(agentHosts.id, workflowDefinitions.runTargetAgentHostId))
        .where(eq(workflowDefinitions.tenantId, tenantId))
        .orderBy(desc(workflowDefinitions.updatedAt));

      // Resolve cloud-agent run targets to names in one batched lookup (ide_agents
      // has no Drizzle model) — avoids an N+1 over the definition list.
      const cloudRefs = [...new Set(rows.map((r) => r.runTargetCloudAgentRef).filter((x): x is string => !!x))];
      const cloudNames = new Map<string, string>();
      if (cloudRefs.length > 0) {
        const cloudRows = (await db.execute(sql`
          SELECT id, name FROM ide_agents
          WHERE tenant_id = ${tenantId} AND id IN (${sql.join(cloudRefs, sql`, `)})
        `)).rows as Array<{ id: string; name: string }>;
        for (const r of cloudRows) cloudNames.set(r.id, r.name);
      }

      return rows.map((r) => {
        const { runTargetAgentHostId, agentHostName, ...rest } = r;
        const agentName = r.runTargetRuntime === 'cloud'
          ? (r.runTargetCloudAgentRef ? cloudNames.get(r.runTargetCloudAgentRef) ?? null : null)
          : agentHostName;
        return { ...rest, runTargetAgentHostId, agentName };
      });
    });

    // Run stats (count + most-recent status/time per definition) are computed
    // fresh, NOT cached: they change on every workflow run, and a run is created
    // deep in the application layer (manual/trigger/swimlane) without access to
    // this cache key. One indexed, grouped query (workflows_definition_id_idx) —
    // not an N+1 — so merging live stats onto the cached list stays cheap.
    const statRows = (await db.execute(sql`
      SELECT workflow_definition_id AS def_id,
             COUNT(*)::int AS run_count,
             (ARRAY_AGG(status ORDER BY created_at DESC))[1] AS last_run_status,
             MAX(created_at) AS last_run_at
      FROM workflows
      WHERE tenant_id = ${tenantId} AND workflow_definition_id IS NOT NULL
      GROUP BY workflow_definition_id
    `)).rows as Array<{ def_id: string; run_count: number; last_run_status: string | null; last_run_at: string | null }>;
    const statsById = new Map(statRows.map((s) => [s.def_id, s]));

    const enriched = definitions.map((d) => {
      const s = statsById.get(d.id);
      return {
        ...d,
        runCount: s?.run_count ?? 0,
        lastRunStatus: s?.last_run_status ?? null,
        lastRunAt: s?.last_run_at ?? null,
      };
    });
    return c.json({ definitions: enriched });
  });

  // GET /:id/runs — execution history for one workflow definition (newest first,
  // bounded). Uncached: run state changes continuously; the list is bounded and
  // served by workflows_definition_id_idx.
  router.get('/:id/runs', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [defRow] = await db
      .select({ id: workflowDefinitions.id })
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.id, id), eq(workflowDefinitions.tenantId, tenantId)));
    if (!defRow) return c.json({ error: 'Workflow definition not found' }, 404);

    const runs = await db
      .select({
        id: workflows.id,
        agentHostId: workflows.agentHostId,
        projectId: workflows.projectId,
        workflowType: workflows.workflowType,
        status: workflows.status,
        description: workflows.description,
        createdAt: workflows.createdAt,
        completedAt: workflows.completedAt,
        updatedAt: workflows.updatedAt,
      })
      .from(workflows)
      .where(and(eq(workflows.workflowDefinitionId, id), eq(workflows.tenantId, tenantId)))
      .orderBy(desc(workflows.createdAt))
      .limit(100);
    return c.json({ runs });
  });

  // GET /:id/usage — daily run-count + estimated cost for the History panel's
  // usage chart (mirrors Make's "credits / data transfer" sidebar). Rolling
  // historical stat with no write path to invalidate from, so — like
  // `run-targets` above — it's read-through cached on a short TTL rather than
  // invalidated on write; a few minutes of staleness is fine for a trend chart.
  router.get('/:id/usage', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const daysParam = Number(c.req.query('days'));
    const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(Math.floor(daysParam), 90) : 7;

    const [defRow] = await db
      .select({ id: workflowDefinitions.id })
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.id, id), eq(workflowDefinitions.tenantId, tenantId)));
    if (!defRow) return c.json({ error: 'Workflow definition not found' }, 404);

    const usage = await getOrSetCached(c.env as Env, `wfdef:usage:${tenantId}:${id}:${days}`, async () => {
      const runRows = (await db.execute(sql`
        SELECT date_trunc('day', created_at)::date::text AS day, status, count(*)::int AS n
        FROM workflows
        WHERE workflow_definition_id = ${id} AND tenant_id = ${tenantId}
          AND created_at >= now() - (${days} || ' days')::interval
        GROUP BY 1, 2
      `)).rows as Array<{ day: string; status: string; n: number }>;

      // Cost joins telemetry_spans the SAME way GET /api/workflows/:id/graph does
      // (estimatedCostUsd, millicents) — the only place a workflow's spend is recorded.
      const costRows = (await db.execute(sql`
        SELECT date_trunc('day', ts.ts)::date::text AS day, COALESCE(sum(ts.estimated_cost_usd), 0)::bigint AS millicents
        FROM telemetry_spans ts
        WHERE ts.tenant_id = ${tenantId}
          AND ts.workflow_id IN (SELECT id FROM workflows WHERE workflow_definition_id = ${id} AND tenant_id = ${tenantId})
          AND ts.ts >= now() - (${days} || ' days')::interval
        GROUP BY 1
      `)).rows as Array<{ day: string; millicents: number }>;

      const byDay = new Map<string, { runCount: number; completedCount: number; failedCount: number; costUsd: number }>();
      const entry = (day: string) => {
        const e = byDay.get(day) ?? { runCount: 0, completedCount: 0, failedCount: 0, costUsd: 0 };
        byDay.set(day, e);
        return e;
      };
      for (const row of runRows) {
        const e = entry(row.day);
        e.runCount += Number(row.n);
        if (row.status === 'completed') e.completedCount += Number(row.n);
        if (row.status === 'failed') e.failedCount += Number(row.n);
      }
      for (const row of costRows) {
        entry(row.day).costUsd += Number(row.millicents) / MILLICENTS_PER_USD;
      }

      const daysOut = Array.from({ length: days }, (_, i) => {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - (days - 1 - i));
        const date = d.toISOString().slice(0, 10);
        return { date, ...(byDay.get(date) ?? { runCount: 0, completedCount: 0, failedCount: 0, costUsd: 0 }) };
      });
      return {
        days: daysOut,
        totalRuns: daysOut.reduce((s, d) => s + d.runCount, 0),
        totalCostUsd: daysOut.reduce((s, d) => s + d.costUsd, 0),
      };
    }, { kvTtlSeconds: 300 });

    return c.json(usage);
  });

  // GET /run-targets — the targets a workflow can run on: self-hosted agentHosts
  // AND builderforce-hosted cloud agents (ide_agents supporting the cloud
  // runtime). Read-through cached; the keyspace is per-tenant and small.
  router.get('/run-targets', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const targets = await getOrSetCached(c.env as Env, `wfdef:run-targets:${tenantId}`, async () => {
      const hosts = await db
        .select({ id: agentHosts.id, name: agentHosts.name, status: agentHosts.status })
        .from(agentHosts)
        .where(eq(agentHosts.tenantId, tenantId))
        .orderBy(desc(agentHosts.lastSeenAt));
      // ide_agents is accessed via raw SQL (no Drizzle model); only agents that
      // can serve the cloud runtime are eligible run targets.
      const cloudRows = (await db.execute(sql`
        SELECT id, name, runtime_support
        FROM ide_agents
        WHERE tenant_id = ${tenantId}
          AND status = 'active'
          AND runtime_support IN ('cloud', 'both')
        ORDER BY created_at DESC
        LIMIT 200
      `)).rows as Array<{ id: string; name: string }>;
      return {
        hosts: hosts.map((h) => ({ id: h.id, name: h.name, status: h.status })),
        cloudAgents: cloudRows.map((r) => ({ ref: r.id, name: r.name })),
      };
    });
    return c.json(targets);
  });

  // POST / — create
  router.post('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const segmentId = c.get('segmentId') ?? null;
    const body = await c.req.json<{
      name?: string;
      description?: string;
      definition?: unknown;
      /** The canvas's own two-value select ('builderforce' | 'campaign-strategist'). */
      runTarget?: string;
      /** The canvas's own gate ('autonomous' | 'required'). */
      approvalMode?: string;
    } & RunTargetInput>();
    if (!body.name || !body.name.trim()) return c.json({ error: 'name is required' }, 400);

    // ── THE CANVAS'S AUTHORED RUN TARGET ───────────────────────────────────────
    // The canvas posts a friendly two-value select ('builderforce' | the agent), not
    // the stored columns. This route took only the columns, which was fine while a
    // second endpoint (`/from-canvas`) did the resolving for the canvas, and stopped
    // being fine when the board itself became the definition: a flow built from a
    // canvas SECTION posts a whole graph HERE, and without this it landed with
    // `runtime: 'host'` and no host — a definition that saves, shows as built, and
    // refuses at run time with "choose a run target", pointing at a control the
    // section does not have. `/from-canvas` has since been deleted, so this is the
    // one door a canvas compiles through and the resolution lives on it.
    let target = coerceRunTarget(
      typeof body.runTarget === 'string' && body.runTarget
        ? { ...body, runTargetRuntime: body.runTargetRuntime ?? 'cloud' }
        : body,
    );
    if (typeof body.runTarget === 'string' && body.runTarget) {
      const resolved = await resolveCanvasRunTarget(db, tenantId, body.runTarget);
      if (!resolved.ok) return c.json({ error: resolved.error, code: 'workflow_run_target_unresolved' }, 400);
      target = resolved.target;
    }

    const row = await createWorkflowDefinition(db, c.env as Env, {
      tenantId,
      segmentId,
      name: body.name,
      description: body.description ?? null,
      projectId: body.projectId ?? null,
      definition: coerceDefinition(body.definition),
      target,
      approvalMode: coerceApprovalMode(body.approvalMode),
      executionScope: body.executionScope ?? null,
    });
    return c.json(row, 201);
  });

  // POST /import — create a definition from a hand-authored YAML/JSON document.
  // Registered before /:id routes; `/import` is a distinct path so no collision.
  router.post('/import', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{ name?: string; yaml?: string }>();
    if (!body.yaml || !body.yaml.trim()) return c.json({ error: 'yaml is required' }, 400);

    let def: WorkflowDefinition;
    try {
      def = yamlToDefinition(body.yaml);
    } catch (e) {
      return c.json({ error: `Could not parse YAML: ${e instanceof Error ? e.message : String(e)}` }, 400);
    }
    const invalid = validateDefinition(def);
    if (invalid) return c.json({ error: invalid }, 400);

    const row = await createWorkflowDefinition(db, c.env as Env, {
      tenantId,
      segmentId: c.get('segmentId') ?? null,
      name: body.name?.trim() || 'Imported workflow',
      description: null,
      definition: def,
      target: coerceRunTarget({}),
    });
    return c.json(row, 201);
  });

  // GET /:id — full definition (graph included)
  router.get('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [row] = await db
      .select()
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.id, id), eq(workflowDefinitions.tenantId, tenantId)));
    if (!row) return c.json({ error: 'Workflow definition not found' }, 404);
    return c.json({ ...row, definition: parseDefinition(row.definition) });
  });

  // GET /:id/export — YAML serialization for download / hand-editing. Single-PK
  // read (cheap, content changes on every edit) — intentionally uncached.
  router.get('/:id/export', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [row] = await db
      .select()
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.id, id), eq(workflowDefinitions.tenantId, tenantId)));
    if (!row) return c.json({ error: 'Workflow definition not found' }, 404);
    const yaml = definitionToYaml(parseDefinition(row.definition));
    return c.body(yaml, 200, {
      'Content-Type': 'application/yaml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${row.name.replace(/[^a-z0-9-_]+/gi, '_')}.yaml"`,
    });
  });

  // GET /:id/triggers — the materialized, activatable triggers for a definition,
  // so the builder can show each one's activation: webhook URL, inbound-email
  // address, next scheduled run, and last firing status. Single-PK-scoped read of
  // a tiny per-definition set — intentionally uncached (state changes per tick).
  router.get('/:id/triggers', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [defRow] = await db
      .select({ id: workflowDefinitions.id })
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.id, id), eq(workflowDefinitions.tenantId, tenantId)));
    if (!defRow) return c.json({ error: 'Workflow definition not found' }, 404);

    const rows = await db
      .select()
      .from(workflowTriggers)
      .where(and(eq(workflowTriggers.definitionId, id), eq(workflowTriggers.tenantId, tenantId)));

    const origin = new URL(c.req.url).origin;
    const emailDomain = (c.env as Env).INBOUND_EMAIL_DOMAIN ?? 'inbound.builderforce.ai';
    return c.json({
      triggers: rows.map((r) => ({
        nodeId: r.nodeId,
        triggerType: r.triggerType,
        enabled: r.enabled,
        nextRunAt: r.nextRunAt,
        lastRunAt: r.lastRunAt,
        lastStatus: r.lastStatus,
        webhookUrl: r.triggerType === 'webhook' && r.token ? `${origin}/api/workflow-triggers/hook/${r.token}` : null,
        emailAddress: r.triggerType === 'inbound-email' && r.token ? `wf+${r.token}@${emailDomain}` : null,
        hasSecret: !!r.secret,
      })),
    });
  });

  // PATCH /:id — update name/description/graph/run-target
  router.patch('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const body = await c.req.json<{
      name?: string;
      description?: string;
      definition?: unknown;
      /** The canvas's own two-value select — see the create route. */
      runTarget?: string;
      approvalMode?: string;
    } & RunTargetInput>();

    const [existing] = await db
      .select()
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.id, id), eq(workflowDefinitions.tenantId, tenantId)));
    if (!existing) return c.json({ error: 'Workflow definition not found' }, 404);

    const canvasTarget = typeof body.runTarget === 'string' && body.runTarget ? body.runTarget : '';
    const runTargetTouched =
      canvasTarget !== '' ||
      body.runTargetRuntime !== undefined ||
      body.runTargetAgentHostId !== undefined ||
      body.runTargetCloudAgentRef !== undefined;
    let target = coerceRunTarget({
      runTargetRuntime: body.runTargetRuntime ?? existing.runTargetRuntime,
      runTargetAgentHostId: body.runTargetAgentHostId ?? existing.runTargetAgentHostId,
      runTargetCloudAgentRef: body.runTargetCloudAgentRef ?? existing.runTargetCloudAgentRef,
    });
    // A REBUILD from the canvas re-sends the section's authored target, so an edit to
    // that control lands on the same definition rather than only on the first save.
    if (canvasTarget) {
      const resolved = await resolveCanvasRunTarget(db, tenantId, canvasTarget);
      if (!resolved.ok) return c.json({ error: resolved.error, code: 'workflow_run_target_unresolved' }, 400);
      target = resolved.target;
    }

    await db
      .update(workflowDefinitions)
      .set({
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
        ...(body.definition !== undefined ? { definition: JSON.stringify(coerceDefinition(body.definition)) } : {}),
        ...(runTargetTouched ? target : {}),
        ...(body.approvalMode !== undefined ? { approvalMode: coerceApprovalMode(body.approvalMode) } : {}),
        // The project binding drives scope; an explicit executionScope only
        // applies when the binding itself isn't being changed.
        ...(body.projectId !== undefined || body.executionScope !== undefined
          ? { executionScope: scopeFromProject(body.projectId, body.executionScope ?? existing.executionScope) }
          : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(workflowDefinitions.id, id), eq(workflowDefinitions.tenantId, tenantId)));

    // Re-sync the trigger registry whenever the graph or run target changed —
    // both feed the materialized workflow_triggers rows.
    if (body.definition !== undefined || runTargetTouched) {
      const [updated] = await db.select().from(workflowDefinitions).where(scopedToTenant(workflowDefinitions, tenantId, eq(workflowDefinitions.id, id)));
      if (updated) {
        await syncDefinitionTriggers(db, {
          definitionId: id,
          tenantId,
          segmentId: updated.segmentId ?? null,
          definition: parseDefinition(updated.definition),
          target: runTargetFromDefinition(updated),
          env: c.env as Env,
        });
      }
    }

    await invalidateCached(c.env as Env, listCacheKey(tenantId));
    const [row] = await db.select().from(workflowDefinitions).where(scopedToTenant(workflowDefinitions, tenantId, eq(workflowDefinitions.id, id)));
    if (!row) return c.json({ error: 'Workflow definition not found' }, 404);
    return c.json({ ...row, definition: parseDefinition(row.definition) });
  });

  // DELETE /:id
  router.delete('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    await db
      .delete(workflowDefinitions)
      .where(and(eq(workflowDefinitions.id, id), eq(workflowDefinitions.tenantId, tenantId)));
    await invalidateCached(c.env as Env, listCacheKey(tenantId));
    // The definition's trigger rows go with it (FK cascade), so the cached
    // "is anyone listening?" answer is now stale — re-arm it.
    await bumpEventTriggerListeners(c.env as Env, tenantId);
    return c.json({ ok: true });
  });

  // POST /:id/run — compile + instantiate an execution record. The run target is
  // taken from the request when supplied (manual run from the builder), else the
  // definition's persisted run target. Supports a self-hosted agentHost
  // (runtime=host) or the builderforce-hosted cloud runtime (runtime=cloud).
  // DEVELOPER+ — instantiating a workflow run dispatches agent work, so it matches
  // the dispatch tier used across runtimeRoutes and /tasks/:id/run-now. Previously
  // ungated, leaving the UI's `runtime.execute` gate unenforced server-side.
  router.post('/:id/run', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const body = await c.req.json<{
      agentHostId?: number;
      runtime?: string;
      cloudAgentRef?: string;
    }>();

    const [defRow] = await db
      .select()
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.id, id), eq(workflowDefinitions.tenantId, tenantId)));
    if (!defRow) return c.json({ error: 'Workflow definition not found' }, 404);

    // ── The approval gate ────────────────────────────────────────────────────
    //
    // A definition whose card says "Approval required" must not start a run until
    // a human has approved one. Evaluated HERE, at the one endpoint every manual
    // and canvas-initiated run passes through, and through the SAME `approvals`
    // gate `task.execution` uses — a canvas-only approval concept would be an
    // approval nobody could see in the approvals queue.
    //
    // 202, not 400: the request was accepted and something happened (a real
    // approval is now pending); it simply is not a run yet, and the caller must
    // not report one.
    const gate = await evaluateWorkflowRunApprovalGate(db, tenantId, (c.get('userId') as string | undefined) ?? null, defRow);
    if (!gate.allowed) {
      // Notify only on the request that OPENED it — a reused pending approval has
      // already been announced, and re-announcing it trains reviewers to ignore it.
      if (gate.opened) {
        await notifyApprovalRequested(c.env as Env, db, {
          tenantId,
          approvalId: gate.approvalId,
          kind: 'approval',
          actionType: 'workflow.run',
          description: `Approve running the workflow "${defRow.name}"`,
        }).catch(() => undefined);
      }
      return c.json({ status: 'pending' as const, approvalId: gate.approvalId, reason: gate.reason }, 202);
    }

    // Request target wins; otherwise fall back to the definition's saved target.
    let target: RunTarget;
    if (body.runtime === 'cloud') {
      target = { runtime: 'cloud', cloudAgentRef: body.cloudAgentRef ?? defRow.runTargetCloudAgentRef };
    } else if (body.runtime === 'host' || body.agentHostId) {
      target = { runtime: 'host', agentHostId: body.agentHostId ?? defRow.runTargetAgentHostId };
    } else {
      target = runTargetFromDefinition(defRow);
    }

    const result = await instantiateWorkflowRun(db, {
      tenantId,
      segmentId: c.get('segmentId') ?? null,
      definition: parseDefinition(defRow.definition),
      name: defRow.name,
      projectId: defRow.projectId,
      definitionId: defRow.id,
      target,
      triggerSource: 'manual',
    });
    if (!result.ok) return c.json({ error: result.error }, 400);

    return c.json({ workflowId: result.workflowId, taskCount: result.taskCount }, 201);
  });

  // POST /:id/fork — fork a (typically shared/global) definition into a custom,
  // project-scoped copy. This is the "modify a shared workflow → custom workflow"
  // path: the source template stays untouched; the fork records its lineage in
  // `parentDefinitionId` and binds to `projectId` (defaults to the source's).
  router.post('/:id/fork', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const segmentId = c.get('segmentId') ?? null;
    const id = c.req.param('id');
    const body = await c.req.json<{ name?: string; projectId?: number | null }>().catch(() => ({} as { name?: string; projectId?: number | null }));

    const [src] = await db
      .select()
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.id, id), eq(workflowDefinitions.tenantId, tenantId)));
    if (!src) return c.json({ error: 'Workflow definition not found' }, 404);

    const projectId = body.projectId !== undefined ? body.projectId : src.projectId;
    const def = parseDefinition(src.definition);
    const row = await createWorkflowDefinition(db, c.env as Env, {
      tenantId,
      segmentId,
      name: body.name?.trim() || `${src.name} (custom)`,
      description: src.description,
      projectId: projectId ?? null,
      definition: def,
      target: coerceRunTarget(src),
      executionScope: src.executionScope,
      parentDefinitionId: src.id,
    });
    return c.json({ ...row, definition: parseDefinition(row.definition) }, 201);
  });

  return router;
}
