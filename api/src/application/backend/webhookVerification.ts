/**
 * Inbound webhook authentication for project backends.
 *
 * The ingress path carries an unguessable token, but a token in a URL is NOT
 * authentication: it is logged by proxies, it appears in the provider's console,
 * and anyone who has ever seen it can replay a request forever. For a Twilio
 * backend that matters concretely — an unverified `/sms` endpoint lets anyone
 * forge "an inbound message from a customer" and make the system send SMS on the
 * account's dime, or drive an IVR flow that dials out.
 *
 * So every handler declares how its caller is proved, and the runtime refuses to
 * execute an unverified request. `none` exists (some endpoints genuinely are
 * public), but it is an explicit choice recorded in the handler spec rather than
 * the default that happens when nobody thought about it.
 *
 * ── WHY THE COMPARISON IS CONSTANT-TIME ─────────────────────────────────────
 * Signature comparison is the one place a timing oracle is actually exploitable:
 * the attacker controls the candidate and can retry without limit. `timingSafeEqual`
 * is length-checked first (lengths are not secret) then folds every byte.
 */

import { reportCaughtError } from '../observability/caughtErrorReporter';

/** How a handler proves who called it. Declared per handler, never inferred. */
export const VERIFY_KINDS = ['none', 'twilio', 'stripe', 'shopify', 'shared-secret'] as const;
export type VerifyKind = (typeof VERIFY_KINDS)[number];

export function isVerifyKind(v: unknown): v is VerifyKind {
  return typeof v === 'string' && (VERIFY_KINDS as readonly string[]).includes(v);
}

/** Project secret each verification kind reads its key from. */
export const VERIFY_SECRET_NAME: Record<Exclude<VerifyKind, 'none'>, string> = {
  twilio: 'TWILIO_AUTH_TOKEN',
  stripe: 'STRIPE_WEBHOOK_SECRET',
  shopify: 'SHOPIFY_WEBHOOK_SECRET',
  'shared-secret': 'WEBHOOK_SHARED_SECRET',
};

/** The header each kind reads its signature from — one table, used by the ingress
 *  AND by the generated Worker, so the two cannot disagree about where to look. */
export const VERIFY_SIGNATURE_HEADER: Record<Exclude<VerifyKind, 'none'>, string> = {
  twilio: 'x-twilio-signature',
  stripe: 'stripe-signature',
  shopify: 'x-shopify-hmac-sha256',
  'shared-secret': 'x-builderforce-signature',
};

/**
 * The project secret a handler verifies against: its own override if it declares
 * one, else the kind's default.
 *
 * Written once because three callers need the same answer — the ingress, the
 * panel's "which secrets are still missing" list, and the Worker generator. If
 * they disagreed, the panel would ask for a secret the runtime never reads, or
 * the generated Worker would ship without one it does.
 */
export function verifySecretNameFor(handler: {
  verify: VerifyKind;
  verifySecret?: string;
}): string | null {
  if (handler.verify === 'none') return null;
  return handler.verifySecret ?? VERIFY_SECRET_NAME[handler.verify];
}

/**
 * How far a Stripe signature's timestamp may be from now.
 *
 * Stripe includes the signing timestamp INSIDE the signed payload precisely so a
 * captured webhook cannot be replayed forever. Checking the signature without
 * checking the age throws that away — which is why "verify the HMAC" is not, on
 * its own, verifying a Stripe webhook. Five minutes is Stripe's own recommendation.
 */
export const STRIPE_TIMESTAMP_TOLERANCE_SECONDS = 300;

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: string };

