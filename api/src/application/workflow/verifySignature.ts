/**
 * Shared HMAC-SHA256 webhook signature verification (Web Crypto — Worker-safe).
 *
 * Accepts the GitHub-style `sha256=<hex>` header form as well as a bare hex
 * digest, so it is reusable by the GitHub webhook route and the generic
 * workflow webhook trigger. Comparison is length-then-content; this is a
 * shared-secret integrity check, not a constant-time secret comparison.
 */

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

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
    const hex = Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return hex.toLowerCase() === expected.toLowerCase();
  } catch {
    return false;
  }
}
