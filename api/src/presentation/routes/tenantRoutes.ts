import { Hono } from 'hono';
import type { Context } from 'hono';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { TenantService } from '../../application/tenant/TenantService';
import { TenantRole, TenantBillingCycle, TenantPlan } from '../../domain/shared/types';
import { resolveAppBaseUrl, type Env, type HonoEnv } from '../../env';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { invalidateJwtMembershipCache } from '../../infrastructure/auth/keyResolutionCache';
import { isAgentHostOnline } from '../../domain/agentHost/onlineStatus';
import { buildPlanLimitsGuard, seatCapacityForTenant } from '../middleware/planLimitsGuard';
import { canAddSeat } from '../../domain/tenant/PlanLimits';
import { trialDaysRemaining } from '../../domain/tenant/effectivePlan';
import { buildPaymentProvider } from '../../infrastructure/payment';
import {
  getCardValidation,
  isCardValidated,
  markCardPending,
  clearCardValidation,
} from '../../application/tenant/cardValidationService';
import { webAuthMiddleware } from '../middleware/webAuthMiddleware';
import type { Db } from '../../infrastructure/database/connection';
import {
  authTokens,
  authUserSessions,
  agentHosts,
  agentHostProjects,
  sourceControlIntegrations,
  tenantInvitations,
  tenantMembers,
  tenants,
  users,
} from '../../infrastructure/database/schema';
import { sendWorkspaceInviteEmail } from '../../infrastructure/email/EmailService';
import { sendTransactionalEmail } from '../../application/email/sendEmail';
import { headerHints } from '../../application/email/emailLocaleResolver';
import { countActiveSessionsAndTokens } from '../../application/security/sessionCounts';
import { provisionBuiltinAgents } from '../../application/agent/provisionBuiltinAgents';
import { recordActivity, resolveActorFromContext } from '../../application/activity/activityLog';
import { tenantHasSuperadminMember } from '../../application/llm/tenantTokenAvailability';
import { getTeamSpendOverview, invalidateTeamSpendCaches, usdToMillicents } from '../../application/consumption/memberSpend';

/** Best-effort audit emit for a membership mutation (invite / add), attributed to
 *  the acting manager. Off the response path; never throws. */
function emitMemberActivity(
  c: Context<HonoEnv>,
  db: Db,
  verb: string,
  o: { targetId: string; targetLabel: string; summary: string; metadata?: Record<string, unknown> },
): void {
  c.executionCtx.waitUntil((async () => {
    const actor = await resolveActorFromContext(c.env as Env, db, c);
    await recordActivity(c.env as Env, db, {
      tenantId: c.get('tenantId') as number,
      actor,
      verb,
      targetType: 'member',
      targetId: o.targetId,
      targetLabel: o.targetLabel,
      summary: o.summary,
      metadata: o.metadata ?? null,
    });
  })().catch(() => {}));
}

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

/**
 * Drop the cached human assignee list for a tenant. Called from every membership
 * add/remove path so GET /api/tasks/assignees re-loads immediately instead of
 * serving a stale roster until the KV TTL expires (~5 min). Keep the key in sync
 * with the producer in taskRoutes.ts (`task-assignees:tenant:<id>`).
 */
async function invalidateTaskAssignees(env: Env, tenantId: number): Promise<void> {
  await invalidateCached(env, `task-assignees:tenant:${tenantId}`);
}

/** Cache key for a tenant's pending-invitation roster (GET /:id/invitations). */
function invitationsCacheKey(tenantId: number): string {
  return `tenant-invitations:tenant:${tenantId}`;
}

async function invalidateInvitations(env: Env, tenantId: number): Promise<void> {
  await invalidateCached(env, invitationsCacheKey(tenantId));
}

/**
 * Convert any still-pending invitations addressed to `email` into real
 * memberships for `userId`. Called on login (GET /tenants/mine) so an invite
 * sent before the person had an account "lands" the first time they return.
 *
 * Each accepted row is stamped accepted/accepted_at and the tenant's assignee +
 * invitation caches are dropped. If the user is already a member (invited twice,
 * or added manually in between) the row is still resolved to 'accepted' rather
 * than retried forever. Best-effort: a single tenant failing never blocks the others.
 */
