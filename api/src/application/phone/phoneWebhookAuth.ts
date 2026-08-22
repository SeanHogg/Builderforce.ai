/**
 * PROVING AN INBOUND CALL/SMS WEBHOOK IS REALLY FROM THE CARRIER.
 *
 * ── WHY THIS CANNOT BE SKIPPED ───────────────────────────────────────────────
 * These endpoints are public by necessity — the carrier has to reach them — and
 * every one of them SPENDS MONEY on the tenant's behalf. An unverified
 * `/webhooks/status` lets anyone post "call SID X ran for 90 minutes" and drain a
 * balance; an unverified `/webhooks/sms` lets anyone forge an inbound message and
 * drive whatever automation reads it. The platform already owns the verification
 * primitive (`backend/webhookVerification.ts`, written for exactly this attack on
 * project backends), so this module is the two things that primitive cannot know:
 * WHICH tenant a request belongs to, and where that tenant's auth token lives.
 *
 * ── THE TENANT COMES FROM THE NUMBER, NOT FROM THE REQUEST ───────────────────
 * Twilio posts `To` (for inbound) and `From` (for outbound status). Either way one
 * of them is a number THIS platform provisioned, and `business_phone_numbers` maps
 * it to its owner. Deliberately not `AccountSid`: two tenants can share a Twilio
 * account, and a claimed account id in an unverified body is not evidence of
 * anything. Resolving by the number means the tenant is decided by a row we wrote,
 * before any signature is checked.
 *
 * ── AND THE TOKEN COMES FROM THAT TENANT'S SEALED CONNECTION ─────────────────
 * Not from an env var. A per-tenant Twilio connection already holds the auth token
 * under the same credential seal every other connector uses, so verification uses
 * the same secret the sending side authenticates with — and a tenant who rotates
 * their token fixes both halves at once.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { businessPhoneNumbers } from '../../infrastructure/database/schema';
import { verifyTwilioSignature } from '../backend/webhookVerification';
import { defaultConnectionFor } from '../connectors/connectorRuntime';
import { reportCaughtError } from '../observability/caughtErrorReporter';

export type WebhookAuth =
  | { ok: true; tenantId: number }
  | { ok: false; status: 401 | 404; reason: string };

/**
 * Resolve the tenant and verify the signature.
 *
 * `params` must be the form parameters IN RECEIVED ORDER — the signature is
 * computed over them and re-ordering breaks it. The caller parses the body once
 * and passes both the ordered pairs and the raw text.
 */
export async function authenticatePhoneWebhook(
  db: Db, env: Env,
  input: { url: string; signature: string | null; params: Array<[string, string]>; rawBody: string },
): Promise<WebhookAuth> {
  const byKey = new Map(input.params);
  const candidates = [byKey.get('To'), byKey.get('From'), byKey.get('Called'), byKey.get('Caller')]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  if (candidates.length === 0) return { ok: false, status: 404, reason: 'No number on the request' };

  const rows = await db.select({ tenantId: businessPhoneNumbers.tenantId })
    .from(businessPhoneNumbers)
    .where(and(
      inArray(businessPhoneNumbers.e164, candidates),
      // A released number is not ours any more; accepting its webhooks would let
      // whoever holds it now write into this platform's log.
      eq(businessPhoneNumbers.provider, 'twilio'),
    ))
    .limit(1);

  const tenantId = rows[0]?.tenantId;
  if (!tenantId) return { ok: false, status: 404, reason: 'No provisioned number matches this request' };

  let authToken = '';
  try {
    const connection = await defaultConnectionFor(db, env, tenantId, 'twilio');
    // The explicit Auth Token field wins. `password` is only a valid fallback when
    // the connection authenticates with the ACCOUNT SID (AC…), because then the
    // password IS the Auth Token; an API key secret (paired with an SK… username)
    // cannot verify a signature and must not be tried, or every inbound webhook
    // fails with "signature does not match" and looks like a Twilio fault.
    const usesAccountSid = (connection.auth.username ?? '').startsWith('AC');
    authToken = connection.auth.authToken || (usesAccountSid ? connection.auth.password ?? '' : '');
    if (!authToken) {
      return {
        ok: false, status: 401,
        reason: 'This Twilio connection has no Account Auth token, so inbound webhooks cannot be verified',
      };
    }
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/phone/phoneWebhookAuth.ts',
      operation: 'authenticatePhoneWebhook',
      context: { tenantId },
    });
    return { ok: false, status: 401, reason: 'No Twilio connection to verify against' };
  }

  const verified = await verifyTwilioSignature({
    url: input.url,
    signature: input.signature,
    authToken,
    formParams: input.params,
    rawBody: input.rawBody,
    isForm: true,
  });

  if (!verified.ok) return { ok: false, status: 401, reason: verified.reason };
  return { ok: true, tenantId };
}
