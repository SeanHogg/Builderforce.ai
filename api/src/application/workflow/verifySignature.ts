/**
 * Shared HMAC-SHA256 webhook signature verification (Web Crypto — Worker-safe).
 *
 * Accepts the GitHub-style `sha256=<hex>` header form as well as a bare hex
 * digest, so it is reusable by the GitHub webhook route and the generic
 * workflow webhook trigger. The check itself is `verifyHmacHex` in
 * `infrastructure/crypto/webhookHmac` — the platform's one implementation.
 */
import { verifyHmacHex } from '../../infrastructure/crypto/webhookHmac';

export async function verifyHmacSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader) return false;
  return verifyHmacHex(rawBody, signatureHeader, secret, signatureHeader.startsWith('sha256=') ? 'sha256=' : undefined);
}
