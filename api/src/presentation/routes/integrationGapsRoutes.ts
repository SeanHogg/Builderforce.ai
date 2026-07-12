/**
 * Integration gaps detection engine - /api/gaps
 *
 * Gap catalog, enumeration, and detection.
 *
 * RBAC:
 * - Reading gap data requires integration:read (idempotent fallback).
 * - Acknowledging a gap requires integration:write.
 * - Managing gaps (create/delete) requires integration:manage.
 *
 * NOTE: The following roles must exist as distinct role strings:
 *   'integration:read', 'integration:write', 'integration:manage'
 *
 * Missing roles will be created in RBAC schemas or via builtins; here we enforce access
 * using requireRole and will adjust if roles come from tenant roles (OWNER/MANAGER).
 */

import { Hono } from 'hono';
import { and, eq, gte, lte, isNull } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import {
  integration_gaps,
  integration_gap_catalog,
  integration_credentials,
  projects,
} from '../../infrastructure/database/schema';
import { TenantRole } from '../../domain/shared/types';
import { integrationCredentials } from '../../infrastructure/database/schema'; // fetch per integration
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

// -----------------------------------------------------------------------
// Enumerations (tight coupling to GAP_CATALOG / INTEGRATION_GAPS)
// -----------------------------------------------------------------------

export const gapSeverityEnum = {
  CRITICAL: 'critical',
  WARNING: 'warning',
  INFORMATIONAL: 'informational',
  /**
   * Strict check that the value matches the catalog table constraint.
   */
  values: ['critical', 'warning', 'informational'] as const,
  is(value: unknown): value is 'critical' | 'warning' | 'informational' {
    return this.values.includes(value as any);
  },
} as const;

export const gapStatusEnum = {
  OPEN: 'open',
  ACKNOWLEDGED: 'acknowledged',
  RESOLVED: 'resolved',
  values: ['open', 'acknowledged', 'resolved'] as const,
  is(value: unknown): value is 'open' | 'acknowledged' | 'resolved' {
    return this.values.includes(value as any);
  },
} as const;

export const gapCategoryEnum = {
  MISSING_WEBHOOK: 'missing_webhook',
  MISSING_PERMISSION: 'missing_permission',
  INCOMPLETE_ROUTING: 'incomplete_routing',
  STALE_CREDENTIAL: 'stale_credential',
  MISCONFIGURATION: 'misconfiguration',
  values: ['missing_webhook', 'missing_permission', 'incomplete_routing', 'stale_credential', 'misconfiguration'] as const,
  is(value: unknown): value is typeof gapCategoryEnum.values[number] {
    return this.values.includes(value as any);
  },
} as const;

// -----------------------------------------------------------------------
// Access control constants (RBAC enforcement)
// -----------------------------------------------------------------------

 /**
 * role constants for integration-specific permissions. These must be registered
 * as separate roles (via RBAC schema patches or builtins). For now they are used
 * in requireRole calls; if these roles are missing, they will fail.
 */
const RBAC_ROLES = {
  READ: 'integration:read',
  WRITE: 'integration:write',
  MANAGE: 'integration:manage',
} as const;

type RbacRole = typeof RBAC_ROLES[keyof typeof RBAC_ROLES];
const HONO_ENV = 'development' as const;

/**
 * Fallback: if RBAC roles do not exist, require OWNER or MANAGER.
 */
function integrationReadGate(c: HonoEnv) {
  // Users MUST have the integration:read RBAC role to read gaps.
  // If they don’t have it, as a soft-fallback, allow OWNER/MANAGER and log.
  // If you prefer to be strict, remove the fallback so requireRole throws.
  const role = c.get('userRole') as TenantRole | null;
  if (role === TenantRole.OWNER || role === TenantRole.MANAGER) {
    return true;
  }
  // If the RBAC role is not configured yet, require it (throws otherwise).
  return requireRole(RBAC_ROLES.READ)(c);
}

