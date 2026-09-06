/**
 * Phone routes — /api/phone
 *
 * ── TWO DOORS, DELIBERATELY SEPARATED ────────────────────────────────────────
 * Everything under `/webhooks/*` is PUBLIC because a carrier has to reach it, and
 * is authenticated by signature (`authenticatePhoneWebhook`) rather than by JWT.
 * Everything else takes the tenant JWT. The split is structural — the webhook
 * sub-router is mounted BEFORE `authMiddleware` is applied, so a future handler
 * cannot accidentally inherit the wrong one.
 *
 * ── WHY PROVISIONING IS MANAGER+ AND SENDING IS NOT ──────────────────────────
 * Buying a number is a recurring monthly commitment against the workspace's
 * balance; sending one message is the product working. Gating both at the same
 * level would either put a spend commitment in every member's hands or make a
 * phone product that only owners can use.
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { commsBalance, commsStatement } from '../../application/phone/commsBalance';
import { COMMS_TOPUP_PACKS, completeCommsTopUp, startCommsTopUp } from '../../application/phone/commsTopUp';
import { DEFAULT_COMMS_RATES } from '../../application/phone/commsRates';
import { applyCallStatus, callLog, placeCall } from '../../application/phone/phoneCalls';
import { applySmsStatus, recordInboundSms, sendSms, smsLog } from '../../application/phone/phoneMessaging';
import {
  listNumbers, purchaseNumber, releaseNumber, searchAvailableNumbers,
} from '../../application/phone/phoneNumbers';
import { phonePlan } from '../../application/phone/phonePlan';
import { authenticatePhoneWebhook } from '../../application/phone/phoneWebhookAuth';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { refusalResponse } from '../middleware/errorResponse';
import { parseBody, z, zNonEmptyString, zOptionalString } from './requestBody';
import { limitParam } from './queryParams';

/**
 * A phone refusal as an HTTP answer, declared as data.
 *
 * `addon_inactive` — the workspace has not bought Business Phone (or it lapsed). 403
 * rather than 402: 402 means "top up your credit", and answering it here would send an
 * operator to the top-up dialog for a problem topping up cannot fix.
 * `vendor_refused` — the carrier said no; 502 because the fault is upstream, and the
 * `detail` the result carries is the carrier's own word on why.
 * Anything unlisted is the caller's mistake, which `refusalResponse` answers 400.
 */
const PHONE_REFUSAL_STATUS: Readonly<Record<string, number>> = {
  addon_inactive: 403,
  insufficient_credit: 402,
  no_sending_number: 409,
  number_taken: 409,
  vendor_refused: 502,
};

const PurchaseNumberBody = z.object({ e164: zNonEmptyString, label: zOptionalString });
/** The message text is content, not a field: it is required but never trimmed. */
const SendSmsBody = z.object({ to: zNonEmptyString, body: z.string().min(1), from: zOptionalString });
const PlaceCallBody = z.object({ to: zNonEmptyString, twimlUrl: zNonEmptyString, from: zOptionalString });
const StartTopUpBody = z.object({ packId: zNonEmptyString, billingEmail: zOptionalString });
const CompleteTopUpBody = z.object({ sessionId: zNonEmptyString });

/** Twilio expects TwiML. An empty response is the documented way to say
 *  "received, do nothing" — anything else makes the carrier read our JSON as
 *  malformed markup and retry. */
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response/>';

