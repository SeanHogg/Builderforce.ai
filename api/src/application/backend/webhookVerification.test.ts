/**
 * Webhook verification tests.
 *
 * This is the control that stops anyone who learns a project's ingress URL from
 * forging "an inbound customer message" and spending the account's balance on the
 * reply, so the assertions are about REJECTION as much as acceptance.
 *
 * The Twilio vector is computed here with the algorithm from Twilio's own docs
 * (HMAC-SHA1 over url + sorted key+value, base64) rather than hardcoded, so the
 * test pins the CONTRACT — if `twilioSignatureBase` starts sorting differently or
 * drops a repeated key, this fails.
 */
import { describe, it, expect } from 'vitest';
import {
  timingSafeEqual,
  twilioSignatureBase,
  verifyShopifySignature,
  verifySharedSecret,
  verifyStripeSignature,
  verifyTwilioSignature,
  STRIPE_TIMESTAMP_TOLERANCE_SECONDS,
  VERIFY_KINDS,
  VERIFY_SECRET_NAME,
  VERIFY_SIGNATURE_HEADER,
  isVerifyKind,
} from './webhookVerification';

const AUTH_TOKEN = '12345678901234567890123456789012';

async function twilioSign(url: string, params: Array<[string, string]>): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(AUTH_TOKEN),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const base = twilioSignatureBase(url, params);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(base));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

describe('twilioSignatureBase', () => {
  it('appends parameters in ASCII key order, not receipt order', () => {
    expect(twilioSignatureBase('https://x.test/sms', [['To', '+1'], ['Body', 'hi'], ['From', '+2']]))
      .toBe('https://x.test/smsBodyhiFrom+2To+1');
  });

  it('includes every value of a repeated key', () => {
    // Dropping duplicates silently breaks the signature on media webhooks.
    expect(twilioSignatureBase('https://x.test/s', [['A', '1'], ['A', '2']])).toBe('https://x.test/sA1A2');
  });

  it('signs the URL including its query string', () => {
    expect(twilioSignatureBase('https://x.test/s?a=1', [])).toBe('https://x.test/s?a=1');
  });
});

describe('verifyTwilioSignature (form webhooks)', () => {
  const url = 'https://api.test/hooks/tok/sms';
  const params: Array<[string, string]> = [['From', '+14155551234'], ['Body', 'help']];

  it('accepts a correctly signed request', async () => {
    const signature = await twilioSign(url, params);
    const result = await verifyTwilioSignature({
      url, signature, authToken: AUTH_TOKEN, formParams: params, rawBody: '', isForm: true,
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects a tampered body even with a signature valid for the original', async () => {
    const signature = await twilioSign(url, params);
    const result = await verifyTwilioSignature({
      url,
      signature,
      authToken: AUTH_TOKEN,
      formParams: [['From', '+14155551234'], ['Body', 'REFUND ME']],
      rawBody: '',
      isForm: true,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a signature computed for a different URL', async () => {
    const signature = await twilioSign('https://api.test/hooks/tok/voice', params);
    const result = await verifyTwilioSignature({
      url, signature, authToken: AUTH_TOKEN, formParams: params, rawBody: '', isForm: true,
    });
    expect(result.ok).toBe(false);
  });

  it('fails closed and says so when the token is not configured', async () => {
    const result = await verifyTwilioSignature({
      url, signature: 'anything', authToken: '', formParams: params, rawBody: '', isForm: true,
    });
    expect(result).toEqual({ ok: false, reason: 'TWILIO_AUTH_TOKEN is not set for this project' });
  });

  it('rejects a request with no signature header at all', async () => {
    const result = await verifyTwilioSignature({
      url, signature: null, authToken: AUTH_TOKEN, formParams: params, rawBody: '', isForm: true,
    });
    expect(result.ok).toBe(false);
  });
});

describe('verifyTwilioSignature (JSON webhooks)', () => {
  it('refuses a JSON webhook with no bodySHA256 — the body would be unbound', async () => {
    const url = 'https://api.test/hooks/tok/events';
    const signature = await twilioSign(url, []);
    const result = await verifyTwilioSignature({
      url, signature, authToken: AUTH_TOKEN, formParams: [], rawBody: '{"a":1}', isForm: false,
    });
    expect(result).toEqual({ ok: false, reason: 'JSON webhook is missing the bodySHA256 query parameter' });
  });

  it('accepts a JSON webhook whose body matches bodySHA256', async () => {
    const rawBody = '{"a":1}';
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawBody))))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const url = `https://api.test/hooks/tok/events?bodySHA256=${digest}`;
    const signature = await twilioSign(url, []);
    const result = await verifyTwilioSignature({
      url, signature, authToken: AUTH_TOKEN, formParams: [], rawBody, isForm: false,
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects a swapped body even when the URL signature is valid', async () => {
    const original = '{"a":1}';
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(original))))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const url = `https://api.test/hooks/tok/events?bodySHA256=${digest}`;
    const signature = await twilioSign(url, []);
    const result = await verifyTwilioSignature({
      url, signature, authToken: AUTH_TOKEN, formParams: [], rawBody: '{"a":666}', isForm: false,
    });
    expect(result).toEqual({ ok: false, reason: 'Request body does not match bodySHA256' });
  });
});