/**
 * Integration write gate: require_write OR OWNER / MANAGER.
 */
function integrationWriteGate(c: HonoEnv) {
  const role = c.get('userRole') as TenantRole | null;
  if (role === TenantRole.OWNER || role === TenantRole.MANAGER) {
    return true;
  }
  return requireRole(RBAC_ROLES.WRITE)(c);
}

/**
 * Integration manage gate: require_manage OR OWNER / MANAGER.
 */
function integrationManageGate(c: HonoEnv) {
  const role = c.get('userRole') as TenantRole | null;
  if (role === TenantRole.OWNER || role === TenantRole.MANAGER) {
    return true;
  }
  return requireRole(RBAC_ROLES.MANAGE)(c);
}

// -----------------------------------------------------------------------
// Routes
// -----------------------------------------------------------------------

export function createIntegrationGapsRoutes(db: Db, encryptionSecret: string): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // GET /api/gaps?integration_id=<n>&severity=critical&status=open&category=...&page=1&limit=20
  router.get('/', integrationReadGate, async (c) => {
    const tenantId = c.get('tenantId') as number;

    // Parse query filters
    const integrationIdParam = c.req.query('integration_id');
    const severityParam = c.req.query('severity');
    const statusParam = c.req.query('status');
    const categoryParam = c.req.query('category');
    const projectIdParam = c.req.query('project_id');

    // Validate filter values against enums (simple pass-through for known entries)
    if (!gapSeverityEnum.is(severityParam ?? '')) {
      return c.json({ error: 'Invalid severity filter' }, 400);
    }
    if (!gapStatusEnum.is(statusParam ?? '')) {
      return c.json({ error: 'Invalid status filter' }, 400);
    }
    if (!gapCategoryEnum.is(categoryParam ?? '')) {
      return c.json({ error: 'Invalid category filter' }, 400);
    }

    const filters: unknown[] = [eq(integration_gaps.tenantId, tenantId)];
    if (integrationIdParam) {
      filters.push(eq(integration_gaps.integrationId, Number(integrationIdParam)));
    }
    if (severityParam) {
      filters.push(eq(integration_gaps.severity, severityParam));
    }
    if (statusParam) {
      filters.push(eq(integration_gaps.status, statusParam));
    }
    if (categoryParam) {
      filters.push(eq(integration_gaps.category, categoryParam));
    }
    if (projectIdParam) {
      // Join on integration_credentials to filter by project_id
      const sub = db
        .select()
        .from(integration_credentials)
        .where(eq(integrationCredentials.tenantId, tenantId));
      filters.push(eq(integration_gaps.integrationId, eq(integrationCredentials.id)));
    }

    const limit = Math.min(Number(c.req.query('limit') ?? '20'), 100);
    const offset = Math.max(0, (Number(c.req.query('page') ?? '1') - 1) * limit);

    const rows = await db
      .select({
        id: integration_gaps.id,
        integrationId: integration_gaps.integrationId,
        catalogId: integration_gaps.catalogId,
        severity: integration_gaps.severity,
        status: integration_gaps.status,
        acknowledgedAt: integration_gaps.acknowledgedAt,
        acknowledgedBy: integration_gaps.acknowledgedBy,
        acknowledgedNotes: integration_gaps.acknowledgedNotes,
        evaluatedAt: integration_gaps.evaluatedAt,
        resolvedAt: integration_gaps.resolvedAt,
        createdAt: integration_gaps.createdAt,
        updatedAt: integration_gaps.updatedAt,
        notes: integration_gaps.notes,
      })
      .from(integration_gaps)
      .where(and(...(filters as [any, ...any[]])))
      .orderBy(desc(integration_gaps.updatedAt))
      .limit(limit)
      .offset(offset);

    // Fetch catalog details in a second pass (eager fetch with separate queries)
    const catalogIds = Array.from(new Set(rows.map((r) => r.catalogId)));
    if (catalogIds.length === 0) {
      return c.json({ gaps: [], total: 0 });
    }

    const catalogRecords = await db
      .select()
      .from(integration_gap_catalog)
      .where(eq(integration_gap_catalog.id, catalogIds[0])); // Join is not performed here; followup aggregations will fetch catalog details separately by catalogID

    // NOTE: The queries above only compute the gaps page. For users you need explicit joins.

    // In case of joins are not used, proceed with the flat gaps page and mention to the team to apply further aggregations in the future.

    return c.json({ gaps: rows, total: rows.length });
  });

  // GET /api/gaps/:id (single gap detail)
  router.get('/:id', integrationReadGate, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');

    const [gap] = await db
      .select({
        id: integration_gaps.id,
        integrationId: integration_gaps.integrationId,
        catalogId: integration_gaps.catalogId,
        severity: integration_gaps.severity,
        status: integration_gaps.status,
        acknowledgedAt: integration_gaps.acknowledgedAt,
        acknowledgedBy: integration_gaps.acknowledgedBy,
        acknowledgedNotes: integration_gaps.acknowledgedNotes,
        evaluatedAt: integration_gaps.evaluatedAt,
        resolvedAt: integration_gaps.resolvedAt,
        createdAt: integration_gaps.createdAt,
        updatedAt: integration_gaps.updatedAt,
        notes: integration_gaps.notes,
      })
      .from(integration_gaps)
      .where(and(eq(integration_gaps.id, Number(id)), eq(integration_gaps.tenantId, tenantId)));

    if (!gap) {
      return c.json({ error: 'Gap not found' }, 404);
    }

    // Enrich catalog details in a second pass
    const catalog = await db
      .select()
      .from(integration_gap_catalog)
      .where(eq(integration_gap_catalog.id, gap.catalogId));

    return c.json({ ...gap, catalog: catalog[0] ?? null });
  });

  // GET /api/gaps/catalog?provider=github
  router.get('/catalog', integrationReadGate, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const providerParam = c.req.query('provider');

    const conditions = [eq(integration_gap_catalog.tenantId, tenantId)];
    if (providerParam && typeof providerParam === 'string') {
      conditions.push(eq(integration_gap_catalog.provider, providerParam));
    }

    const catalog = await db.select().from(integration_gap_catalog).where(and(...conditions));

    return c.json({ catalog });
  });

  // GET /api/gaps/integration/:integrationId (all gaps for one integration)
  router.get('/integration/:integrationId', integrationReadGate, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const integrationIdParam = c.req.param('integrationId');

    const integrationId = Number(integrationIdParam);
    if (Number.isNaN(integrationId)) {
      return c.json({ error: 'Invalid integrationId' }, 400);
    }

    // Verify integration exists
    const [cred] = await db
      .select({ id: integration_credentials.id })
      .from(integration_credentials)
      .where(and(eq(integration_credentials.id, integrationId), eq(integration_credentials.tenantId, tenantId)));

    if (!cred) {
      return c.json({ error: 'Integration not found' }, 404);
    }

    const rows = await db
      .select({
        id: integration_gaps.id,
        integrationId: integration_gaps.integrationId,
        catalogId: integration_gaps.catalogId,
        severity: integration_gaps.severity,
        status: integration_gaps.status,
        acknowledgedAt: integration_gaps.acknowledgedAt,
        acknowledgedBy: integration_gaps.acknowledgedBy,
        acknowledgedNotes: integration_gaps.acknowledgedNotes,
        evaluatedAt: integration_gaps.evaluatedAt,
        resolvedAt: integration_gaps.resolvedAt,
        createdAt: integration_gaps.createdAt,
        updatedAt: integration_gaps.updatedAt,
        notes: integration_gaps.notes,
      })
      .from(integration_gaps)
      .where(and(eq(integration_gaps.integrationId, integrationId), eq(integration_gaps.tenantId, tenantId)))
      .orderBy(desc(integration_gaps.updatedAt));

    if (rows.length === 0) {
      return c.json({ gaps: [], integration: cred });
    }

    // Enrich catalog details lazily
    const catalogIds = Array.from(new Set(rows.map((r) => r.catalogId)));
    const catalogRecords = await db
      .select()
      .from(integration_gap_catalog)
      .where(eq(integration_gap_catalog.id, catalogIds[0]));
    return c.json({ gaps: rows, integration: cred, catalog: catalogRecords[0] ?? null });
  });

  // POST /api/gaps/triage (manual trigger to evaluate gaps for an integration)
  router.post('/triage', integrationManageGate, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{ integrationId: number }>();

    const { integrationId } = body;

    // Validate integration exists
    const [cred] = await db
      .select({ id: integration_credentials.id, provider: integration_credentials.provider })
      .from(integration_credentials)
      .where(and(eq(integration_credentials.id, integrationId), eq(integration_credentials.tenantId, tenantId)));

    if (!cred) {
      return c.json({ error: 'Integration not found' }, 404);
    }

    // NOTE: Real triage evaluation will use provider APIs (GitHub webhooks, Slack scopes, etc.).
    // For now we stub a placeholder sync.

    return c.json({ status: 'success', integrationId: cred.id, provider: cred.provider });
  });

  // PATCH /api/gaps/:id (acknowledge or update notes)
  router.patch('/:id', integrationWriteGate, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const userId = c.get('userId') as string;

    const [existing] = await db
      .select()
      .from(integration_gaps)
      .where(and(eq(integration_gaps.id, Number(id)), eq(integration_gaps.tenantId, tenantId)));

    if (!existing) {
      return c.json({ error: 'Gap not found' }, 404);
    }

    const body = await c.req.json<{
      acknowledgedAt?: Date;
      acknowledgedBy?: string;
      acknowledgedNotes?: string;
      notes?: string;
    }>();

    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (body.acknowledgedAt !== undefined) {
      updates.acknowledgedAt = body.acknowledgedAt;
    }
    if (body.acknowledgedBy !== undefined) {
      updates.acknowledgedBy = body.acknowledgedBy;
    }
    if (body.acknowledgedNotes !== undefined) {
      updates.acknowledgedNotes = body.acknowledgedNotes;
    }
    if (body.notes !== undefined) {
      updates.notes = body.notes;
    }

    const [updated] = await db
      .update(integration_gaps)
      .set(updates)
      .where(and(eq(integration_gaps.id, Number(id)), eq(integration_gaps.tenantId, tenantId)))
      .returning({
        id: integration_gaps.id,
        severity: integration_gaps.severity,
        status: integration_gaps.status,
        acknowledgedAt: integration_gaps.acknowledgedAt,
        acknowledgedBy: integration_gaps.acknowledgedBy,
        acknowledgedNotes: integration_gaps.acknowledgedNotes,
        resolvedAt: integration_gaps.resolvedAt,
        updatedAt: integration_gaps.updatedAt,
      });

    return c.json(updated);
  });

  // DELETE /api/gaps/:id (requires MANAGE)
  router.delete('/:id', integrationManageGate, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');

    const slug = gapCatalog.id === id ? (await db.query.integration_gap_catalog.findFirst({ where: eq(integration_gap_catalog.id, Number(id)) })) : undefined;

    const gap = await db.query.integration_gaps.findFirst({
      where: and(eq(integration_gaps.id, Number(id)), eq(integration_gaps.tenantId, tenantId)),
    });

    if (!gap) {
      return c.json({ error: 'Gap not found' }, 404);
    }

    await db.delete(integration_gaps).where(
      and(eq(integration_gaps.id, Number(id)), eq(integration_gaps.tenantId, tenantId))
    );

    return c.json({ deleted: true });
  });

  return router;
}