/**
 * Integration gaps controller – /api/integrations/:id/gaps
 *
 * Gap summary and acknowledgement under provider endpoints.
 *
 * RBAC:
 * - Reading gap data requires integration:read.
 * - Acknowledging a gap requires integration:write.
 *
 * Access control is enforced via requireRole and tenant gating.
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import {
  integrationGapsAccess,
  integrationGapsTenant,
  gapSeverityEnum as GapSeverity,
  gapStatusEnum as GapStatus,
} from './integrationGapsSchema';
import { db } from '../../infrastructure/database/connection';
import { encryptionSecret } from '../../env';
import { integrationCredentials } from '../../infrastructure/database/schema';

const CATALOG_LIMIT = 50;

/**
 * Role constants for integration-specific permissions. These must be registered
 * as separate roles (via RBAC schema patches or builtins). For now they are used
 * in requireRole calls; if these roles are missing, they will throw.
 */
const RBAC_ROLES = {
  READ: 'integration:read',
  WRITE: 'integration:write',
  MANAGE: 'integration:manage',
} as const;

type RbacRole = (typeof RBAC_ROLES)[keyof typeof RBAC_ROLES];
const HONO_ENV = process.env.NODE_ENV || 'development';

/**
 * Integration read gate: require READ OR OWNER OR MANAGER.
 */
function integrationReadGate(c: HonoEnv) {
  const role = c.get('userRole') as TenantRole | null;
  if (role === TenantRole.OWNER || role === TenantRole.MANAGER) {
    return true;
  }
  return requireRole(RBAC_ROLES.READ)(c);
}

/** Integration write gate: require WRITE OR OWNER OR MANAGER. */
function integrationWriteGate(c: HonoEnv) {
  const role = c.get('userRole') as TenantRole | null;
  if (role === TenantRole.OWNER || role === TenantRole.MANAGER) {
    return true;
  }
  return requireRole(RBAC_ROLES.WRITE)(c);
}

/**
 * Integration manage gate: require MANAGE OR OWNER OR MANAGER.
 */
function integrationManageGate(c: HonoEnv) {
  const role = c.get('userRole') as TenantRole | null;
  if (role === TenantRole.OWNER || role === TenantRole.MANAGER) {
    return true;
  }
  return requireRole(RBAC_ROLES.MANAGE)(c);
}

/**
 * GET /api/integrations/:id/gaps
 *
 * Lists all gaps for a specific integration, respecting tenant and pagination.
 */
export function createIntegrationGapsController() {
  const router = new Hono<HonoEnv>();

  // Gating route: require READ or owner/manager, and also verify tenant
  router.use('*', authMiddleware);

  // Pre-check required RBAC roles
  router.use('*', integrationReadGate);
  router.use('*', integrationManageGate);

  router.get('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const integrationIdParam = c.req.param('id');
    const integrationId = Number(integrationIdParam);

    if (Number.isNaN(integrationId)) {
      return c.json({ error: 'Invalid integrationId' }, 400);
    }

    // Ensure integration belongs to this tenant
    const [cred] = await db
      .select({ id: integration_credentials.id, provider: integration_credentials.provider })
      .from(integration_credentials)
      .where(eq(integration_credentials.id, integrationId));

    if (!cred) {
      return c.json({ error: 'Integration not found' }, 404);
    }

    // Enforce tenant consistency for gaps
    if (cred.tenantId !== tenantId) {
      return c.json({ error: 'Integration not found in this workspace' }, 404);
    }

    // List up to CATALOG_LIMIT gap IDs to avoid excessive cross joins
    const integrationGapIds = await db
      .select({ id: integrationGaps.id })
      .from(integrationGaps)
      .where(eq(integrationGaps.integrationId, integrationId));

    // For an initial implementation, return a minimal structure with status and summary details
    const gaps = integrationGapIds.slice(0, CATALOG_LIMIT).map((g) => ({
      id: g.id,
      status: 'pending' as const, // placeholder pending real gap check implementation
    }));

    return c.json({
      gaps,
      staleChecks: [], // placeholder for staleCheckIds
    });
  });

  // PATCH /api/integrations/:id/gaps/:id/acknowledge
  router.patch('/:integrationId/gaps/:gapId/acknowledge', integrationWriteGate, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const integrationIdParam = c.req.param('integrationId');
    const gapIdParam = c.req.param('gapId');
    const integrationId = Number(integrationIdParam);
    const gapId = Number(gapIdParam);

    if (Number.isNaN(integrationId) || Number.isNaN(gapId)) {
      return c.json({ error: 'Invalid IDs' }, 400);
    }

    // Validate integration exists and belongs to this tenant
    const [cred] = await db
      .select({ id: integration_credentials.id, tenantId: integration_credentials.tenantId })
      .from(integration_credentials)
      .where(eq(integration_credentials.id, integrationId));

    if (!cred || cred.tenantId !== tenantId) {
      return c.json({ error: 'Integration not found in this workspace' }, 404);
    }

    // Find the gap; it may not exist yet, treat as a warning
    const [gap] = await db
      .select({ id: integrationGaps.id })
      .from(integrationGaps)
      .where(eq(integrationGaps.id, gapId));

    if (!gap) {
      return c.json({ error: 'Gap not found' }, 404);
    }

    // Acknowledge the gap: set acknowledgedAt and by
    const now = new Date();
    const userId = c.get('userId') as string;

    await db
      .update(integrationGaps)
      .set({
        acknowledgedAt: now,
        acknowledgedBy: userId,
        updatedAt: now,
      })
      .where(eq(integrationGaps.id, gapId));

    return c.json({ success: true });
  });

  return router;
}