/** Length-checked, byte-folding comparison. No early return on a mismatch. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function toBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(algorithm: 'SHA-1' | 'SHA-256', key: string, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
}

/**
 * The exact string Twilio signs: the full request URL, then every POST parameter
 * appended as `key + value` in ASCII-sorted key order.
 *
 * Two details this gets right that a naive implementation does not:
 *   • The URL must be the one TWILIO called, byte for byte — including the query
 *     string and the scheme. Behind Cloudflare the inbound request URL is already
 *     the public one, so it is used verbatim rather than rebuilt from headers.
 *   • Sorting is over the RAW keys, and a repeated key contributes each of its
 *     values in the order received. Twilio sends repeated keys for media
 *     (`MediaUrl0`, `MediaUrl1` are distinct keys, but `Body` can repeat on some
 *     edge webhooks), and dropping duplicates silently breaks the signature.
 *
 * Exported for tests — this is the string that is wrong when verification fails.
 */
export function twilioSignatureBase(url: string, params: Array<[string, string]>): string {
  const sorted = [...params].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return url + sorted.map(([k, v]) => k + v).join('');
}

/**
 * Verify Twilio's `X-Twilio-Signature`.
 *
 * Two body shapes, both of which Twilio actually sends:
 *   • form-encoded (every messaging and voice webhook) — sign the URL plus the
 *     sorted parameters.
 *   • JSON (Event Streams / some Verify callbacks) — Twilio appends a
 *     `bodySHA256` query parameter and the signature covers the URL ALONE; the
 *     body is bound by that hash, which we therefore have to check ourselves. A
 *     valid signature over a URL whose `bodySHA256` we never compared would
 *     authenticate an attacker-chosen body.
 */
export async function verifyTwilioSignature(args: {
  url: string;
  signature: string | null;
  authToken: string;
  /** Form parameters, in received order. Empty for a JSON body. */
  formParams: Array<[string, string]>;
  /** Raw body text — only needed for the JSON (`bodySHA256`) variant. */
  rawBody: string;
  isForm: boolean;
}): Promise<VerifyResult> {
  const { url, signature, authToken, formParams, rawBody, isForm } = args;
  if (!signature) return { ok: false, reason: 'Missing X-Twilio-Signature header' };
  if (!authToken) return { ok: false, reason: 'TWILIO_AUTH_TOKEN is not set for this project' };

  try {
    if (!isForm) {
      const bodySha = new URL(url).searchParams.get('bodySHA256');
      if (!bodySha) {
        return { ok: false, reason: 'JSON webhook is missing the bodySHA256 query parameter' };
      }
      const digest = toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawBody)));
      if (!timingSafeEqual(digest, bodySha)) {
        return { ok: false, reason: 'Request body does not match bodySHA256' };
      }
    }
    const base = isForm ? twilioSignatureBase(url, formParams) : url;
    const expected = toBase64(await hmac('SHA-1', authToken, base));
    return timingSafeEqual(expected, signature)
      ? { ok: true }
      : { ok: false, reason: 'Signature does not match' };
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/backend/webhookVerification.ts',
      operation: 'verifyTwilioSignature',
    });
    return { ok: false, reason: 'Signature verification failed' };
  }
}

/**
 * Verify Stripe's `Stripe-Signature`.
 *
 * Stripe does NOT send a bare HMAC of the body, which is the mistake that makes a
 * plausible-looking Stripe integration reject every real event. The header is a
 * comma-separated list — `t=<unix>,v1=<hex>,v1=<hex>` — and the signed payload is
 * `"<t>.<rawBody>"`. Three consequences this handles:
 *
 *   • the timestamp is part of the MAC, so it cannot be trusted before the MAC is
 *     checked, and cannot be ignored after — an unchecked age turns a captured
 *     webhook into a replay that is valid forever;
 *   • `v1` can repeat during a secret rotation, and ANY of them matching is a
 *     pass, so a rotation does not drop events;
 *   • the raw body must be the bytes Stripe sent — re-serialising the parsed JSON
 *     changes key order and whitespace and breaks the MAC. The ingress keeps the
 *     raw text for exactly this reason.
 */
