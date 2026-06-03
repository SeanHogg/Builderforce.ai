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
import { eq, and, desc } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { workflowDefinitions, workflows, workflowTasks } from '../../infrastructure/database/schema';
import {
  compileDefinition,
  definitionToYaml,
  parseDefinition,
  validateDefinition,
  yamlToDefinition,
  type WorkflowDefinition,
} from '../../domain/workflowGraph';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

/** Cache key for a tenant's workflow-definition list. */
const listCacheKey = (tenantId: number): string => `wfdef:list:${tenantId}`;

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

export function createWorkflowDefinitionRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // GET / — list this tenant's definitions (newest first). Read-through cached;
  // invalidated by every create/update/delete below.
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const definitions = await getOrSetCached(c.env as Env, listCacheKey(tenantId), () =>
      db
        .select({
          id: workflowDefinitions.id,
          name: workflowDefinitions.name,
          description: workflowDefinitions.description,
          createdAt: workflowDefinitions.createdAt,
          updatedAt: workflowDefinitions.updatedAt,
        })
        .from(workflowDefinitions)
        .where(eq(workflowDefinitions.tenantId, tenantId))
        .orderBy(desc(workflowDefinitions.updatedAt)),
    );
    return c.json({ definitions });
  });

  // POST / — create
  router.post('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{ name?: string; description?: string; definition?: unknown }>();
    if (!body.name || !body.name.trim()) return c.json({ error: 'name is required' }, 400);

    const id = crypto.randomUUID();
    const now = new Date();
    await db.insert(workflowDefinitions).values({
      id,
      tenantId,
      segmentId: c.get('segmentId') ?? null,
      name: body.name.trim(),
      description: body.description ?? null,
      definition: JSON.stringify(coerceDefinition(body.definition)),
      createdAt: now,
      updatedAt: now,
    });

    await invalidateCached(c.env as Env, listCacheKey(tenantId));
    const [row] = await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, id));
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

    const id = crypto.randomUUID();
    const now = new Date();
    await db.insert(workflowDefinitions).values({
      id,
      tenantId,
      segmentId: c.get('segmentId') ?? null,
      name: body.name?.trim() || 'Imported workflow',
      description: null,
      definition: JSON.stringify(def),
      createdAt: now,
      updatedAt: now,
    });
    await invalidateCached(c.env as Env, listCacheKey(tenantId));
    const [row] = await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, id));
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

  // PATCH /:id — update name/description/graph
  router.patch('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const body = await c.req.json<{ name?: string; description?: string; definition?: unknown }>();

    const [existing] = await db
      .select({ id: workflowDefinitions.id })
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.id, id), eq(workflowDefinitions.tenantId, tenantId)));
    if (!existing) return c.json({ error: 'Workflow definition not found' }, 404);

    await db
      .update(workflowDefinitions)
      .set({
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.definition !== undefined ? { definition: JSON.stringify(coerceDefinition(body.definition)) } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(workflowDefinitions.id, id), eq(workflowDefinitions.tenantId, tenantId)));

    await invalidateCached(c.env as Env, listCacheKey(tenantId));
    const [row] = await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, id));
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
    return c.json({ ok: true });
  });

  // POST /:id/run — compile + instantiate an execution record for a agentHost.
  // The definition is lowered to orchestrator steps; each compiled step becomes
  // a workflow_task whose dependsOn holds the *task UUIDs* of upstream nodes.
  router.post('/:id/run', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const body = await c.req.json<{ agentHostId?: number }>();
    if (!body.agentHostId) return c.json({ error: 'agentHostId is required to run a workflow' }, 400);

    const [defRow] = await db
      .select()
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.id, id), eq(workflowDefinitions.tenantId, tenantId)));
    if (!defRow) return c.json({ error: 'Workflow definition not found' }, 404);

    const def = parseDefinition(defRow.definition);
    const invalid = validateDefinition(def);
    if (invalid) return c.json({ error: invalid }, 400);

    const steps = compileDefinition(def);
    const nodeToTaskId = new Map(steps.map((s) => [s.nodeId, crypto.randomUUID()]));

    const workflowId = crypto.randomUUID();
    const now = new Date();
    await db.insert(workflows).values({
      id: workflowId,
      tenantId,
      segmentId: c.get('segmentId') ?? null,
      agentHostId: body.agentHostId,
      workflowType: 'custom',
      status: 'pending',
      description: defRow.name,
      createdAt: now,
      updatedAt: now,
    });

    if (steps.length > 0) {
      await db.insert(workflowTasks).values(
        steps.map((s) => ({
          id: nodeToTaskId.get(s.nodeId)!,
          workflowId,
          agentRole: s.role,
          description: s.description,
          // input carries the node kind + config so the agentHost's orchestrator can
          // run LLM-logic nodes (memory/knowledge/train) natively, not as agents.
          input: JSON.stringify({ kind: s.kind, config: s.config }),
          dependsOn: JSON.stringify(s.dependsOnNodeIds.map((nid) => nodeToTaskId.get(nid)).filter(Boolean)),
          status: 'pending' as const,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }

    return c.json({ workflowId, taskCount: steps.length }, 201);
  });

  return router;
}
