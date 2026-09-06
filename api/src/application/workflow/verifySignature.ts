/**
 * Shared HMAC-SHA256 webhook signature verification (Web Crypto — Worker-safe).
 *
 * Accepts the GitHub-style `sha256=<hex>` header form as well as a bare hex
 * digest, so it is reusable by the GitHub webhook route and the generic
 * workflow webhook trigger. The MAC and the constant-time compare are the
 * platform's one implementation of each (`infrastructure/crypto`).
 */
import { timingSafeEqual } from '../../infrastructure/crypto/constantTime';
import { hmacHex } from '../../infrastructure/crypto/hmac';

export async function verifyHmacSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  try {
    if (!signatureHeader) return false;
    const expected = signatureHeader.startsWith('sha256=')
      ? signatureHeader.slice('sha256='.length)
      : signatureHeader.trim();
    if (!expected) return false;
    return timingSafeEqual(await hmacHex(secret, rawBody), expected.toLowerCase());
  } catch {
    return false;
  }
}
