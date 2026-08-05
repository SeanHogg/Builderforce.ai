/** Server-backed CRM shared by a sales associate and platform superadmins. */
import { Hono, type Context } from 'hono';
import { and, desc, eq, isNotNull, or } from 'drizzle-orm';
import { webAuthMiddleware } from '../middleware/webAuthMiddleware';
import { creationSessionMembers, creationSessions, salesAssociateSettings, salesCampaigns, salesCanvasSessions, salesCoachingNotes, salesCommissionRules, salesContacts, salesReferrals, salesWeeklyGoals, users } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { HonoEnv } from '../../env';
import { TenantService } from '../../application/tenant/TenantService';
import { notify } from '../../application/notifications/notify';
import { commissionPercentToBps } from '../../application/sales/salesPolicy';

const STAGES = new Set(['new', 'contacted', 'qualified', 'meeting', 'proposal', 'won', 'lost']);
const CAMPAIGN_STATUSES = new Set(['draft', 'scheduled', 'active', 'complete']);
const clean = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const positive = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Math.min(1_000_000, Math.max(1, Math.round(Number(value)))) : fallback;
const moneyCents = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Math.min(10_000_000_000, Math.max(0, Math.round(Number(value)))) : fallback;

export function createSalesRoutes(db: Db): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();
  r.use('*', webAuthMiddleware);

  async function viewer(c: Context<HonoEnv>) {
    const userId = c.get('userId') as string;
    const [row] = await db.select({ id: users.id, email: users.email, displayName: users.displayName, emailVerifiedAt: users.emailVerifiedAt, createdAt: users.createdAt, accountType: users.accountType, isSuperadmin: users.isSuperadmin }).from(users).where(eq(users.id, userId)).limit(1);
    return row;
  }

  async function owner(c: Context<HonoEnv>): Promise<{ id: string; admin: boolean } | null> {
    const current = await viewer(c);
    if (!current) return null;
    const requested = c.req.query('associateId') || current.id;
    if (requested === current.id) {
      if (current.accountType !== 'sales') return null;
      return { id: requested, admin: current.isSuperadmin };
    }
    if (!current.isSuperadmin) return null;
    const [associate] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, requested), eq(users.accountType, 'sales'))).limit(1);
    if (!associate) return null;
    return { id: requested, admin: current.isSuperadmin };
  }

  async function settings(ownerUserId: string) {
    const code = `BF${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
    const salesCode = `BS${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
    const [row] = await db.insert(salesAssociateSettings).values({ ownerUserId, referralCode: code, salesCode })
      .onConflictDoNothing({ target: salesAssociateSettings.ownerUserId }).returning();
    if (row) return row;
    const [existing] = await db.select().from(salesAssociateSettings).where(eq(salesAssociateSettings.ownerUserId, ownerUserId)).limit(1);
    return existing;
  }

  r.get('/associates', async (c) => {
    const current = await viewer(c);
    if (!current?.isSuperadmin) return c.json({ error: 'Superadmin required' }, 403);
    const rows = await db.select({ id: users.id, email: users.email, name: users.displayName, createdAt: users.createdAt })
      .from(users).where(eq(users.accountType, 'sales')).orderBy(desc(users.createdAt));
    return c.json({ associates: rows });
  });

  /** Complete referral attribution after an OAuth signup. Password registration
   * records the same row before verification; OAuth returns here already verified. */
  r.post('/claim-referral', async (c) => {
    const current = await viewer(c); if (!current) return c.json({ error: 'Authentication required' }, 401);
    const body = await c.req.json<{ referralCode?: string }>();
    const referralCode = clean(body.referralCode, 32).toUpperCase();
    if (!referralCode) return c.json({ error: 'Referral code is required' }, 400);
    if (!current.emailVerifiedAt || Date.now() - current.createdAt.getTime() > 30 * 60_000) return c.json({ claimed: false });
    const [associate] = await db.select({ ownerUserId: salesAssociateSettings.ownerUserId, notifyOnSignup: salesAssociateSettings.notifyOnSignup, salesCode: salesAssociateSettings.salesCode })
      .from(salesAssociateSettings).where(or(eq(salesAssociateSettings.referralCode, referralCode), eq(salesAssociateSettings.salesCode, referralCode))).limit(1);
    if (!associate || associate.ownerUserId === current.id) return c.json({ claimed: false });
    const [created] = await db.insert(salesReferrals).values({ associateUserId: associate.ownerUserId, referredUserId: current.id, attributionType: referralCode === associate.salesCode ? 'sales' : 'referral', signupNotifiedAt: new Date() }).onConflictDoNothing({ target: salesReferrals.referredUserId }).returning();
    if (created && associate.notifyOnSignup) void notify(db, c.env, { userId: associate.ownerUserId, kind: 'sales.referral_signup', title: 'A referred user signed up', body: `${current.displayName || current.email} verified a Builderforce account through OAuth.`, ref: '/sales' });
    return c.json({ claimed: Boolean(created) });
  });

  r.get('/workspace', async (c) => {
    const target = await owner(c);
    if (!target) return c.json({ error: 'Sales associate access required' }, 403);
    const [contacts, campaigns, goalRows, notes, referrals, associateSettings, commissionRules] = await Promise.all([
      db.select().from(salesContacts).where(eq(salesContacts.ownerUserId, target.id)).orderBy(desc(salesContacts.updatedAt)),
      db.select().from(salesCampaigns).where(eq(salesCampaigns.ownerUserId, target.id)).orderBy(desc(salesCampaigns.updatedAt)),
      db.select().from(salesWeeklyGoals).where(eq(salesWeeklyGoals.ownerUserId, target.id)).limit(1),
      db.select({ id: salesCoachingNotes.id, body: salesCoachingNotes.body, createdAt: salesCoachingNotes.createdAt, authorUserId: salesCoachingNotes.authorUserId, authorName: users.displayName })
        .from(salesCoachingNotes).leftJoin(users, eq(users.id, salesCoachingNotes.authorUserId))
        .where(eq(salesCoachingNotes.associateUserId, target.id)).orderBy(desc(salesCoachingNotes.createdAt)),
      db.select().from(salesReferrals).where(and(eq(salesReferrals.associateUserId, target.id), isNotNull(salesReferrals.signupNotifiedAt))).orderBy(desc(salesReferrals.signedUpAt)),
      settings(target.id),
      db.select().from(salesCommissionRules).orderBy(salesCommissionRules.plan, salesCommissionRules.billingCycle),
    ]);
    const earnedCents = referrals.reduce((sum, referral) => sum + (referral.commissionCents ?? 0), 0);
    const convertedRevenueCents = referrals.reduce((sum, referral) => sum + (referral.revenueCents ?? 0), 0);
    return c.json({ contacts, campaigns, goals: goalRows[0] ?? { ownerUserId: target.id, outreachTarget: 50, contactsTarget: 20, meetingsTarget: 3 }, notes, referrals, settings: associateSettings, commissionRules, performance: { signups: referrals.length, conversions: referrals.filter((row) => row.convertedAt).length, convertedRevenueCents, earnedCents } });
  });

  /** Resolve the one collaborative Canvas session that operates this pipeline. */
  r.get('/canvas', async (c) => {
    const target = await owner(c); if (!target) return c.json({ error: 'Forbidden' }, 403);
    const [row] = await db.select().from(salesCanvasSessions).where(eq(salesCanvasSessions.ownerUserId, target.id)).limit(1);
    const associateSettings = await settings(target.id);
    if (!row) return c.json({ sessionId: null, referralCode: associateSettings?.referralCode ?? null, salesCode: associateSettings?.salesCode ?? null });
    const current = await viewer(c);
    if (current?.isSuperadmin) await db.insert(creationSessionMembers).values({ sessionId: row.sessionId, userId: current.id, role: 'editor', invitedBy: current.id }).onConflictDoUpdate({ target: [creationSessionMembers.sessionId, creationSessionMembers.userId], set: { role: 'editor' } });
    return c.json({ sessionId: row.sessionId, referralCode: associateSettings?.referralCode ?? null, salesCode: associateSettings?.salesCode ?? null });
  });

  r.put('/settings', async (c) => {
    const target = await owner(c); if (!target) return c.json({ error: 'Forbidden' }, 403);
    const body = await c.req.json<Record<string, unknown>>();
    const current = await settings(target.id); if (!current) return c.json({ error: 'Settings unavailable' }, 500);
    const [row] = await db.update(salesAssociateSettings).set({
      revenueGoalCents: body.revenueGoalCents == null ? current.revenueGoalCents : moneyCents(body.revenueGoalCents, current.revenueGoalCents),
      notifyOnSignup: body.notifyOnSignup == null ? current.notifyOnSignup : body.notifyOnSignup === true,
      notifyOnConversion: body.notifyOnConversion == null ? current.notifyOnConversion : body.notifyOnConversion === true,
      updatedAt: new Date(),
    }).where(eq(salesAssociateSettings.ownerUserId, target.id)).returning();
    return c.json(row);
  });

  r.get('/commission-rules', async (c) => {
    const current = await viewer(c); if (!current?.isSuperadmin) return c.json({ error: 'Superadmin required' }, 403);
    return c.json({ rules: await db.select().from(salesCommissionRules).orderBy(salesCommissionRules.plan, salesCommissionRules.billingCycle), pricing: TenantService.PRICING });
  });

  r.put('/commission-rules', async (c) => {
    const current = await viewer(c); if (!current?.isSuperadmin) return c.json({ error: 'Superadmin required' }, 403);
    const body = await c.req.json<{ rules?: Array<{ plan?: string; billingCycle?: string; referralPercent?: number; salesPercent?: number }> }>();
    const allowedPlans = new Set(['pro', 'teams']); const allowedCycles = new Set(['monthly', 'yearly']);
    if (!Array.isArray(body.rules) || body.rules.length < 1 || body.rules.length > 4) return c.json({ error: 'One to four commission rules are required' }, 400);
    const prepared = body.rules.map((rule) => ({ ...rule, referralBps: commissionPercentToBps(rule.referralPercent), salesBps: commissionPercentToBps(rule.salesPercent) }));
    if (prepared.some((rule) => !allowedPlans.has(rule.plan ?? '') || !allowedCycles.has(rule.billingCycle ?? '') || rule.referralBps == null || rule.salesBps == null)) return c.json({ error: 'Percentages must be finite values from 0 to 100' }, 400);
    if (new Set(prepared.map((rule) => `${rule.plan}:${rule.billingCycle}`)).size !== prepared.length) return c.json({ error: 'Duplicate commission rule' }, 400);
    const statements = prepared.map((rule) => {
      const referralBps = rule.referralBps!;
      const salesBps = rule.salesBps!;
      const ruleKey = `${rule.plan}:${rule.billingCycle}`;
      return db.insert(salesCommissionRules).values({ ruleKey, plan: rule.plan!, billingCycle: rule.billingCycle!, referralBps, salesBps, updatedBy: current.id })
        .onConflictDoUpdate({ target: salesCommissionRules.ruleKey, set: { referralBps, salesBps, updatedBy: current.id, updatedAt: new Date() } });
    });
    await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
    return c.json({ rules: await db.select().from(salesCommissionRules).orderBy(salesCommissionRules.plan, salesCommissionRules.billingCycle), pricing: TenantService.PRICING });
  });

  /** Register a newly-created sales canvas and automatically add superadmins as editors. */
  r.put('/canvas', async (c) => {
    const target = await owner(c); if (!target) return c.json({ error: 'Forbidden' }, 403);
    const current = await viewer(c);
    const body = await c.req.json<{ sessionId?: string }>();
    if (!body.sessionId) return c.json({ error: 'sessionId is required' }, 400);
    const [session] = await db.select().from(creationSessions).where(eq(creationSessions.id, body.sessionId)).limit(1);
    if (!session || session.createdBy !== target.id) return c.json({ error: 'Canvas session not found' }, 404);
    await db.insert(salesCanvasSessions).values({ ownerUserId: target.id, sessionId: session.id, tenantId: session.tenantId }).onConflictDoUpdate({ target: salesCanvasSessions.ownerUserId, set: { sessionId: session.id, tenantId: session.tenantId } });
    const admins = await db.select({ id: users.id }).from(users).where(eq(users.isSuperadmin, true));
    if (admins.length) await db.insert(creationSessionMembers).values(admins.map((admin) => ({ sessionId: session.id, userId: admin.id, role: 'editor', invitedBy: current?.id ?? null }))).onConflictDoUpdate({ target: [creationSessionMembers.sessionId, creationSessionMembers.userId], set: { role: 'editor' } });
    return c.json({ sessionId: session.id });
  });

  r.post('/contacts', async (c) => {
    const target = await owner(c); if (!target) return c.json({ error: 'Forbidden' }, 403);
    const body = await c.req.json<Record<string, unknown>>();
    const stage = clean(body.stage, 24);
    const [row] = await db.insert(salesContacts).values({ ownerUserId: target.id, name: clean(body.name, 255), email: clean(body.email, 255), company: clean(body.company, 255), market: clean(body.market, 255), stage: STAGES.has(stage) ? stage : 'new' }).returning();
    return c.json(row, 201);
  });

  r.patch('/contacts/:id', async (c) => {
    const target = await owner(c); if (!target) return c.json({ error: 'Forbidden' }, 403);
    const body = await c.req.json<Record<string, unknown>>();
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of ['name', 'email', 'company', 'market'] as const) if (body[key] !== undefined) patch[key] = clean(body[key], 255);
    if (body.stage !== undefined && STAGES.has(String(body.stage))) { patch.stage = body.stage; patch.lastTouchAt = new Date(); }
    const [row] = await db.update(salesContacts).set(patch).where(and(eq(salesContacts.id, c.req.param('id')), eq(salesContacts.ownerUserId, target.id))).returning();
    if (!row) return c.json({ error: 'Contact not found' }, 404);
    return c.json(row);
  });

  r.post('/campaigns', async (c) => {
    const target = await owner(c); if (!target) return c.json({ error: 'Forbidden' }, 403);
    const body = await c.req.json<Record<string, unknown>>();
    const name = clean(body.name, 255); if (!name) return c.json({ error: 'Campaign name is required' }, 400);
    const [row] = await db.insert(salesCampaigns).values({ ownerUserId: target.id, name, market: clean(body.market, 255), subject: clean(body.subject, 500) }).returning();
    return c.json(row, 201);
  });

  r.patch('/campaigns/:id', async (c) => {
    const target = await owner(c); if (!target) return c.json({ error: 'Forbidden' }, 403);
    const body = await c.req.json<Record<string, unknown>>();
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.status !== undefined && CAMPAIGN_STATUSES.has(String(body.status))) patch.status = body.status;
    for (const key of ['sent', 'replies'] as const) if (body[key] !== undefined) patch[key] = Math.min(2_147_483_647, Math.max(0, Math.round(Number(body[key]) || 0)));
    const [row] = await db.update(salesCampaigns).set(patch).where(and(eq(salesCampaigns.id, c.req.param('id')), eq(salesCampaigns.ownerUserId, target.id))).returning();
    if (!row) return c.json({ error: 'Campaign not found' }, 404);
    return c.json(row);
  });

  r.put('/goals', async (c) => {
    const target = await owner(c); if (!target) return c.json({ error: 'Forbidden' }, 403);
    const body = await c.req.json<Record<string, unknown>>();
    const values = { ownerUserId: target.id, outreachTarget: positive(body.outreachTarget, 50), contactsTarget: positive(body.contactsTarget, 20), meetingsTarget: positive(body.meetingsTarget, 3), updatedAt: new Date() };
    const [row] = await db.insert(salesWeeklyGoals).values(values).onConflictDoUpdate({ target: salesWeeklyGoals.ownerUserId, set: values }).returning();
    return c.json(row);
  });

  r.post('/notes', async (c) => {
    const current = await viewer(c); if (!current?.isSuperadmin) return c.json({ error: 'Superadmin required' }, 403);
    const target = await owner(c); if (!target) return c.json({ error: 'Sales associate not found' }, 404);
    const body = await c.req.json<{ body?: string }>(); const note = clean(body.body, 5000);
    if (!note) return c.json({ error: 'Note is required' }, 400);
    const [row] = await db.insert(salesCoachingNotes).values({ associateUserId: target.id, authorUserId: current.id, body: note }).returning();
    return c.json(row, 201);
  });

  return r;
}
