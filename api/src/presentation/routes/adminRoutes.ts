/**
 * Superadmin routes — /api/admin/*
 *
 * All routes require a WebJWT with sa: true (enforced by superAdminMiddleware).
 *
 * GET  /api/admin/users                — all platform users + tenant counts
 * GET  /api/admin/tenants              — all tenants + member/claw counts
 * GET  /api/admin/health               — system health (DB ping, model pool, counts)
 * GET  /api/admin/errors               — recent API error log (last 200 entries)
 * POST /api/admin/impersonate          — issue a tenant JWT for any user+tenant pair
 */
import { Hono } from 'hono';
import { and, desc, eq, gt, ilike, inArray, isNull, sql } from 'drizzle-orm';
import type { HonoEnv } from '../../env';
import { superAdminMiddleware } from '../middleware/superAdminMiddleware';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import {
  authTokens,
  authUserSessions,
  legalDocuments,
  privacyRequests,
  newsletterEvents,
  newsletterSubscribers,
  newsletterTemplates,
  users,
  tenants,
  tenantMembers,
  coderclawInstances,
  apiErrorLog,
  llmUsageLog,
  userMfaRecoveryCodes,
} from '../../infrastructure/database/schema';
import { signJwt } from '../../infrastructure/auth/JwtService';
import { LlmProxyService, FREE_MODEL_POOL, PRO_PAID_MODEL_POOL, PREFERRED_POOL_SIZE } from '../../application/llm/LlmProxyService';
import { llmFailoverLog } from '../../infrastructure/database/schema';
import {
  buildOtpAuthUrl,
  decryptSecretFromStorage,
  encryptSecretForStorage,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
  verifyTotpCode,
} from '../../infrastructure/auth/MfaService';

type LegalDocResponse = {
  documentType: 'terms' | 'privacy';
  version: string;
  title: string;
  content: string;
  publishedAt: string;
};

type PrivacyRequestStatus = 'pending' | 'completed' | 'closed';
type PrivacyRequestType = 'ccpa' | 'gdpr';

function isPrivacyRequestStatus(value: string): value is PrivacyRequestStatus {
  return value === 'pending' || value === 'completed' || value === 'closed';
}

function isPrivacyRequestType(value: string): value is PrivacyRequestType {
  return value === 'ccpa' || value === 'gdpr';
}

const DEFAULT_LEGAL: Record<'terms' | 'privacy', Omit<LegalDocResponse, 'documentType'>> = {
  terms: {
    version: '1.0.0',
    title: 'Terms of Use',
    content: 'By using CoderClawLink, you agree to these Terms of Use. Continued use of the service indicates acceptance of current terms.',
    publishedAt: new Date(0).toISOString(),
  },
  privacy: {
    version: '1.0.0',
    title: 'Privacy Policy',
    content: 'CoderClawLink processes account, usage, and operational metadata to provide and secure the service.',
    publishedAt: new Date(0).toISOString(),
  },
};

async function getActiveLegalDoc(db: Db, documentType: 'terms' | 'privacy'): Promise<LegalDocResponse> {
  const [doc] = await db
    .select({
      version: legalDocuments.version,
      title: legalDocuments.title,
      content: legalDocuments.content,
      publishedAt: legalDocuments.publishedAt,
    })
    .from(legalDocuments)
    .where(and(eq(legalDocuments.documentType, documentType), eq(legalDocuments.isActive, true)))
    .orderBy(desc(legalDocuments.publishedAt))
    .limit(1);

  if (!doc) {
    return {
      documentType,
      ...DEFAULT_LEGAL[documentType],
    };
  }

  return {
    documentType,
    version: doc.version,
    title: doc.title,
    content: doc.content,
    publishedAt: doc.publishedAt ? doc.publishedAt.toISOString() : new Date().toISOString(),
  };
}

function parseTenantId(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function slugifyName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);
}

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

async function assertMfa(
  db: Db,
  envSecret: string,
  user: typeof users.$inferSelect,
  code?: string,
  recoveryCode?: string,
): Promise<boolean> {
  if (!user.mfaEnabled || !user.mfaSecretEnc) return false;

  if (code) {
    const secret = await decryptSecretFromStorage(user.mfaSecretEnc, envSecret);
    const validTotp = await verifyTotpCode(secret, code);
    if (validTotp) return true;
  }

  if (recoveryCode) {
    const normalized = normalizeRecoveryCode(recoveryCode);
    const hash = await hashRecoveryCode(normalized);
    const [stored] = await db
      .select({ id: userMfaRecoveryCodes.id })
      .from(userMfaRecoveryCodes)
      .where(
        and(
          eq(userMfaRecoveryCodes.userId, user.id),
          eq(userMfaRecoveryCodes.codeHash, hash),
          isNull(userMfaRecoveryCodes.usedAt),
        ),
      )
      .limit(1);

    if (stored) {
      await db
        .update(userMfaRecoveryCodes)
        .set({ usedAt: sql`now()` })
        .where(eq(userMfaRecoveryCodes.id, stored.id));
      return true;
    }
  }

  return false;
}

