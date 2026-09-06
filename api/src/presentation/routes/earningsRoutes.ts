/**
 * Earnings, the platform fee, and where the money goes — `/api/earnings` and
 * `/api/withdrawal-methods`.
 *
 * TWO ROUTERS in one file, because they answer the same person's two halves of one
 * question ("what have I earned" / "how do I get it") and share exactly one piece of
 * machinery: resolving WHICH WORKSPACE a tenantless caller's money and credentials live
 * in. Splitting them would duplicate that resolution, which is the one thing here that
 * must never be done twice — a payout credential sealed under one tenant and read back
 * under another is a credential nobody can open.
 *
 * ── THE TWO TOKENS ───────────────────────────────────────────────────────────────
 * Every endpoint below accepts the WEB JWT, because the people who need it are for-hire
 * accounts that belong to no workspace. That is precisely why `/api/payouts` (tenant
 * JWT) was unreachable for them, and why this exists beside it rather than replacing it:
 * a workspace seller with a tenant token still uses the payout console; a freelancer
 * uses this door, and both end up in `PayoutAccountService` and the same `connections`
 * rows.
 *
 * A tenant-scoped view is still reachable — `?scope=workspace` on the report — for a
 * seller who wants "what this workspace paid me" rather than "what everybody paid me".
 *
 * This file is a presentation adapter and holds no data access.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { webAuthMiddleware } from '../middleware/webAuthMiddleware';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';
import {
  defaultEarningsRange,
  isEarningsPeriod,
  parseRangeDate,
  readEarningsReport,
  type EarningsPeriod,
} from '../../application/finance/earningsLedger';
import { feeSchedule, quotePlatformFee } from '../../application/finance/platformFees';
import {
  connectWithdrawalMethod,
  listWithdrawalMethods,
  removeWithdrawalMethod,
  setDefaultWithdrawalMethod,
  withdrawalReadiness,
  withdrawalTenantFor,
  type WithdrawalRefusal,
} from '../../application/finance/withdrawalMethods';
import { describePayoutProviders } from '../../application/payouts/payoutProviders';
import { refusalResponse } from '../middleware/errorResponse';
import { parseBody, z, zNonEmptyString } from './requestBody';
import { boundedIntParam, limitParam } from './queryParams';

/**
 * A withdrawal refusal as an HTTP answer. `unknown_provider`, `wrong_connect_flow` and
 * `missing_field` are the caller's mistake and fall through to `refusalResponse`'s 400.
 * `not_saved` is NOT here: the credential passed validation and the service still wrote
 * no row, which is an invariant failure the handler throws rather than maps.
 */
const WITHDRAWAL_REFUSAL_STATUS = {
  not_found: 404,
} as const satisfies Partial<Record<WithdrawalRefusal, number>>;

/** A typed-credential destination. The field VALUES are validated by the application
 *  layer against the provider's own declarations, so `fields` is free-form here. */
const ConnectWithdrawalMethodBody = z.object({
  provider: zNonEmptyString,
  fields: z.record(z.string(), z.unknown()).optional(),
  makeDefault: z.boolean().optional(),
});

/**
 * The workspace this caller's money and sealed credentials live in.
 *
 * Resolved from the AUTHENTICATED subject and provisioned on first use — never taken
 * from the request. A tenant off the query string would be an IDOR into somebody else's
 * connections, and a credential sealed under a tenant the caller merely named would be
 * unreadable by the person who wrote it.
 */
async function ownTenant(db: Db, c: Context<HonoEnv>): Promise<number | null> {
  return withdrawalTenantFor(db, c.env as Env, c.get('userId') as string);
}

