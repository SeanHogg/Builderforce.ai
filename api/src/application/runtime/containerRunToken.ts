/**
 * Per-run bearer token for the long-lived Container executor (AgentContainerDO).
 *
 * The container runs OUTSIDE the Worker and calls back into the internal
 * container-op endpoint for every LLM step / repo write / PR finalize. It carries
 * no tenant JWT, so each op is authenticated by this token: an HMAC-SHA256 of the
 * execution id under `JWT_SECRET`. The Worker mints it at dispatch and embeds it in
 * the run spec; the op endpoint recomputes and constant-time compares it, then
 * trusts the body's `executionId` (the token is bound to exactly that id).
 *
 * Scope is intentionally narrow — a token is good only for one execution's ops, so
 * a leaked token can't drive a different run.
 */

const enc = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Mint the container-run token for `executionId`. */
export function mintContainerRunToken(secret: string, executionId: number): Promise<string> {
  return hmacHex(secret, `container-run:${executionId}`);
}

/** Constant-time verify a presented token for `executionId`. */
export async function verifyContainerRunToken(secret: string, executionId: number, presented: string): Promise<boolean> {
  const expected = await hmacHex(secret, `container-run:${executionId}`);
  if (typeof presented !== 'string' || presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ presented.charCodeAt(i);
  return diff === 0;
}
