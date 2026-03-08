import { Hono } from 'hono';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { TenantService } from '../../application/tenant/TenantService';
import { TenantRole, TenantBillingCycle } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { webAuthMiddleware } from '../middleware/webAuthMiddleware';
import type { Db } from '../../infrastructure/database/connection';
import {
  authTokens,
  authUserSessions,
  coderclawInstances,
  clawProjects,
  sourceControlIntegrations,
  tenantMembers,
  users,
} from '../../infrastructure/database/schema';

type SourceControlProvider = 'github' | 'bitbucket';

async function assertTenantMember(db: Db, tenantId: number, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: tenantMembers.id })
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.tenantId, tenantId),
        eq(tenantMembers.userId, userId),
        eq(tenantMembers.isActive, true),
      ),
    )
    .limit(1);

  return Boolean(row);
}

export function createTenantRoutes(tenantService: TenantService, db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // GET /api/tenants/mine  – WebJWT required; returns tenants the caller belongs to
  // Used by the tenant picker immediately after login (before a tenant JWT exists)
  router.get('/mine', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const result = await tenantService.listTenantsForUser(userId);
    return c.json({ tenants: result });
  });

  // POST /api/tenants/create  – WebJWT required; creates tenant + makes caller owner
  // Used from the tenant picker before the user has selected a tenant
  router.post('/create', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const body   = await c.req.json<{ name: string }>();
    if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
    const tenant = await tenantService.createTenant({ name: body.name, ownerUserId: userId });
    return c.json(tenant.toPlain(), 201);
  });

  // All routes below require a tenant-scoped JWT
  router.use('*', authMiddleware);

  // GET /api/tenants
  router.get('/', async (c) => {
    const tenants = await tenantService.listTenants();
    return c.json({ tenants: tenants.map(t => t.toPlain()) });
  });

  // GET /api/tenants/:id
  router.get('/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const tenant = await tenantService.getTenant(id);
    return c.json(tenant.toPlain());
  });

  // GET /api/tenants/:id/default-claw
  router.get('/:id/default-claw', async (c) => {
    const id = Number(c.req.param('id'));
    const callerTenantId = c.get('tenantId') as number;
    if (id !== callerTenantId) return c.json({ error: 'Forbidden' }, 403);
    const tenant = await tenantService.getTenant(id);
    return c.json({ defaultClawId: tenant.defaultClawId });
  });

  // PUT /api/tenants/:id/default-claw
  router.put('/:id/default-claw', requireRole(TenantRole.MANAGER), async (c) => {
    const id = Number(c.req.param('id'));
    const callerTenantId = c.get('tenantId') as number;
    if (id !== callerTenantId) return c.json({ error: 'Forbidden' }, 403);

    const body = await c.req.json<{ clawId?: number | null }>();
    const clawId = body.clawId ?? null;

    if (clawId !== null) {
      const [claw] = await db
        .select({ id: coderclawInstances.id })
        .from(coderclawInstances)
        .where(
          and(
            eq(coderclawInstances.id, clawId),
            eq(coderclawInstances.tenantId, id),
          ),
        )
        .limit(1);
      if (!claw) return c.json({ error: 'Claw not found in workspace' }, 404);
    }

    const tenant = await tenantService.setDefaultClaw(id, clawId);
    return c.json({ defaultClawId: tenant.defaultClawId });
  });

  // GET /api/tenants/:id/subscription
  router.get('/:id/subscription', async (c) => {
    const tenantId = Number(c.req.param('id'));
    const callerTenantId = c.get('tenantId') as number;
    if (tenantId !== callerTenantId) return c.json({ error: 'Forbidden' }, 403);

    const subscription = await tenantService.getSubscription(tenantId);
    return c.json(subscription);
  });

  // POST /api/tenants/:id/subscription/pro
  router.post('/:id/subscription/pro', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = Number(c.req.param('id'));
    const callerTenantId = c.get('tenantId') as number;
    if (tenantId !== callerTenantId) return c.json({ error: 'Forbidden' }, 403);

    const body = await c.req.json<{
      billingCycle: TenantBillingCycle;
      billingEmail: string;
      billingPaymentBrand: string;
      billingPaymentLast4: string;
    }>();

    if (
      !body.billingCycle ||
      !body.billingEmail ||
      !body.billingPaymentBrand ||
      !body.billingPaymentLast4
    ) {
      return c.json({ error: 'billingCycle, billingEmail, billingPaymentBrand and billingPaymentLast4 are required' }, 400);
    }

    const updated = await tenantService.activateProSubscription(tenantId, {
      billingCycle: body.billingCycle,
      billingEmail: body.billingEmail,
      billingPaymentBrand: body.billingPaymentBrand,
      billingPaymentLast4: body.billingPaymentLast4,
    });

    return c.json({ tenant: updated.toPlain() });
  });

  // POST /api/tenants/:id/subscription/free
  router.post('/:id/subscription/free', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = Number(c.req.param('id'));
    const callerTenantId = c.get('tenantId') as number;
    if (tenantId !== callerTenantId) return c.json({ error: 'Forbidden' }, 403);

    const updated = await tenantService.downgradeToFree(tenantId);
    return c.json({ tenant: updated.toPlain() });
  });

  // GET /api/tenants/:id/insights?days=30
  // Insights are available to all tenant plans (no enterprise gating).
  router.get('/:id/insights', async (c) => {
    const tenantId = Number(c.req.param('id'));
    const callerTenantId = c.get('tenantId') as number;
    if (tenantId !== callerTenantId) return c.json({ error: 'Forbidden' }, 403);

    const days = Math.max(1, Math.min(Number(c.req.query('days') ?? '30'), 90));

    const [totals] = (await db.execute(sql`
      SELECT
        COUNT(*)::int                            AS events,
        COALESCE(SUM(code_changes), 0)::bigint   AS code_changes,
        COUNT(DISTINCT user_id)::int             AS active_users
      FROM project_insight_events
      WHERE tenant_id = ${tenantId}
        AND created_at >= NOW() - (${days} || ' days')::interval
    `)).rows as Array<{
      events: number;
      code_changes: bigint;
      active_users: number;
    }>;

    const byProject = await db.execute(sql`
      SELECT
        p.id                                    AS project_id,
        p.name                                  AS project_name,
        COUNT(*)::int                           AS events,
        COALESCE(SUM(pie.code_changes), 0)::bigint AS code_changes,
        MAX(pie.created_at)::text               AS last_activity_at
      FROM project_insight_events pie
      INNER JOIN projects p ON p.id = pie.project_id
      WHERE pie.tenant_id = ${tenantId}
        AND pie.created_at >= NOW() - (${days} || ' days')::interval
      GROUP BY p.id, p.name
      ORDER BY code_changes DESC, events DESC
    `);

    const byDay = await db.execute(sql`
      SELECT
        DATE_TRUNC('day', created_at)::date::text AS day,
        COUNT(*)::int                              AS events,
        COALESCE(SUM(code_changes), 0)::bigint     AS code_changes
      FROM project_insight_events
      WHERE tenant_id = ${tenantId}
        AND created_at >= NOW() - (${days} || ' days')::interval
      GROUP BY DATE_TRUNC('day', created_at)
      ORDER BY DATE_TRUNC('day', created_at)
    `);

    return c.json({
      days,
      tenantId,
      totals: {
        events: Number(totals?.events ?? 0),
        codeChanges: Number(totals?.code_changes ?? 0),
        activeUsers: Number(totals?.active_users ?? 0),
      },
      byProject: byProject.rows,
      byDay: byDay.rows,
    });
  });

  // GET /api/tenants/:id/claws?status=online
  router.get('/:id/claws', async (c) => {
    const tenantId = Number(c.req.param('id'));
    const callerTenantId = c.get('tenantId') as number;
    if (tenantId !== callerTenantId) return c.json({ error: 'Forbidden' }, 403);

    const status = (c.req.query('status') ?? '').trim().toLowerCase();
    const rows = await db
      .select({
        id:           coderclawInstances.id,
        name:         coderclawInstances.name,
        slug:         coderclawInstances.slug,
        status:       coderclawInstances.status,
        connectedAt:  coderclawInstances.connectedAt,
        lastSeenAt:   coderclawInstances.lastSeenAt,
        capabilities: coderclawInstances.capabilities,
      })
      .from(coderclawInstances)
      .where(eq(coderclawInstances.tenantId, tenantId));

    const filtered = status === 'online'
      ? rows.filter((row) => row.connectedAt !== null)
      : rows;

    const claws = await Promise.all(
      filtered.map(async (row) => {
        const associatedProjects = await db
          .select({ projectId: clawProjects.projectId })
          .from(clawProjects)
          .where(
            and(
              eq(clawProjects.tenantId, tenantId),
              eq(clawProjects.clawId, row.id),
            ),
          );
        const capabilities: string[] = row.capabilities
          ? (JSON.parse(row.capabilities) as string[])
          : [];
        return {
          ...row,
          capabilities,
          capabilitySummary: {
            distributed: row.connectedAt !== null && associatedProjects.length > 1,
            remoteDispatch: row.connectedAt !== null && capabilities.includes('remote-dispatch'),
            projectCount: associatedProjects.length,
          },
          projectIds: associatedProjects.map((p) => p.projectId),
        };
      }),
    );

    return c.json({ claws });
  });

  // GET /api/tenants/:id/source-control-integrations
  router.get('/:id/source-control-integrations', async (c) => {
    const tenantId = Number(c.req.param('id'));
    const callerTenantId = c.get('tenantId') as number;
    if (tenantId !== callerTenantId) return c.json({ error: 'Forbidden' }, 403);

    const integrations = await db
      .select({
        id: sourceControlIntegrations.id,
        tenantId: sourceControlIntegrations.tenantId,
        provider: sourceControlIntegrations.provider,
        name: sourceControlIntegrations.name,
        accountIdentifier: sourceControlIntegrations.accountIdentifier,
        hostUrl: sourceControlIntegrations.hostUrl,
        isActive: sourceControlIntegrations.isActive,
        createdAt: sourceControlIntegrations.createdAt,
        updatedAt: sourceControlIntegrations.updatedAt,
      })
      .from(sourceControlIntegrations)
      .where(eq(sourceControlIntegrations.tenantId, tenantId));

    return c.json({ integrations });
  });

  // POST /api/tenants/:id/source-control-integrations
  router.post('/:id/source-control-integrations', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = Number(c.req.param('id'));
    const callerTenantId = c.get('tenantId') as number;
    if (tenantId !== callerTenantId) return c.json({ error: 'Forbidden' }, 403);

    const body = await c.req.json<{
      provider: SourceControlProvider;
      name: string;
      accountIdentifier: string;
      hostUrl?: string | null;
      isActive?: boolean;
    }>();

    if (body.provider !== 'github' && body.provider !== 'bitbucket') {
      return c.json({ error: 'provider must be github or bitbucket' }, 400);
    }

    if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
    if (!body.accountIdentifier?.trim()) return c.json({ error: 'accountIdentifier is required' }, 400);

    const [created] = await db
      .insert(sourceControlIntegrations)
      .values({
        tenantId,
        provider: body.provider,
        name: body.name.trim(),
        accountIdentifier: body.accountIdentifier.trim(),
        hostUrl: body.hostUrl?.trim() || null,
        isActive: body.isActive ?? true,
      })
      .returning();

    return c.json(created, 201);
  });

  // PATCH /api/tenants/:id/source-control-integrations/:integrationId
  router.patch('/:id/source-control-integrations/:integrationId', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = Number(c.req.param('id'));
    const callerTenantId = c.get('tenantId') as number;
    if (tenantId !== callerTenantId) return c.json({ error: 'Forbidden' }, 403);

    const integrationId = Number(c.req.param('integrationId'));
    if (!Number.isFinite(integrationId) || integrationId <= 0) {
      return c.json({ error: 'integrationId must be a positive number' }, 400);
    }

    const body = await c.req.json<{
      provider?: SourceControlProvider;
      name?: string;
      accountIdentifier?: string;
      hostUrl?: string | null;
      isActive?: boolean;
    }>();

    if (body.provider !== undefined && body.provider !== 'github' && body.provider !== 'bitbucket') {
      return c.json({ error: 'provider must be github or bitbucket' }, 400);
    }

    const [existing] = await db
      .select({ id: sourceControlIntegrations.id })
      .from(sourceControlIntegrations)
      .where(
        and(
          eq(sourceControlIntegrations.id, integrationId),
          eq(sourceControlIntegrations.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!existing) return c.json({ error: 'Integration not found' }, 404);

    const [updated] = await db
      .update(sourceControlIntegrations)
      .set({
        ...(body.provider !== undefined && { provider: body.provider }),
        ...(body.name !== undefined && { name: body.name.trim() }),
        ...(body.accountIdentifier !== undefined && { accountIdentifier: body.accountIdentifier.trim() }),
        ...(body.hostUrl !== undefined && { hostUrl: body.hostUrl?.trim() || null }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(sourceControlIntegrations.id, integrationId),
          eq(sourceControlIntegrations.tenantId, tenantId),
        ),
      )
      .returning();

    return c.json(updated);
  });

  // DELETE /api/tenants/:id/source-control-integrations/:integrationId
  router.delete('/:id/source-control-integrations/:integrationId', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = Number(c.req.param('id'));
    const callerTenantId = c.get('tenantId') as number;
    if (tenantId !== callerTenantId) return c.json({ error: 'Forbidden' }, 403);

    const integrationId = Number(c.req.param('integrationId'));
    if (!Number.isFinite(integrationId) || integrationId <= 0) {
      return c.json({ error: 'integrationId must be a positive number' }, 400);
    }

    await db
      .delete(sourceControlIntegrations)
      .where(
        and(
          eq(sourceControlIntegrations.id, integrationId),
          eq(sourceControlIntegrations.tenantId, tenantId),
        ),
      );

    return c.body(null, 204);
  });

  // POST /api/tenants – create another tenant (caller must have a valid tenant JWT already)
  router.post('/', async (c) => {
    const userId = c.get('userId') as string;
    const body   = await c.req.json<{ name: string }>();
    if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
    const tenant = await tenantService.createTenant({ name: body.name, ownerUserId: userId });
    return c.json(tenant.toPlain(), 201);
  });

  // POST /api/tenants/:id/members
  router.post('/:id/members', requireRole(TenantRole.MANAGER), async (c) => {
    const id   = Number(c.req.param('id'));
    const body = await c.req.json<{ newUserId: string; role: TenantRole }>();
    const actorUserId = c.get('userId') as string;
    const tenant = await tenantService.addMember(id, actorUserId, body.newUserId, body.role);
    return c.json(tenant.toPlain());
  });

  // DELETE /api/tenants/:id/members/:userId
  router.delete('/:id/members/:userId', requireRole(TenantRole.MANAGER), async (c) => {
    const id           = Number(c.req.param('id'));
    const targetUserId = c.req.param('userId');
    const actorUserId  = c.get('userId') as string;
    const tenant = await tenantService.removeMember(id, actorUserId, targetUserId);
    return c.json(tenant.toPlain());
  });

  // GET /api/tenants/:id/security/users
  router.get('/:id/security/users', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = Number(c.req.param('id'));
    const callerTenantId = c.get('tenantId') as number;
    if (tenantId !== callerTenantId) return c.json({ error: 'Forbidden' }, 403);

    const memberRows = await db
      .select({
        userId: users.id,
        email: users.email,
        username: users.username,
        displayName: users.displayName,
        mfaEnabled: users.mfaEnabled,
        mfaEnabledAt: users.mfaEnabledAt,
      })
      .from(tenantMembers)
      .innerJoin(users, eq(users.id, tenantMembers.userId))
      .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.isActive, true)));

    const userIds = memberRows.map((row) => row.userId);

    const sessionCounts = userIds.length
      ? await db
        .select({ userId: authUserSessions.userId, count: sql<number>`COUNT(*)` })
        .from(authUserSessions)
        .where(and(inArray(authUserSessions.userId, userIds), eq(authUserSessions.isActive, true)))
        .groupBy(authUserSessions.userId)
      : [];

    const tokenCounts = userIds.length
      ? await db
        .select({ userId: authTokens.userId, count: sql<number>`COUNT(*)` })
        .from(authTokens)
        .where(
          and(
            inArray(authTokens.userId, userIds),
            isNull(authTokens.revokedAt),
            gt(authTokens.expiresAt, new Date()),
          ),
        )
        .groupBy(authTokens.userId)
      : [];

    const sessionsByUser = new Map<string, number>();
    for (const row of sessionCounts) sessionsByUser.set(row.userId, Number(row.count));

    const tokensByUser = new Map<string, number>();
    for (const row of tokenCounts) tokensByUser.set(row.userId, Number(row.count));

    return c.json({
      users: memberRows.map((row) => ({
        id: row.userId,
        email: row.email,
        username: row.username,
        displayName: row.displayName,
        mfaEnabled: row.mfaEnabled,
        mfaEnabledAt: row.mfaEnabledAt,
        activeSessions: sessionsByUser.get(row.userId) ?? 0,
        activeTokens: tokensByUser.get(row.userId) ?? 0,
      })),
    });
  });

  // GET /api/tenants/:id/security/users/:userId
  router.get('/:id/security/users/:userId', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = Number(c.req.param('id'));
    const callerTenantId = c.get('tenantId') as number;
    if (tenantId !== callerTenantId) return c.json({ error: 'Forbidden' }, 403);

    const userId = c.req.param('userId');
    if (!userId) return c.json({ error: 'userId is required' }, 400);

    const isMember = await assertTenantMember(db, tenantId, userId);
    if (!isMember) return c.json({ error: 'User is not an active member of this tenant' }, 404);

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        username: users.username,
        displayName: users.displayName,
        mfaEnabled: users.mfaEnabled,
        mfaTempExpiresAt: users.mfaTempExpiresAt,
        mfaEnabledAt: users.mfaEnabledAt,
        mfaRecoveryGeneratedAt: users.mfaRecoveryGeneratedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return c.json({ error: 'User not found' }, 404);

    const sessions = await db
      .select()
      .from(authUserSessions)
      .where(eq(authUserSessions.userId, userId))
      .orderBy(desc(authUserSessions.lastSeenAt));

    const sessionIds = sessions.map((session) => session.id);
    const tokenRows = sessionIds.length
      ? await db
        .select({
          sessionId: authTokens.sessionId,
          activeCount: sql<number>`COUNT(*)`,
        })
        .from(authTokens)
        .where(
          and(
            eq(authTokens.userId, userId),
            inArray(authTokens.sessionId, sessionIds),
            isNull(authTokens.revokedAt),
            gt(authTokens.expiresAt, new Date()),
          ),
        )
        .groupBy(authTokens.sessionId)
      : [];

    const activeBySession = new Map<string, number>();
    for (const row of tokenRows) {
      if (!row.sessionId) continue;
      activeBySession.set(row.sessionId, Number(row.activeCount));
    }

    const tokenDetails = await db
      .select({
        jti: authTokens.jti,
        tokenType: authTokens.tokenType,
        tenantId: authTokens.tenantId,
        sessionId: authTokens.sessionId,
        issuedAt: authTokens.issuedAt,
        expiresAt: authTokens.expiresAt,
        revokedAt: authTokens.revokedAt,
        userAgent: authTokens.userAgent,
        ipAddress: authTokens.ipAddress,
        lastSeenAt: authTokens.lastSeenAt,
      })
      .from(authTokens)
      .where(eq(authTokens.userId, userId))
      .orderBy(desc(authTokens.lastSeenAt));

    return c.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
      },
      mfa: {
        enabled: user.mfaEnabled,
        setupPending: Boolean(user.mfaTempExpiresAt && user.mfaTempExpiresAt > new Date()),
        enabledAt: user.mfaEnabledAt,
        recoveryGeneratedAt: user.mfaRecoveryGeneratedAt,
      },
      sessions: sessions.map((session) => ({
        id: session.id,
        sessionName: session.sessionName,
        userAgent: session.userAgent,
        ipAddress: session.ipAddress,
        isActive: session.isActive,
        revokedAt: session.revokedAt,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        activeTokens: activeBySession.get(session.id) ?? 0,
      })),
      tokens: tokenDetails.map((row) => ({
        ...row,
        isActive: !row.revokedAt && row.expiresAt > new Date(),
      })),
    });
  });

  // POST /api/tenants/:id/security/users/:userId/sessions/:sessionId/revoke
  router.post('/:id/security/users/:userId/sessions/:sessionId/revoke', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = Number(c.req.param('id'));
    const callerTenantId = c.get('tenantId') as number;
    if (tenantId !== callerTenantId) return c.json({ error: 'Forbidden' }, 403);

    const userId = c.req.param('userId');
    const sessionId = c.req.param('sessionId');
    if (!userId || !sessionId) return c.json({ error: 'userId and sessionId are required' }, 400);

    const isMember = await assertTenantMember(db, tenantId, userId);
    if (!isMember) return c.json({ error: 'User is not an active member of this tenant' }, 404);

    await db
      .update(authUserSessions)
      .set({ isActive: false, revokedAt: sql`now()`, lastSeenAt: sql`now()` })
      .where(and(eq(authUserSessions.id, sessionId), eq(authUserSessions.userId, userId)));

    await db
      .update(authTokens)
      .set({ revokedAt: sql`now()`, lastSeenAt: sql`now()` })
      .where(and(eq(authTokens.userId, userId), eq(authTokens.sessionId, sessionId), isNull(authTokens.revokedAt)));

    return c.json({ ok: true });
  });

  // POST /api/tenants/:id/security/users/:userId/sessions/revoke-all
  router.post('/:id/security/users/:userId/sessions/revoke-all', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = Number(c.req.param('id'));
    const callerTenantId = c.get('tenantId') as number;
    if (tenantId !== callerTenantId) return c.json({ error: 'Forbidden' }, 403);

    const userId = c.req.param('userId');
    if (!userId) return c.json({ error: 'userId is required' }, 400);

    const isMember = await assertTenantMember(db, tenantId, userId);
    if (!isMember) return c.json({ error: 'User is not an active member of this tenant' }, 404);

    await db
      .update(authUserSessions)
      .set({ isActive: false, revokedAt: sql`now()`, lastSeenAt: sql`now()` })
      .where(and(eq(authUserSessions.userId, userId), eq(authUserSessions.isActive, true)));

    await db
      .update(authTokens)
      .set({ revokedAt: sql`now()`, lastSeenAt: sql`now()` })
      .where(and(eq(authTokens.userId, userId), isNull(authTokens.revokedAt)));

    return c.json({ ok: true });
  });

  // POST /api/tenants/:id/security/users/:userId/tokens/:jti/revoke
  router.post('/:id/security/users/:userId/tokens/:jti/revoke', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = Number(c.req.param('id'));
    const callerTenantId = c.get('tenantId') as number;
    if (tenantId !== callerTenantId) return c.json({ error: 'Forbidden' }, 403);

    const userId = c.req.param('userId');
    const jti = c.req.param('jti');
    if (!userId || !jti) return c.json({ error: 'userId and jti are required' }, 400);

    const isMember = await assertTenantMember(db, tenantId, userId);
    if (!isMember) return c.json({ error: 'User is not an active member of this tenant' }, 404);

    await db
      .update(authTokens)
      .set({ revokedAt: sql`now()`, lastSeenAt: sql`now()` })
      .where(and(eq(authTokens.userId, userId), eq(authTokens.jti, jti), isNull(authTokens.revokedAt)));

    return c.json({ ok: true });
  });

  // DELETE /api/tenants/:id
  router.delete('/:id', requireRole(TenantRole.OWNER), async (c) => {
    const id = Number(c.req.param('id'));
    await tenantService.deleteTenant(id);
    return c.body(null, 204);
  });

  return router;
}