export function createEarningsRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', webAuthMiddleware);

  /**
   * GET / — the statement.
   *
   * `scope=workspace` narrows it to the caller's own workspace; the default spans every
   * workspace that has ever paid them, which is the only correct answer for a for-hire
   * account (see `tenantScope.ts`'s `subject_own_rows`).
   */
  router.get('/', async (c) => {
    const userId = c.get('userId') as string;
    const range = defaultEarningsRange();
    const period: EarningsPeriod = isEarningsPeriod(c.req.query('period')) ? c.req.query('period') as EarningsPeriod : 'month';
    const scopeToWorkspace = c.req.query('scope') === 'workspace';
    const tenantId = scopeToWorkspace ? await ownTenant(db, c) : null;
    // A caller who ASKED for their workspace and has none gets an honest empty scope
    // rather than being silently widened to every workspace — a scope that quietly means
    // something other than what was requested is the worst kind of correct.
    if (scopeToWorkspace && tenantId === null) return c.json({ error: 'no_workspace' }, 404);

    const report = await readEarningsReport(db, c.env as Env, {
      tenantId,
      userId,
      from: parseRangeDate(c.req.query('from'), range.from),
      to: parseRangeDate(c.req.query('to'), range.to),
      period,
      limit: limitParam(c.req.query('limit'), 100, 500),
    });
    return c.json({ report });
  });

  /**
   * GET /fee — the platform fee, stated: the published schedule, plus what THIS person
   * pays on their next sale and why.
   *
   * Both halves, because neither is enough on its own: the schedule without the personal
   * quote cannot say "you are paying nothing right now", and the quote without the
   * schedule cannot say what the fee will become.
   */
  router.get('/fee', async (c) => {
    const userId = c.get('userId') as string;
    const tenantId = await ownTenant(db, c);
    const grossCents = boundedIntParam(c.req.query('grossCents'), { def: 0, min: 0 });
    const quote = await quotePlatformFee(db, c.env as Env, { tenantId, ref: userId }, grossCents);
    return c.json({ schedule: feeSchedule(c.env as Env), quote });
  });

  return router;
}

export function createWithdrawalMethodRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', webAuthMiddleware);

  /** GET / — what is recorded, whether it is verified, and whether I can be paid. */
  router.get('/', async (c) => {
    const tenantId = await ownTenant(db, c);
    if (tenantId === null) return c.json({ error: 'no_workspace' }, 404);
    const ctx = { tenantId, userId: c.get('userId') as string };
    const [methods, readiness] = await Promise.all([
      listWithdrawalMethods(db, c.env as Env, ctx),
      withdrawalReadiness(db, c.env as Env, ctx),
    ]);
    return c.json({
      methods,
      readiness,
      // The field DECLARATIONS the form needs, from the provider adapters — never a
      // stored secret, which is write-only by construction.
      providers: describePayoutProviders(c.env as unknown as Record<string, unknown>),
    });
  });

  /** POST / — record a destination whose credential I type (bank, Wise). OAuth
   *  providers connect through `/api/payouts/connect/:provider`, which owns the signed
   *  state; a second entrance to a consent redirect is a second place to get it wrong. */
  router.post('/', async (c) => {
    const tenantId = await ownTenant(db, c);
    if (tenantId === null) return c.json({ error: 'no_workspace' }, 404);
    const body = await parseBody(c, ConnectWithdrawalMethodBody);
    const result = await connectWithdrawalMethod(db, c.env as Env, { tenantId, userId: c.get('userId') as string }, {
      provider: body.provider,
      fields: body.fields ?? {},
      makeDefault: body.makeDefault === true,
    });
    if (result.ok) return c.json({ method: result.method }, 201);
    if (result.reason === 'not_saved') throw new Error('withdrawal method was not saved');
    return refusalResponse(c, result.reason, WITHDRAWAL_REFUSAL_STATUS, { field: result.field ?? null });
  });

  /** PUT /:id/default — exactly one destination is the default. */
  router.put('/:id/default', async (c) => {
    const tenantId = await ownTenant(db, c);
    if (tenantId === null) return c.json({ error: 'no_workspace' }, 404);
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'not_found' }, 404);
    const result = await setDefaultWithdrawalMethod(db, c.env as Env, { tenantId, userId: c.get('userId') as string }, id);
    return result.ok
      ? c.json({ method: result.method })
      : refusalResponse(c, result.reason, WITHDRAWAL_REFUSAL_STATUS);
  });

  /** DELETE /:id — remove a destination. Money already sent through it stays in the
   *  ledger; deleting where money went is not a thing this offers. */
  router.delete('/:id', async (c) => {
    const tenantId = await ownTenant(db, c);
    if (tenantId === null) return c.json({ error: 'no_workspace' }, 404);
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'not_found' }, 404);
    const removed = await removeWithdrawalMethod(db, c.env as Env, { tenantId, userId: c.get('userId') as string }, id);
    return removed ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
  });

  return router;
}
