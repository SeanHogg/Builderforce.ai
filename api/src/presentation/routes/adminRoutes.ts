import { InternalError } from '../../domain/shared/errors';
import { isTenantRole } from '../../domain/shared/types';
import { resolveImpersonationRole } from '../../application/admin/impersonationRole';
import { IMPERSONATION_TTL_SECONDS, startImpersonation } from '../../application/admin/impersonationStart';
import { legacyAliasNotice } from '../middleware/legacyAlias';
import { invalidateEmulationSession } from '../../application/admin/emulationSessions';
import { failResponse, statusResponse } from '../middleware/errorResponse';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
import { parseBody, parseOptionalBody } from './requestBody';
import {
  BroadcastBody,
  CronControlBody,
  CronForceRunBody,
  DiscountCodeCreateBody,
  DiscountCodePatchBody,
  FeedbackReviewBody,
  ImageCreditsLimitBody,
  ImpersonationStartBody,
  LegalDocBody,
  LegalEnhanceBody,
  MaintenanceBody,
  MemberRoleBody,
  MfaChallengeBody,
  MfaEnableBody,
  ModuleAssignBody,
  ModuleCreateBody,
  ModulePatchBody,
  NewsletterEventBody,
  NewsletterTemplateBody,
  PaidOverflowCapBody,
  PartnerTrackBody,
  PersonaCreateBody,
  PersonaPatchBody,
  PremiumCapBody,
  PremiumOverrideBody,
  PricingDraftBody,
  PrivacyRequestPatchBody,
  ProjectGovernanceBody,
  PublisherStateBody,
  PublisherSuspensionBody,
  RolePermissionMatrixBody,
  SalesLeadPatchBody,
  SuspectRevokeBody,
  SwitchRoleBody,
  TokenLimitOverrideBody,
  UserPermissionOverridesBody,
  UserStatusBody,
  ManagedAgentHostProvisionBody,
} from './adminRoutes.schemas';
/**
 * Superadmin routes — /api/admin/*
 *
 * All routes require a WebJWT with sa: true (enforced by superAdminMiddleware).
 *
 * GET  /api/admin/users                — all platform users + tenant counts
 * GET  /api/admin/guest-sessions       — anonymous leads + the prompts they typed
 * GET  /api/admin/visitor-flow         — the anonymous funnel as a directed graph
 * GET  /api/admin/visitor-flow/:visitorId — one visitor's journey, visit by visit
 * GET  /api/admin/broadcasts          — platform messages to logged-out visitors
 * DELETE /api/admin/guest-sessions/:visitorId/prompts — erase one visitor's prompts
 * GET  /api/admin/creation-sessions    — saved Canvases with invitation evidence
 * GET  /api/admin/outcome-metrics      — platform/tenant/project value rollups
 * GET  /api/admin/tenants              — all tenants + member/agentHost counts
 * GET  /api/admin/health               — system health (DB ping, model pool, counts)
 * GET  /api/admin/errors               — recent API error log (last 200 entries)
 * GET  /api/admin/feedback             — cross-tenant product feedback roll-up
 * POST /api/admin/impersonate          — DEPRECATED alias of /impersonation/start (same use case)
 * GET  /api/admin/cron                 — scheduled sweeps + live KV work-gate state
 * POST /api/admin/cron/signal          — set the pending-work flag for the next tick
 * PATCH /api/admin/cron/:target        — enable/disable one scheduled sweep
 * POST /api/admin/cron/:target         — force-run a sweep / cadence group / all
 */
