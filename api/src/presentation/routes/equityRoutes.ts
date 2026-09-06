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
import { limitParam } from './queryParams';
import { parseBody, z, zNonEmptyString } from './requestBody';

// `EquityError` carries `status`, so a thrown one is answered by `app.onError`
// through `statusOf` — no local mapper.

const optionalNumber = (value: unknown): number | null =>
  value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);

const optionalText = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

// ── Body schemas ─────────────────────────────────────────────────────────────
// Optional numbers and texts keep the tolerant readers above (a form posts `''`
// for an empty field); required quantities must be real numbers.

/** `''`, `null`, absent, or a non-numeric → null; a numeric string is admitted. */
const zOptionalNumber = z.preprocess(optionalNumber, z.number().nullable());
/** Blank / non-string → null; otherwise trimmed. */
const zOptionalText = z.preprocess(optionalText, z.string().nullable());
const zOptionalKind = z.string().optional();

const ShareClassBody = z.object({
  companyRef: zOptionalText,
  name: zNonEmptyString,
  kind: zOptionalKind,
  authorized: zOptionalNumber,
  pricePerShare: zOptionalNumber,
  currency: zOptionalKind,
  liquidationMultiple: zOptionalNumber,
  participating: z.boolean().optional(),
  seniority: zOptionalNumber,
  fundingRoundId: zOptionalNumber,
  objectId: zOptionalText,
});

const GrantBody = z.object({
  companyRef: zOptionalText,
  reference: zNonEmptyString,
  shareClassRef: zNonEmptyString,
  holderName: zNonEmptyString,
  holderRef: zOptionalText,
  instrument: zOptionalKind,
  quantity: z.number(),
  pricePerShare: zOptionalNumber,
  fmvPerShare: zOptionalNumber,
  currency: zOptionalKind,
  grantedAt: zOptionalText,
  vestingStartAt: zOptionalText,
  vestingMonths: zOptionalNumber,
  cliffMonths: zOptionalNumber,
  vestingFrequency: zOptionalKind,
  acceleration: zOptionalKind,
  fundingRoundId: zOptionalNumber,
  objectId: zOptionalText,
  notes: zOptionalText,
});

const EquityEventBody = z.object({
  companyRef: zOptionalText,
  eventKind: zNonEmptyString,
  shareClassRef: zOptionalText,
  toShareClassRef: zOptionalText,
  grantId: zOptionalNumber,
  fundingRoundId: zOptionalNumber,
  fromHolderRef: zOptionalText,
  toHolderRef: zOptionalText,
  quantity: z.number(),
  pricePerShare: zOptionalNumber,
  currency: zOptionalKind,
  effectiveAt: zOptionalText,
  reason: zOptionalText,
});

const ConvertibleBody = z.object({
  companyRef: zOptionalText,
  reference: zNonEmptyString,
  kind: zOptionalKind,
  holderName: zNonEmptyString,
  holderRef: zOptionalText,
  principal: z.number(),
  currency: zOptionalKind,
  valuationCap: zOptionalNumber,
  discountPercent: zOptionalNumber,
  postMoney: z.boolean().optional(),
  mfn: z.boolean().optional(),
  interestRate: zOptionalNumber,
  issuedAt: zOptionalText,
  maturesAt: zOptionalText,
  fundingRoundId: zOptionalNumber,
  objectId: zOptionalText,
  notes: zOptionalText,
});

const RoundModelBody = z.object({
  companyRef: zOptionalText,
  preMoney: z.number(),
  raiseAmount: z.number(),
  targetPoolPercent: zOptionalNumber,
  currency: zOptionalKind,
  asOf: zOptionalText,
});

const RoundApplyBody = RoundModelBody.extend({
  shareClassName: zNonEmptyString,
  fundingRoundId: zOptionalNumber,
});

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
  router.get('/cap-table', async (c) =>
    Response.json(await capTable(
      db,
      c.env as Env,
      tenant(c),
      c.req.query('companyRef') ?? '',
      c.req.query('asOf') ?? undefined,
    )));

  /** The ledger the projection folds — the audit read behind "what changed". */
  router.get('/ledger', async (c) =>
    Response.json({
      events: await equityLedger(
        db,
        tenant(c),
        c.req.query('companyRef') ?? '',
        limitParam(c.req.query('limit'), 50, 500),
      ),
    }));

  /** One grant's vested / unvested position at a date, and its cliff. */
  router.get('/grants/:id/vesting', async (c) =>
    Response.json(await grantVesting(db, tenant(c), Number(c.req.param('id')), c.req.query('asOf') ?? undefined)));

  /** What one holder has been granted — the read an `offer`'s equity line is
   *  checked against, so a sentence becomes a fact. */
  router.get('/holders/:partyRef/grants', async (c) =>
    Response.json({ grants: await grantsForHolder(db, tenant(c), c.req.param('partyRef')) }));

  /**
   * Cliffs landing inside a window.
   *
   * Computed, not queried: a cliff is `vestingStartAt` plus `cliffMonths`, and a
   * stored copy is the drift the whole module refuses. This is what a `trigger`
   * with the `due-within` comparator and the nightly sweep both read.
   */
  router.get('/cliffs', async (c) =>
    Response.json({
      cliffs: await cliffsDueWithin(db, tenant(c), Number(c.req.query('days') ?? 30), Date.now()),
    }));

  /** Authorise a class, or restate its terms. An INCREASE to an option pool's
   *  authorisation is recorded as a `pool-increase` event by the handler. */
  router.post('/share-classes', async (c) => {
    const body = await parseBody(c, ShareClassBody);
    return Response.json(await upsertShareClass(db, c.env as Env, tenant(c), {
      companyRef: body.companyRef,
      name: body.name,
      kind: body.kind,
      authorized: body.authorized ?? 0,
      pricePerShare: body.pricePerShare,
      currency: body.currency,
      liquidationMultiple: body.liquidationMultiple,
      participating: body.participating === true,
      seniority: body.seniority ?? 0,
      fundingRoundId: body.fundingRoundId,
      objectId: body.objectId,
    }, actor(c)));
  });

  /** The grant AND its issuance event, in one act — see the handler for why the
   *  two are not separable. */
  router.post('/grants', async (c) => {
    const body = await parseBody(c, GrantBody);
    return Response.json(await recordGrant(db, c.env as Env, tenant(c), body, actor(c)));
  });

  /** Append one ledger event. The legs each verb needs are validated against the
   *  same declaration the fold reads. */
  router.post('/events', async (c) => {
    const body = await parseBody(c, EquityEventBody);
    return Response.json(await recordEquityEvent(db, c.env as Env, tenant(c), body, actor(c)));
  });

  /** A SAFE or a note. No share count, because there is not one until a round
   *  prices it. */
  router.post('/convertibles', async (c) => {
    const body = await parseBody(c, ConvertibleBody);
    return Response.json(await recordConvertible(db, c.env as Env, tenant(c), {
      ...body,
      postMoney: body.postMoney !== false,
      mfn: body.mfn === true,
    }, actor(c)));
  });

  /** Model a priced round. Writes NOTHING — see the module note. */
  router.post('/rounds/model', async (c) => {
    const body = await parseBody(c, RoundModelBody);
    return Response.json({ model: await modelRound(db, c.env as Env, tenant(c), body) });
  });

  /** APPLY one — the conversions and the new class, as real events. Re-models at
   *  write time rather than trusting the plan the caller was shown. */
  router.post('/rounds/apply', async (c) => {
    const body = await parseBody(c, RoundApplyBody);
    return Response.json(await applyRoundConversions(db, c.env as Env, tenant(c), body, actor(c)));
  });

  return router;
}