describe('verifySharedSecret', () => {
  const secret = 'a-shared-secret-value';
  const rawBody = '{"event":"ping"}';

  async function sign(body: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
    return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  it('accepts a bare hex signature and the sha256= prefixed form', async () => {
    const hex = await sign(rawBody);
    expect(await verifySharedSecret({ signature: hex, secret, rawBody })).toEqual({ ok: true });
    expect(await verifySharedSecret({ signature: `sha256=${hex}`, secret, rawBody })).toEqual({ ok: true });
  });

  it('rejects a signature over different content', async () => {
    const hex = await sign('{"event":"other"}');
    expect((await verifySharedSecret({ signature: hex, secret, rawBody })).ok).toBe(false);
  });
});

describe('timingSafeEqual', () => {
  it('is false for different lengths and different content, true for a match', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
  });
});

describe('verify kinds', () => {
  it('names a secret AND a header for every non-none kind, so nothing verifies against nothing', () => {
    expect(VERIFY_SECRET_NAME.twilio).toBe('TWILIO_AUTH_TOKEN');
    expect(VERIFY_SECRET_NAME['shared-secret']).toBe('WEBHOOK_SHARED_SECRET');
    // A kind added without a secret or a header name would fail open or 500 at
    // request time, so the tables are asserted TOTAL rather than spot-checked.
    for (const kind of VERIFY_KINDS) {
      if (kind === 'none') continue;
      expect(VERIFY_SECRET_NAME[kind], kind).toBeTruthy();
      expect(VERIFY_SIGNATURE_HEADER[kind], kind).toBeTruthy();
    }
  });

  it('rejects an unknown kind', () => {
    expect(isVerifyKind('twilio')).toBe(true);
    expect(isVerifyKind('trust-me')).toBe(false);
    expect(isVerifyKind(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------

const STRIPE_SECRET = 'whsec_test_secret_value';

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('verifyStripeSignature', () => {
  const body = JSON.stringify({ type: 'invoice.payment_failed', data: { object: { id: 'in_1' } } });
  const now = 1_800_000_000;

  it('accepts a signature computed over "<timestamp>.<body>"', async () => {
    const v1 = await hmacHex(STRIPE_SECRET, `${now}.${body}`);
    const result = await verifyStripeSignature({
      signature: `t=${now},v1=${v1}`,
      secret: STRIPE_SECRET,
      rawBody: body,
      nowSeconds: now,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an HMAC of the BODY ALONE — the mistake a generated integration makes', async () => {
    const wrong = await hmacHex(STRIPE_SECRET, body);
    const result = await verifyStripeSignature({
      signature: `t=${now},v1=${wrong}`,
      secret: STRIPE_SECRET,
      rawBody: body,
      nowSeconds: now,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a replay outside the tolerance window even though the MAC is valid', async () => {
    const old = now - STRIPE_TIMESTAMP_TOLERANCE_SECONDS - 1;
    const v1 = await hmacHex(STRIPE_SECRET, `${old}.${body}`);
    const result = await verifyStripeSignature({
      signature: `t=${old},v1=${v1}`,
      secret: STRIPE_SECRET,
      rawBody: body,
      nowSeconds: now,
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/tolerance/i);
  });

  it('accepts when ANY v1 matches, so a secret rotation does not drop events', async () => {
    const good = await hmacHex(STRIPE_SECRET, `${now}.${body}`);
    const result = await verifyStripeSignature({
      signature: `t=${now},v1=${'0'.repeat(64)},v1=${good}`,
      secret: STRIPE_SECRET,
      rawBody: body,
      nowSeconds: now,
    });
    expect(result.ok).toBe(true);
  });

  it('refuses a header with no t= or no v1=, and refuses an unset secret', async () => {
    expect((await verifyStripeSignature({ signature: 'v1=abc', secret: STRIPE_SECRET, rawBody: body, nowSeconds: now })).ok).toBe(false);
    expect((await verifyStripeSignature({ signature: `t=${now}`, secret: STRIPE_SECRET, rawBody: body, nowSeconds: now })).ok).toBe(false);
    expect((await verifyStripeSignature({ signature: `t=${now},v1=abc`, secret: '', rawBody: body })).ok).toBe(false);
    expect((await verifyStripeSignature({ signature: null, secret: STRIPE_SECRET, rawBody: body })).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Shopify
// ---------------------------------------------------------------------------

describe('verifyShopifySignature', () => {
  const SECRET = 'shopify_shared_secret';
  const body = JSON.stringify({ id: 4501, name: '#1001' });

  async function shopifySign(message: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
    return btoa(String.fromCharCode(...new Uint8Array(sig)));
  }

  it('accepts the base64 digest Shopify actually sends', async () => {
    const result = await verifyShopifySignature({ signature: await shopifySign(body), secret: SECRET, rawBody: body });
    expect(result.ok).toBe(true);
  });

  it('rejects the HEX form — the encoding mistake that looks like a wrong secret', async () => {
    const hex = await hmacHex(SECRET, body);
    const result = await verifyShopifySignature({ signature: hex, secret: SECRET, rawBody: body });
    expect(result.ok).toBe(false);
  });

  it('rejects a body that was altered after signing', async () => {
    const signature = await shopifySign(body);
    const result = await verifyShopifySignature({ signature, secret: SECRET, rawBody: `${body} ` });
    expect(result.ok).toBe(false);
  });

  it('refuses a missing header or an unset secret rather than passing', async () => {
    expect((await verifyShopifySignature({ signature: null, secret: SECRET, rawBody: body })).ok).toBe(false);
    expect((await verifyShopifySignature({ signature: await shopifySign(body), secret: '', rawBody: body })).ok).toBe(false);
  });
});