async function acceptPendingInvitations(
  db: Db,
  env: Env,
  tenantService: TenantService,
  userId: string,
  email: string,
): Promise<void> {
  const normalized = email.toLowerCase().trim();
  if (!normalized) return;

  const pending = await db
    .select({
      id: tenantInvitations.id,
      tenantId: tenantInvitations.tenantId,
      role: tenantInvitations.role,
      invitedByUserId: tenantInvitations.invitedByUserId,
    })
    .from(tenantInvitations)
    .where(and(eq(tenantInvitations.email, normalized), eq(tenantInvitations.status, 'pending')));

  // Per-tenant live seat tally, fetched lazily on first use and incremented as we
  // seat invites within this run, so a batch of invites for the same tenant can't
  // collectively overshoot the cap.
  const seatState = new Map<number, { plan: TenantPlan; seated: number }>();

  for (const invite of pending) {
    // The invitee can't authorize their own membership — replay the add under
    // the manager who sent the invite (guaranteed a manager/owner at invite time).
    if (!invite.invitedByUserId) continue;
    try {
      // Already a member? Resolve the invite without re-adding (addMember would
      // throw "already a member" and leave the row stuck pending).
      const alreadyMember = await assertTenantMember(db, invite.tenantId, userId);
      if (!alreadyMember) {
        // Re-check seat capacity at ACCEPT time (members-only — this pending row
        // is about to be consumed). The invite-time guard already counted pending
        // seats, but a plan DOWNGRADE after the invites were queued can still
        // over-subscribe. If the plan can't seat it, leave the invite pending
        // (visible in the manager's invitations list, auto-retries once a seat
        // frees up or they upgrade) instead of silently auto-accepting past the cap.
        let state = seatState.get(invite.tenantId);
        if (!state) {
          const cap = await seatCapacityForTenant(db, invite.tenantId);
          state = { plan: cap.plan, seated: cap.members };
          seatState.set(invite.tenantId, state);
        }
        if (!canAddSeat(state.plan, state.seated)) {
          continue; // over cap — leave pending, do not seat
        }
        await tenantService.addMember(invite.tenantId, invite.invitedByUserId, userId, invite.role as TenantRole);
        state.seated += 1;
      }
      await db
        .update(tenantInvitations)
        .set({ status: 'accepted', acceptedAt: new Date() })
        .where(eq(tenantInvitations.id, invite.id));
      await invalidateTaskAssignees(env, invite.tenantId);
      await invalidateInvitations(env, invite.tenantId);
    } catch {
      // A transient error on one tenant must not block the user's login or the
      // other tenants' invites — leave the row pending so it retries next visit.
    }
  }
}

/**
 * Tenant reads on the tenant-JWT path are SELF-SCOPED: a caller may only read the
 * workspace its token is scoped to. Returns a 403 Response to short-circuit otherwise.
 * Prevents enumerating another tenant's metadata (name/plan/billing) by guessing its id.
 */
function forbidCrossTenant(c: Context<HonoEnv>, id: number): Response | undefined {
  return id === (c.get('tenantId') as number) ? undefined : c.json({ error: 'Forbidden' }, 403);
}