import { Hono } from 'hono';
import { and, desc, eq, gt, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { resolveAppBaseUrl, type Env, type HonoEnv } from '../../env';
import { invalidateTenantPlan } from '../../application/tenant/tenantPlanCache';
import { invalidateSessionVersion, revokeSessionTokens } from '../../application/auth/sessionRevocation';
import { credentialSecret } from '../../application/integrations/credentialCrypto';
import { superAdminMiddleware } from '../middleware/superAdminMiddleware';
import {
  PublisherError,
  setPublisherState,
  setPublisherSuspended,
} from '../../application/developer/publishers';
import { setPartnerTrack } from '../../application/developer/partnerPrograms';
import { invalidatePublicCatalog } from '../../application/developer/extensionRepository';
import { buildTransactionalDatabase, type Db } from '../../infrastructure/database/connection';
import { requestDb } from '../../application/shared/dbHandle';
import { writeAdminAudit, type AdminAuditOpts } from '../../infrastructure/audit/adminAudit';
import { reviewFeedbackSubmission } from '../../application/feedback/feedbackEngine';
import { loadFeedbackQueue } from '../../application/feedback/feedbackQueries';
import { FEEDBACK_DECISION_ERROR, feedbackQueueFilter, isFeedbackDecision } from './feedbackHttp';
import { slugify } from '@builderforce/creation-canvas-contract';
import { countActiveSessionsAndTokens } from '../../application/security/sessionCounts';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { computePlatformRollup } from '../../application/admin/platformRollup';
import { getOutcomeValueRollup } from '../../application/admin/outcomeValueRollup';
import { GuestPromptService } from '../../application/marketing/GuestPromptService';
import { VisitorJourneyService, VISITOR_FLOW_WINDOWS } from '../../application/marketing/VisitorJourneyService';
import {
  broadcastVocabulary,
  PlatformBroadcastService,
} from '../../application/marketing/PlatformBroadcastService';
import { isValidVisitorId } from '../../application/marketing/MarketingService';
import {
  clampErrorLogLimit,
  getErrorLogEntry,
  listErrorLogSources,
  queryErrorLog,
  summarizeErrorLog,
  type ErrorLogFilters,
} from '../../application/observability/errorLogQuery';
import {
  authTokens,
  authUserSessions,
  newsletterEvents,
  newsletterSubscribers,
  newsletterTemplates,
  users,
  tenants,
  tenantMembers,
  agentHosts,
  llmUsageLog,
  userMfaRecoveryCodes,
  projects,
  discountCodes,
  emailDeliveryFailures,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { normalizeDiscountCode } from '../../application/tenant/discountCodeService';
import { decodeJwtPayload, signEmulationJwt } from '../../infrastructure/auth/JwtService';
import {
  adminImpersonationSessions,
  adminImpersonationRoleSwitches,
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
  ENFORCED_PERMISSIONS,
} from '../../domain/permissions/permissionRegistry';
import {
  invalidateMemberPermissions,
  invalidateRolePermissions,
} from '../../application/rbac/effectivePermissions';
import { adminHealthReport, systemHealthReport, vendorProbesSection } from '../../application/health/platformHealth';
import { getAllVendorIds, type VendorId } from '../../application/llm/vendors';
import { summarizeActionRatings } from '../../application/llm/actionRatings';
import { llmFailoverLog, llmHealthProbes, llmTraces } from '../../infrastructure/database/schema';
import { probeVendor, tryAcquireProbeSlot, type VendorProbeResult } from '../../application/llm/vendorHealthProbe';
import { persistProbe } from '../../application/llm/vendorProbeStore';
import {
  createPlatformPersona,
  deletePlatformPersona,
  listPlatformPersonas,
  platformPersonaView,
  updatePlatformPersona,
} from '../../application/persona/platformPersonaCatalog';
import { tenantRoleOf } from '../../application/tenant/tenantRoles';
import { listPrivacyRequests, updatePrivacyRequest } from '../../application/legal/privacyRequests';
import { createPlatformTenantApiKeyRoutes } from './tenantApiKeyRoutes';
import { registerMemberCredentialRevocation } from './memberCredentialRevocationRoutes';
import { changeMemberRole } from '../../application/tenant/memberRoleChange';
import {
  applyCronControls,
  cronSweepEnabled,
  readCronControls,
  writeCronControl,
} from '../../application/runtime/cronControls';
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
import { isSafeRelationName, vacuumRelation } from '../../application/maintenance/tableMaintenance';
import { CRON_SWEEPS } from '../../cronSweeps';
import {
  CADENCE_BY_CRON,
  CRON_CADENCES,
  resolveCronTarget,
  runCronSweeps,
} from '../../application/runtime/cronSweepRunner';
import { evaluateCronGate, readScheduleStall, signalPendingWork } from '../../application/runtime/cronWorkSignal';
import { createTickDispatchBudget } from '../../application/runtime/tickDispatchBudget';
import { getPricingDraft, publishPricing, savePricingDraft } from '../../application/tenant/pricingConfiguration';
import {
  listManagedAgentHostRequests,
  provisionManagedAgentHostRequest,
  type ManagedAgentHostRequestStatus,
} from '../../application/tenant/managedAgentHostSubscription';
import { coerceStringArray } from '../../domain/shared/jsonColumn';
import { daysParam } from './queryParams';
import { adminAuditFilterFrom, listAdminAuditLog } from '../../application/audit/adminAuditLog';
import { loadPermissionMatrix } from '../../application/admin/permissionMatrix';
import { adminAuditLogExportSource, permissionMatrixExportSource } from '../../application/admin/adminExportSources';
import { exportSourceHandler } from './exportSourceRoute';
import { LIST_ROW_CAP } from '../../domain/shared/boundedInt';
import { randomHex } from '../../domain/shared/bytes';
import { excluded } from '../../infrastructure/database/upsert';
import { platformUsageReport } from '../../application/llm/usageReports';

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
  return slugify(input, { maxLength: 180 });
}

/** Active member of the workspace? Delegates to the ONE membership read. */
async function assertTenantMember(db: Db, tenantId: number, userId: string): Promise<boolean> {
  return (await tenantRoleOf(db, tenantId, userId)) !== null;
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

/**
 * Throwaway-mail domains, for the pre-OTP account review.
 *
 * Deliberately a short, hand-picked list rather than a downloaded blocklist:
 * this is one signal out of three on a screen a human reads, and a 100k-entry
 * list would put a megabyte in the Worker to make a heuristic marginally
 * better at something nobody automates on.
 */
const DISPOSABLE_DOMAINS = [
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.info', 'sharklasers.com',
  'yopmail.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org',
  'trashmail.com', 'getnada.com', 'dispostable.com', 'maildrop.cc',
  'fakeinbox.com', 'throwawaymail.com', 'mailnesia.com', 'spamgourmet.com',
  'discard.email', 'mohmal.com', 'moakt.com', 'emailondeck.com',
];

export function createAdminRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // All admin routes require superadmin WebJWT
  router.use('*', superAdminMiddleware);

  router.get('/pricing', async (c) => c.json(await getPricingDraft(requestDb(c))));

  router.get('/managed-agent-hosts', async (c) => {
    return c.json({ requests: await listManagedAgentHostRequests(requestDb(c), 'platform', c.req.query('status')) });
  });

  router.patch('/managed-agent-hosts/:id', async (c) => {
    const db = requestDb(c);
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid request id' }, 400);
    const body = await parseBody(c, ManagedAgentHostProvisionBody);
    if (!body.status) return c.json({ error: 'status is required' }, 400);
    const result = await provisionManagedAgentHostRequest(db, {
      requestId: id,
      status: body.status as ManagedAgentHostRequestStatus,
      agentHostId: body.agentHostId ?? null,
    });
    if ('error' in result) return c.json({ error: result.error.error }, result.error.status);
    const actorId = c.get('userId') as string;
    await writeAdminAudit(db, 'MANAGED_AGENT_HOST_PROVISIONED', actorId, {
      metadata: { requestId: id, status: body.status, agentHostId: body.agentHostId ?? null },
    });
    return c.json({ request: result.request });
  });

  // Draft saves never touch the public cache. Only the explicit publication
  // boundary below can make content visible and invalidate cached responses.
  router.put('/pricing/draft', async (c) => {
    // Read above the try: an unreadable body is the shared 400, not this catch's message.
    const document = await parseBody(c, PricingDraftBody);
    try {
      return c.json({ draft: await savePricingDraft(requestDb(c), document) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Invalid pricing configuration' }, 400);
    }
  });

  router.post('/pricing/publish', async (c) => {
    const db = requestDb(c);
    const actorId = c.get('userId') as string;
    const published = await publishPricing(db, c.env as Env, actorId);
    await writeAdminAudit(db, 'PLATFORM_PRICING_PUBLISHED', actorId, {
      metadata: { currency: published.currency, publishedAt: published.publishedAt },
    });
    return c.json({ published });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/legal/current
  // -------------------------------------------------------------------------
  router.get('/legal/current', async (c) => {
    const db = requestDb(c);
    return c.json(await getLegalCurrent(db));
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/legal/history[?docType=terms|privacy] — full audit trail of
  // every publish + amend, newest first.
  // -------------------------------------------------------------------------
  router.get('/legal/history', async (c) => {
    const db = requestDb(c);
    const docTypeParam = c.req.query('docType');
    const docType = docTypeParam === 'terms' || docTypeParam === 'privacy' ? docTypeParam : undefined;
    return c.json({ versions: await getLegalHistory(db, docType) });
  });

  // -------------------------------------------------------------------------
  // POST /api/admin/legal/:docType/publish  (docType: terms | privacy)
  // -------------------------------------------------------------------------
  router.post('/legal/:docType/publish', async (c) => {
    const db = requestDb(c);
    const actorUserId = c.get('userId') as string;
    const docType = c.req.param('docType');
    if (docType !== 'terms' && docType !== 'privacy') {
      return c.json({ error: 'docType must be "terms" or "privacy"' }, 400);
    }
    const body = await parseBody(c, LegalDocBody);
    try {
      // The service owns "version is required" / "content is required".
      const document = await publishLegalDoc(db, docType, { version: body.version ?? '', title: body.title, content: body.content ?? '' }, actorUserId, c.env);
      return c.json({ document }, 201);
    } catch (e) {
      if (e instanceof LegalDocError) return statusResponse(c, { error: e.message }, e.status, { source: 'presentation/routes/adminRoutes.ts', operation: 'legalDoc' }, e);
      throw e;
    }
  });

  // -------------------------------------------------------------------------
  // PATCH /api/admin/legal/:docType  — amend the currently-active doc in place
  // (edit title/content without minting a new version; version optional)
  // -------------------------------------------------------------------------
  router.patch('/legal/:docType', async (c) => {
    const db = requestDb(c);
    const docType = c.req.param('docType');
    if (docType !== 'terms' && docType !== 'privacy') {
      return c.json({ error: 'docType must be "terms" or "privacy"' }, 400);
    }
    const actorUserId = c.get('userId') as string;
    const body = await parseBody(c, LegalDocBody);
    try {
      const document = await amendActiveLegalDoc(db, docType, { version: body.version, title: body.title, content: body.content ?? '' }, actorUserId, c.env);
      return c.json({ document });
    } catch (e) {
      if (e instanceof LegalDocError) return statusResponse(c, { error: e.message }, e.status, { source: 'presentation/routes/adminRoutes.ts', operation: 'legalDoc' }, e);
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
    const body = await parseBody(c, LegalEnhanceBody);
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
      if (e instanceof LegalDocError) return statusResponse(c, { error: e.message }, e.status, { source: 'presentation/routes/adminRoutes.ts', operation: 'legalDoc' }, e);
      throw e;
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/newsletter/subscribers
  // -------------------------------------------------------------------------
  router.get('/newsletter/subscribers', async (c) => {
    const db = requestDb(c);
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
    const db = requestDb(c);
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
      .orderBy(desc(newsletterTemplates.updatedAt)).limit(LIST_ROW_CAP);

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
    const db = requestDb(c);
    const actorUserId = c.get('userId') as string;
    const body = await parseBody(c, NewsletterTemplateBody);

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

    if (!created) throw new InternalError('Failed to create template');

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
    const db = requestDb(c);
    const actorUserId = c.get('userId') as string;
    const templateId = Number(c.req.param('id'));
    if (!Number.isFinite(templateId) || templateId <= 0) {
      return c.json({ error: 'Invalid template id' }, 400);
    }

    const body = await parseBody(c, NewsletterTemplateBody);

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
    const db = requestDb(c);
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
    // The operator scope of THE privacy-request list (the subject's own list is
    // the same use case at /api/auth/me/privacy-requests).
    const requests = await listPrivacyRequests(requestDb(c), {
      kind: 'platform_admin',
      status: c.req.query('status')?.trim(),
      type: c.req.query('type')?.trim(),
      q: c.req.query('q'),
      limit: parsePositiveInt(c.req.query('limit'), 200),
    });
    return c.json({ requests });
  });

  // -------------------------------------------------------------------------
  // PATCH /api/admin/privacy-requests/:id — the fulfilment step
  // -------------------------------------------------------------------------
  router.patch('/privacy-requests/:id', async (c) => {
    const requestId = Number(c.req.param('id'));
    if (!Number.isFinite(requestId) || requestId <= 0) {
      return c.json({ error: 'Invalid request id' }, 400);
    }
    const body = await parseBody(c, PrivacyRequestPatchBody);
    const request = await updatePrivacyRequest(requestDb(c), requestId, { status: body.status, resolution: body.resolution });
    if (!request) return c.json({ error: 'Privacy request not found' }, 404);
    return c.json({ request });
  });

  // -------------------------------------------------------------------------
  // POST /api/admin/newsletter/events
  // -------------------------------------------------------------------------
  router.post('/newsletter/events', async (c) => {
    const db = requestDb(c);
    const body = await parseBody(c, NewsletterEventBody);

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
    const db = requestDb(c);
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
    const db = requestDb(c);
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
      .orderBy(desc(authTokens.lastSeenAt)).limit(LIST_ROW_CAP);

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
    const db = requestDb(c);
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
    const db = requestDb(c);
    const tenantId = parseTenantId(c.req.query('tenantId'));
    const userId = c.req.param('userId');
    const body = await parseBody(c, MfaEnableBody);
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
    const db = requestDb(c);
    const tenantId = parseTenantId(c.req.query('tenantId'));
    const userId = c.req.param('userId');
    const body = await parseBody(c, MfaChallengeBody);
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
    const db = requestDb(c);
    const tenantId = parseTenantId(c.req.query('tenantId'));
    const userId = c.req.param('userId');
    const body = await parseBody(c, MfaChallengeBody);
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
  // POST /api/admin/security/users/:userId/{sessions/:sessionId/revoke,
  // sessions/revoke-all, tokens/:jti/revoke}?tenantId=123 — cross-tenant, behind
  // the superadmin gate above. Same use case as the workspace security page's twin.
  // -------------------------------------------------------------------------
  registerMemberCredentialRevocation(router, '/security/users/:userId', {
    dbOf: requestDb,
    tenantOf: (c) => parseTenantId(c.req.query('tenantId')) ?? c.json({ error: 'tenantId is required' }, 400),
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/users
  // -------------------------------------------------------------------------
  router.get('/users', async (c) => {
    const db = requestDb(c);

    const rows = await db.execute(sql`
      SELECT
        u.id,
        u.email,
        u.username,
        u.display_name  AS "displayName",
        u.is_superadmin AS "isSuperadmin",
        u.created_at    AS "createdAt",
        -- Which shell the account is: only a builder ('standard') is provisioned a
        -- workspace, so without this a hired/sales account's legitimate zero reads
        -- identically to a broken builder's.
        u.account_type  AS "accountType",
        COUNT(DISTINCT tm.tenant_id)::int AS "tenantCount"
      FROM users u
      LEFT JOIN tenant_members tm ON tm.user_id = u.id AND tm.is_active = true
      GROUP BY u.id, u.email, u.username, u.display_name, u.is_superadmin, u.created_at, u.account_type
      ORDER BY u.created_at DESC
      LIMIT 500
    `);

    return c.json({ users: rows.rows });
  });

  // -------------------------------------------------------------------------
  // GET  /api/admin/accounts/suspect          — accounts the OTP gate never tested
  // POST /api/admin/accounts/suspect/revoke   — make them prove the address
  //
  // Migration 0285 introduced the signup OTP gate and backfilled
  // `email_verified_at = created_at` for EVERY account that already existed —
  // necessary (nobody could be locked out retroactively) and, for the fake
  // accounts created before the gate, a free pass. The gate only ever stopped
  // NEW fake signups.
  //
  // The backfill left a signature: `email_verified_at = created_at` to the
  // second is not something a real verification produces, because a real one
  // happens after the code is typed. Combined with "never signed in" and a
  // disposable mail domain, that is enough to review by hand — which is what
  // this is, a review surface, not an automatic purge.
  // -------------------------------------------------------------------------

  router.get('/accounts/suspect', async (c) => {
    const db = requestDb(c);
    const rows = await db.execute(sql`
      SELECT
        u.id,
        u.email,
        u.username,
        u.created_at        AS "createdAt",
        u.last_login_at     AS "lastLoginAt",
        u.email_verified_at AS "emailVerifiedAt",
        -- The 0285 signature: verified in the same second the account was made.
        (u.email_verified_at IS NOT NULL
          AND ABS(EXTRACT(EPOCH FROM (u.email_verified_at - u.created_at))) < 2) AS "backfilledVerification",
        (u.last_login_at IS NULL) AS "neverSignedIn",
        (lower(split_part(u.email, '@', 2)) = ANY(${DISPOSABLE_DOMAINS})) AS "disposableDomain",
        COUNT(DISTINCT tm.tenant_id)::int AS "tenantCount"
      FROM users u
      LEFT JOIN tenant_members tm ON tm.user_id = u.id AND tm.is_active = true
      WHERE u.is_superadmin = false
        AND (
          u.last_login_at IS NULL
          OR lower(split_part(u.email, '@', 2)) = ANY(${DISPOSABLE_DOMAINS})
        )
        AND u.email_verified_at IS NOT NULL
        AND ABS(EXTRACT(EPOCH FROM (u.email_verified_at - u.created_at))) < 2
      GROUP BY u.id, u.email, u.username, u.created_at, u.last_login_at, u.email_verified_at
      ORDER BY u.created_at DESC
      LIMIT 500
    `);
    return c.json({ accounts: rows.rows });
  });

  router.post('/accounts/suspect/revoke', async (c) => {
    const body = await parseOptionalBody(c, SuspectRevokeBody);
    const userIds = (body.userIds ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, 500);
    if (userIds.length === 0) return c.json({ error: 'userIds is required' }, 400);
    const db = requestDb(c);
    // Clearing the stamp, not deleting the account: the person gets the ordinary
    // "verify your email" path on next sign-in, and a real account that was
    // caught by the heuristic recovers itself without an admin doing anything.
    // Superadmins are excluded in SQL as well as in the read — a wrong id here
    // must not be able to lock the operator out.
    const rows = await db.execute(sql`
      UPDATE users
      SET email_verified_at = NULL
      WHERE id = ANY(${userIds}) AND is_superadmin = false
      RETURNING id
    `);
    return c.json({ revoked: rows.rows.length });
  });

  // -------------------------------------------------------------------------
  // GET  /api/admin/guest-sessions             — leads + the intent they typed
  // GET  /api/admin/guest-sessions/:visitorId  — one lead's prompts, newest first
  //
  // An anonymous visitor who types a prompt IS a lead, and this is the only place
  // the funnel is visible end to end: what they asked for, whether they came back,
  // whether they signed up, whether they paid. Served by the application service
  // so the aggregate, its cache and its invalidation live in ONE place rather than
  // being re-remembered per route (the console and the broadcast targeting read the
  // same numbers, and they must agree).
  // -------------------------------------------------------------------------
  router.get('/guest-sessions', async (c) => {
    const service = new GuestPromptService(requestDb(c));
    return c.json(await service.listSessionsWithIntent(c.env as Env));
  });

  router.get('/guest-sessions/:visitorId', async (c) => {
    const visitorId = c.req.param('visitorId');
    if (!isValidVisitorId(visitorId)) return c.json({ error: 'Invalid visitor id' }, 400);
    const service = new GuestPromptService(requestDb(c));
    return c.json({ prompts: await service.listPromptsForVisitor(visitorId) });
  });

  // DELETE /api/admin/guest-sessions/:visitorId/prompts
  //
  // Erase what a visitor typed. A prompt is free text a person wrote, so it is
  // personal data — and it is keyed by an opaque visitor id rather than a user
  // row, so no account deletion or foreign-key cascade would ever reach it. This
  // is how a privacy request that names a visitor gets ACTIONED instead of only
  // tracked in `privacy_requests`. Audited, because erasing evidence without a
  // record of who erased it is the wrong kind of clean.
  router.delete('/guest-sessions/:visitorId/prompts', async (c) => {
    const visitorId = c.req.param('visitorId');
    if (!isValidVisitorId(visitorId)) return c.json({ error: 'Invalid visitor id' }, 400);
    const db = requestDb(c);
    const erased = await new GuestPromptService(db).forgetVisitor(c.env as Env, visitorId, c.get('userId') as string);
    await writeAdminAudit(db, 'GUEST_PROMPTS_ERASED', c.get('userId') as string, {
      metadata: { visitorId, ...erased },
    });
    // `erased` is the headline number the drawer reports: the total across EVERY
    // registered eraser (prompts, journey, Insights recordings), not prompts alone.
    return c.json(erased);
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/creation-sessions
  // Cross-tenant operational view of durable Canvases. Invitations are nested
  // with their Session so support/growth can trace the invited address through
  // pending, accepted, expired, and revoked states without treating an invite as
  // newsletter consent.
  // -------------------------------------------------------------------------
  router.get('/creation-sessions', async (c) => {
    const db = requestDb(c);
    const rows = await db.execute(sql`
      SELECT
        cs.id,
        cs.tenant_id AS "tenantId",
        t.name AS "tenantName",
        cs.segment_id AS "segmentId",
        cs.title,
        cs.status,
        cs.canvas_revision AS "revision",
        cs.created_at AS "createdAt",
        cs.last_activity_at AS "lastActivityAt",
        creator.email AS "creatorEmail",
        (SELECT COUNT(*)::int FROM creation_session_objects cso WHERE cso.session_id = cs.id) AS "objectCount",
        (SELECT COUNT(*)::int FROM creation_session_members csm WHERE csm.session_id = cs.id) AS "memberCount",
        COALESCE((
          SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
            'id', csi.id,
            'email', csi.email,
            'role', csi.role,
            'createdAt', csi.created_at,
            'expiresAt', csi.expires_at,
            'acceptedAt', csi.accepted_at,
            'revokedAt', csi.revoked_at
          ) ORDER BY csi.created_at DESC)
          FROM invitations csi
          JOIN objects o ON o.id = csi.object_id
          WHERE csi.kind = 'session'
            AND o.kind = 'creation_session'
            AND o.ref_id = cs.id::text
            AND o.tenant_id = cs.tenant_id
        ), '[]'::jsonb) AS invitations
      FROM creation_sessions cs
      JOIN tenants t ON t.id = cs.tenant_id
      LEFT JOIN users creator ON creator.id = cs.created_by
      ORDER BY cs.last_activity_at DESC
      LIMIT 500
    `);
    return c.json({ sessions: rows.rows });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/outcome-metrics
  // Content-free value generation across the platform, optionally narrowed to
  // one tenant or project. The previous equal-length period is the baseline.
  // -------------------------------------------------------------------------
  router.get('/outcome-metrics', async (c) => {
    const days = daysParam(c.req.query('days'), 30, 365, 7);
    const tenantValue = Number(c.req.query('tenantId'));
    const projectValue = Number(c.req.query('projectId'));
    const tenantId = Number.isInteger(tenantValue) && tenantValue > 0 ? tenantValue : undefined;
    const projectId = Number.isInteger(projectValue) && projectValue > 0 ? projectValue : undefined;
    const db = requestDb(c);
    // Read-through cached: five cohort queries over every session in the window,
    // on a panel that re-polls on every filter change. Value rollups move on the
    // scale of hours, not seconds, so a minute of staleness costs nothing and a
    // superadmin flipping between workspaces stops re-running the whole sweep.
    return c.json(await getOrSetCached(
      c.env,
      `admin:outcome-metrics:${days}:${tenantId ?? 'all'}:${projectId ?? 'all'}`,
      () => getOutcomeValueRollup(db, { days, tenantId, projectId }),
      { kvTtlSeconds: 60 },
    ));
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/visitor-flow?days=30      — the anonymous funnel AS A GRAPH
  // GET /api/admin/visitor-flow/:visitorId   — one visitor's journey, visit by visit
  //
  // Replaces `GET /demo/funnel` (a persona × stage COUNT matrix over the same
  // stream). A count matrix cannot answer the question the panel exists for —
  // "where does the funnel leak" — because a leak lives on an edge: it can say
  // 400 visitors saw pricing, never that 300 arrived from the prompt and 280
  // stopped there. Persona is still on every row, so the demo's funnel is one
  // slice of this rather than a separate screen.
  //
  // Served by the application service, so the scan bounds, the cache and the
  // aggregation live in one place instead of as SQL inside a route handler.
  // -------------------------------------------------------------------------
  router.get('/visitor-flow', async (c) => {
    const service = new VisitorJourneyService(requestDb(c));
    const days = Number(c.req.query('days') ?? VISITOR_FLOW_WINDOWS.defaultDays);
    return c.json(await service.flowGraph(c.env as Env, days));
  });

  router.get('/visitor-flow/:visitorId', async (c) => {
    const visitorId = c.req.param('visitorId');
    if (!isValidVisitorId(visitorId)) return c.json({ error: 'Invalid visitor id' }, 400);
    const service = new VisitorJourneyService(requestDb(c));
    return c.json(await service.journeyFor(visitorId));
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/sales-leads  ·  PATCH /api/admin/sales-leads/:id
  // Book-a-demo pipeline: list newest-first, update status as sales works them.
  // -------------------------------------------------------------------------
  router.get('/sales-leads', async (c) => {
    const db = requestDb(c);
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
    const body = await parseOptionalBody(c, SalesLeadPatchBody);
    const allowed = ['new', 'contacted', 'qualified', 'closed'];
    if (!body.status || !allowed.includes(body.status)) {
      return c.json({ error: `status must be one of ${allowed.join(', ')}` }, 400);
    }
    const db = requestDb(c);
    const rows = await db.execute(sql`
      UPDATE sales_leads SET status = ${body.status} WHERE id = ${id}
      RETURNING id, status
    `);
    if (rows.rows.length === 0) return c.json({ error: 'Lead not found' }, 404);
    return c.json({ lead: rows.rows[0] });
  });

  // -------------------------------------------------------------------------
  // Platform broadcasts — /api/admin/broadcasts
  //
  // The channel to visitors who have no workspace to reach them through. A lead
  // who typed a prompt and left has no email and no account, so the campaign
  // engine (audiences of addresses, verified senders, suppression) cannot touch
  // them — but they still have an open tab, and this is what puts a message in it.
  //
  // GET    /broadcasts      — every platform broadcast + its measured engagement
  // POST   /broadcasts      — author one
  // PATCH  /broadcasts/:id  — edit / schedule / take it live / archive it
  // DELETE /broadcasts/:id  — remove it (engagement survives in activity_log)
  //
  // Every write publishes: caches dropped and one `{type:'changed'}` frame to the
  // shared relay room, so a banner appears in open tabs rather than on next load.
  // -------------------------------------------------------------------------
  router.get('/broadcasts', async (c) => {
    const service = new PlatformBroadcastService(requestDb(c));
    return c.json({
      broadcasts: await service.listForConsole(c.env as Env),
      vocabulary: broadcastVocabulary,
    });
  });

  router.post('/broadcasts', async (c) => {
    const body = await parseOptionalBody(c, BroadcastBody);
    const db = requestDb(c);
    const actorId = c.get('userId') as string;
    const created = await new PlatformBroadcastService(db).create(c.env as Env, body, actorId);
    if (!created) return c.json({ error: 'A broadcast needs a message.' }, 400);
    await writeAdminAudit(db, 'PLATFORM_BROADCAST_CREATED', actorId, {
      metadata: { broadcastId: created.id, status: created.status, audience: created.audience },
    });
    return c.json({ broadcast: created }, 201);
  });

  router.patch('/broadcasts/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid broadcast id' }, 400);
    const body = await parseOptionalBody(c, BroadcastBody);
    const db = requestDb(c);
    if (!await new PlatformBroadcastService(db).update(c.env as Env, id, body)) {
      return c.json({ error: 'Broadcast not found' }, 404);
    }
    await writeAdminAudit(db, 'PLATFORM_BROADCAST_UPDATED', c.get('userId') as string, {
      metadata: { broadcastId: id, patch: body },
    });
    return c.json({ ok: true });
  });

  router.delete('/broadcasts/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid broadcast id' }, 400);
    const db = requestDb(c);
    if (!await new PlatformBroadcastService(db).remove(c.env as Env, id)) {
      return c.json({ error: 'Broadcast not found' }, 404);
    }
    await writeAdminAudit(db, 'PLATFORM_BROADCAST_DELETED', c.get('userId') as string, {
      metadata: { broadcastId: id },
    });
    return c.body(null, 204);
  });

  // -------------------------------------------------------------------------
  // Discount codes — SuperAdmin-authored signup/checkout offers.
  // -------------------------------------------------------------------------
  router.get('/discount-codes', async (c) => {
    const db = requestDb(c);
    const rows = await db.execute(sql`
      SELECT dc.id, dc.code, dc.percent_off AS "percentOff",
             dc.applicable_plan AS "applicablePlan", dc.billing_cycle AS "billingCycle",
             dc.duration_years AS "durationYears", dc.is_active AS "isActive",
             dc.created_at AS "createdAt", dc.updated_at AS "updatedAt",
             COUNT(dr.id)::int AS "redemptionCount",
             COUNT(dr.id) FILTER (WHERE dr.status = 'redeemed')::int AS "redeemedCount"
      FROM discount_codes dc
      LEFT JOIN discount_redemptions dr ON dr.discount_code_id = dc.id
      GROUP BY dc.id
      ORDER BY dc.created_at DESC
    `);
    return c.json({ discountCodes: rows.rows });
  });

  router.post('/discount-codes', async (c) => {
    const body = await parseOptionalBody(c, DiscountCodeCreateBody);
    const code = normalizeDiscountCode(body.code ?? '');
    const percentOff = Number(body.percentOff);
    const durationYears = Number(body.durationYears);
    if (!/^[A-Z0-9_-]{3,64}$/.test(code)) return c.json({ error: 'Code must be 3–64 letters, numbers, _ or -' }, 400);
    if (!Number.isInteger(percentOff) || percentOff < 1 || percentOff > 100) return c.json({ error: 'percentOff must be an integer from 1 to 100' }, 400);
    if (!Number.isInteger(durationYears) || durationYears < 1 || durationYears > 20) return c.json({ error: 'durationYears must be an integer from 1 to 20' }, 400);
    const applicablePlan = body.applicablePlan === 'teams' ? 'teams' : 'pro';
    const billingCycle = body.billingCycle === 'monthly' ? 'monthly' : 'yearly';
    const db = requestDb(c);
    const [existing] = await db.select({ id: discountCodes.id }).from(discountCodes).where(eq(discountCodes.code, code)).limit(1);
    if (existing) return c.json({ error: 'Discount code already exists' }, 409);
    const [created] = await db.insert(discountCodes).values({
      code, percentOff, durationYears, applicablePlan, billingCycle,
      isActive: body.isActive ?? true,
      createdByUserId: c.get('userId') as string,
    }).returning();
    if (!created) throw new InternalError('Failed to create discount code');
    await writeAdminAudit(db, 'DISCOUNT_CODE_CREATED', c.get('userId') as string, {
      metadata: { discountCodeId: created.id, code },
    });
    return c.json({ discountCode: created }, 201);
  });

  router.patch('/discount-codes/:id', async (c) => {
    const body = await parseOptionalBody(c, DiscountCodePatchBody);
    const updates: Partial<typeof discountCodes.$inferInsert> = { updatedAt: new Date() };
    if (body.code !== undefined) {
      const code = normalizeDiscountCode(body.code);
      if (!/^[A-Z0-9_-]{3,64}$/.test(code)) return c.json({ error: 'Code must be 3–64 letters, numbers, _ or -' }, 400);
      updates.code = code;
    }
    if (body.percentOff !== undefined) {
      if (!Number.isInteger(body.percentOff) || body.percentOff < 1 || body.percentOff > 100) return c.json({ error: 'percentOff must be an integer from 1 to 100' }, 400);
      updates.percentOff = body.percentOff;
    }
    if (body.durationYears !== undefined) {
      if (!Number.isInteger(body.durationYears) || body.durationYears < 1 || body.durationYears > 20) return c.json({ error: 'durationYears must be an integer from 1 to 20' }, 400);
      updates.durationYears = body.durationYears;
    }
    if (body.applicablePlan !== undefined) updates.applicablePlan = body.applicablePlan;
    if (body.billingCycle !== undefined) updates.billingCycle = body.billingCycle;
    if (body.isActive !== undefined) updates.isActive = body.isActive;
    const db = requestDb(c);
    const [updated] = await db.update(discountCodes).set(updates).where(eq(discountCodes.id, c.req.param('id'))).returning();
    if (!updated) return c.json({ error: 'Discount code not found' }, 404);
    await writeAdminAudit(db, 'DISCOUNT_CODE_UPDATED', c.get('userId') as string, {
      metadata: { discountCodeId: updated.id, code: updated.code },
    });
    return c.json({ discountCode: updated });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/tenants
  // -------------------------------------------------------------------------
  router.get('/tenants', async (c) => {
    const db = requestDb(c);

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
        t.premium_daily_cap AS "premiumDailyCap",
        t.image_credits_daily_limit AS "imageCreditsDailyLimit",
        t.premium_override AS "premiumOverride",
        d.code AS "discountCode",
        d.percent_off AS "discountPercentOff",
        d.duration_years AS "discountDurationYears",
        d.status AS "discountStatus",
        d.applied_at AS "discountAppliedAt",
        CASE WHEN t.plan = 'pro' AND t.billing_status = 'active' AND t.is_demo = false THEN true ELSE false END AS "isPaid",
        CASE WHEN t.plan = 'pro' AND t.billing_status = 'active' THEN 'pro' ELSE 'free' END AS "effectivePlan",
        t.created_at AS "createdAt",
        COUNT(DISTINCT tm.user_id)::int  AS "memberCount",
        COUNT(DISTINCT ci.id)::int       AS "agentHostCount"
      FROM tenants t
      LEFT JOIN tenant_members tm ON tm.tenant_id = t.id AND tm.is_active = true
      LEFT JOIN agent_hosts ci ON ci.tenant_id = t.id
      LEFT JOIN LATERAL (
        SELECT dc.code, dc.percent_off, dc.duration_years, dr.status, dr.applied_at
        FROM discount_redemptions dr
        JOIN discount_codes dc ON dc.id = dr.discount_code_id
        WHERE dr.tenant_id = t.id
        ORDER BY dr.applied_at DESC
        LIMIT 1
      ) d ON true
      GROUP BY t.id, t.name, t.slug, t.status, t.plan, t.billing_status, t.billing_email, t.billing_updated_at, t.external_customer_id, t.external_subscription_id, t.token_daily_limit_override, t.paid_overflow_daily_cap, t.premium_daily_cap, t.image_credits_daily_limit, t.premium_override, t.created_at, d.code, d.percent_off, d.duration_years, d.status, d.applied_at
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

    const body = await parseBody(c, TokenLimitOverrideBody);
    const value = body.tokenDailyLimitOverride;
    if (value !== null && value !== undefined) {
      if (!Number.isInteger(value) || value < -1) {
        return c.json({
          error: 'tokenDailyLimitOverride must be null, -1 (unlimited), or a non-negative integer',
        }, 400);
      }
    }
    const next = value === undefined ? null : value;

    const db = requestDb(c);
    const [before] = await db.select({ prev: tenants.tokenDailyLimitOverride }).from(tenants).where(eq(tenants.id, tenantId));
    const [updated] = await db
      .update(tenants)
      .set({ tokenDailyLimitOverride: next, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId))
      .returning({ id: tenants.id, tokenDailyLimitOverride: tenants.tokenDailyLimitOverride });

    if (!updated) return c.json({ error: 'Tenant not found' }, 404);
    await invalidateTenantPlan(c.env, tenantId);

    // Forensic trail: who flipped a tenant's token cap, from what to what, and when.
    await writeAudit(db, 'TOKEN_LIMIT_OVERRIDE_CHANGED', c.get('userId') as string, {
      tenantId,
      metadata: { from: before?.prev ?? null, to: updated.tokenDailyLimitOverride },
      ipAddress: c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? null,
    }).catch((error) => {
      reportCaughtError(error, { source: "presentation/routes/adminRoutes.ts", operation: "createAdminRoutes" });
    });

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

    const body = await parseBody(c, PaidOverflowCapBody);
    const value = body.paidOverflowDailyCap;
    if (value !== null && value !== undefined) {
      if (!Number.isInteger(value) || value < -1) {
        return c.json({
          error: 'paidOverflowDailyCap must be null, -1 (unlimited), or a non-negative integer (millicents)',
        }, 400);
      }
    }
    const next = value === undefined ? null : value;

    const db = requestDb(c);
    const [before] = await db.select({ prev: tenants.paidOverflowDailyCap }).from(tenants).where(eq(tenants.id, tenantId));
    const [updated] = await db
      .update(tenants)
      .set({ paidOverflowDailyCap: next, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId))
      .returning({ id: tenants.id, paidOverflowDailyCap: tenants.paidOverflowDailyCap });

    if (!updated) return c.json({ error: 'Tenant not found' }, 404);
    await invalidateTenantPlan(c.env, tenantId);

    // Forensic trail: who changed a tenant's funded-overflow ceiling, and when.
    await writeAudit(db, 'PAID_OVERFLOW_CAP_CHANGED', c.get('userId') as string, {
      tenantId,
      metadata: { from: before?.prev ?? null, to: updated.paidOverflowDailyCap },
      ipAddress: c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? null,
    }).catch((error) => {
      reportCaughtError(error, { source: "presentation/routes/adminRoutes.ts", operation: "createAdminRoutes" });
    });

    return c.json({ id: updated.id, paidOverflowDailyCap: updated.paidOverflowDailyCap });
  });

  // -------------------------------------------------------------------------
  // PATCH /api/admin/tenants/:id/premium-cap
  // Body: { premiumDailyCap: number | null }  (millicents/day, 1/100000 USD)
  //   null → clear override (plan default $10/day) · -1 → unlimited · >= 0 → explicit
  //
  // The sibling of the paid-overflow cap above, and deliberately a SEPARATE ceiling:
  // that one bounds spend Builderforce funds on its own keys, this one bounds what a
  // tenant runs up on the metered premium long tail. One number cannot answer to two
  // budgets — merging them would mean a tenant exhausting its premium allowance also
  // closed our reliability backstop. Migration 0952.
  // -------------------------------------------------------------------------
  router.patch('/tenants/:id/premium-cap', async (c) => {
    const tenantId = Number(c.req.param('id'));
    if (!tenantId) return c.json({ error: 'Invalid tenant id' }, 400);

    const body = await parseBody(c, PremiumCapBody);
    const value = body.premiumDailyCap;
    if (value !== null && value !== undefined) {
      if (!Number.isInteger(value) || value < -1) {
        return c.json({
          error: 'premiumDailyCap must be null, -1 (unlimited), or a non-negative integer (millicents)',
        }, 400);
      }
    }
    const next = value === undefined ? null : value;

    const db = requestDb(c);
    const [before] = await db.select({ prev: tenants.premiumDailyCap }).from(tenants).where(eq(tenants.id, tenantId));
    const [updated] = await db
      .update(tenants)
      .set({ premiumDailyCap: next, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId))
      .returning({ id: tenants.id, premiumDailyCap: tenants.premiumDailyCap });

    if (!updated) return c.json({ error: 'Tenant not found' }, 404);
    await invalidateTenantPlan(c.env, tenantId);

    // Forensic trail: raising a premium ceiling is raising a spend ceiling.
    await writeAudit(db, 'PREMIUM_CAP_CHANGED', c.get('userId') as string, {
      tenantId,
      metadata: { from: before?.prev ?? null, to: updated.premiumDailyCap },
      ipAddress: c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? null,
    }).catch((error) => {
      reportCaughtError(error, { source: "presentation/routes/adminRoutes.ts", operation: "createAdminRoutes" });
    });

    return c.json({ id: updated.id, premiumDailyCap: updated.premiumDailyCap });
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

    const body = await parseBody(c, ImageCreditsLimitBody);
    const value = body.imageCreditsDailyLimit;
    if (value !== null && value !== undefined) {
      if (!Number.isInteger(value) || value < -1) {
        return c.json({
          error: 'imageCreditsDailyLimit must be null, -1 (unlimited), or a non-negative integer',
        }, 400);
      }
    }
    const next = value === undefined ? null : value;

    const db = requestDb(c);
    const [before] = await db.select({ prev: tenants.imageCreditsDailyLimit }).from(tenants).where(eq(tenants.id, tenantId));
    const [updated] = await db
      .update(tenants)
      .set({ imageCreditsDailyLimit: next, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId))
      .returning({ id: tenants.id, imageCreditsDailyLimit: tenants.imageCreditsDailyLimit });

    if (!updated) return c.json({ error: 'Tenant not found' }, 404);
    await invalidateTenantPlan(c.env, tenantId);

    await writeAudit(db, 'IMAGE_CREDITS_LIMIT_CHANGED', c.get('userId') as string, {
      tenantId,
      metadata: { from: before?.prev ?? null, to: updated.imageCreditsDailyLimit },
      ipAddress: c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? null,
    }).catch((error) => {
      reportCaughtError(error, { source: "presentation/routes/adminRoutes.ts", operation: "createAdminRoutes" });
    });

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

    const body = await parseBody(c, PremiumOverrideBody);
    if (typeof body.premiumOverride !== 'boolean') {
      return c.json({ error: 'premiumOverride must be a boolean' }, 400);
    }

    const db = requestDb(c);
    const [before] = await db.select({ prev: tenants.premiumOverride }).from(tenants).where(eq(tenants.id, tenantId));
    const [updated] = await db
      .update(tenants)
      .set({ premiumOverride: body.premiumOverride, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId))
      .returning({ id: tenants.id, premiumOverride: tenants.premiumOverride });

    if (!updated) return c.json({ error: 'Tenant not found' }, 404);
    await invalidateTenantPlan(c.env, tenantId);

    // Forensic trail: who flipped a tenant to/from premium routing, and when.
    await writeAudit(db, 'PREMIUM_OVERRIDE_CHANGED', c.get('userId') as string, {
      tenantId,
      metadata: { from: before?.prev ?? null, to: updated.premiumOverride },
      ipAddress: c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? null,
    }).catch((error) => {
      reportCaughtError(error, { source: "presentation/routes/adminRoutes.ts", operation: "createAdminRoutes" });
    });

    return c.json({ id: updated.id, premiumOverride: updated.premiumOverride });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/tenants/:id/members
  // -------------------------------------------------------------------------
  router.get('/tenants/:id/members', async (c) => {
    const db = requestDb(c);
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
    const db = requestDb(c);
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

  // The operator's platform health: DB ping, platform counts and the raw LLM pool
  // partition — sections of THE health use case (application/health/platformHealth).
  router.get('/health', async (c) => c.json(await adminHealthReport(requestDb(c), c.env as Env)));

  // -------------------------------------------------------------------------
  // GET /api/admin/system-health — operational infrastructure + both Neon DBs.
  // Table mutation counters are PostgreSQL counters since the last stats reset;
  // they make sustained growth visible without retaining a second metrics table.
  // -------------------------------------------------------------------------
  router.get('/system-health', async (c) => c.json(await systemHealthReport(requestDb(c), c.env as Env)));

  // POST /api/admin/system-health/maintenance
  // { action: 'purge_expired' } runs only the existing retention policy.
  // { action: 'vacuum_analyze', target, table? } is intentionally limited to
  // normal VACUUM ANALYZE (never VACUUM FULL / arbitrary SQL).
  router.post('/system-health/maintenance', async (c) => {
    const body = await parseOptionalBody(c, MaintenanceBody);
    const actorId = c.get('userId') as string | undefined;
    if (body.action === 'purge_expired') {
      await runRetentionPurge(c.env as Env);
      await writeAdminAudit(requestDb(c), 'SYSTEM_HEALTH_PURGE_EXPIRED', actorId ?? null, {
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
    const db = body.target === 'primary' ? requestDb(c) : buildTransactionalDatabase(c.env);
    try {
      // Same statement builder the daily maintenance sweep uses, so the quoting rule
      // and the relation-name guard cannot diverge between the two callers.
      await vacuumRelation(db, body.table ?? undefined);
    } catch (error) {
      return failResponse(c, new InternalError('VACUUM failed', { cause: error }), { source: 'presentation/routes/adminRoutes.ts', operation: 'vacuumAnalyze' });
    }
    await writeAdminAudit(requestDb(c), 'SYSTEM_HEALTH_VACUUM_ANALYZE', actorId ?? null, {
      metadata: { target: body.target, table: body.table ?? null }, ipAddress: c.req.header('cf-connecting-ip') ?? null,
    });
    return c.json({ ok: true, action: body.action, target: body.target, table: body.table ?? null });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/cron — what the platform has scheduled, plus the LIVE state of
  // the KV work-gate that decides whether the every-5-minute tick runs at all.
  //
  // Deliberately NOT cached (contra the default for read endpoints): it reads KV
  // only — no Neon round-trip, so there is no cost to serve — and its entire
  // purpose is to show the CURRENT gate decision. A cache would hide exactly the
  // state it exists to reveal.
  // -------------------------------------------------------------------------
  router.get('/cron', async (c) => {
    const env = c.env as Env;
    const nowMs = Date.now();
    // Read-only: evaluateCronGate never writes, so inspecting the gate cannot
    // consume a pending-work signal or move the floor timestamp.
    // Both reads are KV-only, so the "no Neon round-trip" property above still holds
    // with the stall report added.
    const [gate, controls, stall] = await Promise.all([
      evaluateCronGate(env, nowMs),
      readCronControls(env),
      readScheduleStall(env),
    ]);
    return c.json({
      now: new Date(nowMs).toISOString(),
      gate: {
        /** What the next frequent tick would do if it fired right now. */
        wouldRun: gate.run,
        reason: gate.reason,
        floorDue: gate.floorDue,
        floorIntervalMs: gate.floorIntervalMs,
        floorIntervalOverridden: Boolean(env.CRON_FLOOR_INTERVAL_MS),
        lastFloorSweepAt: gate.lastFloorMs ? new Date(gate.lastFloorMs).toISOString() : null,
        nextFloorDueAt: gate.lastFloorMs
          ? new Date(gate.lastFloorMs + gate.floorIntervalMs).toISOString()
          : null,
        /** Earliest armed schedule, and how it reads against the clock. `stuck` means
         *  the gate is correctly declining to re-open on an ancient due time — the row
         *  is not being cleared by any sweep and only the floor still runs it. */
        nextDueAt: gate.nextDueMs ? new Date(gate.nextDueMs).toISOString() : null,
        dueState: gate.dueState,
        /** Unbound KV = the gate fails open and every tick runs the fan-out. */
        kvBound: Boolean(env.AUTH_CACHE_KV),
      },
      /** Non-null = scheduled work is JAMMED, not idle: armed rows overdue by more than
       *  a floor interval that every sweep has already had its chance at. */
      scheduleStall: stall && {
        jammedSince: new Date(stall.firstDetectedMs).toISOString(),
        observedAt: new Date(stall.observedMs).toISOString(),
        observations: stall.observations,
        tables: stall.tables.map((entry) => ({
          table: entry.table,
          dueAt: new Date(entry.dueAtMs).toISOString(),
          overdueMs: entry.overdueMs,
        })),
      },
      cadences: CRON_CADENCES.map((cadence) => ({
        cadence,
        cron: Object.entries(CADENCE_BY_CRON).find(([, v]) => v === cadence)?.[0] ?? null,
        sweeps: CRON_SWEEPS.filter((s) => s.cadence === cadence).length,
      })),
      sweeps: CRON_SWEEPS.map((s) => ({
        key: s.key,
        cadence: s.cadence,
        description: s.description,
        dispatches: Boolean(s.dispatches),
        available: s.available ? s.available(env) : true,
        enabled: cronSweepEnabled(controls, s.key),
      })),
      controlsPersisted: Boolean(env.AUTH_CACHE_KV),
    });
  });

  // One switch per registry entry. Disabled sweeps are skipped by both real cron
  // ticks and force-runs; no restart/deploy is required to resume them.
  router.patch('/cron/:target', async (c) => {
    const env = c.env as Env;
    const target = c.req.param('target');
    const sweep = CRON_SWEEPS.find((candidate) => candidate.key === target);
    if (!sweep) return c.json({ error: `Unknown cron sweep '${target}'.` }, 404);
    const body = await parseOptionalBody(c, CronControlBody);
    if (typeof body.enabled !== 'boolean') return c.json({ error: 'enabled must be a boolean.' }, 400);
    try {
      await writeCronControl(env, target, body.enabled);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Could not persist cron control.' }, 503);
    }
    await writeAdminAudit(requestDb(c), 'CRON_CONTROL_CHANGED', (c.get('userId') as string | undefined) ?? null, {
      metadata: { sweep: target, enabled: body.enabled },
      ipAddress: c.req.header('cf-connecting-ip') ?? null,
    });
    return c.json({ key: target, enabled: body.enabled });
  });

  // -------------------------------------------------------------------------
  // POST /api/admin/cron/signal — set the KV pending-work flag so the NEXT real
  // cron tick runs the Postgres fan-out instead of skipping. This exercises the
  // gate itself (the force-run below deliberately bypasses it), which is the only
  // way to confirm end-to-end that a signalled tick actually wakes and dispatches.
  //
  // MUST stay registered before `/cron/:target` so the static path wins the match.
  // -------------------------------------------------------------------------
  router.post('/cron/signal', async (c) => {
    const env = c.env as Env;
    if (!env.AUTH_CACHE_KV) {
      return c.json({ error: 'AUTH_CACHE_KV is not bound — the work-gate fails open and every tick already runs.' }, 409);
    }
    await signalPendingWork(env);
    const gate = await evaluateCronGate(env, Date.now());
    await writeAdminAudit(requestDb(c), 'CRON_SIGNAL_WORK', (c.get('userId') as string | undefined) ?? null, {
      ipAddress: c.req.header('cf-connecting-ip') ?? null,
    });
    return c.json({ ok: true, gate: { wouldRun: gate.run, reason: gate.reason } });
  });

  // -------------------------------------------------------------------------
  // POST /api/admin/cron/:target — force-run scheduled work NOW. `:target` is a
  // sweep key, a cadence group (frequent | daily | weekly-mon | weekly-fri), or
  // `all`. Body: { timeoutMs? }.
  //
  // WHY: Cloudflare delivers crons to scheduled(), never to a URL, so before this
  // route a change to any cron-path sweep could only be observed by waiting out
  // the work-gate — and the wait is worse than the 5-minute trigger suggests,
  // because signalPendingWork only fires when a ticket actually passes its gates,
  // so a board of stalled tickets signals nothing and falls through to the
  // 30-minute floor. The manual "Run manager now" button is not a substitute: it
  // takes the shouldDispatch = true branch, a different path from the cron one.
  //
  // The sweeps invoked are the SAME registry entries scheduled() dispatches, with
  // one shared per-tenant dispatch budget, exactly as a real tick has. It does NOT
  // touch the gate's KV state: stamping the floor here would push the next real
  // floor sweep out by a full interval, i.e. the diagnostic would delay the work
  // it was run to observe. Audited.
  // -------------------------------------------------------------------------
  router.post('/cron/:target', async (c) => {
    const env = c.env as Env;
    const target = c.req.param('target');
    const resolved = resolveCronTarget(CRON_SWEEPS, target);
    if (!resolved) {
      return c.json({
        error: `Unknown cron target '${target}'. Use a sweep key, a cadence (${CRON_CADENCES.join(' | ')}), or 'all'.`,
        sweeps: CRON_SWEEPS.map((s) => s.key),
      }, 404);
    }
    if (resolved.sweeps.length === 0) {
      return c.json({ error: `No sweeps are registered for '${target}'.` }, 404);
    }
    const body = await parseOptionalBody(c, CronForceRunBody);
    const budget = createTickDispatchBudget();
    const started = Date.now();
    const controls = await readCronControls(env);
    const controlledSweeps = applyCronControls(resolved.sweeps, controls);
    const results = await runCronSweeps(controlledSweeps, { env, db: requestDb(c), budget, controls }, {
      timeoutMs: body.timeoutMs,
      // A sweep past its deadline keeps running after we answer; without this the
      // isolate would cancel it when the request ends and the force-run would
      // silently truncate real work.
      keepAlive: (p) => c.executionCtx.waitUntil(p),
    });
    await writeAdminAudit(requestDb(c), 'CRON_FORCE_RUN', (c.get('userId') as string | undefined) ?? null, {
      metadata: {
        target,
        kind: resolved.kind,
        sweeps: resolved.sweeps.map((s) => s.key),
        failed: results.filter((r) => !r.ok).map((r) => r.key),
        timedOut: results.filter((r) => r.timedOut).map((r) => r.key),
      },
      ipAddress: c.req.header('cf-connecting-ip') ?? null,
    });
    return c.json({
      target,
      kind: resolved.kind,
      ranAt: new Date(started).toISOString(),
      totalMs: Date.now() - started,
      /** Billable runs this forced pass actually started, across all tenants. */
      dispatchesReserved: budget.total(),
      results,
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/errors
  //   ?q&source&operation&path&handled&tenantId&sinceHours&limit&offset
  //
  // Answer-first: the rollup says which faults are loudest, the rows are the
  // evidence. Reads the OPERATIONAL database — that is where persistCaughtError
  // writes. Shares its read model with the built-in MCP `errors.*` tools.
  // -------------------------------------------------------------------------
  router.get('/errors', async (c) => {
    const db = buildTransactionalDatabase(c.env);
    const q = c.req.query();

    const handledParam = q.handled;
    const filters: ErrorLogFilters = {
      q: q.q || undefined,
      source: q.source || undefined,
      operation: q.operation || undefined,
      path: q.path || undefined,
      handled: handledParam === 'true' ? true : handledParam === 'false' ? false : undefined,
      tenantId: q.tenantId ? Number(q.tenantId) : undefined,
      sinceHours: q.sinceHours ? Number(q.sinceHours) : undefined,
      limit: clampErrorLogLimit(q.limit),
      offset: q.offset ? Number(q.offset) : 0,
    };

    // Cache on the exact filter set: the log is append-only, so a short TTL is
    // safe and the unfiltered first page (the common case) stops hitting Neon
    // on every superadmin refresh.
    const key = `admin:errors:${JSON.stringify(filters)}`;
    const payload = await getOrSetCached(
      c.env as Env,
      key,
      async () => {
        const [page, summary, sources] = await Promise.all([
          queryErrorLog(db, filters),
          summarizeErrorLog(db, { ...filters, offset: 0 }),
          listErrorLogSources(db, filters.sinceHours),
        ]);
        return { ...page, summary, sources };
      },
      { kvTtlSeconds: 30, l1TtlMs: 10_000 },
    );

    return c.json(payload);
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/errors/:id — one entry with full stack + context.
  // -------------------------------------------------------------------------
  router.get('/errors/:id', async (c) => {
    const entry = await getErrorLogEntry(buildTransactionalDatabase(c.env), Number(c.req.param('id')));
    if (!entry) return c.json({ error: 'Error log entry not found' }, 404);
    return c.json({ error: entry });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/email-delivery-failures
  // Durable provider-rejection ledger. Message bodies, OTPs and API keys are
  // never stored, so this view is diagnostic without becoming a secrets store.
  // -------------------------------------------------------------------------
  router.get('/email-delivery-failures', async (c) => {
    const db = requestDb(c);
    const q = c.req.query();
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
    const offset = Math.max(Number(q.offset) || 0, 0);
    const conditions = [];
    if (q.deliveryType) conditions.push(eq(emailDeliveryFailures.deliveryType, q.deliveryType.slice(0, 64)));
    if (q.q) {
      const needle = `%${q.q.slice(0, 200)}%`;
      conditions.push(or(
        ilike(emailDeliveryFailures.recipient, needle),
        ilike(emailDeliveryFailures.errorMessage, needle),
      )!);
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const [failures, countRows, summaryRows, typeRows] = await Promise.all([
      db.select().from(emailDeliveryFailures).where(where)
        .orderBy(desc(emailDeliveryFailures.createdAt)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(emailDeliveryFailures).where(where),
      db.select({
        total: sql<number>`count(*)::int`,
        last24Hours: sql<number>`count(*) filter (where ${emailDeliveryFailures.createdAt} >= now() - interval '24 hours')::int`,
        affectedRecipients: sql<number>`count(distinct ${emailDeliveryFailures.recipient})::int`,
        latestAt: sql<Date | null>`max(${emailDeliveryFailures.createdAt})`,
      }).from(emailDeliveryFailures),
      db.selectDistinct({ deliveryType: emailDeliveryFailures.deliveryType })
        .from(emailDeliveryFailures).orderBy(emailDeliveryFailures.deliveryType),
    ]);
    const total = countRows[0]?.count ?? 0;
    return c.json({
      failures,
      total,
      returned: failures.length,
      offset,
      hasMore: offset + failures.length < total,
      summary: summaryRows[0] ?? { total: 0, last24Hours: 0, affectedRecipients: 0, latestAt: null },
      deliveryTypes: typeRows.map((row) => row.deliveryType),
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/admin/impersonate   { userId, tenantId, reason? }   — DEPRECATED
  // Kept for already-written callers; successor is POST /api/admin/impersonation/start.
  // It used to sign a writable tenant JWT with no session and no audit row. It now
  // runs THE start use case, so it gets the same refusals, the read-only emulation
  // token and the audit trail. A caller that predates `reason` still works: the
  // session records that the legacy door was used, which is itself the audit fact.
  // -------------------------------------------------------------------------
  router.post('/impersonate', legacyAliasNotice('/api/admin/impersonation/start'), async (c) => {
    const body = await parseBody(c, ImpersonationStartBody);
    const result = await startImpersonation(c.env, requestDb(c), {
      adminId:   c.get('userId') as string,
      userId:    body.userId ?? '',
      tenantId:  body.tenantId ?? 0,
      role:      body.role,
      reason:    body.reason?.trim() || 'Legacy POST /api/admin/impersonate (no reason supplied)',
      ipAddress: c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
    });
    if (!result.ok) {
      return c.json({ error: result.error, ...(result.sessionId ? { sessionId: result.sessionId } : {}) }, result.status);
    }
    const s = result.started;
    // The legacy response shape, plus the session id so the caller can end it.
    return c.json({
      token:              s.token,
      expiresIn:          IMPERSONATION_TTL_SECONDS,
      userId:             s.user.id,
      email:              s.user.email,
      tenantId:           s.tenant.id,
      role:               s.role,
      emulationSessionId: s.sessionId,
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/llm-usage?days=30
  // Per-model aggregates + daily time series
  // -------------------------------------------------------------------------
  router.get('/llm-usage', async (c) => {
    const days = daysParam(c.req.query('days'), 30, 90);
    // A thin adapter over THE usage query use case: the platform scope of the same
    // aggregates the tenant `/llm/v1/usage` report reads, on the ledger's own database
    // (this handler once read the primary while the writer used the operational one,
    // and summed an empty table). Includes the orphaned bucket that makes
    // platform total = Σ(tenant totals) + orphaned reconcile by construction.
    return c.json(await platformUsageReport(c.env, requestDb(c), days));
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/llm/traces — search/list recent LLM diagnostic traces.
  //   ?q=  trace id / consumer request id (substring)   ?tenantId=  ?model=
  //   ?success=true|false   ?outcome=   ?days= (def 7, max 90)   ?limit= ?page=
  // Summary columns only; full bodies come from the single-trace endpoint.
  // Everything here is builder-side / superadmin-only.
  // -------------------------------------------------------------------------
  router.get('/llm/traces', async (c) => {
    const db = requestDb(c);
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
    const db = requestDb(c);
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
  router.get('/llm-health', async (c) => c.json({ vendors: await vendorProbesSection(c.env as Env) }));

  // -------------------------------------------------------------------------
  // GET /api/admin/llm-ratings?days=30 — platform-wide human ratings of model
  // output, rolled up by (model × action × MCP tool).
  //
  // The counterpart to /llm-usage: that answers "what did we spend and where",
  // this answers "was any of it any GOOD, and which model is good at what". Both
  // live under the same admin tab because a model that is cheap and disliked is a
  // worse choice than the cost table alone can show.
  // -------------------------------------------------------------------------
  router.get('/llm-ratings', async (c) => {
    const days = daysParam(c.req.query('days'), 30, 365);
    const db = requestDb(c);
    // tenantId omitted ⇒ every tenant, which is exactly what a platform view is.
    return c.json(await summarizeActionRatings(c.env, db, { days }));
  });

  // -------------------------------------------------------------------------
  // /api/admin/personas — platform persona CRUD. The catalogue owns the table and
  // its invalidation; admin differs from the public readers only by scope.
  // -------------------------------------------------------------------------
  router.get('/personas', async (c) => {
    const rows = await listPlatformPersonas(c.env, requestDb(c), 'admin');
    return c.json({ personas: rows.map(platformPersonaView) });
  });

  router.post('/personas', async (c) => {
    const body = await parseBody(c, PersonaCreateBody);
    const name = body.name?.trim();
    if (!name) return c.json({ error: 'name is required' }, 400);
    const inserted = await createPlatformPersona(c.env, requestDb(c), { ...body, name });
    if (!inserted) throw new InternalError('Insert failed');
    return c.json({ persona: platformPersonaView(inserted) }, 201);
  });

  router.patch('/personas/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
    const body = await parseBody(c, PersonaPatchBody);
    const updated = await updatePlatformPersona(c.env, requestDb(c), id, body);
    if (!updated) return c.json({ error: 'Persona not found' }, 404);
    return c.json({ persona: platformPersonaView(updated) });
  });

  router.delete('/personas/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
    if (!(await deletePlatformPersona(c.env, requestDb(c), id))) return c.json({ error: 'Persona not found' }, 404);
    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/projects   — list all projects (for Governance tab)
  // -------------------------------------------------------------------------
  router.get('/projects', async (c) => {
    const db = requestDb(c);
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
      .orderBy(desc(projects.updatedAt)).limit(LIST_ROW_CAP);
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
    const db = requestDb(c);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
    const body = await parseBody(c, ProjectGovernanceBody);
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
    const body = await parseBody(c, ImpersonationStartBody);
    const result = await startImpersonation(c.env, requestDb(c), {
      adminId:        c.get('userId') as string,
      userId:         body.userId ?? '',
      tenantId:       body.tenantId ?? 0,
      role:           body.role,
      reason:         body.reason ?? '',
      enableDebugger: body.enableDebugger ?? false,
      ipAddress:      c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? null,
      userAgent:      c.req.header('User-Agent') ?? null,
    });
    if (!result.ok) {
      return c.json({ error: result.error, ...(result.sessionId ? { sessionId: result.sessionId } : {}) }, result.status);
    }
    const { sessionId, ...started } = result.started;
    return c.json({ emulationSessionId: sessionId, ...started });
  });

  // -------------------------------------------------------------------------
  // POST /api/admin/impersonation/:id/end
  // End an active impersonation session and invalidate the token.
  // -------------------------------------------------------------------------
  router.post('/impersonation/:id/end', async (c) => {
    const adminId = c.get('userId') as string;
    const sessionId = c.req.param('id');
    const db = requestDb(c);

    const [session] = await db
      .select()
      .from(adminImpersonationSessions)
      .where(and(eq(adminImpersonationSessions.id, sessionId), eq(adminImpersonationSessions.adminUserId, adminId)))
      .limit(1);

    if (!session) return c.json({ error: 'Session not found' }, 404);
    if (session.endedAt) return c.json({ error: 'Session already ended' }, 409);

    const now = new Date();
    await db
      .update(adminImpersonationSessions)
      .set({ endedAt: now, endReason: 'MANUAL' })
      .where(eq(adminImpersonationSessions.id, sessionId));
    // The emulation middleware caches the session verdict; drop it so the token dies now.
    await invalidateEmulationSession(c.env, sessionId);

    // Revoke the token JTI
    if (session.tokenJti) await revokeSessionTokens(db, c.env, { jti: session.tokenJti });

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
    const db = requestDb(c);
    const { role: requestedRole } = await parseBody(c, SwitchRoleBody);

    if (!requestedRole) return c.json({ error: 'role is required' }, 400);

    const [session] = await db
      .select()
      .from(adminImpersonationSessions)
      .where(and(eq(adminImpersonationSessions.id, sessionId), eq(adminImpersonationSessions.adminUserId, adminId), isNull(adminImpersonationSessions.endedAt)))
      .limit(1);

    if (!session) return c.json({ error: 'Active session not found' }, 404);

    const roleDecision = await resolveImpersonationRole(db, session.tenantId, session.targetUserId, requestedRole);
    if (!roleDecision.ok) return c.json({ error: roleDecision.error }, roleDecision.status);
    const role = roleDecision.role;
    const fromRole = session.roleOverride;

    // Log the role switch
    await db.insert(adminImpersonationRoleSwitches).values({
      sessionId,
      fromRole,
      toRole: role,
    });

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

    // Update the session's current role AND its live JTI — the emulation middleware
    // rejects any token whose jti differs from the stored one, so without this the
    // freshly issued token was refused as "superseded" and the old one kept working.
    const newJti = decodeJwtPayload<{ jti?: string }>(newToken).jti;
    await db
      .update(adminImpersonationSessions)
      .set({ roleOverride: role, ...(newJti ? { tokenJti: newJti } : {}) })
      .where(eq(adminImpersonationSessions.id, sessionId));
    // The middleware caches the session's JTI; drop it so the switch bites now.
    await invalidateEmulationSession(c.env, sessionId);

    // Invalidate old token JTI if present
    if (session.tokenJti) await revokeSessionTokens(db, c.env, { jti: session.tokenJti });

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
    const db = requestDb(c);

    const [session] = await db
      .select()
      .from(adminImpersonationSessions)
      .where(and(eq(adminImpersonationSessions.adminUserId, adminId), isNull(adminImpersonationSessions.endedAt), gt(adminImpersonationSessions.expiresAt, new Date())))
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
    const db = requestDb(c);
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
    const db = requestDb(c);
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
      .orderBy(adminImpersonationRoleSwitches.switchedAt).limit(LIST_ROW_CAP);

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
    // The ONE operator-audit read, shared with the CSV download below.
    const entries = await listAdminAuditLog(requestDb(c), adminAuditFilterFrom((name) => c.req.query(name)), {
      limit: Math.min(parsePositiveInt(c.req.query('limit'), 50), 200),
      offset: parsePositiveInt(c.req.query('offset'), 0),
    });
    return c.json({ entries });
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
    const { roles, permissions, matrix, overrides } = await loadPermissionMatrix(requestDb(c));
    return c.json({
      roles,
      permissions,
      matrix,
      // Which rows are backed by a real request-time gate. Without this the
      // screen implied every override took effect; most are still advisory
      // because the route is gated by the role ladder alone.
      enforced: [...ENFORCED_PERMISSIONS],
      overrides: overrides.map((o) => ({ tenantId: null, role: o.role, permission: o.permission, granted: o.granted })),
    });
  });

  // PUT /api/admin/permissions/roles/:role — update permission overrides for a role
  router.put('/permissions/roles/:role', async (c) => {
    const db = requestDb(c);
    const actorId = c.get('userId') as string;
    const role = c.req.param('role');
    if (!isTenantRole(role)) {
      return c.json({ error: 'Invalid role' }, 400);
    }
    const body = await parseBody(c, RolePermissionMatrixBody);
    if (!Array.isArray(body.overrides)) return c.json({ error: 'overrides array required' }, 400);

    // ONE multi-row upsert for the whole matrix edit.
    if (body.overrides.length) {
      await db
        .insert(rolePermissionOverrides)
        .values(body.overrides.map((override) => ({ role, permission: override.permission, granted: override.granted, reason: override.reason ?? null, createdBy: actorId })))
        .onConflictDoUpdate({
          target: [rolePermissionOverrides.role, rolePermissionOverrides.permission],
          set: { granted: excluded(rolePermissionOverrides.granted), reason: excluded(rolePermissionOverrides.reason) },
        });
    }

    await writeAudit(db, 'ROLE_PERMISSION_CHANGED', actorId, {
      metadata: { role, overrides: body.overrides },
      ipAddress: c.req.header('CF-Connecting-IP') ?? null,
    });

    // The gate resolves this set from cache on every request — a matrix edit
    // that skipped this would keep applying the OLD permissions until the TTL.
    await invalidateRolePermissions(c.env, role);

    const updated = await db.select().from(rolePermissionOverrides).where(eq(rolePermissionOverrides.role, role));
    return c.json({ role, permissions: resolveRolePermissions(role, updated) });
  });

  // GET /api/admin/permissions/matrix/export — a registered export source
  // (csv | xlsx | json; also at /api/exports/sources/admin.permission-matrix).
  router.get('/permissions/matrix/export', exportSourceHandler(permissionMatrixExportSource));

  // =========================================================================
  // MODULES ROUTES
  // =========================================================================

  // GET /api/admin/modules
  router.get('/modules', async (c) => {
    const db = requestDb(c);
    const rows = await db.select().from(platformModules).orderBy(platformModules.name).limit(LIST_ROW_CAP);
    return c.json({
      modules: rows.map((m) => ({
        ...m,
        permissions: coerceStringArray(m.permissions),
        createdAt: m.createdAt?.toISOString() ?? null,
        updatedAt: m.updatedAt?.toISOString() ?? null,
      })),
    });
  });

  // POST /api/admin/modules
  router.post('/modules', async (c) => {
    const db = requestDb(c);
    const actorId = c.get('userId') as string;
    const body = await parseBody(c, ModuleCreateBody);
    if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
    const slug = (body.slug?.trim() || body.name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''));
    const [mod] = await db
      .insert(platformModules)
      .values({
        name: body.name.trim(),
        slug,
        description: body.description?.trim() ?? null,
        baseRole: body.baseRole ?? null,
        // `platform_modules.permissions` is a jsonb column typed `string[]` — the array
        // goes in as an array. Stringifying it stored a JSON string INSIDE the jsonb,
        // which read back as a string that every permission check then failed to match.
        permissions: body.permissions ?? [],
        isBuiltin: false,
        createdBy: actorId,
      })
      .returning();
    await writeAudit(db, 'MODULE_ASSIGNED', actorId, { metadata: { moduleId: mod!.id, name: mod!.name } });
    return c.json({ module: { ...mod, permissions: coerceStringArray(mod!.permissions) } }, 201);
  });

  // PATCH /api/admin/modules/:id
  router.patch('/modules/:id', async (c) => {
    const db = requestDb(c);
    const actorId = c.get('userId') as string;
    const id = c.req.param('id');
    const body = await parseBody(c, ModulePatchBody);
    const [mod] = await db
      .update(platformModules)
      .set({
        ...(body.name && { name: body.name.trim() }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.baseRole !== undefined && { baseRole: body.baseRole }),
        ...(body.permissions !== undefined && { permissions: body.permissions }),
        updatedAt: new Date(),
      })
      .where(eq(platformModules.id, id))
      .returning();
    if (!mod) return c.json({ error: 'Module not found' }, 404);
    return c.json({ module: { ...mod, permissions: coerceStringArray(mod.permissions) } });
  });

  // DELETE /api/admin/modules/:id
  router.delete('/modules/:id', async (c) => {
    const db = requestDb(c);
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
    const db = requestDb(c);
    const actorId = c.get('userId') as string;
    const tenantId = parseInt(c.req.param('tenantId'), 10);
    const userId = c.req.param('userId');
    const body = await parseBody(c, ModuleAssignBody);
    if (!body.moduleId) return c.json({ error: 'moduleId is required' }, 400);
    await db.insert(tenantMemberModules).values({
      tenantId, userId, moduleId: body.moduleId, grantedBy: actorId,
    }).onConflictDoNothing();
    await invalidateMemberPermissions(c.env, tenantId, userId);
    await writeAudit(db, 'MODULE_ASSIGNED', actorId, { targetUserId: userId, tenantId, metadata: { moduleId: body.moduleId } });
    return c.json({ ok: true });
  });

  // DELETE /api/admin/tenants/:tenantId/members/:userId/modules/:moduleId
  router.delete('/tenants/:tenantId/members/:userId/modules/:moduleId', async (c) => {
    const db = requestDb(c);
    const actorId = c.get('userId') as string;
    const tenantId = parseInt(c.req.param('tenantId'), 10);
    const userId = c.req.param('userId');
    const moduleId = c.req.param('moduleId');
    await db.delete(tenantMemberModules).where(
      and(eq(tenantMemberModules.tenantId, tenantId), eq(tenantMemberModules.userId, userId), eq(tenantMemberModules.moduleId, moduleId))
    );
    await invalidateMemberPermissions(c.env, tenantId, userId);
    await writeAudit(db, 'MODULE_REMOVED', actorId, { targetUserId: userId, tenantId, metadata: { moduleId } });
    return c.json({ ok: true });
  });

  // =========================================================================
  // ENHANCED USER MANAGEMENT ROUTES
  // =========================================================================

  // POST /api/admin/users/:id/force-logout — increment session_version + revoke all tokens
  router.post('/users/:id/force-logout', async (c) => {
    const db = requestDb(c);
    const actorId = c.get('userId') as string;
    const targetId = c.req.param('id');
    // Increment session_version (JWT-level invalidation for future tokens carrying sv)
    await db.update(users).set({ sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, targetId));
    // authMiddleware reads the counter through the cache — drop it with the increment.
    await invalidateSessionVersion(c.env, targetId);
    // Revoke every active token and session — and the worker's cached verdicts.
    await revokeSessionTokens(db, c.env, { userId: targetId });
    await writeAudit(db, 'USER_SESSIONS_REVOKED', actorId, {
      targetUserId: targetId,
      metadata: { method: 'force_logout' },
      ipAddress: c.req.header('CF-Connecting-IP') ?? null,
    });
    return c.json({ ok: true });
  });

  // POST /api/admin/users/:id/reset-password — send password reset email
  router.post('/users/:id/reset-password', async (c) => {
    const db = requestDb(c);
    const actorId = c.get('userId') as string;
    const targetId = c.req.param('id');
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, targetId)).limit(1);
    if (!user) return c.json({ error: 'User not found' }, 404);

    // Generate a 24-hour magic link so the user can sign in and set a new password
    const token = randomHex(32);
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
    const db = requestDb(c);
    const actorId = c.get('userId') as string;
    const targetId = c.req.param('id');
    const body = await parseBody(c, UserStatusBody);
    await db
      .update(users)
      .set({ isSuspended: body.suspended, updatedAt: sql`now()` })
      .where(eq(users.id, targetId));
    // Revoke every active token and session so suspended users are kicked
    // immediately — including at the legacy worker, whose cached verdict the
    // use case drops.
    if (body.suspended) await revokeSessionTokens(db, c.env, { userId: targetId });
    await writeAudit(db, 'USER_STATUS_CHANGED', actorId, {
      targetUserId: targetId,
      metadata: { suspended: body.suspended },
      ipAddress: c.req.header('CF-Connecting-IP') ?? null,
    });
    return c.json({ ok: true });
  });

  // PUT /api/admin/users/:id/permissions — grant/revoke per-user permissions
  router.put('/users/:id/permissions', async (c) => {
    const db = requestDb(c);
    const actorId = c.get('userId') as string;
    const targetId = c.req.param('id');
    const { tenantId, overrides } = await parseBody(c, UserPermissionOverridesBody);
    if (!tenantId || !Array.isArray(overrides)) {
      return c.json({ error: 'tenantId and overrides array required' }, 400);
    }
    if (overrides.length) {
      await db
        .insert(userPermissionOverrides)
        .values(overrides.map((o) => ({
          tenantId,
          userId: targetId,
          permission: o.permission,
          granted: o.granted,
          expiresAt: o.expiresAt ? new Date(o.expiresAt) : null,
          createdBy: actorId,
        })))
        .onConflictDoUpdate({
          target: [userPermissionOverrides.tenantId, userPermissionOverrides.userId, userPermissionOverrides.permission],
          set: { granted: excluded(userPermissionOverrides.granted), expiresAt: excluded(userPermissionOverrides.expiresAt) },
        });
    }
    await invalidateMemberPermissions(c.env, tenantId, targetId);
    await writeAudit(db, 'USER_PERMISSION_OVERRIDE', actorId, {
      targetUserId: targetId,
      tenantId,
      metadata: { overrides },
      ipAddress: c.req.header('CF-Connecting-IP') ?? null,
    });
    return c.json({ ok: true });
  });

  // PATCH /api/admin/tenants/:tenantId/members/:userId/role — override member role
  router.patch('/tenants/:tenantId/members/:userId/role', async (c) => {
    const db = requestDb(c);
    const actorId = c.get('userId') as string;
    const tenantId = parseInt(c.req.param('tenantId'), 10);
    const userId = c.req.param('userId');
    const body = await parseBody(c, MemberRoleBody);
    const nextRole = body.role;
    if (!isTenantRole(nextRole)) return c.json({ error: 'Invalid role' }, 400);
    // Same use case as the workspace manager's role change, in the platform-admin
    // scope: a cross-tenant override past the member rules, audited.
    const result = await changeMemberRole(db, c.env as Env, { kind: 'platform_admin', ipAddress: c.req.header('CF-Connecting-IP') ?? null }, {
      tenantId, actorUserId: actorId, targetUserId: userId, role: nextRole,
    });
    if (!result.ok) return c.json({ error: 'Member not found in tenant' }, 404);
    return c.json({ ok: true });
  });

  // GET /api/admin/users/:id/effective-permissions — resolved permissions for user in tenant
  router.get('/users/:id/effective-permissions', async (c) => {
    const db = requestDb(c);
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
    const modulePerms = assignedModules.flatMap((m) => coerceStringArray(m.permissions));

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

  // GET /api/admin/audit-log/export — a registered export source
  // (csv | json | xlsx; also at /api/exports/sources/admin.audit-log).
  router.get('/audit-log/export', exportSourceHandler(adminAuditLogExportSource));

  // GET /api/admin/users/:id/workspaces — workspace memberships for a user (tenantId, name, slug, role)
  router.get('/users/:id/workspaces', async (c) => {
    const db = requestDb(c);
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
      .orderBy(tenantMembers.joinedAt).limit(LIST_ROW_CAP);
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
    const db = requestDb(c);
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

  // Tenant API keys (bfk_*) — superadmin mint-on-behalf for any tenant. The SAME
  // router as the owner's /api/tenants/:tenantId/api-keys, in its platform-admin
  // scope (authorized by the superadmin gate above).
  router.route('/tenants/:tenantId/api-keys', createPlatformTenantApiKeyRoutes());

  /**
   * Cross-tenant product feedback roll-up — the dogfooding inbox. Every external
   * request gathered by any tenant's feedback collector, newest first. Shares the
   * ONE queue read the per-tenant triage queue uses (`loadFeedbackQueue`);
   * passing `tenantId: null` is what widens it to every workspace.
   */
  router.get('/feedback', async (c) => {
    const tenantParam = c.req.query('tenantId');
    const tenantId = tenantParam ? Number(tenantParam) : null;
    if (tenantId != null && !Number.isFinite(tenantId)) return c.json({ error: 'Invalid tenantId' }, 400);
    return c.json(await loadFeedbackQueue(requestDb(c), c.env, feedbackQueueFilter(c, { tenantId })));
  });

  /**
   * Superadmin review of any tenant's request. The decision itself runs through
   * the SAME engine as tenant-side triage, so approving here un-gates the ticket
   * identically — there is no second, privileged approval path to keep in sync.
   */
  router.post('/feedback/:id/review', async (c) => {
    const db = requestDb(c);
    const body = await parseOptionalBody(c, FeedbackReviewBody);
    if (!isFeedbackDecision(body.decision)) return c.json({ error: FEEDBACK_DECISION_ERROR }, 400);
    if (typeof body.tenantId !== 'number') return c.json({ error: 'tenantId is required' }, 400);

    const result = await reviewFeedbackSubmission(db, c.env, {
      tenantId: body.tenantId,
      submissionId: c.req.param('id'),
      decision: body.decision,
      reviewerUserId: (c.get('userId') as string | undefined) ?? null,
    });
    if (!result.ok) return c.json({ error: 'Submission not found' }, 404);
    return c.json({ ok: true, taskId: result.taskId });
  });

  // ═══ PUBLISHERS — the decisions only an operator may make (PRD 24) ════════
  //
  // Three of the marketplace's states cannot be self-serve, and each for its own
  // reason:
  //
  //   • `identity_verified` — it is what gates CHARGING MONEY (§9 decision 2,
  //     `mayCharge`). A workspace that could promote itself past it would be a
  //     workspace that could take payments by pressing a button. Domain
  //     verification IS self-serve (`verifyPublisherDomain` does a real DNS
  //     lookup and promotes on the result); identity is the tier that needs a
  //     person to have looked at a document, so the endpoint records a decision
  //     rather than performing a check.
  //   • suspension — standing a vendor down hides every listing they have at once.
  //   • a partner TRACK and Featured placement — §2.1's funnel has a human at the
  //     top, and Featured's entire value is that not everybody has it.
  //
  // Every one is audited: these are the marketplace's trust decisions, and a
  // trust decision nobody can attribute is one that will eventually be disputed.

  router.post('/publishers/:tenantId/state', async (c) => {
    const db = requestDb(c);
    const tenantId = Number(c.req.param('tenantId'));
    if (!Number.isFinite(tenantId)) return c.json({ error: 'Invalid tenantId' }, 400);
    const body = await parseOptionalBody(c, PublisherStateBody);
    const actorId = c.get('userId') as string;
    try {
      const publisher = await setPublisherState(db, c.env as Env, { tenantId, state: body.state ?? '' });
      await writeAdminAudit(db, 'PUBLISHER_STATE_SET', actorId, {
        tenantId,
        metadata: { state: publisher.state, note: body.note ?? null },
      });
      return c.json({ publisher });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Could not set the publisher state' },
        error instanceof PublisherError ? error.status : 400,
      );
    }
  });

  router.post('/publishers/:tenantId/suspension', async (c) => {
    const db = requestDb(c);
    const tenantId = Number(c.req.param('tenantId'));
    if (!Number.isFinite(tenantId)) return c.json({ error: 'Invalid tenantId' }, 400);
    const body = await parseOptionalBody(c, PublisherSuspensionBody);
    if (typeof body.suspended !== 'boolean') return c.json({ error: 'suspended must be true or false' }, 400);
    const actorId = c.get('userId') as string;
    try {
      const publisher = await setPublisherSuspended(db, c.env as Env, {
        tenantId,
        suspended: body.suspended,
        reason: body.reason ?? null,
      });
      // The catalogue caches a suspended publisher's listings out of existence,
      // so the invalidation is part of the decision rather than a later sweep.
      await invalidatePublicCatalog(c.env as Env);
      await writeAdminAudit(db, body.suspended ? 'PUBLISHER_SUSPENDED' : 'PUBLISHER_RESTORED', actorId, {
        tenantId,
        metadata: { reason: body.reason ?? null },
      });
      return c.json({ publisher });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Could not change the suspension' },
        error instanceof PublisherError ? error.status : 400,
      );
    }
  });

  router.post('/publishers/:tenantId/track', async (c) => {
    const db = requestDb(c);
    const tenantId = Number(c.req.param('tenantId'));
    if (!Number.isFinite(tenantId)) return c.json({ error: 'Invalid tenantId' }, 400);
    const body = await parseOptionalBody(c, PartnerTrackBody);
    const actorId = c.get('userId') as string;
    try {
      const standing = await setPartnerTrack(db, c.env as Env, {
        tenantId,
        track: body.track ?? 'none',
        featured: body.featured,
      });
      await writeAdminAudit(db, 'PUBLISHER_TRACK_SET', actorId, {
        tenantId,
        metadata: { track: standing.track, featured: standing.featuredAtISO !== null },
      });
      return c.json({ standing });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Could not set the partner track' },
        error instanceof PublisherError ? error.status : 400,
      );
    }
  });

  return router;
}