export function createPhoneRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.route('/webhooks', createWebhookRoutes(db));

  // ── Everything below is tenant-authenticated ────────────────────────────
  router.use('*', authMiddleware);

  // ── GET /api/phone — the whole surface in one read ──────────────────────
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const env = c.env as Env;
    const [balance, numbers, plan] = await Promise.all([
      commsBalance(db, env, tenantId),
      listNumbers(db, tenantId),
      phonePlan(db, env, tenantId),
    ]);
    // The card the CONSOLE shows is the card the meter charges: the published
    // overage rates when the add-on is live, the platform default otherwise. Two
    // rate lists is how a customer gets quoted one price and billed another.
    return c.json({
      balanceCents: balance,
      numbers,
      plan: { active: plan.active, status: plan.status, includedNumbers: plan.includedNumbers, allowanceCents: plan.allowanceCents },
      rates: DEFAULT_COMMS_RATES.map((rate) => ({ ...rate, cents: plan.rates[rate.unit] ?? rate.cents })),
    });
  });

  router.get('/statement', async (c) => {
    const tenantId = c.get('tenantId') as number;
    return c.json({ rows: await commsStatement(db, tenantId, limitParam(c.req.query('limit'), 50, 500)) });
  });

  router.get('/messages', async (c) => {
    const tenantId = c.get('tenantId') as number;
    return c.json({ rows: await smsLog(db, tenantId, limitParam(c.req.query('limit'), 50, 500)) });
  });

  router.get('/calls', async (c) => {
    const tenantId = c.get('tenantId') as number;
    return c.json({ rows: await callLog(db, tenantId, limitParam(c.req.query('limit'), 50, 500)) });
  });

  // ── Numbers ─────────────────────────────────────────────────────────────
  router.get('/numbers/available', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const areaCode = Number(c.req.query('areaCode'));
    return c.json({
      rows: await searchAvailableNumbers(db, c.env as Env, {
        tenantId,
        country: c.req.query('country') ?? 'US',
        areaCode: Number.isFinite(areaCode) && areaCode > 0 ? areaCode : undefined,
        contains: c.req.query('contains') ?? undefined,
      }),
    });
  });

  router.post('/numbers', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await parseBody(c, PurchaseNumberBody);
    const result = await purchaseNumber(db, c.env as Env, {
      tenantId, e164: body.e164, label: body.label,
      // The origin the carrier will call back on is THIS request's own origin, so
      // a staging workspace cannot end up with a number pointed at production.
      webhookBase: new URL(c.req.url).origin,
    });
    if (!result.ok) return refusalResponse(c, result.reason, PHONE_REFUSAL_STATUS, { ...result });
    return c.json(result);
  });

  router.delete('/numbers/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid number id' }, 400);
    const released = await releaseNumber(db, c.env as Env, tenantId, id);
    return released ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
  });

  // ── Sending ─────────────────────────────────────────────────────────────
  router.post('/sms', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await parseBody(c, SendSmsBody);
    const result = await sendSms(db, c.env as Env, {
      tenantId, to: body.to, body: body.body, from: body.from,
    });
    if (!result.ok) return refusalResponse(c, result.reason, PHONE_REFUSAL_STATUS, { ...result });
    return c.json(result);
  });

  router.post('/calls', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;
    const body = await parseBody(c, PlaceCallBody);
    const result = await placeCall(db, c.env as Env, {
      tenantId, to: body.to, twimlUrl: body.twimlUrl, from: body.from, actorRef: userId ?? null,
    });
    if (!result.ok) return refusalResponse(c, result.reason, PHONE_REFUSAL_STATUS, { ...result });
    return c.json(result);
  });

  // ── Top-up ──────────────────────────────────────────────────────────────
  //
  // Two steps, because credit is bought with MONEY. `start` opens a hosted
  // checkout for a published pack; `complete` reads the session back from the
  // processor and only then credits the ledger. An endpoint that took an amount
  // and a caller-supplied reference would be an endpoint that mints credit.
  //
  // Manager+ rather than owner-only: it is a purchase against the workspace, the
  // same commitment level as provisioning a number, and an owner-only gate makes
  // a phone product that stops working the moment the owner is on holiday.
  router.get('/topup/packs', async (c) => c.json({ packs: COMMS_TOPUP_PACKS }));

  //
  // A `CommsTopUpError` carries its own 4xx `status`, which is exactly the rule
  // `statusOf` applies in the global handler — so neither handler catches it.
  router.post('/topup', requireRole(TenantRole.MANAGER), async (c) => {
    const body = await parseBody(c, StartTopUpBody);
    return c.json(await startCommsTopUp(c.env as Env, {
      tenantId: c.get('tenantId') as number,
      userId: c.get('userId') as string,
      packId: body.packId,
      billingEmail: body.billingEmail ?? null,
      appUrl: (c.env as Env).APP_URL ?? new URL(c.req.url).origin,
    }));
  });

  router.post('/topup/complete', requireRole(TenantRole.MANAGER), async (c) => {
    const body = await parseBody(c, CompleteTopUpBody);
    return c.json(await completeCommsTopUp(db, c.env as Env, {
      tenantId: c.get('tenantId') as number,
      checkoutSessionId: body.sessionId,
    }));
  });

  return router;
}

