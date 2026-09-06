/**
 * Signed, time-limited preview token for the live container-preview ingress
 * (Replit-parity phase 2). A running container may expose a dev server; the Worker
 * proxies `preview.builderforce.ai/<token>/*` to it (see {@link ../ide/previewIngress}).
 * Because that URL is public (a phone loads it straight from the QR), the token both
 * NAMES the target execution and PROVES the holder was granted access, and it EXPIRES
 * so a leaked URL stops working — a plain HMAC-of-id (like {@link ./containerRunToken})
 * would grant indefinite access to anyone who ever saw the link.
 *
 * Format: `<executionId>.<expEpochSec>.<hmacHex>` where the HMAC is over
 * `preview:<executionId>:<exp>` under `JWT_SECRET`. Self-describing (no server state)
 * and constant-time verified, mirroring the `?exp&sig` brain-file upload signature.
 */

import { timingSafeEqual } from '../../infrastructure/crypto/constantTime';
import { hmacHex } from '../../infrastructure/crypto/hmac';

const constantTimeEqual = (a: unknown, b: unknown): boolean =>
  typeof a === 'string' && typeof b === 'string' && timingSafeEqual(a, b);

/** Default preview link lifetime — long enough for an editing session, short enough
 *  that a shared URL doesn't linger. Overridable per mint. */
export const PREVIEW_TOKEN_TTL_SECONDS = 60 * 60; // 1h

/** Mint a preview token for `executionId`, valid for `ttlSeconds` from `nowSec`.
 *  `nowSec` is injected (not read via Date.now) so callers can stamp it from the
 *  request context and the function stays pure/testable. */
export async function mintPreviewToken(
  secret: string,
  executionId: number,
  nowSec: number,
  ttlSeconds: number = PREVIEW_TOKEN_TTL_SECONDS,
): Promise<string> {
  const exp = Math.floor(nowSec) + Math.max(1, Math.floor(ttlSeconds));
  const sig = await hmacHex(secret, `preview:${executionId}:${exp}`);
  return `${executionId}.${exp}.${sig}`;
}

/** Verify a presented preview token against `nowSec`. Returns the bound executionId,
 *  or null when the token is malformed, tampered, or expired. */
export async function verifyPreviewToken(
  secret: string,
  presented: string,
  nowSec: number,
): Promise<{ executionId: number } | null> {
  if (typeof presented !== 'string') return null;
  const parts = presented.split('.');
  if (parts.length !== 3) return null;
  const [idRaw, expRaw, sig] = parts;
  if (!idRaw || !expRaw || !sig) return null;
  const executionId = Number(idRaw);
  const exp = Number(expRaw);
  if (!Number.isFinite(executionId) || executionId <= 0 || !Number.isFinite(exp)) return null;
  if (Math.floor(nowSec) >= exp) return null; // expired

  const expected = await hmacHex(secret, `preview:${executionId}:${exp}`);
  if (!constantTimeEqual(expected, sig)) return null;
  return { executionId };
}