export async function verifyStripeSignature(args: {
  signature: string | null;
  secret: string;
  rawBody: string;
  /** Injected so the tolerance window is testable without freezing the clock. */
  nowSeconds?: number;
}): Promise<VerifyResult> {
  const { signature, secret, rawBody } = args;
  if (!signature) return { ok: false, reason: 'Missing Stripe-Signature header' };
  if (!secret) return { ok: false, reason: `${VERIFY_SECRET_NAME.stripe} is not set for this project` };

  let timestamp = '';
  const candidates: string[] = [];
  for (const part of signature.split(',')) {
    const [key, value] = part.trim().split('=');
    if (key === 't' && value) timestamp = value;
    else if (key === 'v1' && value) candidates.push(value);
  }
  if (!timestamp || candidates.length === 0) {
    return { ok: false, reason: 'Stripe-Signature is missing t= or v1=' };
  }

  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  const age = Math.abs(now - Number(timestamp));
  if (!Number.isFinite(age) || age > STRIPE_TIMESTAMP_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'Stripe signature timestamp is outside the tolerance window' };
  }

  try {
    const expected = toHex(await hmac('SHA-256', secret, `${timestamp}.${rawBody}`));
    // Every candidate is compared — no early exit — so a rotation with two valid
    // signatures does not leak which one matched through timing.
    let matched = false;
    for (const candidate of candidates) matched = timingSafeEqual(expected, candidate) || matched;
    return matched ? { ok: true } : { ok: false, reason: 'Signature does not match' };
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/backend/webhookVerification.ts',
      operation: 'verifyStripeSignature',
    });
    return { ok: false, reason: 'Signature verification failed' };
  }
}

/**
 * Verify Shopify's `X-Shopify-Hmac-Sha256`.
 *
 * Same algorithm as the generic shared secret, different ENCODING: Shopify sends
 * base64, not hex, and with no `sha256=` prefix. Comparing a hex digest against a
 * base64 signature fails 100% of the time and looks exactly like a wrong secret,
 * which is why this is its own kind rather than a note in the docs.
 */
export async function verifyShopifySignature(args: {
  signature: string | null;
  secret: string;
  rawBody: string;
}): Promise<VerifyResult> {
  const { signature, secret, rawBody } = args;
  if (!signature) return { ok: false, reason: 'Missing X-Shopify-Hmac-Sha256 header' };
  if (!secret) return { ok: false, reason: `${VERIFY_SECRET_NAME.shopify} is not set for this project` };
  try {
    const expected = toBase64(await hmac('SHA-256', secret, rawBody));
    return timingSafeEqual(expected, signature.trim())
      ? { ok: true }
      : { ok: false, reason: 'Signature does not match' };
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/backend/webhookVerification.ts',
      operation: 'verifyShopifySignature',
    });
    return { ok: false, reason: 'Signature verification failed' };
  }
}

/**
 * Verify a generic `X-Builderforce-Signature: sha256=<hex>` HMAC over the raw
 * body — the shape used by GitHub, Stripe-alikes and most "sign your webhook"
 * docs, so a customer wiring a non-Twilio provider has a path that needs no new
 * verification kind.
 */
export async function verifySharedSecret(args: {
  signature: string | null;
  secret: string;
  rawBody: string;
}): Promise<VerifyResult> {
  const { signature, secret, rawBody } = args;
  if (!signature) return { ok: false, reason: 'Missing signature header' };
  if (!secret) return { ok: false, reason: 'WEBHOOK_SHARED_SECRET is not set for this project' };
  try {
    const expected = toHex(await hmac('SHA-256', secret, rawBody));
    const provided = signature.startsWith('sha256=') ? signature.slice(7) : signature;
    return timingSafeEqual(expected, provided) ? { ok: true } : { ok: false, reason: 'Signature does not match' };
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/backend/webhookVerification.ts',
      operation: 'verifySharedSecret',
    });
    return { ok: false, reason: 'Signature verification failed' };
  }
}
