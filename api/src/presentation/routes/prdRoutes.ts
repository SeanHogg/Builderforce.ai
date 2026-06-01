/**
 * PRD versioning, generation & audit routes – /api/prd
 *
 * Sibling to specRoutes.ts (the spec CRUD). Adds the auditable-contract
 * capabilities on top of an existing spec:
 *
 * POST /api/prd/specs/:id/versions   Snapshot current spec → spec_versions (monotonic, unfrozen)
 * POST /api/prd/specs/:id/freeze     Freeze the latest version (freeze-on-execute immutability)
 * GET  /api/prd/specs/:id/versions   List versions for a spec
 * POST /api/prd/specs/:id/generate   Create a generate-PRD planning workflow + mark spec origin
 * GET  /api/prd/specs/:id/audit      List audit records (+ ?agentRole= & ?swimlane= filters)
 * POST /api/prd/specs/:id/audit      Append an audit record
 *
 * All routes are tenant-scoped via authMiddleware. JSON payload columns are
 * stored as text → JSON.stringify on write.
 */
import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import {
  specs,
  specVersions,
  specAuditRecords,
  workflows,
  tenants,
} from '../../infrastructure/database/schema';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import {
  nextVersionNumber,
  assertNotFrozen,
  buildFrozenSnapshot,
  FrozenVersionError,
} from '../../application/prd/versioning';
import { buildPrdWorkflowSpec } from '../../application/prd/generatePrd';
import { buildSpecAuditRecord } from '../../application/prd/audit';

