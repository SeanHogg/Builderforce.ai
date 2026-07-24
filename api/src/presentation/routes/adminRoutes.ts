/**
 * Superadmin routes — /api/admin/*
 *
 * All routes require a WebJWT with sa: true (enforced by superAdminMiddleware).
 *
 * GET  /api/admin/users                — all platform users + tenant counts
 * GET  /api/admin/guest-sessions       — anonymous Brain/tool adoption sessions
 * GET  /api/admin/tenants              — all tenants + member/agentHost counts
 * GET  /api/admin/health               — system health (DB ping, model pool, counts)
 * GET  /api/admin/errors               — recent API error log (last 200 entries)
 * GET  /api/admin/feedback             — cross-tenant product feedback roll-up
 * POST /api/admin/impersonate          — issue a tenant JWT for any user+tenant pair
 */
import { Hono } from 'hono';
import { and, desc, eq, gt, ilike, inArray, isNull, sql } from 'drizzle-orm';
import { resolveAppBaseUrl, type Env, type HonoEnv } from '../../env';
import { credentialSecret } from '../../application/integrations/credentialCrypto';
import { superAdminMiddleware } from '../middleware/superAdminMiddleware';
import { buildDatabase, buildTransactionalDatabase, type Db } from '../../infrastructure/database/connection';
import { writeAdminAudit, type AdminAuditOpts } from '../../infrastructure/audit/adminAudit';
import { parseJsonArray } from '../../domain/shared/json';
import { reviewFeedbackSubmission } from '../../application/feedback/feedbackEngine';
import {
  listFeedbackSubmissions, countFeedbackByStatus, parseFeedbackStatus,
} from '../../application/feedback/feedbackQueries';
import { slugify } from '../../domain/shared/strings';
import { countActiveSessionsAndTokens } from '../../application/security/sessionCounts';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { computePlatformRollup } from '../../application/admin/platformRollup';
import {
  authTokens,
  authUserSessions,
  privacyRequests,
  newsletterEvents,
  newsletterSubscribers,
  newsletterTemplates,
  users,
  tenants,
  tenantMembers,
  agentHosts,
  apiErrorLog,
  llmUsageLog,
  userMfaRecoveryCodes,
  projects,
  platformPersonas,
} from '../../infrastructure/database/schema';
import { signJwt, signEmulationJwt } from '../../infrastructure/auth/JwtService';
import {
  adminImpersonationSessions,
  adminImpersonationRoleSwitches,
  adminAuditLog,
  rolePermissionOverrides,
  tenantCustomRoles,
  platformModules,
  tenantMemberModules,
  userPermissionOverrides,
} from '../../infrastructure/database/schema';
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  resolveRolePermissions,
  resolveEffectivePermissions,
} from '../../domain/permissions/permissionRegistry';
import {
  adminPoolProxy,
  FREE_MODEL_POOL,
  PRO_PAID_MODEL_POOL,
  PREMIUM_FALLBACK_MODELS,
  type ProductName,
  type ProxyEnv,
} from '../../application/llm/LlmProxyService';
import { getAllVendorIds, vendorForModel, type VendorId } from '../../application/llm/vendors';
import { llmFailoverLog, llmHealthProbes, llmTraces } from '../../infrastructure/database/schema';
import { probeVendor, tryAcquireProbeSlot, type VendorProbeResult } from '../../application/llm/vendorHealthProbe';
import { invalidateCapabilityCache } from '../../application/artifact/capabilityContext';
import { invalidateJwtMembershipCache } from '../../infrastructure/auth/keyResolutionCache';
import {
  mintTenantApiKey,
  listTenantApiKeys,
  queryTenantApiKeyUsage,
  revokeTenantApiKey,
  updateTenantApiKey,
} from '../../application/llm/tenantApiKeyService';
import { normalizeOrigins } from './tenantApiKeyRoutes';
import {
  amendActiveLegalDoc,
  enhanceLegalContent,
  getLegalCurrent,
  getLegalHistory,
  LegalDocError,
  publishLegalDoc,
} from '../../application/legal/legalDocsService';
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
import { magicLinkTokens } from '../../infrastructure/database/schema';
import { sendAdminPasswordResetEmail } from '../../infrastructure/email/EmailService';
import { sendTransactionalEmail } from '../../application/email/sendEmail';
import { runRetentionPurge } from '../../application/maintenance/retentionPurge';
import { API_VERSION } from '../../version';

/**
 * Coerce a `platform_modules.permissions` value into `string[]`.
 *
 * Schema drift: the column is JSONB in the database (per migration 0038)
 * but typed as `text` in the Drizzle schema. The pg driver auto-decodes
 * JSONB into a JS array at runtime, so `m.permissions` is *already* an
 * array — but `JSON.parse(array)` would coerce to `array.toString()`
 * (e.g. `"billing:read"`) and throw. This helper handles array, string,
 * and null inputs uniformly so every read site stays one-liner safe.
 */
function coercePermissions(value: unknown): string[] {
  return parseJsonArray<string>(value);
}

/** Persist one health-probe run. Shared by the manual route and the cron handler.
 *  `modelsJson` is a JSONB column ([1449]) — pass the JS array; Drizzle encodes it. */
export async function persistProbe(
  db: Db,
  result: VendorProbeResult,
  trigger: 'manual' | 'cron',
): Promise<void> {
  await db.insert(llmHealthProbes).values({
    vendor:       result.vendor,
    status:       result.status,
    probedCount:  result.probedCount,
    okCount:      result.okCount,
    failedCount:  result.failedCount,
    latencyMs:    result.latencyMs,
    modelsJson:   result.models,
    trigger,
  });
}

/** Defensive coercion for `models_json` (now `jsonb` [1449]): the pg driver
 *  decodes JSONB to an array, but legacy rows written while the column was
 *  mis-handled as text may still come back as a JSON string. Accept both. */
function coerceProbeModels(value: unknown): unknown[] {
  return parseJsonArray(value);
}

/** Status entry for one model in the admin LLM panel. Delegates to the proxy
 *  service so per-model cooldown, per-vendor cooldown, and per-vendor key
 *  binding are evaluated with one source of truth — see
 *  [LlmProxyService.status()](../../application/llm/LlmProxyService.ts). */
async function poolStatus(
  env: ProxyEnv,
  pool: readonly string[],
  productName: ProductName,
): ReturnType<ReturnType<typeof adminPoolProxy>['status']> {
  return adminPoolProxy(env, pool, productName).status();
}

type PrivacyRequestStatus = 'pending' | 'completed' | 'closed';
type PrivacyRequestType = 'ccpa' | 'gdpr';

function isPrivacyRequestStatus(value: string): value is PrivacyRequestStatus {
  return value === 'pending' || value === 'completed' || value === 'closed';
}