export function createTenantRoutes(tenantService: TenantService, db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // GET /api/tenants/mine  – WebJWT required; returns tenants the caller belongs to
  // Used by the tenant picker immediately after login (before a tenant JWT exists)
  router.get('/mine', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    // Land any invitations sent to this user's email before they had an account
    // (or before they last returned) — they convert to memberships and show up
    // in the list below on this very request.
    const [account] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (account?.email) {
      await acceptPendingInvitations(db, c.env as Env, tenantService, userId, account.email);
    }
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
    await provisionBuiltinAgents(db, tenant.id).catch(() => {});   // seed Validator + Security
    return c.json(tenant.toPlain(), 201);
  });

  // PATCH /api/tenants/:id/name  – WebJWT required; renames a workspace (owner/manager only)
  // Lives on the web-auth path so the tenant picker can rename before a tenant JWT exists.
  router.patch('/:id/name', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const id     = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'invalid tenant id' }, 400);
    const body   = await c.req.json<{ name: string }>();
    if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
    const tenant = await tenantService.renameTenant(id, userId, body.name);
    return c.json(tenant.toPlain());
  });

  // All routes below require a tenant-scoped JWT
  router.use('*', authMiddleware);

  // GET /api/tenants — membership-scoped: returns only the workspaces the caller
  // belongs to (billing PII + roster live on toPlain, so an unscoped list would
  // leak every tenant's data). A superadmin-operated tenant keeps the full,
  // unscoped view via the same check the token/run caps use.
  router.get('/', async (c) => {
    const userId = c.get('userId') as string;
    const isSuperadmin = await tenantHasSuperadminMember(db, c.get('tenantId') as number, c.env as Env);
    const tenants = isSuperadmin
      ? await tenantService.listTenants()
      : await tenantService.listTenantsForUserFull(userId);
    return c.json({ tenants: tenants.map(t => t.toPlain()) });
  });

  // GET /api/tenants/:id — self-scoped (a caller can only read its own workspace).
  // Surfaces the trial state (effectivePlan + days left) so the UI can render
  // "Pro trial — N days left" without re-deriving the entitlement rules.
  router.get('/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const denied = forbidCrossTenant(c, id);
    if (denied) return denied;
    const tenant = await tenantService.getTenant(id);
    return c.json({
      ...tenant.toPlain(),
      effectivePlan: tenant.effectivePlan(),
      trialDaysRemaining: trialDaysRemaining(tenant.billingStatus, tenant.trialEndsAt),
    });
  });

  // GET /api/tenants/:id/default-agentHost
  router.get('/:id/default-agentHost', async (c) => {
    const id = Number(c.req.param('id'));
    const denied = forbidCrossTenant(c, id);
    if (denied) return denied;
    const tenant = await tenantService.getTenant(id);
    return c.json({ defaultAgentHostId: tenant.defaultAgentHostId });
  });

  // PUT /api/tenants/:id/default-agentHost
  router.put('/:id/default-agentHost', requireRole(TenantRole.MANAGER), async (c) => {
    const id = Number(c.req.param('id'));
    const callerTenantId = c.get('tenantId') as number;
    if (id !== callerTenantId) return c.json({ error: 'Forbidden' }, 403);

    const body = await c.req.json<{ agentHostId?: number | null }>();
    const agentHostId = body.agentHostId ?? null;

    if (agentHostId !== null) {
      const [agentHost] = await db
        .select({ id: agentHosts.id })
        .from(agentHosts)
        .where(
          and(
            eq(agentHosts.id, agentHostId),
            eq(agentHosts.tenantId, id),
          ),
        )
        .limit(1);
      if (!agentHost) return c.json({ error: 'AgentHost not found in workspace' }, 404);
    }

    const tenant = await tenantService.setDefaultAgentHost(id, agentHostId);
    return c.json({ defaultAgentHostId: tenant.defaultAgentHostId });
  });

  // GET /api/tenants/:id/subscription
  router.get('/:id/subscription', async (c) => {
    const tenantId = Number(c.req.param('id'));
    const callerTenantId = c.get('tenantId') as number;
    if (tenantId !== callerTenantId) return c.json({ error: 'Forbidden' }, 403);

    const subscription = await tenantService.getSubscription(tenantId);
    return c.json(subscription);
  });

  /**
   * POST /api/tenants/:id/subscription/checkout
   *
   * Initiate a Pro or Teams upgrade. Returns { checkoutUrl: "https://..." } — the
   * frontend redirects the user there. The subscription becomes active only once
   * Stripe fires the activation webhook, never from this request.
   *
   * Body:
   *   targetPlan          "pro" | "teams"        optional (defaults to "pro")
   *   seats               number                 required when targetPlan="teams"
   *   billingCycle        "monthly" | "yearly"   required
   *   billingEmail        string                 required
   *   successUrl          string                 optional (defaults to /pricing?success=1)
   *   cancelUrl           string                 optional (defaults to /pricing?cancelled=1)
   */
  router.post('/:id/subscription/checkout', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = Number(c.req.param('id'));
    const callerTenantId = c.get('tenantId') as number;
    if (tenantId !== callerTenantId) return c.json({ error: 'Forbidden' }, 403);

    const body = await c.req.json<{
      targetPlan?: 'pro' | 'teams';
      seats?: number;
      billingCycle: TenantBillingCycle;
      billingEmail: string;
      successUrl?: string;
      cancelUrl?: string;
    }>();

    if (!body.billingCycle || !body.billingEmail) {
      return c.json({ error: 'billingCycle and billingEmail are required' }, 400);
    }

    const targetPlan = body.targetPlan === 'teams' ? TenantPlan.TEAMS : TenantPlan.PRO;

    if (targetPlan === TenantPlan.TEAMS && (!body.seats || body.seats < 1)) {
      return c.json({ error: 'seats (≥1) is required for the Teams plan' }, 400);
    }

    const appUrl = c.env.APP_URL ?? 'https://builderforce.ai';
    const result = await tenantService.createCheckoutSession(tenantId, {
      targetPlan,
      seats: body.seats,
      billingCycle: body.billingCycle,
      billingEmail: body.billingEmail,
      successUrl: body.successUrl ?? `${appUrl}/pricing?success=1`,
      cancelUrl: body.cancelUrl ?? `${appUrl}/pricing?cancelled=1`,
    });

    return c.json(result);
  });

  /**
   * GET /api/tenants/:id/card-validation
   *
   * Current card-validation state — the gate on PREMIUM (any-paid-OpenRouter) model
   * selection. `validated` is the same predicate the gateway enforces.
   */
  router.get('/:id/card-validation', async (c) => {
    const tenantId = Number(c.req.param('id'));
    const callerTenantId = c.get('tenantId') as number;
    if (tenantId !== callerTenantId) return c.json({ error: 'Forbidden' }, 403);

    const state = await getCardValidation(c.env, tenantId);
    return c.json({
      status: state.status,
      validated: isCardValidated(state),
      validatedAt: state.validatedAt?.toISOString() ?? null,
      brand: state.brand,
      last4: state.last4,
    });
  });

  /**
   * POST /api/tenants/:id/card-validation
   *
   * Start the explicit card-validation flow (Stripe SetupIntent / $0 auth) that unlocks
   * PREMIUM model selection — any paid OpenRouter model, billed at OpenRouter cost + a
   * flat 1¢ per request.
   *
   * Returns { checkoutUrl } to redirect to; the card is stamped validated when Stripe
   * fires the `card.validated` webhook.
   *
   * Body:
   *   billingEmail  string   required
   *   successUrl    string   optional
   *   cancelUrl     string   optional
   */
  router.post('/:id/card-validation', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = Number(c.req.param('id'));
    const callerTenantId = c.get('tenantId') as number;
    if (tenantId !== callerTenantId) return c.json({ error: 'Forbidden' }, 403);

    const body = await c.req.json<{ billingEmail?: string; successUrl?: string; cancelUrl?: string }>()
      .catch(() => ({} as { billingEmail?: string; successUrl?: string; cancelUrl?: string }));

    const tenant = await tenantService.getTenant(tenantId);
    const billingEmail = body.billingEmail ?? tenant.billingEmail;
    if (!billingEmail) return c.json({ error: 'billingEmail is required' }, 400);

    const appUrl = c.env.APP_URL ?? 'https://builderforce.ai';
    const payment = buildPaymentProvider(c.env);
    const result = await payment.createCardValidationSession({
      tenantId,
      billingEmail,
      externalCustomerId: tenant.externalCustomerId,
      // Return to the BILLING CONSOLE, which is `/pricing` — that's where the card
      // controls live (<PremiumModelUnlock> / <CardOnFile>). `/settings` has no card
      // surface at all, so the old default dropped the user on a page that couldn't
      // confirm what had just happened.
      successUrl: body.successUrl ?? `${appUrl}/pricing?card=validated`,
      cancelUrl: body.cancelUrl ?? `${appUrl}/pricing?card=cancelled`,
    });

    // ADD-then-swap, never reset-then-add.
    //
    // Marking `pending` clears the validated verdict, which SUSPENDS premium model
    // access. That's right for a first-time validation (there was no access to
    // lose) but wrong for a REPLACE: it revoked a paying tenant's premium for as
    // long as the processor took to confirm the new card, for no reason — the old
    // card is still perfectly valid until the new one lands. So an already-validated
    // tenant keeps their verdict, and the swap completes in the webhook, which
    // overwrites the card and detaches the displaced one.
    const existing = await getCardValidation(c.env, tenantId);
    const replacing = isCardValidated(existing);
    if (!replacing) await markCardPending(c.env, tenantId);

    return c.json({
      checkoutUrl: result.checkoutUrl,
      sessionId: result.sessionId,
      // A replace reports the state the tenant is actually still in — they remain
      // validated on the OLD card until the new one is confirmed.
      validated: replacing,
      status: replacing ? existing.status : 'pending',
    });
  });

  /**
   * DELETE /api/tenants/:id/card-validation
   *
   * Remove the card on file: detach it at the processor, then clear our own record.
   * Premium model selection goes with it — the gate reads `isCardValidated`, and
   * continuing to sell premium off a card we no longer hold would be the bug.
   *
   * REFUSED while a paid subscription is live (409). Those cards are the renewal
   * instrument; detaching one would break billing at the next cycle with no signal
   * to the user. Downgrading to Free cancels the subscription and clears the way,
   * so the response names that path rather than half-performing the removal.
   *
   * Order matters: detach FIRST, clear second. If the processor call fails we've
   * changed nothing, and the tenant keeps the access they paid for — the opposite
   * order would revoke premium while Stripe still held the card.
   */
  router.delete('/:id/card-validation', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = Number(c.req.param('id'));
    const forbidden = forbidCrossTenant(c, tenantId);
    if (forbidden) return forbidden;

    const tenant = await tenantService.getTenant(tenantId);

    if (tenant.externalSubscriptionId && tenant.billingStatus === 'active') {
      return c.json({
        error: 'Cancel your paid plan before removing the card it bills. Downgrade to Free, then remove the card.',
        code: 'card_backs_active_subscription',
      }, 409);
    }

    // Detach the card WE recorded. Pre-0346 rows carry no payment-method id and
    // fall back to a customer-wide sweep (safe: those tenants predate multi-card
    // support). With neither handle there is nothing stored at the processor, but
    // clearing our own record still matters — a stale `validated` status would
    // keep premium open against a card we no longer have.
    const { paymentMethodId } = await getCardValidation(c.env, tenantId);
    if (paymentMethodId || tenant.externalCustomerId) {
      await buildPaymentProvider(c.env).detachCards({
        paymentMethodId,
        externalCustomerId: tenant.externalCustomerId,
      });
    }
    await clearCardValidation(c.env, tenantId);

    return c.json({ status: 'none', validated: false, validatedAt: null, brand: null, last4: null });
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

  // GET /api/tenants/:id/agentHosts?status=online
  router.get('/:id/agentHosts', async (c) => {
    const tenantId = Number(c.req.param('id'));
    const callerTenantId = c.get('tenantId') as number;
    if (tenantId !== callerTenantId) return c.json({ error: 'Forbidden' }, 403);

    const status = (c.req.query('status') ?? '').trim().toLowerCase();
    const rows = await db
      .select({
        id:           agentHosts.id,
        name:         agentHosts.name,
        slug:         agentHosts.slug,
        status:       agentHosts.status,
        connectedAt:  agentHosts.connectedAt,
        lastSeenAt:   agentHosts.lastSeenAt,
        capabilities: agentHosts.capabilities,
      })
      .from(agentHosts)
      .where(eq(agentHosts.tenantId, tenantId));

    const filtered = status === 'online'
      ? rows.filter((row) => isAgentHostOnline(row))
      : rows;

    // Fetch every host's project links in ONE query (grouped in JS) instead of an
    // N+1 per-host round-trip.
    const hostIds = filtered.map((row) => row.id);
    const projectLinks = hostIds.length
      ? await db
          .select({ agentHostId: agentHostProjects.agentHostId, projectId: agentHostProjects.projectId })
          .from(agentHostProjects)
          .where(and(
            eq(agentHostProjects.tenantId, tenantId),
            inArray(agentHostProjects.agentHostId, hostIds),
          ))
      : [];
    const projectsByHost = new Map<number, number[]>();
    for (const link of projectLinks) {
      const list = projectsByHost.get(link.agentHostId) ?? [];
      list.push(link.projectId);
      projectsByHost.set(link.agentHostId, list);
    }

    const hostRows = filtered.map((row) => {
      const associatedProjects = projectsByHost.get(row.id) ?? [];
      const capabilities: string[] = row.capabilities
        ? (JSON.parse(row.capabilities) as string[])
        : [];
      const online = isAgentHostOnline(row);
      return {
        ...row,
        online,
        capabilities,
        capabilitySummary: {
          distributed: online && associatedProjects.length > 1,
          remoteDispatch: online && capabilities.includes('remote-dispatch'),
          projectCount: associatedProjects.length,
        },
        projectIds: associatedProjects,
      };
    });

    return c.json({ agentHosts: hostRows });
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
    await provisionBuiltinAgents(db, tenant.id).catch(() => {});   // seed Validator + Security
    return c.json(tenant.toPlain(), 201);
  });

  // POST /api/tenants/:id/members
  router.post('/:id/members', requireRole(TenantRole.MANAGER), async (c) => {
    const id   = Number(c.req.param('id'));
    const body = await c.req.json<{ newUserId: string; role: TenantRole }>();
    const actorUserId = c.get('userId') as string;

    const guard = buildPlanLimitsGuard(db, c.env as Env);
    const limitErr = await guard.checkSeatLimit(id);
    if (limitErr) return c.json(limitErr, 402);

    const tenant = await tenantService.addMember(id, actorUserId, body.newUserId, body.role);
    await invalidateTaskAssignees(c.env as Env, id);
    // New membership must resolve at the gateway immediately, not after the 60s TTL.
    await invalidateJwtMembershipCache(c.env as Env, id, body.newUserId).catch(() => {});
    return c.json(tenant.toPlain());
  });

  // POST /api/tenants/:id/invite-by-email
  // Existing account → add as a member immediately (status 'added'). No account
  // yet → record a pending invitation (status 'pending') that auto-converts to a
  // membership the first time they log in with that email (see GET /mine).
  router.post('/:id/invite-by-email', requireRole(TenantRole.MANAGER), async (c) => {
    const id          = Number(c.req.param('id'));
    const callerTenantId = c.get('tenantId') as number;
    if (id !== callerTenantId) return c.json({ error: 'Forbidden' }, 403);

    const body = await c.req.json<{ email: string; role?: TenantRole }>();
    if (!body.email?.trim()) return c.json({ error: 'email is required' }, 400);

    const email = body.email.toLowerCase().trim();
    const role = body.role ?? TenantRole.DEVELOPER;
    const actorUserId = c.get('userId') as string;

    // Seat limit guards both paths: a pending invite is a promise of a seat, so
    // refuse to queue one the plan can't honour. (It is not yet counted as a
    // filled seat — see the Consolidated Gap Register.)
    const guard = buildPlanLimitsGuard(db, c.env as Env);
    const limitErr = await guard.checkSeatLimit(id);
    if (limitErr) return c.json(limitErr, 402);

    const [found] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (found) {
      const tenant = await tenantService.addMember(id, actorUserId, found.id, role);
      await invalidateTaskAssignees(c.env as Env, id);
      await invalidateJwtMembershipCache(c.env as Env, id, found.id).catch(() => {});
      emitMemberActivity(c, db, 'member.added', {
        targetId: found.id, targetLabel: found.email,
        summary: `Added ${found.email} as ${role}`, metadata: { role, userId: found.id },
      });
      return c.json({ ok: true, status: 'added', tenant: tenant.toPlain(), addedUser: { id: found.id, email: found.email } });
    }

    // No account: upsert the pending invitation (the partial-unique index allows
    // only one open invite per email, so re-inviting refreshes role + timestamp).
    const [existing] = await db
      .select({ id: tenantInvitations.id })
      .from(tenantInvitations)
      .where(and(
        eq(tenantInvitations.tenantId, id),
        eq(tenantInvitations.email, email),
        eq(tenantInvitations.status, 'pending'),
      ))
      .limit(1);

    if (existing) {
      await db
        .update(tenantInvitations)
        .set({ role, invitedByUserId: actorUserId, createdAt: new Date() })
        .where(eq(tenantInvitations.id, existing.id));
    } else {
      await db
        .insert(tenantInvitations)
        .values({ tenantId: id, email, role, invitedByUserId: actorUserId });
    }

    await invalidateInvitations(c.env as Env, id);

    emitMemberActivity(c, db, 'member.invited', {
      targetId: email, targetLabel: email,
      summary: `Invited ${email} as ${role}`, metadata: { role, email },
    });

    // Tell the cold invitee they were invited (best-effort — no-ops without
    // RESEND_API_KEY). The signup link pre-fills the invited address so the
    // pending invitation auto-converts on first login (see GET /mine). [1248]
    try {
      const [[tenantRow], [inviter]] = await Promise.all([
        db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, id)).limit(1),
        db.select({ displayName: users.displayName, email: users.email })
          .from(users).where(eq(users.id, actorUserId)).limit(1),
      ]);
      const frontendBase = resolveAppBaseUrl(c.env as Env);
      const signupUrl = `${frontendBase}/register?email=${encodeURIComponent(email)}`;
      // Locale: the resolver first looks up the INVITEE's stored locale — an
      // already-registered user being added to a second workspace gets their own
      // language. Only a genuinely cold address (no `users` row, so nothing to look
      // up) falls through to the INVITER's request locale, which is the best
      // available guess: colleagues being invited to a workspace usually share one.
      await sendTransactionalEmail(
        c.env as Env,
        db,
        email,
        ({ locale }) => sendWorkspaceInviteEmail(c.env as Env, email, {
          workspaceName: tenantRow?.name ?? 'a Builderforce workspace',
          inviterName: inviter?.displayName ?? inviter?.email ?? 'A teammate',
          signupUrl,
          role,
          locale,
        }),
        { headers: headerHints(c.req) },
      );
    } catch (err) {
      console.error('[invite-by-email] notification failed (invite still recorded):', err);
    }

    return c.json({ ok: true, status: 'pending', email });
  });

  // GET /api/tenants/:id/invitations — pending (not-yet-accepted) invitations.
  router.get('/:id/invitations', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = Number(c.req.param('id'));
    const callerTenantId = c.get('tenantId') as number;
    if (tenantId !== callerTenantId) return c.json({ error: 'Forbidden' }, 403);

    const invitations = await getOrSetCached(c.env as Env, invitationsCacheKey(tenantId), async () => {
      const rows = await db
        .select({
          id: tenantInvitations.id,
          email: tenantInvitations.email,
          role: tenantInvitations.role,
          createdAt: tenantInvitations.createdAt,
        })
        .from(tenantInvitations)
        .where(and(eq(tenantInvitations.tenantId, tenantId), eq(tenantInvitations.status, 'pending')))
        .orderBy(desc(tenantInvitations.createdAt));
      return rows;
    });

    return c.json({ invitations });
  });

  // DELETE /api/tenants/:id/invitations/:invId — revoke a pending invitation.
  router.delete('/:id/invitations/:invId', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = Number(c.req.param('id'));
    const callerTenantId = c.get('tenantId') as number;
    if (tenantId !== callerTenantId) return c.json({ error: 'Forbidden' }, 403);

    const invId = c.req.param('invId');
    if (!invId) return c.json({ error: 'invId is required' }, 400);

    await db
      .update(tenantInvitations)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(and(
        eq(tenantInvitations.id, invId),
        eq(tenantInvitations.tenantId, tenantId),
        eq(tenantInvitations.status, 'pending'),
      ));

    await invalidateInvitations(c.env as Env, tenantId);
    return c.json({ ok: true });
  });

  // DELETE /api/tenants/:id/members/:userId
  router.delete('/:id/members/:userId', requireRole(TenantRole.MANAGER), async (c) => {
    const id           = Number(c.req.param('id'));
    const targetUserId = c.req.param('userId');
    const actorUserId  = c.get('userId') as string;
    const tenant = await tenantService.removeMember(id, actorUserId, targetUserId);
    await invalidateTaskAssignees(c.env as Env, id);
    // Revoke the removed member's gateway access at once (not after the 60s TTL).
    await invalidateJwtMembershipCache(c.env as Env, id, targetUserId).catch(() => {});
    return c.json(tenant.toPlain());
  });

  // PATCH /api/tenants/:id/members/:userId/role — change an existing member's role.
  router.patch('/:id/members/:userId/role', requireRole(TenantRole.MANAGER), async (c) => {
    const id           = Number(c.req.param('id'));
    const callerTenantId = c.get('tenantId') as number;
    if (id !== callerTenantId) return c.json({ error: 'Forbidden' }, 403);

    const targetUserId = c.req.param('userId');
    const actorUserId  = c.get('userId') as string;
    const body = await c.req.json<{ role: TenantRole }>();
    if (!body.role || !Object.values(TenantRole).includes(body.role)) {
      return c.json({ error: 'role must be one of: ' + Object.values(TenantRole).join(', ') }, 400);
    }

    const tenant = await tenantService.changeMemberRole(id, actorUserId, targetUserId, body.role);
    await invalidateTaskAssignees(c.env as Env, id);
    // The role rides in the member's next JWT mint; clear the cached membership now.
    await invalidateJwtMembershipCache(c.env as Env, id, targetUserId).catch(() => {});
    return c.json(tenant.toPlain());
  });

  // ── Per-seat AI spend limits (Teams) ──────────────────────────────────────
  // Owner-configured monthly $ ceiling on each seat's non-BYO AI spend (metered at
  // the OpenRouter rate). Reads are MANAGER+ (spend visibility); writes are OWNER
  // only (they own the budget). The enforcement + resolution rule lives ONCE in
  // application/consumption/memberSpend.ts — these routes are the config surface.
  const MAX_SPEND_CAP_USD = 100_000;

  // GET /api/tenants/:id/spend-limits — overview: default cap + every seat's cap & spend.
  router.get('/:id/spend-limits', requireRole(TenantRole.MANAGER), async (c) => {
    const id = Number(c.req.param('id'));
    if (id !== (c.get('tenantId') as number)) return c.json({ error: 'Forbidden' }, 403);
    const overview = await getTeamSpendOverview(db, c.env as Env, id);
    return c.json(overview);
  });

  // PATCH /api/tenants/:id/spend-limits — set the team-wide DEFAULT per-seat cap.
  //   body { amountUsd: number | null } — null clears the default (seats uncapped
  //   unless individually set); a number >= 0 applies to every seat with no override.
  router.patch('/:id/spend-limits', requireRole(TenantRole.OWNER), async (c) => {
    const id = Number(c.req.param('id'));
    if (id !== (c.get('tenantId') as number)) return c.json({ error: 'Forbidden' }, 403);
    const body = await c.req.json<{ amountUsd?: number | null }>().catch(() => ({} as { amountUsd?: number | null }));
    const amount = body.amountUsd;
    let millicents: number | null;
    if (amount == null) {
      millicents = null;
    } else if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > MAX_SPEND_CAP_USD) {
      return c.json({ error: `amountUsd must be null or a number between 0 and ${MAX_SPEND_CAP_USD}` }, 400);
    } else {
      millicents = usdToMillicents(amount);
    }
    await db.update(tenants).set({ memberDefaultSpendCapMillicents: millicents }).where(eq(tenants.id, id));
    await invalidateTeamSpendCaches(c.env as Env, id);
    return c.json(await getTeamSpendOverview(db, c.env as Env, id));
  });

  // PATCH /api/tenants/:id/members/:userId/spend-limit — set ONE seat's cap.
  //   body { mode: 'inherit' | 'unlimited' | 'custom', amountUsd?: number }
  //     inherit   → null (use the team default)
  //     unlimited → -1   (exempt this seat from the default)
  //     custom    → amountUsd >= 0 (0 = no paid spend allowed)
  router.patch('/:id/members/:userId/spend-limit', requireRole(TenantRole.OWNER), async (c) => {
    const id = Number(c.req.param('id'));
    if (id !== (c.get('tenantId') as number)) return c.json({ error: 'Forbidden' }, 403);
    const targetUserId = c.req.param('userId');
    type SeatLimitBody = { mode?: 'inherit' | 'unlimited' | 'custom'; amountUsd?: number };
    const body = await c.req.json<SeatLimitBody>().catch(() => ({} as SeatLimitBody));
    let millicents: number | null;
    if (body.mode === 'inherit') {
      millicents = null;
    } else if (body.mode === 'unlimited') {
      millicents = -1;
    } else if (body.mode === 'custom') {
      const amount = body.amountUsd;
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > MAX_SPEND_CAP_USD) {
        return c.json({ error: `amountUsd must be a number between 0 and ${MAX_SPEND_CAP_USD}` }, 400);
      }
      millicents = usdToMillicents(amount);
    } else {
      return c.json({ error: "mode must be one of: 'inherit', 'unlimited', 'custom'" }, 400);
    }
    const updated = await db
      .update(tenantMembers)
      .set({ monthlySpendCapMillicents: millicents })
      .where(and(eq(tenantMembers.tenantId, id), eq(tenantMembers.userId, targetUserId), eq(tenantMembers.isActive, true)))
      .returning({ id: tenantMembers.id });
    if (updated.length === 0) return c.json({ error: 'Member not found in this workspace' }, 404);
    await invalidateTeamSpendCaches(c.env as Env, id, targetUserId);
    return c.json(await getTeamSpendOverview(db, c.env as Env, id));
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
        psychometric: users.psychometric,
        role: tenantMembers.role,
        joinedAt: tenantMembers.joinedAt,
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
        // A person's personality (parsed) — displayed on their card, self-hides when unset.
        psychometric: row.psychometric ? (JSON.parse(row.psychometric) as unknown) : null,
        role: row.role,
        joinedAt: row.joinedAt,
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