export function createPrdRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.use('*', authMiddleware);

  /** Load a tenant-scoped spec or return null. */
  async function loadSpec(specId: string, tenantId: number) {
    const [row] = await db
      .select()
      .from(specs)
      .where(and(eq(specs.id, specId), eq(specs.tenantId, tenantId)));
    return row ?? null;
  }

  // POST /api/prd/specs/:id/versions — snapshot current spec into spec_versions
  router.post('/specs/:id/versions', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const segmentId = (c.get('segmentId') as string | undefined) ?? null;
    const specId = c.req.param('id');

    const spec = await loadSpec(specId, tenantId);
    if (!spec) return c.json({ error: 'Spec not found' }, 404);

    const body = await c.req
      .json<{ origin?: string; createdBy?: string }>()
      .catch(() => ({} as { origin?: string; createdBy?: string }));

    const existing = await db
      .select({ version: specVersions.version })
      .from(specVersions)
      .where(and(eq(specVersions.specId, specId), eq(specVersions.tenantId, tenantId)));

    const version = nextVersionNumber(existing.map((r) => r.version));

    // A newly-created version is NOT frozen — it freezes on /freeze (execute).
    const snapshot = buildFrozenSnapshot(
      { id: spec.id, tenantId, segmentId, prd: spec.prd, archSpec: spec.archSpec, taskList: spec.taskList },
      version,
      new Date(),
      { origin: body.origin, createdBy: body.createdBy ?? null },
    );

    const [row] = await db
      .insert(specVersions)
      .values({ ...snapshot, frozen: false, frozenAt: null })
      .returning();

    return c.json(row, 201);
  });

  // POST /api/prd/specs/:id/freeze — freeze the latest version
  router.post('/specs/:id/freeze', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const specId = c.req.param('id');

    const spec = await loadSpec(specId, tenantId);
    if (!spec) return c.json({ error: 'Spec not found' }, 404);

    const [latest] = await db
      .select()
      .from(specVersions)
      .where(and(eq(specVersions.specId, specId), eq(specVersions.tenantId, tenantId)))
      .orderBy(desc(specVersions.version))
      .limit(1);

    if (!latest) return c.json({ error: 'No version to freeze' }, 404);

    // Already frozen → immutable; surface the invariant violation.
    try {
      assertNotFrozen({ frozen: latest.frozen });
    } catch (e) {
      if (e instanceof FrozenVersionError) {
        return c.json({ error: 'Latest version is already frozen', version: latest.version }, 409);
      }
      throw e;
    }

    const now = new Date();
    const [row] = await db
      .update(specVersions)
      .set({ frozen: true, frozenAt: now })
      .where(and(eq(specVersions.id, latest.id), eq(specVersions.tenantId, tenantId)))
      .returning();

    return c.json(row);
  });

  // GET /api/prd/specs/:id/versions — list versions (newest first)
  router.get('/specs/:id/versions', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const specId = c.req.param('id');

    const spec = await loadSpec(specId, tenantId);
    if (!spec) return c.json({ error: 'Spec not found' }, 404);

    const rows = await db
      .select()
      .from(specVersions)
      .where(and(eq(specVersions.specId, specId), eq(specVersions.tenantId, tenantId)))
      .orderBy(desc(specVersions.version));

    return c.json({ versions: rows });
  });

  // POST /api/prd/specs/:id/generate — create a generate-PRD planning workflow
  router.post('/specs/:id/generate', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const segmentId = (c.get('segmentId') as string | undefined) ?? null;
    const specId = c.req.param('id');

    const spec = await loadSpec(specId, tenantId);
    if (!spec) return c.json({ error: 'Spec not found' }, 404);

    const body = await c.req
      .json<{ ticketDescription?: string; clawId?: number }>()
      .catch(() => ({} as { ticketDescription?: string; clawId?: number }));

    // workflows.clawId is NOT NULL — resolve from body, the spec, or the tenant default.
    let clawId = body.clawId ?? spec.clawId ?? null;
    if (clawId == null) {
      const [t] = await db
        .select({ defaultClawId: tenants.defaultClawId })
        .from(tenants)
        .where(eq(tenants.id, tenantId));
      clawId = t?.defaultClawId ?? null;
    }
    if (clawId == null) {
      return c.json({ error: 'clawId is required (no default claw for tenant)' }, 400);
    }

    const ticket = body.ticketDescription ?? spec.goal ?? '';
    const workflowSpec = buildPrdWorkflowSpec(ticket);

    const workflowId = crypto.randomUUID();
    const now = new Date();

    const [workflow] = await db
      .insert(workflows)
      .values({
        id:           workflowId,
        tenantId,
        segmentId,
        clawId,
        specId,
        workflowType: workflowSpec.workflowType,
        status:       'pending',
        description:  JSON.stringify(workflowSpec),
        createdAt:    now,
        updatedAt:    now,
      })
      .returning();

    // Mark the spec's working version origin as generated-from-ticket so the
    // audit trail reflects the PRD provenance.
    const existing = await db
      .select({ version: specVersions.version })
      .from(specVersions)
      .where(and(eq(specVersions.specId, specId), eq(specVersions.tenantId, tenantId)));
    const version = nextVersionNumber(existing.map((r) => r.version));
    const snapshot = buildFrozenSnapshot(
      { id: spec.id, tenantId, segmentId, prd: spec.prd, archSpec: spec.archSpec, taskList: spec.taskList },
      version,
      now,
      { origin: 'generated_from_ticket' },
    );
    const [specVersion] = await db
      .insert(specVersions)
      .values({ ...snapshot, frozen: false, frozenAt: null })
      .returning();

    return c.json({ workflow, workflowSpec, specVersion }, 201);
  });

  // GET /api/prd/specs/:id/audit — list audit records (+ filters)
  router.get('/specs/:id/audit', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const specId = c.req.param('id');
    const agentRole = c.req.query('agentRole');
    const swimlane = c.req.query('swimlane');

    const spec = await loadSpec(specId, tenantId);
    if (!spec) return c.json({ error: 'Spec not found' }, 404);

    const conds = [eq(specAuditRecords.specId, specId), eq(specAuditRecords.tenantId, tenantId)];
    if (agentRole) conds.push(eq(specAuditRecords.agentRole, agentRole));
    if (swimlane) conds.push(eq(specAuditRecords.swimlane, swimlane));

    const rows = await db
      .select()
      .from(specAuditRecords)
      .where(and(...conds))
      .orderBy(desc(specAuditRecords.at));

    return c.json({ records: rows });
  });

  // POST /api/prd/specs/:id/audit — append an audit record
  router.post('/specs/:id/audit', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const segmentId = (c.get('segmentId') as string | undefined) ?? null;
    const specId = c.req.param('id');

    const spec = await loadSpec(specId, tenantId);
    if (!spec) return c.json({ error: 'Spec not found' }, 404);

    const body = await c.req.json<{
      specVersion?: number;
      sectionId?:   string;
      agentRole?:   string;
      action:       string;
      swimlane?:    string;
      taskId?:      number;
      detail?:      unknown;
    }>();

    let payload;
    try {
      payload = buildSpecAuditRecord({
        specId,
        tenantId,
        segmentId,
        specVersion: body.specVersion ?? null,
        sectionId:   body.sectionId ?? null,
        agentRole:   body.agentRole ?? null,
        action:      body.action,
        swimlane:    body.swimlane ?? null,
        taskId:      body.taskId ?? null,
        detail:      body.detail,
      });
    } catch {
      return c.json({ error: 'action is required' }, 400);
    }

    const [row] = await db.insert(specAuditRecords).values(payload).returning();
    return c.json(row, 201);
  });

  return router;
}