async function replaceRecoveryCodes(db: Db, userId: string, codes: string[]) {
  await db.delete(userMfaRecoveryCodes).where(eq(userMfaRecoveryCodes.userId, userId));
  const hashed = await Promise.all(
    codes.map(async (code) => ({
      userId,
      codeHash: await hashRecoveryCode(code),
    })),
  );
  await db.insert(userMfaRecoveryCodes).values(hashed);
}

export function createAdminRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // All admin routes require superadmin WebJWT
  router.use('*', superAdminMiddleware);

  // -------------------------------------------------------------------------
  // GET /api/admin/legal/current
  // -------------------------------------------------------------------------
  router.get('/legal/current', async (c) => {
    const db = buildDatabase(c.env);
    const [terms, privacy] = await Promise.all([
      getActiveLegalDoc(db, 'terms'),
      getActiveLegalDoc(db, 'privacy'),
    ]);
    return c.json({ terms, privacy });
  });

  // -------------------------------------------------------------------------
  // POST /api/admin/legal/terms/publish
  // -------------------------------------------------------------------------
  router.post('/legal/terms/publish', async (c) => {
    const db = buildDatabase(c.env);
    const actorUserId = c.get('userId') as string;
    const body = await c.req.json<{ version: string; title?: string; content: string }>();

    const version = body.version?.trim();
    const content = body.content?.trim();
    const title = body.title?.trim() || 'Terms of Use';

    if (!version) return c.json({ error: 'version is required' }, 400);
    if (!content) return c.json({ error: 'content is required' }, 400);

    const [existing] = await db
      .select({ id: legalDocuments.id })
      .from(legalDocuments)
      .where(
        and(
          eq(legalDocuments.documentType, 'terms'),
          eq(legalDocuments.version, version),
        ),
      )
      .limit(1);

    if (existing) {
      return c.json({ error: `Terms version ${version} already exists` }, 409);
    }

    await db
      .update(legalDocuments)
      .set({ isActive: false, updatedAt: sql`now()` })
      .where(and(eq(legalDocuments.documentType, 'terms'), eq(legalDocuments.isActive, true)));

    await db.insert(legalDocuments).values({
      documentType: 'terms',
      version,
      title,
      content,
      isActive: true,
      publishedBy: actorUserId,
    });

    const terms = await getActiveLegalDoc(db, 'terms');
    return c.json({ terms }, 201);
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/newsletter/subscribers
  // -------------------------------------------------------------------------
  router.get('/newsletter/subscribers', async (c) => {
    const db = buildDatabase(c.env);
    const status = c.req.query('status')?.trim();
    const q = c.req.query('q')?.trim();
    const limit = Math.min(parsePositiveInt(c.req.query('limit'), 200), 1000);

    const filters = [
      status ? eq(newsletterSubscribers.status, status as 'subscribed' | 'unsubscribed' | 'suppressed') : null,
      q ? ilike(newsletterSubscribers.email, `%${q}%`) : null,
    ].filter(Boolean) as Array<ReturnType<typeof eq>>;

    const rows = await db
      .select({
        id: newsletterSubscribers.id,
        userId: newsletterSubscribers.userId,
        email: newsletterSubscribers.email,
        firstName: newsletterSubscribers.firstName,
        lastName: newsletterSubscribers.lastName,
        source: newsletterSubscribers.source,
        status: newsletterSubscribers.status,
        subscribedAt: newsletterSubscribers.subscribedAt,
        unsubscribedAt: newsletterSubscribers.unsubscribedAt,
        unsubscribeReason: newsletterSubscribers.unsubscribeReason,
        lastCommunicationAt: newsletterSubscribers.lastCommunicationAt,
        createdAt: newsletterSubscribers.createdAt,
        updatedAt: newsletterSubscribers.updatedAt,
        userDisplayName: users.displayName,
        userUsername: users.username,
      })
      .from(newsletterSubscribers)
      .leftJoin(users, eq(newsletterSubscribers.userId, users.id))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(newsletterSubscribers.updatedAt))
      .limit(limit);

    return c.json({
      subscribers: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        email: row.email,
        firstName: row.firstName,
        lastName: row.lastName,
        source: row.source,
        status: row.status,
        subscribedAt: row.subscribedAt?.toISOString() ?? null,
        unsubscribedAt: row.unsubscribedAt?.toISOString() ?? null,
        unsubscribeReason: row.unsubscribeReason,
        lastCommunicationAt: row.lastCommunicationAt?.toISOString() ?? null,
        createdAt: row.createdAt?.toISOString() ?? null,
        updatedAt: row.updatedAt?.toISOString() ?? null,
        userDisplayName: row.userDisplayName,
        userUsername: row.userUsername,
      })),
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/newsletter/templates
  // -------------------------------------------------------------------------
  router.get('/newsletter/templates', async (c) => {
    const db = buildDatabase(c.env);
    const templates = await db
      .select({
        id: newsletterTemplates.id,
        name: newsletterTemplates.name,
        slug: newsletterTemplates.slug,
        subject: newsletterTemplates.subject,
        preheader: newsletterTemplates.preheader,
        bodyMarkdown: newsletterTemplates.bodyMarkdown,
        isActive: newsletterTemplates.isActive,
        createdAt: newsletterTemplates.createdAt,
        updatedAt: newsletterTemplates.updatedAt,
      })
      .from(newsletterTemplates)
      .orderBy(desc(newsletterTemplates.updatedAt));

    return c.json({
      templates: templates.map((template) => ({
        ...template,
        createdAt: template.createdAt?.toISOString() ?? null,
        updatedAt: template.updatedAt?.toISOString() ?? null,
      })),
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/admin/newsletter/templates
  // -------------------------------------------------------------------------
  router.post('/newsletter/templates', async (c) => {
    const db = buildDatabase(c.env);
    const actorUserId = c.get('userId') as string;
    const body = await c.req.json<{
      name?: string;
      slug?: string;
      subject?: string;
      preheader?: string;
      bodyMarkdown?: string;
      isActive?: boolean;
    }>();

    const name = body.name?.trim() ?? '';
    const subject = body.subject?.trim() ?? '';
    const bodyMarkdown = body.bodyMarkdown?.trim() ?? '';
    const slug = (body.slug?.trim() || slugifyName(name));
    const preheader = body.preheader?.trim() || null;
    const isActive = body.isActive ?? true;

    if (!name) return c.json({ error: 'name is required' }, 400);
    if (!subject) return c.json({ error: 'subject is required' }, 400);
    if (!bodyMarkdown) return c.json({ error: 'bodyMarkdown is required' }, 400);
    if (!slug) return c.json({ error: 'slug is required' }, 400);

    const [existing] = await db
      .select({ id: newsletterTemplates.id })
      .from(newsletterTemplates)
      .where(eq(newsletterTemplates.slug, slug))
      .limit(1);
    if (existing) return c.json({ error: `Template slug '${slug}' already exists` }, 409);

    const [created] = await db
      .insert(newsletterTemplates)
      .values({
        name,
        slug,
        subject,
        preheader,
        bodyMarkdown,
        isActive,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      })
      .returning();

    if (!created) return c.json({ error: 'Failed to create template' }, 500);

    return c.json({
      template: {
        ...created,
        createdAt: created.createdAt?.toISOString() ?? null,
        updatedAt: created.updatedAt?.toISOString() ?? null,
      },
    }, 201);
  });

  // -------------------------------------------------------------------------
  // PATCH /api/admin/newsletter/templates/:id
  // -------------------------------------------------------------------------
  router.patch('/newsletter/templates/:id', async (c) => {
    const db = buildDatabase(c.env);
    const actorUserId = c.get('userId') as string;
    const templateId = Number(c.req.param('id'));
    if (!Number.isFinite(templateId) || templateId <= 0) {
      return c.json({ error: 'Invalid template id' }, 400);
    }

    const body = await c.req.json<{
      name?: string;
      slug?: string;
      subject?: string;
      preheader?: string | null;
      bodyMarkdown?: string;
      isActive?: boolean;
    }>();

    const patch: Partial<typeof newsletterTemplates.$inferInsert> = {
      updatedBy: actorUserId,
      updatedAt: new Date(),
    };

    if (typeof body.name === 'string') patch.name = body.name.trim();
    if (typeof body.slug === 'string') patch.slug = body.slug.trim();
    if (typeof body.subject === 'string') patch.subject = body.subject.trim();
    if (typeof body.preheader === 'string') patch.preheader = body.preheader.trim();
    if (body.preheader === null) patch.preheader = null;
    if (typeof body.bodyMarkdown === 'string') patch.bodyMarkdown = body.bodyMarkdown.trim();
    if (typeof body.isActive === 'boolean') patch.isActive = body.isActive;

    const [updated] = await db
      .update(newsletterTemplates)
      .set(patch)
      .where(eq(newsletterTemplates.id, templateId))
      .returning();

    if (!updated) return c.json({ error: 'Template not found' }, 404);

    return c.json({
      template: {
        ...updated,
        createdAt: updated.createdAt?.toISOString() ?? null,
        updatedAt: updated.updatedAt?.toISOString() ?? null,
      },
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/newsletter/events
  // -------------------------------------------------------------------------
  router.get('/newsletter/events', async (c) => {
    const db = buildDatabase(c.env);
    const limit = Math.min(parsePositiveInt(c.req.query('limit'), 300), 1000);

    const rows = await db
      .select({
        id: newsletterEvents.id,
        eventType: newsletterEvents.eventType,
        metadata: newsletterEvents.metadata,
        createdAt: newsletterEvents.createdAt,
        subscriberId: newsletterSubscribers.id,
        email: newsletterSubscribers.email,
        templateId: newsletterTemplates.id,
        templateName: newsletterTemplates.name,
        templateSlug: newsletterTemplates.slug,
      })
      .from(newsletterEvents)
      .innerJoin(newsletterSubscribers, eq(newsletterEvents.subscriberId, newsletterSubscribers.id))
      .leftJoin(newsletterTemplates, eq(newsletterEvents.templateId, newsletterTemplates.id))
      .orderBy(desc(newsletterEvents.createdAt))
      .limit(limit);

    return c.json({
      events: rows.map((row) => ({
        id: row.id,
        eventType: row.eventType,
        metadata: row.metadata,
        createdAt: row.createdAt?.toISOString() ?? null,
        subscriberId: row.subscriberId,
        email: row.email,
        templateId: row.templateId,
        templateName: row.templateName,
        templateSlug: row.templateSlug,
      })),
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/privacy-requests
  // -------------------------------------------------------------------------
  router.get('/privacy-requests', async (c) => {
    const db = buildDatabase(c.env);
    const statusRaw = c.req.query('status')?.trim();
    const typeRaw = c.req.query('type')?.trim();
    const status = statusRaw && isPrivacyRequestStatus(statusRaw) ? statusRaw : undefined;
    const type = typeRaw && isPrivacyRequestType(typeRaw) ? typeRaw : undefined;
    const q = c.req.query('q')?.trim();
    const limit = Math.min(parsePositiveInt(c.req.query('limit'), 200), 1000);

    const filters = [
      status ? eq(privacyRequests.status, status) : null,
      type ? eq(privacyRequests.requestType, type) : null,
      q ? ilike(privacyRequests.email, `%${q}%`) : null,
    ].filter(Boolean) as Array<ReturnType<typeof eq>>;

    const rows = await db
      .select({
        id: privacyRequests.id,
        userId: privacyRequests.userId,
        email: privacyRequests.email,
        requestType: privacyRequests.requestType,
        status: privacyRequests.status,
        details: privacyRequests.details,
        resolution: privacyRequests.resolution,
        createdAt: privacyRequests.createdAt,
        updatedAt: privacyRequests.updatedAt,
        closedAt: privacyRequests.closedAt,
      })
      .from(privacyRequests)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(privacyRequests.updatedAt))
      .limit(limit);

    return c.json({
      requests: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        email: row.email,
        requestType: row.requestType,
        status: row.status,
        details: row.details,
        resolution: row.resolution,
        createdAt: row.createdAt?.toISOString() ?? null,
        updatedAt: row.updatedAt?.toISOString() ?? null,
        closedAt: row.closedAt?.toISOString() ?? null,
      })),
    });
  });

  // -------------------------------------------------------------------------
  // PATCH /api/admin/privacy-requests/:id
  // -------------------------------------------------------------------------
  router.patch('/privacy-requests/:id', async (c) => {
    const db = buildDatabase(c.env);
    const requestId = Number(c.req.param('id'));
    if (!Number.isFinite(requestId) || requestId <= 0) {
      return c.json({ error: 'Invalid request id' }, 400);
    }

    const body = await c.req.json<{
      status?: PrivacyRequestStatus;
      resolution?: string | null;
    }>();

    const patch: Partial<typeof privacyRequests.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (typeof body.status === 'string' && isPrivacyRequestStatus(body.status)) {
      patch.status = body.status;
    }
    if (typeof body.resolution === 'string') patch.resolution = body.resolution.trim() || null;
    if (body.resolution === null) patch.resolution = null;
    if (body.status && body.status !== 'pending') {
      patch.closedAt = new Date();
    }

    const [updated] = await db
      .update(privacyRequests)
      .set(patch)
      .where(eq(privacyRequests.id, requestId))
      .returning();

    if (!updated) return c.json({ error: 'Privacy request not found' }, 404);

    return c.json({
      request: {
        ...updated,
        createdAt: updated.createdAt?.toISOString() ?? null,
        updatedAt: updated.updatedAt?.toISOString() ?? null,
        closedAt: updated.closedAt?.toISOString() ?? null,
      },
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/admin/newsletter/events
  // -------------------------------------------------------------------------
  router.post('/newsletter/events', async (c) => {
    const db = buildDatabase(c.env);
    const body = await c.req.json<{
      subscriberEmail?: string;
      templateId?: number | null;
      eventType?: 'template_sent' | 'email_opened' | 'email_clicked';
      metadata?: string;
    }>();

    const email = body.subscriberEmail?.trim().toLowerCase();
    const eventType = body.eventType;
    if (!email || !email.includes('@')) return c.json({ error: 'subscriberEmail is required' }, 400);
    if (!eventType) return c.json({ error: 'eventType is required' }, 400);

    const [subscriber] = await db
      .select({ id: newsletterSubscribers.id })
      .from(newsletterSubscribers)
      .where(eq(newsletterSubscribers.email, email))
      .limit(1);
    if (!subscriber) return c.json({ error: 'Subscriber not found' }, 404);

    await db.insert(newsletterEvents).values({
      subscriberId: subscriber.id,
      templateId: body.templateId ?? null,
      eventType,
      metadata: body.metadata ?? null,
    });

    if (eventType === 'template_sent') {
      await db
        .update(newsletterSubscribers)
        .set({ lastCommunicationAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(newsletterSubscribers.id, subscriber.id));
    }

    return c.json({ ok: true }, 201);
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/security/users?tenantId=123
  // -------------------------------------------------------------------------
  router.get('/security/users', async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = parseTenantId(c.req.query('tenantId'));
    if (!tenantId) return c.json({ error: 'tenantId is required' }, 400);

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

  // -------------------------------------------------------------------------
  // GET /api/admin/security/users/:userId?tenantId=123
  // -------------------------------------------------------------------------
  router.get('/security/users/:userId', async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = parseTenantId(c.req.query('tenantId'));
    const userId = c.req.param('userId');
    if (!tenantId) return c.json({ error: 'tenantId is required' }, 400);
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

  // -------------------------------------------------------------------------
  // POST /api/admin/security/users/:userId/mfa/setup?tenantId=123
  // -------------------------------------------------------------------------
  router.post('/security/users/:userId/mfa/setup', async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = parseTenantId(c.req.query('tenantId'));
    const userId = c.req.param('userId');
    if (!tenantId) return c.json({ error: 'tenantId is required' }, 400);
    if (!userId) return c.json({ error: 'userId is required' }, 400);

    const isMember = await assertTenantMember(db, tenantId, userId);
    if (!isMember) return c.json({ error: 'User is not an active member of this tenant' }, 404);

    const [user] = await db
      .select({ id: users.id, email: users.email, mfaEnabled: users.mfaEnabled })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return c.json({ error: 'User not found' }, 404);
    if (user.mfaEnabled) return c.json({ error: 'MFA is already enabled' }, 409);

    const secret = generateTotpSecret();
    const encrypted = await encryptSecretForStorage(secret, c.env.JWT_SECRET);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await db
      .update(users)
      .set({
        mfaTempSecretEnc: encrypted,
        mfaTempExpiresAt: expiresAt,
        updatedAt: sql`now()`,
      })
      .where(eq(users.id, user.id));

    const otpauthUrl = buildOtpAuthUrl({
      accountName: user.email,
      secret,
      issuer: 'CoderClawLink',
    });

    return c.json({
      otpauthUrl,
      manualEntryKey: secret,
      expiresIn: 600,
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/admin/security/users/:userId/mfa/enable?tenantId=123
  // -------------------------------------------------------------------------
  router.post('/security/users/:userId/mfa/enable', async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = parseTenantId(c.req.query('tenantId'));
    const userId = c.req.param('userId');
    const body = await c.req.json<{ code: string }>();
    if (!tenantId) return c.json({ error: 'tenantId is required' }, 400);
    if (!userId) return c.json({ error: 'userId is required' }, 400);
    if (!body.code) return c.json({ error: 'code is required' }, 400);

    const isMember = await assertTenantMember(db, tenantId, userId);
    if (!isMember) return c.json({ error: 'User is not an active member of this tenant' }, 404);

    const [user] = await db
      .select({
        id: users.id,
        mfaEnabled: users.mfaEnabled,
        mfaTempSecretEnc: users.mfaTempSecretEnc,
        mfaTempExpiresAt: users.mfaTempExpiresAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return c.json({ error: 'User not found' }, 404);
    if (user.mfaEnabled) return c.json({ error: 'MFA is already enabled' }, 409);
    if (!user.mfaTempSecretEnc || !user.mfaTempExpiresAt || user.mfaTempExpiresAt <= new Date()) {
      return c.json({ error: 'MFA setup session expired. Start setup again.' }, 400);
    }

    const secret = await decryptSecretFromStorage(user.mfaTempSecretEnc, c.env.JWT_SECRET);
    const valid = await verifyTotpCode(secret, body.code);
    if (!valid) return c.json({ error: 'Invalid MFA code' }, 401);

    const encryptedSecret = await encryptSecretForStorage(secret, c.env.JWT_SECRET);
    const recoveryCodes = generateRecoveryCodes(10);

    await replaceRecoveryCodes(db, user.id, recoveryCodes);

    await db
      .update(users)
      .set({
        mfaEnabled: true,
        mfaSecretEnc: encryptedSecret,
        mfaEnabledAt: sql`now()`,
        mfaTempSecretEnc: null,
        mfaTempExpiresAt: null,
        mfaRecoveryGeneratedAt: sql`now()`,
        mfaLastVerifiedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(users.id, user.id));

    return c.json({ enabled: true, recoveryCodes });
  });

  // -------------------------------------------------------------------------
  // POST /api/admin/security/users/:userId/mfa/disable?tenantId=123
  // -------------------------------------------------------------------------
  router.post('/security/users/:userId/mfa/disable', async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = parseTenantId(c.req.query('tenantId'));
    const userId = c.req.param('userId');
    const body = await c.req.json<{ code?: string; recoveryCode?: string }>();
    if (!tenantId) return c.json({ error: 'tenantId is required' }, 400);
    if (!userId) return c.json({ error: 'userId is required' }, 400);
    if (!body.code && !body.recoveryCode) {
      return c.json({ error: 'A TOTP code or recovery code is required' }, 400);
    }

    const isMember = await assertTenantMember(db, tenantId, userId);
    if (!isMember) return c.json({ error: 'User is not an active member of this tenant' }, 404);

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return c.json({ error: 'User not found' }, 404);
    if (!user.mfaEnabled) return c.json({ enabled: false });

    const valid = await assertMfa(db, c.env.JWT_SECRET, user, body.code, body.recoveryCode);
    if (!valid) return c.json({ error: 'Invalid MFA code' }, 401);

    await db.delete(userMfaRecoveryCodes).where(eq(userMfaRecoveryCodes.userId, user.id));
    await db
      .update(users)
      .set({
        mfaEnabled: false,
        mfaSecretEnc: null,
        mfaTempSecretEnc: null,
        mfaTempExpiresAt: null,
        mfaEnabledAt: null,
        mfaRecoveryGeneratedAt: null,
        updatedAt: sql`now()`,
      })
      .where(eq(users.id, user.id));

    return c.json({ enabled: false });
  });

  // -------------------------------------------------------------------------
  // POST /api/admin/security/users/:userId/mfa/recovery-codes/regenerate?tenantId=123
  // -------------------------------------------------------------------------
  router.post('/security/users/:userId/mfa/recovery-codes/regenerate', async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = parseTenantId(c.req.query('tenantId'));
    const userId = c.req.param('userId');
    const body = await c.req.json<{ code?: string; recoveryCode?: string }>();
    if (!tenantId) return c.json({ error: 'tenantId is required' }, 400);
    if (!userId) return c.json({ error: 'userId is required' }, 400);
    if (!body.code && !body.recoveryCode) {
      return c.json({ error: 'A TOTP code or recovery code is required' }, 400);
    }

    const isMember = await assertTenantMember(db, tenantId, userId);
    if (!isMember) return c.json({ error: 'User is not an active member of this tenant' }, 404);

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return c.json({ error: 'User not found' }, 404);
    if (!user.mfaEnabled) return c.json({ error: 'MFA is not enabled' }, 400);

    const valid = await assertMfa(db, c.env.JWT_SECRET, user, body.code, body.recoveryCode);
    if (!valid) return c.json({ error: 'Invalid MFA code' }, 401);

    const recoveryCodes = generateRecoveryCodes(10);
    await replaceRecoveryCodes(db, user.id, recoveryCodes);
    await db
      .update(users)
      .set({ mfaRecoveryGeneratedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(users.id, user.id));

    return c.json({ recoveryCodes });
  });

  // -------------------------------------------------------------------------
  // POST /api/admin/security/users/:userId/sessions/:sessionId/revoke?tenantId=123
  // -------------------------------------------------------------------------
  router.post('/security/users/:userId/sessions/:sessionId/revoke', async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = parseTenantId(c.req.query('tenantId'));
    const userId = c.req.param('userId');
    const sessionId = c.req.param('sessionId');
    if (!tenantId) return c.json({ error: 'tenantId is required' }, 400);
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

  // -------------------------------------------------------------------------
  // POST /api/admin/security/users/:userId/sessions/revoke-all?tenantId=123
  // -------------------------------------------------------------------------
  router.post('/security/users/:userId/sessions/revoke-all', async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = parseTenantId(c.req.query('tenantId'));
    const userId = c.req.param('userId');
    if (!tenantId) return c.json({ error: 'tenantId is required' }, 400);
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

  // -------------------------------------------------------------------------
  // POST /api/admin/security/users/:userId/tokens/:jti/revoke?tenantId=123
  // -------------------------------------------------------------------------
  router.post('/security/users/:userId/tokens/:jti/revoke', async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = parseTenantId(c.req.query('tenantId'));
    const userId = c.req.param('userId');
    const jti = c.req.param('jti');
    if (!tenantId) return c.json({ error: 'tenantId is required' }, 400);
    if (!userId || !jti) return c.json({ error: 'userId and jti are required' }, 400);

    const isMember = await assertTenantMember(db, tenantId, userId);
    if (!isMember) return c.json({ error: 'User is not an active member of this tenant' }, 404);

    await db
      .update(authTokens)
      .set({ revokedAt: sql`now()`, lastSeenAt: sql`now()` })
      .where(and(eq(authTokens.userId, userId), eq(authTokens.jti, jti), isNull(authTokens.revokedAt)));

    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/users
  // -------------------------------------------------------------------------
  router.get('/users', async (c) => {
    const db = buildDatabase(c.env);

    const rows = await db.execute(sql`
      SELECT
        u.id,
        u.email,
        u.username,
        u.display_name  AS "displayName",
        u.is_superadmin AS "isSuperadmin",
        u.created_at    AS "createdAt",
        COUNT(DISTINCT tm.tenant_id)::int AS "tenantCount"
      FROM users u
      LEFT JOIN tenant_members tm ON tm.user_id = u.id AND tm.is_active = true
      GROUP BY u.id, u.email, u.username, u.display_name, u.is_superadmin, u.created_at
      ORDER BY u.created_at DESC
      LIMIT 500
    `);

    return c.json({ users: rows.rows });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/tenants
  // -------------------------------------------------------------------------
  router.get('/tenants', async (c) => {
    const db = buildDatabase(c.env);

    const rows = await db.execute(sql`
      SELECT
        t.id,
        t.name,
        t.slug,
        t.status,
        t.plan,
        t.billing_status AS "billingStatus",
        t.billing_email AS "billingEmail",
        t.billing_updated_at AS "billingUpdatedAt",
        CASE WHEN t.plan = 'pro' AND t.billing_status = 'active' THEN true ELSE false END AS "isPaid",
        CASE WHEN t.plan = 'pro' AND t.billing_status = 'active' THEN 'pro' ELSE 'free' END AS "effectivePlan",
        t.created_at AS "createdAt",
        COUNT(DISTINCT tm.user_id)::int  AS "memberCount",
        COUNT(DISTINCT ci.id)::int       AS "clawCount"
      FROM tenants t
      LEFT JOIN tenant_members tm ON tm.tenant_id = t.id AND tm.is_active = true
      LEFT JOIN coderclaw_instances ci ON ci.tenant_id = t.id
      GROUP BY t.id, t.name, t.slug, t.status, t.plan, t.billing_status, t.billing_email, t.billing_updated_at, t.created_at
      ORDER BY t.created_at DESC
      LIMIT 500
    `);

    return c.json({ tenants: rows.rows });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/health
  // -------------------------------------------------------------------------
  router.get('/health', async (c) => {
    const db = buildDatabase(c.env);

    let dbOk = false;
    let dbLatencyMs = 0;
    try {
      const t0 = Date.now();
      await db.execute(sql`SELECT 1`);
      dbLatencyMs = Date.now() - t0;
      dbOk = true;
    } catch { /* dbOk stays false */ }

    // Platform counts
    const [counts] = (await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM users)                   AS "userCount",
        (SELECT COUNT(*)::int FROM tenants)                 AS "tenantCount",
        (SELECT COUNT(*)::int FROM coderclaw_instances)     AS "clawCount",
        (SELECT COUNT(*)::int FROM executions)              AS "executionCount",
        (SELECT COUNT(*)::int FROM api_error_log)           AS "errorCount",
        (SELECT COUNT(*)::int FROM tenants WHERE plan = 'pro' AND billing_status = 'active') AS "paidTenantCount"
    `)).rows as Array<{
      userCount: number; tenantCount: number; clawCount: number;
      executionCount: number; errorCount: number; paidTenantCount: number;
    }>;

    // LLM model pool — include both Free + Pro pools, with live cooldown state when keys are available
    const freeApiKey = c.env.OPENROUTER_API_KEY;
    const proApiKey = c.env.OPENROUTER_API_KEY_PRO;

    const freeModelPool = freeApiKey
      ? new LlmProxyService(freeApiKey, {
          modelPool: FREE_MODEL_POOL,
          preferredPoolSize: Math.min(PREFERRED_POOL_SIZE, FREE_MODEL_POOL.length),
          productName: 'coderClawLLM',
        }).status()
      : FREE_MODEL_POOL.map((m, i) => ({ model: m, preferred: i < PREFERRED_POOL_SIZE, available: true }));

    const proModelPool = proApiKey
      ? new LlmProxyService(proApiKey, {
          modelPool: PRO_PAID_MODEL_POOL,
          preferredPoolSize: Math.min(PREFERRED_POOL_SIZE, PRO_PAID_MODEL_POOL.length),
          productName: 'coderClawLLMPro',
        }).status()
      : PRO_PAID_MODEL_POOL.map((m, i) => ({ model: m, preferred: i < PREFERRED_POOL_SIZE, available: true }));

    const modelPool = [...freeModelPool, ...proModelPool];

    return c.json({
      status:       dbOk ? 'ok' : 'degraded',
      db:           { ok: dbOk, latencyMs: dbLatencyMs },
      platform:     counts,
      llm:          { pool: modelPool.length, models: modelPool },
      timestamp:    new Date().toISOString(),
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/errors
  // -------------------------------------------------------------------------
  router.get('/errors', async (c) => {
    const db = buildDatabase(c.env);

    const rows = await db
      .select()
      .from(apiErrorLog)
      .orderBy(desc(apiErrorLog.createdAt))
      .limit(200);

    return c.json({ errors: rows });
  });

  // -------------------------------------------------------------------------
  // POST /api/admin/impersonate   { userId, tenantId }
  // Issue a 1-hour tenant-scoped JWT for any user+tenant pair.
  // -------------------------------------------------------------------------
  router.post('/impersonate', async (c) => {
    const { userId, tenantId } = await c.req.json<{ userId: string; tenantId: number }>();
    if (!userId || !tenantId) {
      return c.json({ error: 'userId and tenantId are required' }, 400);
    }

    const db = buildDatabase(c.env);

    // Verify the user exists
    const [userRow] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(sql`${users.id} = ${userId}`)
      .limit(1);
    if (!userRow) return c.json({ error: 'User not found' }, 404);

    // Verify the tenant exists and get the user's role
    const [memberRow] = await db
      .select({ role: tenantMembers.role })
      .from(tenantMembers)
      .where(sql`${tenantMembers.userId} = ${userId} AND ${tenantMembers.tenantId} = ${tenantId} AND ${tenantMembers.isActive} = true`)
      .limit(1);

    // Use the user's actual role if a member, otherwise default to 'viewer'
    const role = memberRow?.role ?? 'viewer';

    const token = await signJwt(
      { sub: userId, tid: tenantId, role: role as Parameters<typeof signJwt>[0]['role'] },
      c.env.JWT_SECRET,
      3600,
    );

    return c.json({
      token,
      expiresIn:    3600,
      userId:       userRow.id,
      email:        userRow.email,
      tenantId,
      role,
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/llm-usage?days=30
  // Per-model aggregates + daily time series
  // -------------------------------------------------------------------------
  router.get('/llm-usage', async (c) => {
    const days = Math.min(Number(c.req.query('days') ?? '30'), 90);
    const db = buildDatabase(c.env);

    // Per-model totals
    const byModel = await db.execute(sql`
      SELECT
        model,
        COUNT(*)::int                    AS requests,
        SUM(prompt_tokens)::bigint       AS prompt_tokens,
        SUM(completion_tokens)::bigint   AS completion_tokens,
        SUM(total_tokens)::bigint        AS total_tokens,
        SUM(retries)::int                AS retries,
        COUNT(CASE WHEN streamed THEN 1 END)::int AS streamed_requests
      FROM llm_usage_log
      WHERE created_at >= NOW() - (${days} || ' days')::interval
      GROUP BY model
      ORDER BY requests DESC
    `);

    // Daily time series (requests + tokens)
    const daily = await db.execute(sql`
      SELECT
        DATE_TRUNC('day', created_at)::date::text AS day,
        COUNT(*)::int                             AS requests,
        SUM(total_tokens)::bigint                 AS total_tokens
      FROM llm_usage_log
      WHERE created_at >= NOW() - (${days} || ' days')::interval
      GROUP BY DATE_TRUNC('day', created_at)
      ORDER BY DATE_TRUNC('day', created_at)
    `);

    // Platform totals (all time)
    const [totals] = (await db.execute(sql`
      SELECT
        COUNT(*)::int          AS total_requests,
        SUM(total_tokens)::bigint AS total_tokens,
        SUM(prompt_tokens)::bigint AS total_prompt_tokens,
        SUM(completion_tokens)::bigint AS total_completion_tokens,
        COUNT(DISTINCT model)::int AS model_count
      FROM llm_usage_log
    `)).rows as Array<{
      total_requests: number; total_tokens: bigint;
      total_prompt_tokens: bigint; total_completion_tokens: bigint;
      model_count: number;
    }>;

    // Per-model failover counts (errors that triggered a fallback)
    const failovers = await db.execute(sql`
      SELECT
        model,
        error_code  AS "errorCode",
        COUNT(*)::int AS count
      FROM llm_failover_log
      WHERE created_at >= NOW() - (${days} || ' days')::interval
      GROUP BY model, error_code
      ORDER BY count DESC
    `);

    return c.json({
      days,
      totals: {
        requests:          Number(totals?.total_requests          ?? 0),
        totalTokens:       Number(totals?.total_tokens            ?? 0),
        promptTokens:      Number(totals?.total_prompt_tokens     ?? 0),
        completionTokens:  Number(totals?.total_completion_tokens ?? 0),
        modelCount:        Number(totals?.model_count             ?? 0),
      },
      byModel:    byModel.rows,
      daily:      daily.rows,
      failovers:  failovers.rows,
    });
  });

  return router;
}
