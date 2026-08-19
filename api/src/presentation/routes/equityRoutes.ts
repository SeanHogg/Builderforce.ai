/**
 * Ownership — `/api/equity`.
 *
 * The cap-table PROJECTION, the append-only ledger behind it, vesting computed
 * at a date, and the round modeller. Every rule lives in
 * `application/finance/equity.ts`, including the one that matters most: nothing
 * here stores a total, so no response can disagree with the rows it is made of.
 *
 * NOTE ON MODEL VERSUS APPLY. `POST /rounds/model` writes NOTHING and
 * `POST /rounds/apply` changes who owns the company. Two routes and not one flag,
 * for the same reason the payable's approve is its own act: a caller that can
 * accidentally pass `apply: true` is a caller that can accidentally issue shares.
 *
 * NOTE ON THE RECORDER. `recordedBy` comes from the SESSION and is never read
 * from the body. A ledger row signed with a name its author supplied is worse
 * than an unsigned one, because it reads as attribution.
 */

import { Hono, type Context } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import {
  EquityError,
  applyRoundConversions,
  capTable,
  cliffsDueWithin,
  equityLedger,
  grantVesting,
  grantsForHolder,
  modelRound,
  recordConvertible,
  recordEquityEvent,
  recordGrant,
  upsertShareClass,
} from '../../application/finance/equity';

const handle = async (run: () => Promise<Response>): Promise<Response> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof EquityError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
};

const optionalNumber = (value: unknown): number | null =>
  value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);

const optionalText = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

