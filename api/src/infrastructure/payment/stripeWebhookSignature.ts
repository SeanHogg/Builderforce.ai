/**
 * Stripe webhook signature verification — Web Crypto only, so it runs on Workers.
 * See: https://stripe.com/docs/webhooks/signatures
 */
import { timingSafeEqual } from '../crypto/constantTime';
import { hmacHex } from '../crypto/hmac';

/** Stripe's documented replay window for webhook signatures. */
const SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Verify Stripe webhook signature using Web Crypto API (no Node.js required).
 * See: https://stripe.com/docs/webhooks/signatures
 */
export async function verifyStripeSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  try {
    // Header form: `t=<ts>,v1=<sig>[,v1=<sig>]`. Multiple v1 entries appear while a
    // signing secret is being rotated, so every one is a candidate.
    let timestamp = '';
    const signatures: string[] = [];
    for (const part of signatureHeader.split(',')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const key = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (key === 't') timestamp = value;
      else if (key === 'v1') signatures.push(value);
    }
    if (!timestamp || signatures.length === 0) return false;

    // Without this, a captured payload stays replayable forever.
    const sentAt = Number(timestamp);
    if (!Number.isFinite(sentAt)) return false;
    if (Math.abs(Date.now() / 1000 - sentAt) > SIGNATURE_TOLERANCE_SECONDS) return false;

    const hex = await hmacHex(secret, `${timestamp}.${payload}`);
    return signatures.some((candidate) => timingSafeEqual(hex, candidate));
  } catch {
    return false;
  }
}
