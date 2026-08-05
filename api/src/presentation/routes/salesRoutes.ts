/** Server-backed CRM shared by a sales associate and platform superadmins. */
import { Hono, type Context } from 'hono';
import { webAuthMiddleware } from '../middleware/webAuthMiddleware';
import type { HonoEnv } from '../../env';
import { TenantService } from '../../application/tenant/TenantService';
import { commissionPercentToBps } from '../../application/sales/salesPolicy';
import { SalesWorkspaceService, type SalesWorkspaceDb } from '../../application/sales/SalesWorkspaceService';

const STAGES = new Set(['new', 'contacted', 'qualified', 'meeting', 'proposal', 'won', 'lost']);
const CAMPAIGN_STATUSES = new Set(['draft', 'scheduled', 'active', 'complete']);
const clean = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const positive = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Math.min(1_000_000, Math.max(1, Math.round(Number(value)))) : fallback;
const moneyCents = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Math.min(10_000_000_000, Math.max(0, Math.round(Number(value)))) : fallback;

export function createSalesRoutes(db: SalesWorkspaceDb): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();
  const sales = new SalesWorkspaceService(db);
  r.use('*', webAuthMiddleware);

  const userId = (c: Context<HonoEnv>) => c.get('userId') as string;
  const viewer = (c: Context<HonoEnv>) => sales.viewer(userId(c));
  const owner = (c: Context<HonoEnv>) => sales.owner(userId(c), c.req.query('associateId'));

  r.get('/associates', async (c) => {
    const current = await viewer(c);
    if (!current?.isSuperadmin) return c.json({ error: 'Superadmin required' }, 403);
    return c.json({ associates: await sales.associates() });
  });

  /** Complete referral attribution after an OAuth signup. Password registration
   * records the same row before verification; OAuth returns here already verified. */
  r.post('/claim-referral', async (c) => {
    const body = await c.req.json<{ referralCode?: string }>();
    const referralCode = clean(body.referralCode, 32).toUpperCase();
    if (!referralCode) return c.json({ error: 'Referral code is required' }, 400);
    const result = await sales.claimReferral(userId(c), referralCode, c.env);
    if (!result.authenticated) return c.json({ error: 'Authentication required' }, 401);
    return c.json({ claimed: result.claimed });
  });

  r.get('/workspace', async (c) => {
    const target = await owner(c);
    if (!target) return c.json({ error: 'Sales associate access required' }, 403);
    return c.json(await sales.workspace(target.id));
  });

  /** Resolve the one collaborative Canvas session that operates this pipeline. */
  r.get('/canvas', async (c) => {
    const target = await owner(c);
    if (!target) return c.json({ error: 'Forbidden' }, 403);
    return c.json(await sales.canvas(target.id, userId(c)));
  });

  r.put('/settings', async (c) => {
    const target = await owner(c);
    if (!target) return c.json({ error: 'Forbidden' }, 403);
    const body = await c.req.json<Record<string, unknown>>();
    const current = await sales.settings(target.id);
    if (!current) return c.json({ error: 'Settings unavailable' }, 500);
    const row = await sales.updateSettings(target.id, {
      revenueGoalCents: body.revenueGoalCents == null ? current.revenueGoalCents : moneyCents(body.revenueGoalCents, current.revenueGoalCents),
      notifyOnSignup: body.notifyOnSignup == null ? current.notifyOnSignup : body.notifyOnSignup === true,
      notifyOnConversion: body.notifyOnConversion == null ? current.notifyOnConversion : body.notifyOnConversion === true,
    });
    return c.json(row);
  });

  r.get('/commission-rules', async (c) => {
    const current = await viewer(c);
    if (!current?.isSuperadmin) return c.json({ error: 'Superadmin required' }, 403);
    return c.json({ rules: await sales.commissionRules(), pricing: TenantService.PRICING });
  });

  r.put('/commission-rules', async (c) => {
    const current = await viewer(c);
    if (!current?.isSuperadmin) return c.json({ error: 'Superadmin required' }, 403);
    const body = await c.req.json<{ rules?: Array<{ plan?: string; billingCycle?: string; referralPercent?: number; salesPercent?: number }> }>();
    const allowedPlans = new Set(['pro', 'teams']); const allowedCycles = new Set(['monthly', 'yearly']);
    if (!Array.isArray(body.rules) || body.rules.length < 1 || body.rules.length > 4) return c.json({ error: 'One to four commission rules are required' }, 400);
    const prepared = body.rules.map((rule) => ({ ...rule, referralBps: commissionPercentToBps(rule.referralPercent), salesBps: commissionPercentToBps(rule.salesPercent) }));
    if (prepared.some((rule) => !allowedPlans.has(rule.plan ?? '') || !allowedCycles.has(rule.billingCycle ?? '') || rule.referralBps == null || rule.salesBps == null)) return c.json({ error: 'Percentages must be finite values from 0 to 100' }, 400);
    if (new Set(prepared.map((rule) => `${rule.plan}:${rule.billingCycle}`)).size !== prepared.length) return c.json({ error: 'Duplicate commission rule' }, 400);
    const rules = await sales.updateCommissionRules(prepared.map((rule) => ({ plan: rule.plan!, billingCycle: rule.billingCycle!, referralBps: rule.referralBps!, salesBps: rule.salesBps! })), current.id);
    return c.json({ rules, pricing: TenantService.PRICING });
  });

  /** Register a newly-created sales canvas and automatically add superadmins as editors. */
  r.put('/canvas', async (c) => {
    const target = await owner(c);
    if (!target) return c.json({ error: 'Forbidden' }, 403);
    const body = await c.req.json<{ sessionId?: string }>();
    if (!body.sessionId) return c.json({ error: 'sessionId is required' }, 400);
    const sessionId = await sales.setCanvas(target.id, userId(c), body.sessionId);
    if (!sessionId) return c.json({ error: 'Canvas session not found' }, 404);
    return c.json({ sessionId });
  });

  r.post('/contacts', async (c) => {
    const target = await owner(c); if (!target) return c.json({ error: 'Forbidden' }, 403);
    const body = await c.req.json<Record<string, unknown>>();
    const stage = clean(body.stage, 24);
    const row = await sales.createContact(target.id, { name: clean(body.name, 255), email: clean(body.email, 255), company: clean(body.company, 255), market: clean(body.market, 255), stage: STAGES.has(stage) ? stage : 'new' });
    return c.json(row, 201);
  });

  r.patch('/contacts/:id', async (c) => {
    const target = await owner(c); if (!target) return c.json({ error: 'Forbidden' }, 403);
    const body = await c.req.json<Record<string, unknown>>();
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of ['name', 'email', 'company', 'market'] as const) if (body[key] !== undefined) patch[key] = clean(body[key], 255);
    if (body.stage !== undefined && STAGES.has(String(body.stage))) { patch.stage = body.stage; patch.lastTouchAt = new Date(); }
    const row = await sales.updateContact(target.id, c.req.param('id'), patch);
    if (!row) return c.json({ error: 'Contact not found' }, 404);
    return c.json(row);
  });

  r.post('/campaigns', async (c) => {
    const target = await owner(c); if (!target) return c.json({ error: 'Forbidden' }, 403);
    const body = await c.req.json<Record<string, unknown>>();
    const name = clean(body.name, 255); if (!name) return c.json({ error: 'Campaign name is required' }, 400);
    const row = await sales.createCampaign(target.id, { name, market: clean(body.market, 255), subject: clean(body.subject, 500) });
    return c.json(row, 201);
  });

  r.patch('/campaigns/:id', async (c) => {
    const target = await owner(c); if (!target) return c.json({ error: 'Forbidden' }, 403);
    const body = await c.req.json<Record<string, unknown>>();
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.status !== undefined && CAMPAIGN_STATUSES.has(String(body.status))) patch.status = body.status;
    for (const key of ['sent', 'replies'] as const) if (body[key] !== undefined) patch[key] = Math.min(2_147_483_647, Math.max(0, Math.round(Number(body[key]) || 0)));
    const row = await sales.updateCampaign(target.id, c.req.param('id'), patch);
    if (!row) return c.json({ error: 'Campaign not found' }, 404);
    return c.json(row);
  });

  r.put('/goals', async (c) => {
    const target = await owner(c); if (!target) return c.json({ error: 'Forbidden' }, 403);
    const body = await c.req.json<Record<string, unknown>>();
    return c.json(await sales.setGoals(target.id, { outreachTarget: positive(body.outreachTarget, 50), contactsTarget: positive(body.contactsTarget, 20), meetingsTarget: positive(body.meetingsTarget, 3) }));
  });

  r.post('/notes', async (c) => {
    const current = await viewer(c); if (!current?.isSuperadmin) return c.json({ error: 'Superadmin required' }, 403);
    const target = await owner(c); if (!target) return c.json({ error: 'Sales associate not found' }, 404);
    const body = await c.req.json<{ body?: string }>(); const note = clean(body.body, 5000);
    if (!note) return c.json({ error: 'Note is required' }, 400);
    return c.json(await sales.addNote(target.id, current.id, note), 201);
  });

  return r;
}