function isPrivacyRequestType(value: string): value is PrivacyRequestType {
  return value === 'ccpa' || value === 'gdpr';
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
  return slugify(input, { maxLen: 180 });
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
  env: Env,
  user: typeof users.$inferSelect,
  code?: string,
  recoveryCode?: string,
): Promise<boolean> {
  if (!user.mfaEnabled || !user.mfaSecretEnc) return false;

  if (code) {
    // M2: read under the dedicated credential secret, with JWT_SECRET as the legacy
    // fallback so MFA rows sealed before the migration still decrypt (versioned dual-read).
    const secret = await decryptSecretFromStorage(user.mfaSecretEnc, credentialSecret(env), { legacySecret: env.JWT_SECRET });
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

type DatabaseTarget = 'primary' | 'transactional';

async function inspectDatabase(db: Db, name: DatabaseTarget) {
  const started = Date.now();
  try {
    const [database] = (await db.execute(sql`
      SELECT current_database() AS "databaseName", pg_database_size(current_database())::bigint AS "totalBytes"
    `)).rows as Array<{ databaseName: string; totalBytes: number | string }>;
    const tables = (await db.execute(sql`
      SELECT relname AS name,
        pg_total_relation_size(relid)::bigint AS "totalBytes",
        COALESCE(n_live_tup, 0)::bigint AS "estimatedRows",
        COALESCE(n_tup_ins, 0)::bigint AS "insertsSinceStatsReset",
        COALESCE(n_tup_upd, 0)::bigint AS "updatesSinceStatsReset",
        COALESCE(n_tup_del, 0)::bigint AS "deletesSinceStatsReset",
        last_autovacuum AS "lastAutovacuum",
        last_analyze AS "lastAnalyze"
      FROM pg_stat_user_tables
      ORDER BY pg_total_relation_size(relid) DESC
      LIMIT 100
    `)).rows;
    return {
      name, ok: true, latencyMs: Date.now() - started,
      databaseName: database?.databaseName ?? null,
      totalBytes: Number(database?.totalBytes ?? 0),
      tables,
    };
  } catch (error) {
    return {
      name, ok: false, latencyMs: Date.now() - started, databaseName: null,
      totalBytes: 0, tables: [], error: error instanceof Error ? error.message : 'Database inspection failed',
    };
  }
}

function isSafeRelationName(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z_][a-z0-9_]{0,62}$/.test(value);
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
    return c.json(await getLegalCurrent(db));
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/legal/history[?docType=terms|privacy] — full audit trail of
  // every publish + amend, newest first.
  // -------------------------------------------------------------------------
  router.get('/legal/history', async (c) => {
    const db = buildDatabase(c.env);
    const docTypeParam = c.req.query('docType');
    const docType = docTypeParam === 'terms' || docTypeParam === 'privacy' ? docTypeParam : undefined;
    return c.json({ versions: await getLegalHistory(db, docType) });
  });

  // -------------------------------------------------------------------------
  // POST /api/admin/legal/:docType/publish  (docType: terms | privacy)
  // -------------------------------------------------------------------------
  router.post('/legal/:docType/publish', async (c) => {
    const db = buildDatabase(c.env);
    const actorUserId = c.get('userId') as string;
    const docType = c.req.param('docType');
    if (docType !== 'terms' && docType !== 'privacy') {
      return c.json({ error: 'docType must be "terms" or "privacy"' }, 400);
    }
    const body = await c.req.json<{ version: string; title?: string; content: string }>();
    try {
      const document = await publishLegalDoc(db, docType, body, actorUserId);
      return c.json({ document }, 201);
    } catch (e) {
      if (e instanceof LegalDocError) return c.json({ error: e.message }, e.status as 400);
      throw e;
    }
  });

  // -------------------------------------------------------------------------
  // PATCH /api/admin/legal/:docType  — amend the currently-active doc in place
  // (edit title/content without minting a new version; version optional)
  // -------------------------------------------------------------------------
  router.patch('/legal/:docType', async (c) => {
    const db = buildDatabase(c.env);
    const docType = c.req.param('docType');
    if (docType !== 'terms' && docType !== 'privacy') {
      return c.json({ error: 'docType must be "terms" or "privacy"' }, 400);
    }
    const actorUserId = c.get('userId') as string;
    const body = await c.req.json<{ version?: string; title?: string; content: string }>();
    try {
      const document = await amendActiveLegalDoc(db, docType, body, actorUserId);
      return c.json({ document });
    } catch (e) {
      if (e instanceof LegalDocError) return c.json({ error: e.message }, e.status as 400);
      throw e;
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/admin/legal/:docType/enhance — AI-draft or improve the document.
  // Returns { content } (clean Markdown); the editor previews it before saving,
  // so nothing is persisted here. Metered through the shared LLM gateway.
  // -------------------------------------------------------------------------
  router.post('/legal/:docType/enhance', async (c) => {
    const actorUserId = c.get('userId') as string;
    const docType = c.req.param('docType');
    if (docType !== 'terms' && docType !== 'privacy') {
      return c.json({ error: 'docType must be "terms" or "privacy"' }, 400);
    }
    const body = await c.req.json<{ content?: string; instruction?: string; title?: string }>();
    try {
      const content = await enhanceLegalContent(c.env, c.executionCtx, {
        docType,
        content: body.content ?? '',
        instruction: body.instruction,
        title: body.title,
        userId: actorUserId,
        requestIp: c.req.header('cf-connecting-ip') ?? null,
        origin: c.req.header('Origin') ?? null,
        userAgent: c.req.header('User-Agent') ?? null,
      });
      return c.json({ content });
    } catch (e) {
      if (e instanceof LegalDocError) return c.json({ error: e.message }, e.status as 400);
      throw e;
    }
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

    const { sessionsByUser, tokensByUser } = await countActiveSessionsAndTokens(db, userIds);

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
    const encrypted = await encryptSecretForStorage(secret, credentialSecret(c.env), { upgrade: true });
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
      issuer: 'Builderforce',
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

    const secret = await decryptSecretFromStorage(user.mfaTempSecretEnc, credentialSecret(c.env), { legacySecret: c.env.JWT_SECRET });
    const valid = await verifyTotpCode(secret, body.code);
    if (!valid) return c.json({ error: 'Invalid MFA code' }, 401);

    const encryptedSecret = await encryptSecretForStorage(secret, credentialSecret(c.env), { upgrade: true });
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

    const valid = await assertMfa(db, c.env, user, body.code, body.recoveryCode);
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

    const valid = await assertMfa(db, c.env, user, body.code, body.recoveryCode);
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
  // GET /api/admin/guest-sessions
  // Anonymous Brain sessions are marketing leads, not auth_user_sessions. Keep
  // them visible beside the user directory so admins can follow the full
  // guest -> account -> paid adoption funnel.
  // -------------------------------------------------------------------------
  router.get('/guest-sessions', async (c) => {
    const db = buildDatabase(c.env);

    const rows = await db.execute(sql`
      SELECT
        ms.id,
        ms.visitor_id        AS "visitorId",
        ms.guest_chat_count  AS "guestChatCount",
        ms.guest_chat_tokens AS "guestChatTokens",
        ms.guest_chat_day    AS "guestChatDay",
        ms.tool_runs         AS "toolRuns",
        ms.last_tool_id      AS "lastToolId",
        ms.landing_path      AS "landingPath",
        ms.referrer,
        ms.converted,
        ms.converted_user_id AS "convertedUserId",
        ms.converted_at      AS "convertedAt",
        ms.first_seen_at     AS "firstSeenAt",
        ms.last_seen_at      AS "lastSeenAt",
        u.email              AS "convertedEmail",
        COALESCE(BOOL_OR(t.plan = 'pro' AND t.billing_status = 'active'), false) AS "isPaid"
      FROM marketing_sessions ms
      LEFT JOIN users u ON u.id = ms.converted_user_id
      LEFT JOIN tenant_members tm ON tm.user_id = u.id AND tm.is_active = true
      LEFT JOIN tenants t ON t.id = tm.tenant_id
      GROUP BY ms.id, u.email
      ORDER BY ms.last_seen_at DESC
      LIMIT 500
    `);

    return c.json({ sessions: rows.rows });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/demo/funnel
  // Demo-account conversion funnel (migration 0360): per-persona event rollup
  // over the trailing 30 days + the most recent raw events. Cached 60s — the
  // stream is append-only and the panel re-polls.
  // -------------------------------------------------------------------------
  router.get('/demo/funnel', async (c) => {
    const funnel = await getOrSetCached(c.env, 'admin:demo:funnel', async () => {
      const db = buildDatabase(c.env);
      const byKind = await db.execute(sql`
        SELECT
          persona,
          kind,
          COUNT(*)::int                    AS "count",
          COUNT(DISTINCT visitor_id)::int  AS "visitors"
        FROM demo_events
        WHERE occurred_at > now() - interval '30 days'
        GROUP BY persona, kind
        ORDER BY persona, kind
      `);
      const recent = await db.execute(sql`
        SELECT persona, kind, path, visitor_id AS "visitorId", occurred_at AS "occurredAt"
        FROM demo_events
        ORDER BY occurred_at DESC
        LIMIT 100
      `);
      return { byKind: byKind.rows, recent: recent.rows };
    }, { kvTtlSeconds: 60 });
    return c.json(funnel);
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/sales-leads  ·  PATCH /api/admin/sales-leads/:id
  // Book-a-demo pipeline: list newest-first, update status as sales works them.
  // -------------------------------------------------------------------------
  router.get('/sales-leads', async (c) => {
    const db = buildDatabase(c.env);
    const status = (c.req.query('status') ?? '').trim();
    const rows = await db.execute(sql`
      SELECT id, name, email, company, interest, message, source, locale,
             visitor_id AS "visitorId", status, created_at AS "createdAt"
      FROM sales_leads
      ${status ? sql`WHERE status = ${status}` : sql``}
      ORDER BY created_at DESC
      LIMIT 500
    `);
    return c.json({ leads: rows.rows });
  });

  router.patch('/sales-leads/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{ status?: string }>().catch(() => ({} as { status?: string }));
    const allowed = ['new', 'contacted', 'qualified', 'closed'];
    if (!body.status || !allowed.includes(body.status)) {
      return c.json({ error: `status must be one of ${allowed.join(', ')}` }, 400);
    }
    const db = buildDatabase(c.env);
    const rows = await db.execute(sql`
      UPDATE sales_leads SET status = ${body.status} WHERE id = ${id}
      RETURNING id, status
    `);
    if (rows.rows.length === 0) return c.json({ error: 'Lead not found' }, 404);
    return c.json({ lead: rows.rows[0] });
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
        t.external_customer_id AS "externalCustomerId",
        t.external_subscription_id AS "externalSubscriptionId",
        t.token_daily_limit_override AS "tokenDailyLimitOverride",
        t.paid_overflow_daily_cap AS "paidOverflowDailyCap",
        t.image_credits_daily_limit AS "imageCreditsDailyLimit",
        t.premium_override AS "premiumOverride",
        CASE WHEN t.plan = 'pro' AND t.billing_status = 'active' THEN true ELSE false END AS "isPaid",
        CASE WHEN t.plan = 'pro' AND t.billing_status = 'active' THEN 'pro' ELSE 'free' END AS "effectivePlan",
        t.created_at AS "createdAt",
        COUNT(DISTINCT tm.user_id)::int  AS "memberCount",
        COUNT(DISTINCT ci.id)::int       AS "agentHostCount"
      FROM tenants t
      LEFT JOIN tenant_members tm ON tm.tenant_id = t.id AND tm.is_active = true
      LEFT JOIN agent_hosts ci ON ci.tenant_id = t.id
      GROUP BY t.id, t.name, t.slug, t.status, t.plan, t.billing_status, t.billing_email, t.billing_updated_at, t.external_customer_id, t.external_subscription_id, t.token_daily_limit_override, t.paid_overflow_daily_cap, t.image_credits_daily_limit, t.premium_override, t.created_at
      ORDER BY t.created_at DESC
      LIMIT 500
    `);

    return c.json({ tenants: rows.rows });
  });

  // -------------------------------------------------------------------------
  // PATCH /api/admin/tenants/:id/token-limit-override
  // Body: { tokenDailyLimitOverride: number | null }
  //   null → clear override (revert to plan default)
  //   -1   → unlimited (skip the gate entirely)
  //   >= 0 → use this value as the daily token cap
  // -------------------------------------------------------------------------
  router.patch('/tenants/:id/token-limit-override', async (c) => {
    const tenantId = Number(c.req.param('id'));
    if (!tenantId) return c.json({ error: 'Invalid tenant id' }, 400);

    const body = await c.req.json<{ tokenDailyLimitOverride?: number | null }>();
    const value = body.tokenDailyLimitOverride;
    if (value !== null && value !== undefined) {
      if (!Number.isInteger(value) || value < -1) {
        return c.json({
          error: 'tokenDailyLimitOverride must be null, -1 (unlimited), or a non-negative integer',
        }, 400);
      }
    }
    const next = value === undefined ? null : value;

    const db = buildDatabase(c.env);
    const [before] = await db.select({ prev: tenants.tokenDailyLimitOverride }).from(tenants).where(eq(tenants.id, tenantId));
    const [updated] = await db
      .update(tenants)
      .set({ tokenDailyLimitOverride: next, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId))
      .returning({ id: tenants.id, tokenDailyLimitOverride: tenants.tokenDailyLimitOverride });

    if (!updated) return c.json({ error: 'Tenant not found' }, 404);

    // Forensic trail: who flipped a tenant's token cap, from what to what, and when.
    await writeAudit(db, 'TOKEN_LIMIT_OVERRIDE_CHANGED', c.get('userId') as string, {
      tenantId,
      metadata: { from: before?.prev ?? null, to: updated.tokenDailyLimitOverride },
      ipAddress: c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? null,
    }).catch(() => {});

    return c.json({ id: updated.id, tokenDailyLimitOverride: updated.tokenDailyLimitOverride });
  });

  // -------------------------------------------------------------------------
  // PATCH /api/admin/tenants/:id/paid-overflow-cap
  // Body: { paidOverflowDailyCap: number | null }  (value in MILLICENTS, 1/100000 USD)
  //   null → clear override (free → $0.50/day default; pro/teams → unlimited)
  //   -1   → unlimited (funded-overflow gate skipped)
  //   >= 0 → use this daily $ ceiling (millicents) on funded-overflow spend
  // The funded-overflow path = the always-on premium-fallback + reliability
  // backstop chain that runs on Builderforce's own keys (migration 0130).
  // -------------------------------------------------------------------------
  router.patch('/tenants/:id/paid-overflow-cap', async (c) => {
    const tenantId = Number(c.req.param('id'));
    if (!tenantId) return c.json({ error: 'Invalid tenant id' }, 400);

    const body = await c.req.json<{ paidOverflowDailyCap?: number | null }>();
    const value = body.paidOverflowDailyCap;
    if (value !== null && value !== undefined) {
      if (!Number.isInteger(value) || value < -1) {
        return c.json({
          error: 'paidOverflowDailyCap must be null, -1 (unlimited), or a non-negative integer (millicents)',
        }, 400);
      }
    }
    const next = value === undefined ? null : value;

    const db = buildDatabase(c.env);
    const [before] = await db.select({ prev: tenants.paidOverflowDailyCap }).from(tenants).where(eq(tenants.id, tenantId));
    const [updated] = await db
      .update(tenants)
      .set({ paidOverflowDailyCap: next, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId))
      .returning({ id: tenants.id, paidOverflowDailyCap: tenants.paidOverflowDailyCap });

    if (!updated) return c.json({ error: 'Tenant not found' }, 404);

    // Forensic trail: who changed a tenant's funded-overflow ceiling, and when.
    await writeAudit(db, 'PAID_OVERFLOW_CAP_CHANGED', c.get('userId') as string, {
      tenantId,
      metadata: { from: before?.prev ?? null, to: updated.paidOverflowDailyCap },
      ipAddress: c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? null,
    }).catch(() => {});

    return c.json({ id: updated.id, paidOverflowDailyCap: updated.paidOverflowDailyCap });
  });

  // -------------------------------------------------------------------------
  // PATCH /api/admin/tenants/:id/image-credits-limit
  // Body: { imageCreditsDailyLimit: number | null }  (credits = returned images)
  //   null → clear override (plan default: free 10 / pro 1000 / teams 5000)
  //   -1   → unlimited (gate skipped)
  //   >= 0 → explicit images/day ceiling
  // Metered independently of the text token cap (migration 0131).
  // -------------------------------------------------------------------------
  router.patch('/tenants/:id/image-credits-limit', async (c) => {
    const tenantId = Number(c.req.param('id'));
    if (!tenantId) return c.json({ error: 'Invalid tenant id' }, 400);

    const body = await c.req.json<{ imageCreditsDailyLimit?: number | null }>();
    const value = body.imageCreditsDailyLimit;
    if (value !== null && value !== undefined) {
      if (!Number.isInteger(value) || value < -1) {
        return c.json({
          error: 'imageCreditsDailyLimit must be null, -1 (unlimited), or a non-negative integer',
        }, 400);
      }
    }
    const next = value === undefined ? null : value;

    const db = buildDatabase(c.env);
    const [before] = await db.select({ prev: tenants.imageCreditsDailyLimit }).from(tenants).where(eq(tenants.id, tenantId));
    const [updated] = await db
      .update(tenants)
      .set({ imageCreditsDailyLimit: next, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId))
      .returning({ id: tenants.id, imageCreditsDailyLimit: tenants.imageCreditsDailyLimit });

    if (!updated) return c.json({ error: 'Tenant not found' }, 404);

    await writeAudit(db, 'IMAGE_CREDITS_LIMIT_CHANGED', c.get('userId') as string, {
      tenantId,
      metadata: { from: before?.prev ?? null, to: updated.imageCreditsDailyLimit },
      ipAddress: c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? null,
    }).catch(() => {});

    return c.json({ id: updated.id, imageCreditsDailyLimit: updated.imageCreditsDailyLimit });
  });

  // -------------------------------------------------------------------------
  // PATCH /api/admin/tenants/:id/premium-override
  // Body: { premiumOverride: boolean }
  //   true  → premium routing (top PREMIUM-tier models + extended vendor timeout)
  //   false → revert to plan-driven routing
  // -------------------------------------------------------------------------
  router.patch('/tenants/:id/premium-override', async (c) => {
    const tenantId = Number(c.req.param('id'));
    if (!tenantId) return c.json({ error: 'Invalid tenant id' }, 400);

    const body = await c.req.json<{ premiumOverride?: boolean }>();
    if (typeof body.premiumOverride !== 'boolean') {
      return c.json({ error: 'premiumOverride must be a boolean' }, 400);
    }

    const db = buildDatabase(c.env);
    const [before] = await db.select({ prev: tenants.premiumOverride }).from(tenants).where(eq(tenants.id, tenantId));
    const [updated] = await db
      .update(tenants)
      .set({ premiumOverride: body.premiumOverride, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId))
      .returning({ id: tenants.id, premiumOverride: tenants.premiumOverride });

    if (!updated) return c.json({ error: 'Tenant not found' }, 404);

    // Forensic trail: who flipped a tenant to/from premium routing, and when.
    await writeAudit(db, 'PREMIUM_OVERRIDE_CHANGED', c.get('userId') as string, {
      tenantId,
      metadata: { from: before?.prev ?? null, to: updated.premiumOverride },
      ipAddress: c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? null,
    }).catch(() => {});

    return c.json({ id: updated.id, premiumOverride: updated.premiumOverride });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/tenants/:id/members
  // -------------------------------------------------------------------------
  router.get('/tenants/:id/members', async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = Number(c.req.param('id'));
    if (!tenantId) return c.json({ error: 'Invalid tenant id' }, 400);
    const rows = await db.execute(sql`
      SELECT
        u.id,
        u.email,
        u.username,
        u.display_name AS "displayName",
        tm.role,
        tm.is_active AS "isActive",
        tm.joined_at AS "joinedAt"
      FROM tenant_members tm
      JOIN users u ON u.id = tm.user_id
      WHERE tm.tenant_id = ${tenantId}
      ORDER BY tm.joined_at DESC
      LIMIT 200
    `);
    return c.json({ members: rows.rows });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/health
  // -------------------------------------------------------------------------
  // GET /api/admin/platform-rollup?days= — platform-wide historical trends
  // (user + workspace growth, LLM tokens/spend, error-event volume) for the
  // superadmin Health/Usage charts. Cached on a short TTL (platform-scoped).
  router.get('/platform-rollup', async (c) => {
    const db = buildDatabase(c.env);
    const raw = Number(c.req.query('days'));
    const days = Number.isFinite(raw) && raw >= 1 && raw <= 365 ? Math.floor(raw) : 30;
    const rollup = await getOrSetCached(
      c.env as Env,
      `admin:platform-rollup:d:${days}`,
      () => computePlatformRollup(db, days),
      { kvTtlSeconds: 120, l1TtlMs: 30_000 },
    );
    return c.json(rollup);
  });

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
        (SELECT COUNT(*)::int FROM agent_hosts)     AS "agentHostCount",
        (SELECT COUNT(*)::int FROM executions)              AS "executionCount",
        (SELECT COUNT(*)::int FROM api_error_log)           AS "errorCount",
        (SELECT COUNT(*)::int FROM tenants WHERE plan = 'pro' AND billing_status = 'active') AS "paidTenantCount"
    `)).rows as Array<{
      userCount: number; tenantCount: number; agentHostCount: number;
      executionCount: number; errorCount: number; paidTenantCount: number;
    }>;

    // LLM model pool — include both Free + Pro pools. Per-model availability
    // (cooldown / vendor-key / vendor-cooldown) is resolved inside the proxy
    // service so this call doesn't need to know which vendor owns each model.
    // The premium-fallback tail is appended to EVERY chain (Free included) as the
    // always-on backstop, but it isn't part of the Free/Pro pools — surface it as
    // its own row so superadmins can see its cooldown/key-bound state too [1430].
    const [freeModelPool, proModelPool, premiumFallbackPool] = await Promise.all([
      poolStatus(c.env, FREE_MODEL_POOL,            'builderforceLLM'),
      poolStatus(c.env, PRO_PAID_MODEL_POOL,        'builderforceLLMPro'),
      poolStatus(c.env, PREMIUM_FALLBACK_MODELS,    'builderforceLLMPro'),
    ]);

    const modelPool = [...freeModelPool, ...proModelPool];

    return c.json({
      status:       dbOk ? 'ok' : 'degraded',
      db:           { ok: dbOk, latencyMs: dbLatencyMs },
      platform:     counts,
      llm:          {
        pool:   modelPool.length,
        models: modelPool,
        free:   freeModelPool,
        pro:    proModelPool,
        premiumFallback: premiumFallbackPool,
      },
      timestamp:    new Date().toISOString(),
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/system-health — operational infrastructure + both Neon DBs.
  // Table mutation counters are PostgreSQL counters since the last stats reset;
  // they make sustained growth visible without retaining a second metrics table.
  // -------------------------------------------------------------------------
  router.get('/system-health', async (c) => {
    const primary = buildDatabase(c.env);
    const transactional = buildTransactionalDatabase(c.env);
    const [primaryDb, transactionalDb, runtime] = await Promise.all([
      inspectDatabase(primary, 'primary'),
      inspectDatabase(transactional, 'transactional'),
      primary.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM agent_hosts) AS "agentHosts",
          (SELECT COUNT(*)::int FROM agent_hosts WHERE connected_at IS NOT NULL AND last_seen_at > now() - interval '5 minutes') AS "onlineAgentHosts",
          (SELECT COUNT(*)::int FROM executions WHERE status IN ('pending', 'running')) AS "activeExecutions",
          (SELECT COUNT(*)::int FROM executions WHERE status = 'failed' AND updated_at > now() - interval '24 hours') AS "failedExecutions24h"
      `).catch(() => ({ rows: [] })),
    ]);
    const row = (runtime.rows[0] ?? {}) as Record<string, number>;
    return c.json({
      timestamp: new Date().toISOString(),
      worker: {
        version: API_VERSION,
        environment: c.env.ENVIRONMENT ?? 'unknown',
        bindings: {
          analysisRunner: Boolean(c.env.ANALYSIS_RUNNER),
          agentContainer: Boolean(c.env.AGENT_CONTAINER),
          qaRunnerContainer: Boolean(c.env.QA_RUNNER_CONTAINER),
          cloudRunner: Boolean(c.env.CLOUD_RUNNER),
          cloudflareAi: Boolean(c.env.CLOUDFLARE_AI_API_TOKEN && c.env.CLOUDFLARE_ACCOUNT_ID),
        },
      },
      runtime: {
        agentHosts: Number(row.agentHosts ?? 0),
        onlineAgentHosts: Number(row.onlineAgentHosts ?? 0),
        activeExecutions: Number(row.activeExecutions ?? 0),
        failedExecutions24h: Number(row.failedExecutions24h ?? 0),
      },
      databases: [primaryDb, transactionalDb],
    });
  });

  // POST /api/admin/system-health/maintenance
  // { action: 'purge_expired' } runs only the existing retention policy.
  // { action: 'vacuum_analyze', target, table? } is intentionally limited to
  // normal VACUUM ANALYZE (never VACUUM FULL / arbitrary SQL).
  router.post('/system-health/maintenance', async (c) => {
    const body = await c.req.json().catch(() => ({})) as {
      action?: string; target?: DatabaseTarget; table?: string;
    };
    const actorId = c.get('userId') as string | undefined;
    if (body.action === 'purge_expired') {
      await runRetentionPurge(c.env as Env);
      await writeAdminAudit(buildDatabase(c.env), 'SYSTEM_HEALTH_PURGE_EXPIRED', actorId ?? null, {
        metadata: { target: 'both', retentionPolicy: true }, ipAddress: c.req.header('cf-connecting-ip') ?? null,
      });
      return c.json({ ok: true, action: body.action });
    }
    if (body.action !== 'vacuum_analyze' || (body.target !== 'primary' && body.target !== 'transactional')) {
      return c.json({ error: 'Use purge_expired or vacuum_analyze with target primary|transactional.' }, 400);
    }
    if (body.table != null && !isSafeRelationName(body.table)) {
      return c.json({ error: 'Invalid table name.' }, 400);
    }
    const db = body.target === 'primary' ? buildDatabase(c.env) : buildTransactionalDatabase(c.env);
    const statement = body.table ? `VACUUM (ANALYZE) "${body.table}"` : 'VACUUM (ANALYZE)';
    try {
      await db.execute(sql.raw(statement));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'VACUUM failed' }, 500);
    }
    await writeAdminAudit(buildDatabase(c.env), 'SYSTEM_HEALTH_VACUUM_ANALYZE', actorId ?? null, {
      metadata: { target: body.target, table: body.table ?? null }, ipAddress: c.req.header('cf-connecting-ip') ?? null,
    });
    return c.json({ ok: true, action: body.action, target: body.target, table: body.table ?? null });
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

    // Platform totals — windowed to the same `days` range as the per-model
    // table + daily series, so the totals card and the table never disagree
    // (previously the card was all-time, reading e.g. "515k tokens" while the
    // windowed table said "No usage in this period").
    const [totals] = (await db.execute(sql`
      SELECT
        COUNT(*)::int          AS total_requests,
        SUM(total_tokens)::bigint AS total_tokens,
        SUM(prompt_tokens)::bigint AS total_prompt_tokens,
        SUM(completion_tokens)::bigint AS total_completion_tokens,
        COUNT(DISTINCT model)::int AS model_count
      FROM llm_usage_log
      WHERE created_at >= NOW() - (${days} || ' days')::interval
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

    // Enrich per-model and per-failover rows with `vendor` so the admin UI
    // can group by vendor without re-deriving prefix→vendor mappings client-side.
    const enrichVendor = <T extends { model: string }>(rows: ReadonlyArray<T>) =>
      rows.map((r) => ({ ...r, vendor: vendorForModel(r.model) }));

    return c.json({
      days,
      totals: {
        requests:          Number(totals?.total_requests          ?? 0),
        totalTokens:       Number(totals?.total_tokens            ?? 0),
        promptTokens:      Number(totals?.total_prompt_tokens     ?? 0),
        completionTokens:  Number(totals?.total_completion_tokens ?? 0),
        modelCount:        Number(totals?.model_count             ?? 0),
      },
      byModel:    enrichVendor(byModel.rows as Array<{ model: string }>),
      daily:      daily.rows,
      failovers:  enrichVendor(failovers.rows as Array<{ model: string }>),
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/llm/traces — search/list recent LLM diagnostic traces.
  //   ?q=  trace id / consumer request id (substring)   ?tenantId=  ?model=
  //   ?success=true|false   ?outcome=   ?days= (def 7, max 90)   ?limit= ?page=
  // Summary columns only; full bodies come from the single-trace endpoint.
  // Everything here is builder-side / superadmin-only.
  // -------------------------------------------------------------------------
  router.get('/llm/traces', async (c) => {
    const db = buildDatabase(c.env);
    const q        = c.req.query('q')?.trim() || null;
    const tenantId = parseTenantId(c.req.query('tenantId'));
    const model    = c.req.query('model')?.trim() || null;
    const successQ = c.req.query('success');
    const outcome  = c.req.query('outcome')?.trim() || null;
    const days     = Math.min(parsePositiveInt(c.req.query('days'), 7), 90);
    const limit    = Math.min(parsePositiveInt(c.req.query('limit'), 50), 200);
    const page     = Math.max(parsePositiveInt(c.req.query('page'), 1), 1);
    const offset   = (page - 1) * limit;
    const successFilter = successQ === 'true' ? true : successQ === 'false' ? false : null;

    const result = await db.execute(sql`
      SELECT
        trace_id            AS "traceId",
        created_at::text    AS "createdAt",
        tenant_id           AS "tenantId",
        user_id             AS "userId",
        surface,
        llm_product         AS "llmProduct",
        resolved_model      AS "resolvedModel",
        resolved_vendor     AS "resolvedVendor",
        status,
        success,
        outcome,
        classification,
        attempt_count       AS "attemptCount",
        retries,
        schema_retries      AS "schemaRetries",
        duration_ms         AS "durationMs",
        total_tokens        AS "totalTokens",
        use_case            AS "useCase",
        consumer_request_id AS "consumerRequestId",
        streamed,
        error_message       AS "errorMessage"
      FROM llm_traces
      WHERE created_at >= now() - (${days} || ' days')::interval
        AND (${q === null}             OR trace_id ILIKE ${'%' + (q ?? '') + '%'} OR consumer_request_id ILIKE ${'%' + (q ?? '') + '%'})
        AND (${tenantId === null}      OR tenant_id = ${tenantId ?? 0})
        AND (${model === null}         OR resolved_model ILIKE ${'%' + (model ?? '') + '%'})
        AND (${successFilter === null} OR success = ${successFilter ?? false})
        AND (${outcome === null}       OR outcome = ${outcome ?? ''})
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    return c.json({ traces: result.rows, page, limit, days });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/llm/traces/:traceId — full single trace, JSON blobs parsed.
  // The screen a superadmin lands on after a customer quotes their trace id:
  // who called, how long, every model attempt, every exception, the candidate
  // chain, and the full request/response bodies.
  // -------------------------------------------------------------------------
  router.get('/llm/traces/:traceId', async (c) => {
    const db = buildDatabase(c.env);
    const traceId = c.req.param('traceId');
    const [row] = await db
      .select()
      .from(llmTraces)
      .where(eq(llmTraces.traceId, traceId))
      .limit(1);
    if (!row) return c.json({ error: 'Trace not found' }, 404);

    // Reading a single trace exposes the FULL captured request/response bodies
    // (which may contain end-user PII). Record who viewed which trace [1300].
    await writeAudit(db, 'LLM_TRACE_VIEWED', c.get('userId') as string, {
      tenantId:  row.tenantId ?? null,
      metadata:  { traceId },
      ipAddress: c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? null,
    });

    const parse = (v: string | null): unknown => {
      if (v == null) return null;
      try { return JSON.parse(v); } catch { return v; }
    };

    return c.json({
      trace: {
        ...row,
        createdAt:      row.createdAt ? row.createdAt.toISOString() : null,
        requestShape:   parse(row.requestShape),
        candidateChain: parse(row.candidateChain),
        attempts:       parse(row.attempts),
        requestBody:    parse(row.requestBody),
        responseBody:   parse(row.responseBody),
        callerMetadata: parse(row.callerMetadata),
      },
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/admin/llm-health/:vendor — probe every model in the vendor's
  // catalog with a 1-token chat completion. Persists the result row so the
  // scheduled() cron can diff against prior runs. Returns the live probe to
  // the caller.
  // -------------------------------------------------------------------------
  router.post('/llm-health/:vendor', async (c) => {
    const vendorParam = c.req.param('vendor');
    const allowed = new Set(getAllVendorIds() as string[]);
    if (!allowed.has(vendorParam)) {
      return c.json({ error: `Unknown vendor: ${vendorParam}` }, 400);
    }
    // Rate-limit the manual button: each probe fans out N upstream calls, so a
    // repeated click can burn free-tier quota. At most one manual probe per
    // vendor per minute (the daily cron is unaffected). [1424]
    const slot = tryAcquireProbeSlot(vendorParam, Date.now());
    if (!slot.ok) {
      const retryAfterSeconds = Math.ceil(slot.retryAfterMs / 1000);
      return c.json(
        { error: `Health probe for '${vendorParam}' ran recently — retry in ${retryAfterSeconds}s`, retryAfterSeconds },
        429,
      );
    }
    const result = await probeVendor(c.env, vendorParam as VendorId);
    await persistProbe(buildTransactionalDatabase(c.env), result, 'manual');
    return c.json(result);
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/llm-health — latest probe per vendor, for the admin UI
  // -------------------------------------------------------------------------
  router.get('/llm-health', async (c) => {
    const db = buildTransactionalDatabase(c.env);
    const rows = (await db.execute(sql`
      SELECT DISTINCT ON (vendor)
        vendor, status, probed_count AS "probedCount", ok_count AS "okCount",
        failed_count AS "failedCount", latency_ms AS "latencyMs",
        models_json AS "modelsJson", trigger,
        created_at AS "createdAt"
      FROM llm_health_probes
      ORDER BY vendor, created_at DESC
    `)).rows as Array<{
      vendor: string; status: string;
      probedCount: number; okCount: number; failedCount: number; latencyMs: number;
      modelsJson: unknown; trigger: string; createdAt: Date | string;
    }>;
    return c.json({
      vendors: rows.map((r) => ({
        vendor:       r.vendor,
        status:       r.status,
        probedCount:  r.probedCount,
        okCount:      r.okCount,
        failedCount:  r.failedCount,
        latencyMs:    r.latencyMs,
        models:       coerceProbeModels(r.modelsJson),
        trigger:      r.trigger,
        createdAt:    r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      })),
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/personas   — list platform personas (admin CRUD)
  // -------------------------------------------------------------------------
  router.get('/personas', async (c) => {
    const db = buildDatabase(c.env);
    const rows = await db.select().from(platformPersonas).orderBy(platformPersonas.name);
    const list = rows.map((r) => ({
      id:         r.id,
      name:       r.name,
      slug:       r.slug,
      description: r.description ?? null,
      voice:      r.voice ?? null,
      perspective: r.perspective ?? null,
      decisionStyle: r.decisionStyle ?? null,
      outputPrefix: r.outputPrefix ?? null,
      capabilities: r.capabilities ? (JSON.parse(r.capabilities) as string[]) : [],
      tags:       r.tags ? (JSON.parse(r.tags) as string[]) : [],
      psychometric: r.psychometric ? JSON.parse(r.psychometric) : null,
      source:     r.source ?? 'builtin',
      author:     r.author ?? null,
      active:     r.active,
      createdAt:  r.createdAt?.toISOString() ?? null,
      updatedAt:  r.updatedAt?.toISOString() ?? null,
    }));
    return c.json({ personas: list });
  });

  // -------------------------------------------------------------------------
  // POST /api/admin/personas   — create platform persona
  // -------------------------------------------------------------------------
  router.post('/personas', async (c) => {
    const db = buildDatabase(c.env);
    const body = await c.req.json<{
      name: string;
      slug?: string;
      description?: string | null;
      voice?: string | null;
      perspective?: string | null;
      decisionStyle?: string | null;
      outputPrefix?: string | null;
      capabilities?: string[];
      tags?: string[];
      psychometric?: unknown; // PsychometricProfile object, or null
      source?: string;
      author?: string | null;
      active?: boolean;
    }>();
    const name = body.name?.trim();
    if (!name) return c.json({ error: 'name is required' }, 400);
    const slug = (body.slug ?? name).trim().toLowerCase().replace(/\s+/g, '-');
    const [inserted] = await db
      .insert(platformPersonas)
      .values({
        name,
        slug,
        description: body.description ?? null,
        voice: body.voice ?? null,
        perspective: body.perspective ?? null,
        decisionStyle: body.decisionStyle ?? null,
        outputPrefix: body.outputPrefix ?? null,
        capabilities: body.capabilities?.length ? JSON.stringify(body.capabilities) : null,
        tags: body.tags?.length ? JSON.stringify(body.tags) : null,
        psychometric: body.psychometric ? JSON.stringify(body.psychometric) : null,
        source: body.source ?? 'builtin',
        author: body.author ?? null,
        active: body.active ?? true,
      })
      .returning();
    if (!inserted) return c.json({ error: 'Insert failed' }, 500);
    return c.json({
      persona: {
        id:         inserted.id,
        name:       inserted.name,
        slug:       inserted.slug,
        description: inserted.description ?? null,
        voice:      inserted.voice ?? null,
        perspective: inserted.perspective ?? null,
        decisionStyle: inserted.decisionStyle ?? null,
        outputPrefix: inserted.outputPrefix ?? null,
        capabilities: inserted.capabilities ? (JSON.parse(inserted.capabilities) as string[]) : [],
        tags:        inserted.tags ? (JSON.parse(inserted.tags) as string[]) : [],
        psychometric: inserted.psychometric ? JSON.parse(inserted.psychometric) : null,
        source:      inserted.source ?? 'builtin',
        author:      inserted.author ?? null,
        active:      inserted.active,
        createdAt:   inserted.createdAt?.toISOString() ?? null,
        updatedAt:   inserted.updatedAt?.toISOString() ?? null,
      },
    }, 201);
  });

  // -------------------------------------------------------------------------
  // PATCH /api/admin/personas/:id   — update platform persona
  // -------------------------------------------------------------------------
  router.patch('/personas/:id', async (c) => {
    const db = buildDatabase(c.env);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
    const body = await c.req.json<{
      name?: string;
      slug?: string;
      description?: string | null;
      voice?: string | null;
      perspective?: string | null;
      decisionStyle?: string | null;
      outputPrefix?: string | null;
      capabilities?: string[];
      tags?: string[];
      psychometric?: unknown; // PsychometricProfile object, or null to clear
      source?: string;
      author?: string | null;
      active?: boolean;
    }>();
    const [existing] = await db.select().from(platformPersonas).where(eq(platformPersonas.id, id)).limit(1);
    if (!existing) return c.json({ error: 'Persona not found' }, 404);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) updates.name = body.name.trim();
    if (body.slug !== undefined) updates.slug = body.slug.trim().toLowerCase().replace(/\s+/g, '-');
    if (body.description !== undefined) updates.description = body.description;
    if (body.voice !== undefined) updates.voice = body.voice;
    if (body.perspective !== undefined) updates.perspective = body.perspective;
    if (body.decisionStyle !== undefined) updates.decisionStyle = body.decisionStyle;
    if (body.outputPrefix !== undefined) updates.outputPrefix = body.outputPrefix;
    if (body.capabilities !== undefined) updates.capabilities = body.capabilities?.length ? JSON.stringify(body.capabilities) : null;
    if (body.tags !== undefined) updates.tags = body.tags?.length ? JSON.stringify(body.tags) : null;
    if (body.psychometric !== undefined) updates.psychometric = body.psychometric ? JSON.stringify(body.psychometric) : null;
    if (body.source !== undefined) updates.source = body.source;
    if (body.author !== undefined) updates.author = body.author;
    if (body.active !== undefined) updates.active = body.active;
    const [updated] = await db.update(platformPersonas).set(updates as Record<string, unknown>).where(eq(platformPersonas.id, id)).returning();
    if (!updated) return c.json({ error: 'Update failed' }, 500);
    // Invalidate the cloud capability cache for both old + new slug so the next
    // cloud run re-reads the edited persona body.
    await invalidateCapabilityCache(c.env, 'persona', existing.slug);
    if (updated.slug !== existing.slug) await invalidateCapabilityCache(c.env, 'persona', updated.slug);
    return c.json({
      persona: {
        id:         updated.id,
        name:       updated.name,
        slug:       updated.slug,
        description: updated.description ?? null,
        voice:      updated.voice ?? null,
        perspective: updated.perspective ?? null,
        decisionStyle: updated.decisionStyle ?? null,
        outputPrefix: updated.outputPrefix ?? null,
        capabilities: updated.capabilities ? (JSON.parse(updated.capabilities) as string[]) : [],
        tags:        updated.tags ? (JSON.parse(updated.tags) as string[]) : [],
        psychometric: updated.psychometric ? JSON.parse(updated.psychometric) : null,
        source:      updated.source ?? 'builtin',
        author:      updated.author ?? null,
        active:      updated.active,
        createdAt:   updated.createdAt?.toISOString() ?? null,
        updatedAt:   updated.updatedAt?.toISOString() ?? null,
      },
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /api/admin/personas/:id
  // -------------------------------------------------------------------------
  router.delete('/personas/:id', async (c) => {
    const db = buildDatabase(c.env);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
    const result = await db.delete(platformPersonas).where(eq(platformPersonas.id, id)).returning({ id: platformPersonas.id, slug: platformPersonas.slug });
    const deleted = result[0];
    if (!deleted) return c.json({ error: 'Persona not found' }, 404);
    await invalidateCapabilityCache(c.env, 'persona', deleted.slug);
    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/projects   — list all projects (for Governance tab)
  // -------------------------------------------------------------------------
  router.get('/projects', async (c) => {
    const db = buildDatabase(c.env);
    const rows = await db
      .select({
        id:         projects.id,
        name:       projects.name,
        tenantId:   projects.tenantId,
        governance: projects.governance,
        updatedAt:  projects.updatedAt,
        tenantName: tenants.name,
      })
      .from(projects)
      .leftJoin(tenants, eq(projects.tenantId, tenants.id))
      .orderBy(desc(projects.updatedAt));
    const list = rows.map((r) => ({
      id:         r.id,
      name:       r.name,
      tenantId:   r.tenantId,
      tenantName: r.tenantName ?? null,
      governance: r.governance ?? null,
      updatedAt:  r.updatedAt?.toISOString() ?? null,
    }));
    return c.json({ projects: list });
  });

  // -------------------------------------------------------------------------
  // PATCH /api/admin/projects/:id/governance   — update project governance (superadmin only)
  // -------------------------------------------------------------------------
  router.patch('/projects/:id/governance', async (c) => {
    const db = buildDatabase(c.env);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
    const body = await c.req.json<{ governance?: string | null }>();
    const [updated] = await db
      .update(projects)
      .set({ governance: body.governance ?? null, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning({ id: projects.id, name: projects.name, governance: projects.governance });
    if (!updated) return c.json({ error: 'Project not found' }, 404);
    return c.json({ project: { id: updated.id, name: updated.name, governance: updated.governance ?? null } });
  });

  // ===========================================================================
  // IMPERSONATION SYSTEM  (PRD §4.2)
  // ===========================================================================

  // Helper: write an audit log entry. Thin wrapper over the shared
  // `writeAdminAudit` so every admin route uses one insert path.
  const writeAudit = (
    db: Db,
    event: string,
    actorId: string,
    opts: AdminAuditOpts = {},
  ) => writeAdminAudit(db, event, actorId, opts);

  // -------------------------------------------------------------------------
  // POST /api/admin/impersonation/start
  // Begin an impersonation session and return an emulation token.
  // -------------------------------------------------------------------------
  router.post('/impersonation/start', async (c) => {
    const adminId = c.get('userId') as string;
    const db = buildDatabase(c.env);
    const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? null;
    const ua = c.req.header('User-Agent') ?? null;

    const body = await c.req.json<{
      userId: string;
      tenantId: number;
      role?: string;
      reason: string;
      enableDebugger?: boolean;
    }>();

    if (!body.userId || !body.tenantId || !body.reason?.trim()) {
      return c.json({ error: 'userId, tenantId, and reason are required' }, 400);
    }

    // Reject if target is a Super Admin
    const [targetRow] = await db
      .select({ id: users.id, email: users.email, displayName: users.displayName, avatarUrl: users.avatarUrl, isSuperadmin: users.isSuperadmin })
      .from(users)
      .where(eq(users.id, body.userId))
      .limit(1);

    if (!targetRow) return c.json({ error: 'User not found' }, 404);
    if (targetRow.isSuperadmin) {
      return c.json({ error: 'Cannot impersonate a Super Admin account' }, 403);
    }

    // Reject if the admin already has an active session
    const [existingSession] = await db
      .select({ id: adminImpersonationSessions.id })
      .from(adminImpersonationSessions)
      .where(and(
        eq(adminImpersonationSessions.adminUserId, adminId),
        isNull(adminImpersonationSessions.endedAt),
      ))
      .limit(1);

    if (existingSession) {
      return c.json({ error: 'You already have an active impersonation session. End it before starting a new one.', sessionId: existingSession.id }, 409);
    }

    // Resolve the tenant + role
    const [tenantRow] = await db
      .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.id, body.tenantId))
      .limit(1);

    if (!tenantRow) return c.json({ error: 'Tenant not found' }, 404);

    const [memberRow] = await db
      .select({ role: tenantMembers.role })
      .from(tenantMembers)
      .where(and(
        eq(tenantMembers.userId, body.userId),
        eq(tenantMembers.tenantId, body.tenantId),
        eq(tenantMembers.isActive, true),
      ))
      .limit(1);

    const resolvedRole = (body.role ?? memberRow?.role ?? 'viewer') as Parameters<typeof signEmulationJwt>[0]['role'];
    const expiresAt = new Date(Date.now() + 3600_000); // 1 hour

    // Create session record
    const [session] = await db
      .insert(adminImpersonationSessions)
      .values({
        adminUserId:     adminId,
        targetUserId:    body.userId,
        tenantId:        body.tenantId,
        roleOverride:    resolvedRole,
        reason:          body.reason.trim(),
        expiresAt,
        ipAddress:       ip,
        userAgent:       ua,
        debuggerEnabled: body.enableDebugger ?? false,
      })
      .returning();

    if (!session) return c.json({ error: 'Failed to create impersonation session' }, 500);

    // Sign emulation JWT
    const token = await signEmulationJwt(
      { sub: body.userId, tid: body.tenantId, role: resolvedRole, emuBy: adminId, emuSid: session.id },
      c.env.JWT_SECRET,
    );

    // Store the JTI back on the session for revocation
    const jtiMatch = token.split('.')[1];
    if (jtiMatch) {
      const tokenPayload = JSON.parse(atob(jtiMatch.replace(/-/g, '+').replace(/_/g, '/'))) as { jti?: string };
      if (tokenPayload.jti) {
        await db
          .update(adminImpersonationSessions)
          .set({ tokenJti: tokenPayload.jti })
          .where(eq(adminImpersonationSessions.id, session.id));
      }
    }

    await writeAudit(db, 'IMPERSONATION_STARTED', adminId, {
      targetUserId: body.userId,
      tenantId:     body.tenantId,
      metadata:     { sessionId: session.id, role: resolvedRole, reason: body.reason.trim(), debugger: body.enableDebugger ?? false },
      ipAddress:    ip,
    });

    return c.json({
      emulationSessionId: session.id,
      token,
      user: {
        id:          targetRow.id,
        email:       targetRow.email,
        displayName: targetRow.displayName,
        avatarUrl:   targetRow.avatarUrl,
      },
      tenant: { id: tenantRow.id, name: tenantRow.name, slug: tenantRow.slug },
      role:        resolvedRole,
      startedAt:   session.startedAt?.toISOString() ?? new Date().toISOString(),
      expiresAt:   expiresAt.toISOString(),
      debugger:    body.enableDebugger ?? false,
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/admin/impersonation/:id/end
  // End an active impersonation session and invalidate the token.
  // -------------------------------------------------------------------------
  router.post('/impersonation/:id/end', async (c) => {
    const adminId = c.get('userId') as string;
    const sessionId = c.req.param('id');
    const db = buildDatabase(c.env);

    const [session] = await db
      .select()
      .from(adminImpersonationSessions)
      .where(and(
        eq(adminImpersonationSessions.id, sessionId),
        eq(adminImpersonationSessions.adminUserId, adminId),
      ))
      .limit(1);

    if (!session) return c.json({ error: 'Session not found' }, 404);
    if (session.endedAt) return c.json({ error: 'Session already ended' }, 409);

    const now = new Date();
    await db
      .update(adminImpersonationSessions)
      .set({ endedAt: now, endReason: 'MANUAL' })
      .where(eq(adminImpersonationSessions.id, sessionId));

    // Revoke the token JTI
    if (session.tokenJti) {
      await db
        .update(authTokens)
        .set({ revokedAt: now })
        .where(eq(authTokens.jti, session.tokenJti));
    }

    const durationMs = now.getTime() - (session.startedAt?.getTime() ?? now.getTime());
    const durationMin = Math.round(durationMs / 60_000);

    await writeAudit(db, 'IMPERSONATION_ENDED', adminId, {
      targetUserId: session.targetUserId,
      tenantId:     session.tenantId,
      metadata:     { sessionId, endReason: 'MANUAL', durationMinutes: durationMin, writeBlockCount: session.writeBlockCount },
    });

    return c.json({ ok: true, sessionId, durationMinutes: durationMin });
  });

  // -------------------------------------------------------------------------
  // POST /api/admin/impersonation/:id/switch-role
  // Switch the active role mid-session, re-issue emulation token.
  // -------------------------------------------------------------------------
  router.post('/impersonation/:id/switch-role', async (c) => {
    const adminId = c.get('userId') as string;
    const sessionId = c.req.param('id');
    const db = buildDatabase(c.env);
    const { role } = await c.req.json<{ role: string }>();

    if (!role) return c.json({ error: 'role is required' }, 400);

    const [session] = await db
      .select()
      .from(adminImpersonationSessions)
      .where(and(
        eq(adminImpersonationSessions.id, sessionId),
        eq(adminImpersonationSessions.adminUserId, adminId),
        isNull(adminImpersonationSessions.endedAt),
      ))
      .limit(1);

    if (!session) return c.json({ error: 'Active session not found' }, 404);

    const fromRole = session.roleOverride;

    // Log the role switch
    await db.insert(adminImpersonationRoleSwitches).values({
      sessionId,
      fromRole,
      toRole: role,
    });

    // Update the session's current role
    await db
      .update(adminImpersonationSessions)
      .set({ roleOverride: role })
      .where(eq(adminImpersonationSessions.id, sessionId));

    // Invalidate old token JTI if present
    if (session.tokenJti) {
      await db
        .update(authTokens)
        .set({ revokedAt: new Date() })
        .where(eq(authTokens.jti, session.tokenJti));
    }

    // Issue new emulation token with the new role
    const newToken = await signEmulationJwt(
      {
        sub:    session.targetUserId,
        tid:    session.tenantId,
        role:   role as Parameters<typeof signEmulationJwt>[0]['role'],
        emuBy:  adminId,
        emuSid: sessionId,
      },
      c.env.JWT_SECRET,
    );

    await writeAudit(db, 'IMPERSONATION_PERSONA_SWITCHED', adminId, {
      targetUserId: session.targetUserId,
      tenantId:     session.tenantId,
      metadata:     { sessionId, fromRole, toRole: role },
    });

    return c.json({ ok: true, token: newToken, role });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/impersonation/active
  // Return the requesting admin's currently active session (if any).
  // -------------------------------------------------------------------------
  router.get('/impersonation/active', async (c) => {
    const adminId = c.get('userId') as string;
    const db = buildDatabase(c.env);

    const [session] = await db
      .select()
      .from(adminImpersonationSessions)
      .where(and(
        eq(adminImpersonationSessions.adminUserId, adminId),
        isNull(adminImpersonationSessions.endedAt),
        gt(adminImpersonationSessions.expiresAt, new Date()),
      ))
      .limit(1);

    if (!session) return c.json({ session: null });

    const [targetUser] = await db
      .select({ id: users.id, email: users.email, displayName: users.displayName, avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, session.targetUserId))
      .limit(1);

    const [tenant] = await db
      .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.id, session.tenantId))
      .limit(1);

    return c.json({
      session: {
        id:             session.id,
        role:           session.roleOverride,
        startedAt:      session.startedAt?.toISOString(),
        expiresAt:      session.expiresAt?.toISOString(),
        debuggerEnabled: session.debuggerEnabled,
        user:           targetUser ?? null,
        tenant:         tenant ?? null,
      },
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/impersonation
  // List all impersonation sessions (paginated).
  // -------------------------------------------------------------------------
  router.get('/impersonation', async (c) => {
    const db = buildDatabase(c.env);
    const limit  = Math.min(parsePositiveInt(c.req.query('limit'), 50), 200);
    const offset = parsePositiveInt(c.req.query('offset'), 0);

    const rows = await db
      .select({
        id:             adminImpersonationSessions.id,
        adminUserId:    adminImpersonationSessions.adminUserId,
        targetUserId:   adminImpersonationSessions.targetUserId,
        tenantId:       adminImpersonationSessions.tenantId,
        roleOverride:   adminImpersonationSessions.roleOverride,
        reason:         adminImpersonationSessions.reason,
        startedAt:      adminImpersonationSessions.startedAt,
        endedAt:        adminImpersonationSessions.endedAt,
        expiresAt:      adminImpersonationSessions.expiresAt,
        endReason:      adminImpersonationSessions.endReason,
        writeBlockCount: adminImpersonationSessions.writeBlockCount,
        debuggerEnabled: adminImpersonationSessions.debuggerEnabled,
        ipAddress:      adminImpersonationSessions.ipAddress,
        adminEmail:     users.email,
      })
      .from(adminImpersonationSessions)
      .leftJoin(users, eq(users.id, adminImpersonationSessions.adminUserId))
      .orderBy(desc(adminImpersonationSessions.startedAt))
      .limit(limit)
      .offset(offset);

    return c.json({ sessions: rows.map((r) => ({
      ...r,
      startedAt: r.startedAt?.toISOString() ?? null,
      endedAt:   r.endedAt?.toISOString() ?? null,
      expiresAt: r.expiresAt?.toISOString() ?? null,
    })) });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/impersonation/:id
  // Get a single session detail including role switch history.
  // -------------------------------------------------------------------------
  router.get('/impersonation/:id', async (c) => {
    const db = buildDatabase(c.env);
    const sessionId = c.req.param('id');

    const [session] = await db
      .select()
      .from(adminImpersonationSessions)
      .where(eq(adminImpersonationSessions.id, sessionId))
      .limit(1);

    if (!session) return c.json({ error: 'Session not found' }, 404);

    const roleSwitches = await db
      .select()
      .from(adminImpersonationRoleSwitches)
      .where(eq(adminImpersonationRoleSwitches.sessionId, sessionId))
      .orderBy(adminImpersonationRoleSwitches.switchedAt);

    const [targetUser] = await db
      .select({ id: users.id, email: users.email, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, session.targetUserId))
      .limit(1);

    return c.json({
      session: {
        ...session,
        startedAt: session.startedAt?.toISOString() ?? null,
        endedAt:   session.endedAt?.toISOString() ?? null,
        expiresAt: session.expiresAt?.toISOString() ?? null,
        targetUser: targetUser ?? null,
      },
      roleSwitches: roleSwitches.map((r) => ({
        ...r,
        switchedAt: r.switchedAt?.toISOString() ?? null,
      })),
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/audit-log
  // Paginated, filterable audit log.
  // -------------------------------------------------------------------------
  router.get('/audit-log', async (c) => {
    const db = buildDatabase(c.env);
    const limit  = Math.min(parsePositiveInt(c.req.query('limit'), 50), 200);
    const offset = parsePositiveInt(c.req.query('offset'), 0);
    const event  = c.req.query('event') ?? null;
    const actor  = c.req.query('actor') ?? null;
    const target = c.req.query('target') ?? null;

    const conditions = [];
    if (event)  conditions.push(eq(adminAuditLog.event, event));
    if (actor)  conditions.push(eq(adminAuditLog.actorId, actor));
    if (target) conditions.push(eq(adminAuditLog.targetUserId, target));

    const rows = await db
      .select()
      .from(adminAuditLog)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(adminAuditLog.createdAt))
      .limit(limit)
      .offset(offset);

    return c.json({ entries: rows.map((r) => ({
      ...r,
      createdAt: r.createdAt?.toISOString() ?? null,
    })) });
  });

  // =========================================================================
  // PERMISSION MATRIX ROUTES
  // =========================================================================

  // GET /api/admin/permissions — full permission registry
  router.get('/permissions', async (c) => {
    return c.json({ permissions: ALL_PERMISSIONS });
  });

  // GET /api/admin/permissions/matrix — current effective role × permission matrix
  router.get('/permissions/matrix', async (c) => {
    const db = buildDatabase(c.env);
    const overrides = await db.select().from(rolePermissionOverrides);
    const roles = ['viewer', 'developer', 'manager', 'owner'] as const;
    const matrix: Record<string, string[]> = {};
    for (const role of roles) {
      const roleOverrides = overrides.filter((o) => o.role === role);
      matrix[role] = resolveRolePermissions(role, roleOverrides);
    }
    return c.json({
      roles,
      permissions: ALL_PERMISSIONS,
      matrix,
      overrides: overrides.map((o) => ({ tenantId: null, role: o.role, permission: o.permission, granted: o.granted })),
    });
  });

  // PUT /api/admin/permissions/roles/:role — update permission overrides for a role
  router.put('/permissions/roles/:role', async (c) => {
    const db = buildDatabase(c.env);
    const actorId = c.get('userId') as string;
    const role = c.req.param('role');
    const validRoles = ['viewer', 'developer', 'manager', 'owner'];
    if (!validRoles.includes(role)) {
      return c.json({ error: 'Invalid role' }, 400);
    }
    const body = await c.req.json<{ overrides: Array<{ permission: string; granted: boolean; reason?: string }> }>();
    if (!Array.isArray(body.overrides)) return c.json({ error: 'overrides array required' }, 400);

    // Upsert each override
    for (const override of body.overrides) {
      await db
        .insert(rolePermissionOverrides)
        .values({ role, permission: override.permission, granted: override.granted, reason: override.reason ?? null, createdBy: actorId })
        .onConflictDoUpdate({
          target: [rolePermissionOverrides.role, rolePermissionOverrides.permission],
          set: { granted: override.granted, reason: override.reason ?? null },
        });
    }

    await writeAudit(db, 'ROLE_PERMISSION_CHANGED', actorId, {
      metadata: { role, overrides: body.overrides },
      ipAddress: c.req.header('CF-Connecting-IP') ?? null,
    });

    const updated = await db.select().from(rolePermissionOverrides).where(eq(rolePermissionOverrides.role, role));
    return c.json({ role, permissions: resolveRolePermissions(role, updated) });
  });

  // GET /api/admin/permissions/matrix/export — CSV export
  router.get('/permissions/matrix/export', async (c) => {
    const db = buildDatabase(c.env);
    const overrides = await db.select().from(rolePermissionOverrides);
    const roles = ['viewer', 'developer', 'manager', 'owner'];
    const header = ['permission', ...roles].join(',');
    const rows = ALL_PERMISSIONS.map((perm) => {
      const cols = roles.map((role) => {
        const roleOverrides = overrides.filter((o) => o.role === role);
        const perms = resolveRolePermissions(role, roleOverrides);
        return (perms as string[]).includes(perm as string) ? '1' : '0';
      });
      return [perm, ...cols].join(',');
    });
    const csv = [header, ...rows].join('\n');
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="permission-matrix.csv"',
      },
    });
  });

  // =========================================================================
  // MODULES ROUTES
  // =========================================================================

  // GET /api/admin/modules
  router.get('/modules', async (c) => {
    const db = buildDatabase(c.env);
    const rows = await db.select().from(platformModules).orderBy(platformModules.name);
    return c.json({
      modules: rows.map((m) => ({
        ...m,
        permissions: coercePermissions(m.permissions),
        createdAt: m.createdAt?.toISOString() ?? null,
        updatedAt: m.updatedAt?.toISOString() ?? null,
      })),
    });
  });

  // POST /api/admin/modules
  router.post('/modules', async (c) => {
    const db = buildDatabase(c.env);
    const actorId = c.get('userId') as string;
    const body = await c.req.json<{
      name: string;
      slug?: string;
      description?: string;
      baseRole?: string;
      permissions?: string[];
    }>();
    if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
    const slug = (body.slug?.trim() || body.name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''));
    const [mod] = await db
      .insert(platformModules)
      .values({
        name: body.name.trim(),
        slug,
        description: body.description?.trim() ?? null,
        baseRole: body.baseRole ?? null,
        permissions: JSON.stringify(body.permissions ?? []),
        isBuiltin: false,
        createdBy: actorId,
      })
      .returning();
    await writeAudit(db, 'MODULE_ASSIGNED', actorId, { metadata: { moduleId: mod!.id, name: mod!.name } });
    return c.json({ module: { ...mod, permissions: coercePermissions(mod!.permissions) } }, 201);
  });

  // PATCH /api/admin/modules/:id
  router.patch('/modules/:id', async (c) => {
    const db = buildDatabase(c.env);
    const actorId = c.get('userId') as string;
    const id = c.req.param('id');
    const body = await c.req.json<{ name?: string; description?: string; baseRole?: string; permissions?: string[] }>();
    const [mod] = await db
      .update(platformModules)
      .set({
        ...(body.name && { name: body.name.trim() }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.baseRole !== undefined && { baseRole: body.baseRole }),
        ...(body.permissions !== undefined && { permissions: JSON.stringify(body.permissions) }),
        updatedAt: new Date(),
      })
      .where(eq(platformModules.id, id))
      .returning();
    if (!mod) return c.json({ error: 'Module not found' }, 404);
    return c.json({ module: { ...mod, permissions: coercePermissions(mod.permissions) } });
  });

  // DELETE /api/admin/modules/:id
  router.delete('/modules/:id', async (c) => {
    const db = buildDatabase(c.env);
    const actorId = c.get('userId') as string;
    const id = c.req.param('id');
    const [mod] = await db.select({ isBuiltin: platformModules.isBuiltin, name: platformModules.name }).from(platformModules).where(eq(platformModules.id, id)).limit(1);
    if (!mod) return c.json({ error: 'Module not found' }, 404);
    if (mod.isBuiltin) return c.json({ error: 'Cannot delete a built-in module' }, 403);
    await db.delete(platformModules).where(eq(platformModules.id, id));
    await writeAudit(db, 'MODULE_REMOVED', actorId, { metadata: { moduleId: id, name: mod.name } });
    return c.json({ ok: true });
  });

  // POST /api/admin/tenants/:tenantId/members/:userId/modules — assign module to user
  router.post('/tenants/:tenantId/members/:userId/modules', async (c) => {
    const db = buildDatabase(c.env);
    const actorId = c.get('userId') as string;
    const tenantId = parseInt(c.req.param('tenantId'), 10);
    const userId = c.req.param('userId');
    const body = await c.req.json<{ moduleId: string }>();
    if (!body.moduleId) return c.json({ error: 'moduleId is required' }, 400);
    await db.insert(tenantMemberModules).values({
      tenantId, userId, moduleId: body.moduleId, grantedBy: actorId,
    }).onConflictDoNothing();
    await writeAudit(db, 'MODULE_ASSIGNED', actorId, { targetUserId: userId, tenantId, metadata: { moduleId: body.moduleId } });
    return c.json({ ok: true });
  });

  // DELETE /api/admin/tenants/:tenantId/members/:userId/modules/:moduleId
  router.delete('/tenants/:tenantId/members/:userId/modules/:moduleId', async (c) => {
    const db = buildDatabase(c.env);
    const actorId = c.get('userId') as string;
    const tenantId = parseInt(c.req.param('tenantId'), 10);
    const userId = c.req.param('userId');
    const moduleId = c.req.param('moduleId');
    await db.delete(tenantMemberModules).where(
      and(eq(tenantMemberModules.tenantId, tenantId), eq(tenantMemberModules.userId, userId), eq(tenantMemberModules.moduleId, moduleId))
    );
    await writeAudit(db, 'MODULE_REMOVED', actorId, { targetUserId: userId, tenantId, metadata: { moduleId } });
    return c.json({ ok: true });
  });

  // =========================================================================
  // ENHANCED USER MANAGEMENT ROUTES
  // =========================================================================

  // POST /api/admin/users/:id/force-logout — increment session_version + revoke all tokens
  router.post('/users/:id/force-logout', async (c) => {
    const db = buildDatabase(c.env);
    const actorId = c.get('userId') as string;
    const targetId = c.req.param('id');
    // Increment session_version (JWT-level invalidation for future tokens carrying sv)
    await db.update(users).set({ sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, targetId));
    // Revoke all active auth tokens
    await db.update(authTokens).set({ revokedAt: new Date() }).where(and(eq(authTokens.userId, targetId), isNull(authTokens.revokedAt)));
    // Deactivate all sessions
    await db.update(authUserSessions).set({ isActive: false, revokedAt: new Date() }).where(and(eq(authUserSessions.userId, targetId), eq(authUserSessions.isActive, true)));
    await writeAudit(db, 'USER_SESSIONS_REVOKED', actorId, {
      targetUserId: targetId,
      metadata: { method: 'force_logout' },
      ipAddress: c.req.header('CF-Connecting-IP') ?? null,
    });
    return c.json({ ok: true });
  });

  // POST /api/admin/users/:id/reset-password — send password reset email
  router.post('/users/:id/reset-password', async (c) => {
    const db = buildDatabase(c.env);
    const actorId = c.get('userId') as string;
    const targetId = c.req.param('id');
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, targetId)).limit(1);
    if (!user) return c.json({ error: 'User not found' }, 404);

    // Generate a 24-hour magic link so the user can sign in and set a new password
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const frontendBase = resolveAppBaseUrl(c.env);

    await db
      .update(magicLinkTokens)
      .set({ used: true })
      .where(and(eq(magicLinkTokens.email, user.email), eq(magicLinkTokens.used, false)));

    await db.insert(magicLinkTokens).values({
      email: user.email,
      token,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      redirect: '/settings/account',
    });

    const magicUrl = `${frontendBase}/auth/magic-link?token=${encodeURIComponent(token)}`;
    // The admin triggering this may not share the target's language, so the
    // resolver's stored-locale lookup (keyed on the TARGET's address) is what
    // matters here; the admin's request headers are only a last resort.
    void sendTransactionalEmail(
      c.env,
      db,
      user.email,
      ({ locale }) => sendAdminPasswordResetEmail(c.env, user.email, magicUrl, locale),
    );

    await writeAudit(db, 'USER_PASSWORD_RESET_FORCED', actorId, {
      targetUserId: targetId,
      metadata: { email: user.email },
      ipAddress: c.req.header('CF-Connecting-IP') ?? null,
    });
    return c.json({ ok: true, email: user.email });
  });

  // PUT /api/admin/users/:id/status — activate / suspend
  router.put('/users/:id/status', async (c) => {
    const db = buildDatabase(c.env);
    const actorId = c.get('userId') as string;
    const targetId = c.req.param('id');
    const body = await c.req.json<{ suspended: boolean }>();
    await db
      .update(users)
      .set({ isSuspended: body.suspended, updatedAt: sql`now()` })
      .where(eq(users.id, targetId));
    // Revoke all active tokens so suspended users are kicked immediately
    if (body.suspended) {
      await db.update(authTokens).set({ revokedAt: new Date() }).where(and(eq(authTokens.userId, targetId), isNull(authTokens.revokedAt)));
    }
    await writeAudit(db, 'USER_STATUS_CHANGED', actorId, {
      targetUserId: targetId,
      metadata: { suspended: body.suspended },
      ipAddress: c.req.header('CF-Connecting-IP') ?? null,
    });
    return c.json({ ok: true });
  });

  // PUT /api/admin/users/:id/permissions — grant/revoke per-user permissions
  router.put('/users/:id/permissions', async (c) => {
    const db = buildDatabase(c.env);
    const actorId = c.get('userId') as string;
    const targetId = c.req.param('id');
    const body = await c.req.json<{
      tenantId: number;
      overrides: Array<{ permission: string; granted: boolean; expiresAt?: string }>;
    }>();
    if (!body.tenantId || !Array.isArray(body.overrides)) {
      return c.json({ error: 'tenantId and overrides array required' }, 400);
    }
    for (const o of body.overrides) {
      await db
        .insert(userPermissionOverrides)
        .values({
          tenantId: body.tenantId,
          userId: targetId,
          permission: o.permission,
          granted: o.granted,
          expiresAt: o.expiresAt ? new Date(o.expiresAt) : null,
          createdBy: actorId,
        })
        .onConflictDoUpdate({
          target: [userPermissionOverrides.tenantId, userPermissionOverrides.userId, userPermissionOverrides.permission],
          set: { granted: o.granted, expiresAt: o.expiresAt ? new Date(o.expiresAt) : null },
        });
    }
    await writeAudit(db, 'USER_PERMISSION_OVERRIDE', actorId, {
      targetUserId: targetId,
      tenantId: body.tenantId,
      metadata: { overrides: body.overrides },
      ipAddress: c.req.header('CF-Connecting-IP') ?? null,
    });
    return c.json({ ok: true });
  });

  // PATCH /api/admin/tenants/:tenantId/members/:userId/role — override member role
  router.patch('/tenants/:tenantId/members/:userId/role', async (c) => {
    const db = buildDatabase(c.env);
    const actorId = c.get('userId') as string;
    const tenantId = parseInt(c.req.param('tenantId'), 10);
    const userId = c.req.param('userId');
    const body = await c.req.json<{ role: string }>();
    const validRoles = ['viewer', 'developer', 'manager', 'owner'];
    if (!validRoles.includes(body.role)) return c.json({ error: 'Invalid role' }, 400);
    const [row] = await db.select({ id: tenantMembers.id }).from(tenantMembers).where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId))).limit(1);
    if (!row) return c.json({ error: 'Member not found in tenant' }, 404);
    await db.update(tenantMembers).set({ role: body.role as 'viewer' | 'developer' | 'manager' | 'owner' }).where(eq(tenantMembers.id, row.id));
    // Bust the gateway's JWT→membership cache so the new role takes effect at once
    // (otherwise a demote keeps elevated gateway access until the 60s TTL lapses).
    await invalidateJwtMembershipCache(c.env as Env, tenantId, userId).catch(() => {});
    await writeAudit(db, 'USER_PERSONA_CHANGED', actorId, {
      targetUserId: userId,
      tenantId,
      metadata: { newRole: body.role },
      ipAddress: c.req.header('CF-Connecting-IP') ?? null,
    });
    return c.json({ ok: true });
  });

  // GET /api/admin/users/:id/effective-permissions — resolved permissions for user in tenant
  router.get('/users/:id/effective-permissions', async (c) => {
    const db = buildDatabase(c.env);
    const targetId = c.req.param('id');
    const tenantId = parseInt(c.req.query('tenantId') ?? '0', 10);
    if (!tenantId) return c.json({ error: 'tenantId query param required' }, 400);

    // Get user's role in tenant
    const [membership] = await db
      .select({ role: tenantMembers.role })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, targetId)))
      .limit(1);
    if (!membership) return c.json({ error: 'User is not a member of this tenant' }, 404);

    // Role overrides
    const roleOverrides = await db.select().from(rolePermissionOverrides).where(eq(rolePermissionOverrides.role, membership.role));
    const rolePerms = resolveRolePermissions(membership.role, roleOverrides);

    // Module permissions
    const assignedModules = await db
      .select({ permissions: platformModules.permissions })
      .from(tenantMemberModules)
      .innerJoin(platformModules, eq(tenantMemberModules.moduleId, platformModules.id))
      .where(and(eq(tenantMemberModules.tenantId, tenantId), eq(tenantMemberModules.userId, targetId)));
    const modulePerms = assignedModules.flatMap((m) => coercePermissions(m.permissions));

    // Per-user overrides
    const userOverrides = await db.select().from(userPermissionOverrides).where(and(eq(userPermissionOverrides.tenantId, tenantId), eq(userPermissionOverrides.userId, targetId)));
    const userGrants    = userOverrides.filter((o) => o.granted).map((o) => o.permission);
    const userRevokes   = userOverrides.filter((o) => !o.granted).map((o) => o.permission);

    const effective = resolveEffectivePermissions({ rolePermissions: rolePerms, modulePermissions: modulePerms, userGrants, userRevocations: userRevokes });

    return c.json({
      userId: targetId,
      tenantId,
      role: membership.role,
      permissions: effective,
      rolePermissions: rolePerms,
      modulePermissions: modulePerms,
      userGrants,
      userRevocations: userRevokes,
      // Keep the original field during the rolling-deploy window for any older
      // clients that consumed the route before its response contract was fixed.
      effectivePermissions: effective,
    });
  });

  // GET /api/admin/audit-log/export — CSV export
  router.get('/audit-log/export', async (c) => {
    const db = buildDatabase(c.env);
    const event  = c.req.query('event') ?? null;
    const actor  = c.req.query('actor') ?? null;
    const target = c.req.query('target') ?? null;
    const conditions = [];
    if (event)  conditions.push(eq(adminAuditLog.event, event));
    if (actor)  conditions.push(eq(adminAuditLog.actorId, actor));
    if (target) conditions.push(eq(adminAuditLog.targetUserId, target));

    const rows = await db
      .select()
      .from(adminAuditLog)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(adminAuditLog.createdAt))
      .limit(10000);

    const header = 'id,event,actorId,targetUserId,tenantId,ipAddress,createdAt,metadata';
    const csv = [
      header,
      ...rows.map((r) =>
        [r.id, r.event, r.actorId ?? '', r.targetUserId ?? '', r.tenantId ?? '', r.ipAddress ?? '', r.createdAt?.toISOString() ?? '', JSON.stringify(r.metadata ?? {}).replace(/"/g, '""')].map((v) => `"${v}"`).join(',')
      ),
    ].join('\n');
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="audit-log.csv"',
      },
    });
  });

  // GET /api/admin/users/:id/workspaces — workspace memberships for a user (tenantId, name, slug, role)
  router.get('/users/:id/workspaces', async (c) => {
    const db = buildDatabase(c.env);
    const targetId = c.req.param('id');
    const rows = await db
      .select({
        tenantId: tenantMembers.tenantId,
        name: tenants.name,
        slug: tenants.slug,
        role: tenantMembers.role,
        joinedAt: tenantMembers.joinedAt,
      })
      .from(tenantMembers)
      .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
      .where(and(eq(tenantMembers.userId, targetId), eq(tenantMembers.isActive, true)))
      .orderBy(tenantMembers.joinedAt);
    return c.json({
      workspaces: rows.map((r) => ({
        tenantId: r.tenantId,
        name: r.name,
        slug: r.slug,
        role: r.role,
        joinedAt: r.joinedAt instanceof Date ? r.joinedAt.toISOString() : (r.joinedAt ?? null),
      })),
    });
  });

  // GET /api/admin/users/:id/admin-access — impersonation sessions targeting this user (for target transparency)
  router.get('/users/:id/admin-access', async (c) => {
    const db = buildDatabase(c.env);
    const targetId = c.req.param('id');
    const rows = await db
      .select({
        id: adminImpersonationSessions.id,
        adminUserId: adminImpersonationSessions.adminUserId,
        tenantId: adminImpersonationSessions.tenantId,
        roleOverride: adminImpersonationSessions.roleOverride,
        startedAt: adminImpersonationSessions.startedAt,
        endedAt: adminImpersonationSessions.endedAt,
        expiresAt: adminImpersonationSessions.expiresAt,
        endReason: adminImpersonationSessions.endReason,
      })
      .from(adminImpersonationSessions)
      .where(eq(adminImpersonationSessions.targetUserId, targetId))
      .orderBy(desc(adminImpersonationSessions.startedAt))
      .limit(50);
    return c.json({
      sessions: rows.map((r) => ({
        ...r,
        startedAt: r.startedAt?.toISOString() ?? null,
        endedAt: r.endedAt?.toISOString() ?? null,
        expiresAt: r.expiresAt?.toISOString() ?? null,
        durationSeconds: r.endedAt && r.startedAt ? Math.floor((r.endedAt.getTime() - r.startedAt.getTime()) / 1000) : null,
        // Note: adminUserId is exposed here for superadmin use; end-user transparency API filters it out
      })),
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Tenant API keys (bfk_*) — superadmin mint-on-behalf for any tenant.
  // The owner self-service flow lives at /api/tenants/:id/api-keys; the
  // shared service module dedupes the mint/list/revoke logic.
  // ─────────────────────────────────────────────────────────────────────

  router.get('/tenants/:tenantId/api-keys', async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = Number(c.req.param('tenantId'));
    if (!Number.isFinite(tenantId)) return c.json({ error: 'Invalid tenantId' }, 400);
    const keys = await listTenantApiKeys(db, tenantId);
    return c.json({ keys });
  });

  router.post('/tenants/:tenantId/api-keys', async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = Number(c.req.param('tenantId'));
    if (!Number.isFinite(tenantId)) return c.json({ error: 'Invalid tenantId' }, 400);
    const adminUserId = c.get('userId') as string | undefined;
    const body = await c.req.json<{ name?: string; allowedOrigins?: string[] | null }>()
      .catch(() => ({} as { name?: string; allowedOrigins?: string[] | null }));
    const name = (body.name ?? '').trim() || 'Admin-issued tenant API key';
    const minted = await mintTenantApiKey(db, {
      tenantId,
      name,
      createdByUserId: adminUserId ?? null,
      allowedOrigins: normalizeOrigins(body.allowedOrigins),
    });
    return c.json(minted, 201);
  });

  router.get('/tenants/:tenantId/api-keys/:keyId/usage', async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = Number(c.req.param('tenantId'));
    if (!Number.isFinite(tenantId)) return c.json({ error: 'Invalid tenantId' }, 400);
    const keyId  = c.req.param('keyId');
    const days   = Number(c.req.query('days')  ?? '30');
    const page   = Number(c.req.query('page')  ?? '1');
    const limit  = Number(c.req.query('limit') ?? '100');
    const result = await queryTenantApiKeyUsage(db, { tenantId, keyId, days, page, limit });
    return c.json(result);
  });

  router.patch('/tenants/:tenantId/api-keys/:keyId', async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = Number(c.req.param('tenantId'));
    if (!Number.isFinite(tenantId)) return c.json({ error: 'Invalid tenantId' }, 400);
    const keyId = c.req.param('keyId');
    const body = await c.req.json<{ name?: string; allowedOrigins?: string[] | null }>()
      .catch(() => ({} as { name?: string; allowedOrigins?: string[] | null }));

    const updated = await updateTenantApiKey(db, {
      tenantId,
      keyId,
      ...(typeof body.name === 'string' ? { name: body.name } : {}),
      ...(body.allowedOrigins !== undefined ? { allowedOrigins: normalizeOrigins(body.allowedOrigins) } : {}),
      env: c.env,
    });
    if (!updated) return c.json({ error: 'Key not found, revoked, or no fields to update' }, 404);
    return c.json({ key: updated });
  });

  /**
   * Cross-tenant product feedback roll-up — the dogfooding inbox. Every external
   * request gathered by any tenant's feedback collector, newest first. Shares the
   * exact loader the per-tenant triage queue uses (`listFeedbackSubmissions`);
   * passing `tenantId: null` is what widens it to every workspace.
   */
  router.get('/feedback', async (c) => {
    const db = buildDatabase(c.env);
    const tenantParam = c.req.query('tenantId');
    const tenantId = tenantParam ? Number(tenantParam) : null;
    if (tenantId != null && !Number.isFinite(tenantId)) return c.json({ error: 'Invalid tenantId' }, 400);

    const filter = {
      tenantId,
      status: parseFeedbackStatus(c.req.query('status')),
      limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
      before: c.req.query('before') ?? null,
    };
    const [submissions, counts] = await Promise.all([
      listFeedbackSubmissions(db, c.env, filter),
      countFeedbackByStatus(db, c.env, { tenantId, projectId: null }),
    ]);
    return c.json({ submissions, counts });
  });

  /**
   * Superadmin review of any tenant's request. The decision itself runs through
   * the SAME engine as tenant-side triage, so approving here un-gates the ticket
   * identically — there is no second, privileged approval path to keep in sync.
   */
  router.post('/feedback/:id/review', async (c) => {
    const db = buildDatabase(c.env);
    const body = await c.req.json<{ decision?: string; tenantId?: number }>().catch(() => null);
    const decision = body?.decision;
    if (decision !== 'approved' && decision !== 'declined') {
      return c.json({ error: "decision must be 'approved' or 'declined'" }, 400);
    }
    if (typeof body?.tenantId !== 'number') return c.json({ error: 'tenantId is required' }, 400);

    const result = await reviewFeedbackSubmission(db, c.env, {
      tenantId: body.tenantId,
      submissionId: c.req.param('id'),
      decision,
      reviewerUserId: (c.get('userId') as string | undefined) ?? null,
    });
    if (!result.ok) return c.json({ error: 'Submission not found' }, 404);
    return c.json({ ok: true, taskId: result.taskId });
  });

  router.delete('/tenants/:tenantId/api-keys/:keyId', async (c) => {
    const db = buildDatabase(c.env);
    const tenantId = Number(c.req.param('tenantId'));
    if (!Number.isFinite(tenantId)) return c.json({ error: 'Invalid tenantId' }, 400);
    const keyId = c.req.param('keyId');
    const ok = await revokeTenantApiKey(db, { tenantId, keyId, env: c.env });
    if (!ok) return c.json({ error: 'Key not found' }, 404);
    return c.json({ ok: true });
  });

  return router;
}