export function createEquityRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  const tenant = (c: Context<HonoEnv>) => c.get('tenantId') as number;
  const actor = (c: Context<HonoEnv>) => String(c.get('userId') ?? '');

  /**
   * The cap table, folded as of an instant.
   *
   * `asOf` is what makes "what did we own in March" the SAME read with a cutoff
   * rather than a second stored history. Empty (never a 404) for a company with
   * no ledger: a workspace can be real and simply not have recorded its
   * formation, and the card says so rather than showing zeroes.
   */
  router.get('/cap-table', (c) => handle(async () =>
    Response.json(await capTable(
      db,
      c.env as Env,
      tenant(c),
      c.req.query('companyRef') ?? '',
      c.req.query('asOf') ?? undefined,
    ))));

  /** The ledger the projection folds — the audit read behind "what changed". */
  router.get('/ledger', (c) => handle(async () =>
    Response.json({
      events: await equityLedger(
        db,
        tenant(c),
        c.req.query('companyRef') ?? '',
        Number(c.req.query('limit') ?? 50),
      ),
    })));

  /** One grant's vested / unvested position at a date, and its cliff. */
  router.get('/grants/:id/vesting', (c) => handle(async () =>
    Response.json(await grantVesting(db, tenant(c), Number(c.req.param('id')), c.req.query('asOf') ?? undefined))));

  /** What one holder has been granted — the read an `offer`'s equity line is
   *  checked against, so a sentence becomes a fact. */
  router.get('/holders/:partyRef/grants', (c) => handle(async () =>
    Response.json({ grants: await grantsForHolder(db, tenant(c), c.req.param('partyRef')) })));

  /**
   * Cliffs landing inside a window.
   *
   * Computed, not queried: a cliff is `vestingStartAt` plus `cliffMonths`, and a
   * stored copy is the drift the whole module refuses. This is what a `trigger`
   * with the `due-within` comparator and the nightly sweep both read.
   */
  router.get('/cliffs', (c) => handle(async () =>
    Response.json({
      cliffs: await cliffsDueWithin(db, tenant(c), Number(c.req.query('days') ?? 30), Date.now()),
    })));

  /** Authorise a class, or restate its terms. An INCREASE to an option pool's
   *  authorisation is recorded as a `pool-increase` event by the handler. */
  router.post('/share-classes', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await upsertShareClass(db, c.env as Env, tenant(c), {
      companyRef: optionalText(body.companyRef),
      name: String(body.name ?? ''),
      kind: typeof body.kind === 'string' ? body.kind : undefined,
      authorized: optionalNumber(body.authorized) ?? 0,
      pricePerShare: optionalNumber(body.pricePerShare),
      currency: typeof body.currency === 'string' ? body.currency : undefined,
      liquidationMultiple: optionalNumber(body.liquidationMultiple),
      participating: body.participating === true,
      seniority: optionalNumber(body.seniority) ?? 0,
      fundingRoundId: optionalNumber(body.fundingRoundId),
      objectId: optionalText(body.objectId),
    }, actor(c)));
  }));

  /** The grant AND its issuance event, in one act — see the handler for why the
   *  two are not separable. */
  router.post('/grants', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await recordGrant(db, c.env as Env, tenant(c), {
      companyRef: optionalText(body.companyRef),
      reference: String(body.reference ?? ''),
      shareClassRef: String(body.shareClassRef ?? ''),
      holderName: String(body.holderName ?? ''),
      holderRef: optionalText(body.holderRef),
      instrument: typeof body.instrument === 'string' ? body.instrument : undefined,
      quantity: Number(body.quantity),
      pricePerShare: optionalNumber(body.pricePerShare),
      fmvPerShare: optionalNumber(body.fmvPerShare),
      currency: typeof body.currency === 'string' ? body.currency : undefined,
      grantedAt: optionalText(body.grantedAt),
      vestingStartAt: optionalText(body.vestingStartAt),
      vestingMonths: optionalNumber(body.vestingMonths),
      cliffMonths: optionalNumber(body.cliffMonths),
      vestingFrequency: typeof body.vestingFrequency === 'string' ? body.vestingFrequency : undefined,
      acceleration: typeof body.acceleration === 'string' ? body.acceleration : undefined,
      fundingRoundId: optionalNumber(body.fundingRoundId),
      objectId: optionalText(body.objectId),
      notes: optionalText(body.notes),
    }, actor(c)));
  }));

  /** Append one ledger event. The legs each verb needs are validated against the
   *  same declaration the fold reads. */
  router.post('/events', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await recordEquityEvent(db, c.env as Env, tenant(c), {
      companyRef: optionalText(body.companyRef),
      eventKind: String(body.eventKind ?? ''),
      shareClassRef: optionalText(body.shareClassRef),
      toShareClassRef: optionalText(body.toShareClassRef),
      grantId: optionalNumber(body.grantId),
      fundingRoundId: optionalNumber(body.fundingRoundId),
      fromHolderRef: optionalText(body.fromHolderRef),
      toHolderRef: optionalText(body.toHolderRef),
      quantity: Number(body.quantity),
      pricePerShare: optionalNumber(body.pricePerShare),
      currency: typeof body.currency === 'string' ? body.currency : undefined,
      effectiveAt: optionalText(body.effectiveAt),
      reason: optionalText(body.reason),
    }, actor(c)));
  }));

  /** A SAFE or a note. No share count, because there is not one until a round
   *  prices it. */
  router.post('/convertibles', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await recordConvertible(db, c.env as Env, tenant(c), {
      companyRef: optionalText(body.companyRef),
      reference: String(body.reference ?? ''),
      kind: typeof body.kind === 'string' ? body.kind : undefined,
      holderName: String(body.holderName ?? ''),
      holderRef: optionalText(body.holderRef),
      principal: Number(body.principal),
      currency: typeof body.currency === 'string' ? body.currency : undefined,
      valuationCap: optionalNumber(body.valuationCap),
      discountPercent: optionalNumber(body.discountPercent),
      postMoney: body.postMoney !== false,
      mfn: body.mfn === true,
      interestRate: optionalNumber(body.interestRate),
      issuedAt: optionalText(body.issuedAt),
      maturesAt: optionalText(body.maturesAt),
      fundingRoundId: optionalNumber(body.fundingRoundId),
      objectId: optionalText(body.objectId),
      notes: optionalText(body.notes),
    }, actor(c)));
  }));

  /** Model a priced round. Writes NOTHING — see the module note. */
  router.post('/rounds/model', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json({
      model: await modelRound(db, c.env as Env, tenant(c), {
        companyRef: optionalText(body.companyRef),
        preMoney: Number(body.preMoney),
        raiseAmount: Number(body.raiseAmount),
        targetPoolPercent: optionalNumber(body.targetPoolPercent),
        currency: typeof body.currency === 'string' ? body.currency : undefined,
        asOf: optionalText(body.asOf),
      }),
    });
  }));

  /** APPLY one — the conversions and the new class, as real events. Re-models at
   *  write time rather than trusting the plan the caller was shown. */
  router.post('/rounds/apply', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const shareClassName = String(body.shareClassName ?? '').trim();
    if (!shareClassName) {
      return Response.json({ error: 'Applying a round needs the name of the class the new money buys.' }, { status: 400 });
    }
    return Response.json(await applyRoundConversions(db, c.env as Env, tenant(c), {
      companyRef: optionalText(body.companyRef),
      preMoney: Number(body.preMoney),
      raiseAmount: Number(body.raiseAmount),
      targetPoolPercent: optionalNumber(body.targetPoolPercent),
      shareClassName,
      currency: typeof body.currency === 'string' ? body.currency : undefined,
      asOf: optionalText(body.asOf),
      fundingRoundId: optionalNumber(body.fundingRoundId),
    }, actor(c)));
  }));

  return router;
}