/**
 * The carrier's door. No JWT — a signature over the exact URL and the exact form
 * parameters, checked against the owning tenant's own Auth Token.
 *
 * Every handler answers TwiML, including the failures: a carrier that receives
 * JSON logs a parse error and retries, so a refusal expressed as JSON becomes a
 * retry storm on an endpoint that already said no.
 */
function createWebhookRoutes(db: Db): Hono<HonoEnv> {
  const hooks = new Hono<HonoEnv>();

  const authenticate = async (c: { req: { url: string; text(): Promise<string>; header(n: string): string | undefined } }, env: Env) => {
    const rawBody = await c.req.text();
    const params = [...new URLSearchParams(rawBody).entries()];
    return {
      params: new Map(params),
      auth: await authenticatePhoneWebhook(db, env, {
        url: c.req.url,
        signature: c.req.header('x-twilio-signature') ?? null,
        params,
        rawBody,
      }),
    };
  };

  const twiml = (body: string, status: 200 | 401 | 404 = 200) =>
    new Response(body, { status, headers: { 'Content-Type': 'text/xml' } });

  // Inbound SMS.
  hooks.post('/sms', async (c) => {
    const { params, auth } = await authenticate(c, c.env as Env);
    if (!auth.ok) return twiml(EMPTY_TWIML, auth.status);

    await recordInboundSms(db, {
      tenantId: auth.tenantId,
      from: params.get('From') ?? '',
      to: params.get('To') ?? '',
      body: params.get('Body') ?? '',
      providerRef: params.get('MessageSid') ?? params.get('SmsSid') ?? '',
    });
    return twiml(EMPTY_TWIML);
  });

  // Outbound message status callbacks.
  hooks.post('/status', async (c) => {
    const { params, auth } = await authenticate(c, c.env as Env);
    if (!auth.ok) return twiml(EMPTY_TWIML, auth.status);

    const callSid = params.get('CallSid');
    if (callSid) {
      // A voice status callback and a message status callback arrive on the same
      // URL; the presence of `CallSid` is what separates them.
      await applyCallStatus(db, c.env as Env, {
        tenantId: auth.tenantId,
        providerRef: callSid,
        to: params.get('To') ?? '',
        from: params.get('From') ?? '',
        status: params.get('CallStatus') ?? 'unknown',
        durationSeconds: Number(params.get('CallDuration') ?? 0),
        direction: (params.get('Direction') ?? '').startsWith('inbound') ? 'inbound' : 'outbound',
      });
      return twiml(EMPTY_TWIML);
    }

    await applySmsStatus(db, {
      tenantId: auth.tenantId,
      providerRef: params.get('MessageSid') ?? params.get('SmsSid') ?? '',
      status: params.get('MessageStatus') ?? params.get('SmsStatus') ?? '',
      error: params.get('ErrorMessage') ?? null,
    });
    return twiml(EMPTY_TWIML);
  });

  // Inbound voice. Answers with empty TwiML — this platform records the call and
  // does not yet route it. An IVR is a Canvas concern (the phone-line realization
  // target already builds one), so this endpoint deliberately does not grow one.
  hooks.post('/voice', async (c) => {
    const { params, auth } = await authenticate(c, c.env as Env);
    if (!auth.ok) return twiml(EMPTY_TWIML, auth.status);

    await applyCallStatus(db, c.env as Env, {
      tenantId: auth.tenantId,
      providerRef: params.get('CallSid') ?? '',
      to: params.get('To') ?? '',
      from: params.get('From') ?? '',
      status: params.get('CallStatus') ?? 'ringing',
      durationSeconds: 0,
      direction: 'inbound',
    });
    return twiml(EMPTY_TWIML);
  });

  return hooks;
}
