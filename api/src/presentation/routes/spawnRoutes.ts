/**
 * /api/spawn — Spawn, the Roblox game builder (spawn.builderforce.ai).
 *
 * The website reads the price list, the installers and the account and runs the two purchases;
 * the Spawn desktop app reads the account and sends builds. Every refusal is a
 * `SpawnError` carrying its own status and a `code` both clients translate.
 *
 * Purchases are Manager+ (the player's own workspace makes them its owner), the
 * same commitment level as any other purchase against a workspace. Building is
 * any member who has cleared the age line, on a workspace with a membership or a live
 * free trial. The `/parent/*` routes are the grown-up's, authorised by the signed
 * link the trial emails carry instead of a session.
 */
import { Hono } from 'hono';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { TenantRole } from '../../domain/shared/types';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { parseBody, z, zNonEmptyString } from './requestBody';
import { spawnAccount, spawnPriceList } from '../../application/spawn/spawnAccount';
import { recordBirthMonth } from '../../application/spawn/spawnAge';
import { completeSpawnMembership, startSpawnMembership } from '../../application/spawn/spawnMembership';
import { completeSpawnTopUp, startSpawnTopUp } from '../../application/spawn/spawnTopUp';
import { runSpawnBuild } from '../../application/spawn/spawnBuild';
import { spawnInstallers } from '../../application/spawn/spawnDownloads';
import { startSpawnTrial } from '../../application/spawn/spawnTrial';
import {
  completeParentMembership, completeParentTopUp, spawnParentView, startParentMembership, startParentTopUp,
} from '../../application/spawn/spawnParent';

const AgeBody = z.object({ year: z.number().int(), month: z.number().int() });
const PackBody = z.object({ packId: zNonEmptyString });
const SessionBody = z.object({ sessionId: zNonEmptyString });
const TrialBody = z.object({ parentEmail: zNonEmptyString });
/** The parent routes' only credential is the signed link from the trial emails. */
const ParentBody = z.object({ t: zNonEmptyString });
const ParentSessionBody = ParentBody.extend({ sessionId: zNonEmptyString });
const ParentPackBody = ParentBody.extend({ packId: zNonEmptyString });
/** The plugin's place snapshot is shape-checked here and BOUNDED by `readBuildRequest`. */
const BuildBody = z.object({
  prompt: z.string(),
  place: z.object({
    tree: z.string().optional(),
    scripts: z.array(z.object({ path: z.string(), kind: z.string(), source: z.string() })).optional(),
    errors: z.array(z.string()).optional(),
  }).optional(),
  history: z.array(z.object({ role: z.string(), text: z.string() })).optional(),
});

export function createSpawnRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // Public: the landing page shows the prices before anyone signs in. Static data.
  router.get('/prices', (c) => c.json(spawnPriceList()));
  // Public: every download button links straight to the installer. Cached (spawnDownloads).
  router.get('/downloads', async (c) => c.json(await spawnInstallers(c.env as Env)));

  const appUrl = (c: { env: unknown; req: { url: string } }) => (c.env as Env).APP_URL ?? new URL(c.req.url).origin;

  // Public, for the grown-up: the signed link from the trial emails is the whole
  // credential, and it can only open this workspace's checkouts (spawnParent.ts).
  router.get('/parent', async (c) => c.json(await spawnParentView(db, c.env as Env, c.req.query('t') ?? '')));
  router.post('/parent/membership', async (c) => {
    const body = await parseBody(c, ParentBody);
    return c.json(await startParentMembership(db, c.env as Env, { token: body.t, appUrl: appUrl(c) }));
  });
  router.post('/parent/membership/complete', async (c) => {
    const body = await parseBody(c, ParentSessionBody);
    const membership = await completeParentMembership(db, c.env as Env, { token: body.t, sessionId: body.sessionId });
    return c.json({ membership: membership.status });
  });
  router.post('/parent/tokens', async (c) => {
    const body = await parseBody(c, ParentPackBody);
    return c.json(await startParentTopUp(db, c.env as Env, { token: body.t, packId: body.packId, appUrl: appUrl(c) }));
  });
  router.post('/parent/tokens/complete', async (c) => {
    const body = await parseBody(c, ParentSessionBody);
    return c.json(await completeParentTopUp(db, c.env as Env, { token: body.t, sessionId: body.sessionId }));
  });

  router.use('*', authMiddleware);

  const who = (c: { get: (key: 'tenantId' | 'userId') => unknown }) => ({
    tenantId: c.get('tenantId') as number,
    userId: c.get('userId') as string,
  });
  router.get('/account', async (c) => c.json(await spawnAccount(db, c.env as Env, who(c))));

  router.post('/age', async (c) => {
    const body = await parseBody(c, AgeBody);
    const age = await recordBirthMonth(db, c.env as Env, { userId: who(c).userId, year: body.year, month: body.month });
    return c.json({ age });
  });

  // The free week: any member past the age line, once per person and per workspace.
  router.post('/trial', async (c) => {
    const body = await parseBody(c, TrialBody);
    return c.json({ trial: await startSpawnTrial(db, c.env as Env, { ...who(c), parentEmail: body.parentEmail }) });
  });

  router.post('/membership', requireRole(TenantRole.MANAGER), async (c) =>
    c.json(await startSpawnMembership(db, c.env as Env, { ...who(c), appUrl: appUrl(c) })));

  router.post('/membership/complete', requireRole(TenantRole.MANAGER), async (c) => {
    const body = await parseBody(c, SessionBody);
    const membership = await completeSpawnMembership(db, c.env as Env, { tenantId: who(c).tenantId, checkoutSessionId: body.sessionId });
    return c.json({ membership: membership.status });
  });

  router.post('/tokens', requireRole(TenantRole.MANAGER), async (c) => {
    const body = await parseBody(c, PackBody);
    return c.json(await startSpawnTopUp(db, c.env as Env, { ...who(c), packId: body.packId, appUrl: appUrl(c) }));
  });

  router.post('/tokens/complete', requireRole(TenantRole.MANAGER), async (c) => {
    const body = await parseBody(c, SessionBody);
    return c.json(await completeSpawnTopUp(db, c.env as Env, { tenantId: who(c).tenantId, checkoutSessionId: body.sessionId }));
  });

  // The builder. The body is the plugin's place snapshot; `readBuildRequest` bounds it.
  router.post('/build', async (c) => {
    const body = await parseBody(c, BuildBody);
    return c.json(await runSpawnBuild(db, c.env as Env, { ...who(c), body }));
  });

  return router;
}
