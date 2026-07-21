/**
 * Crypto utilities using the Web Crypto API (SubtleCrypto).
 *
 * These work natively in Cloudflare Workers without any npm dependencies.
 */

/** SHA-256 hex digest of a string – used to store API keys. */
export async function hashSecret(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Constant-time comparison of a plaintext secret against a stored SHA-256 hex hash. */
export async function verifySecret(value: string, storedHash: string): Promise<boolean> {
  const computed = await hashSecret(value);
  if (computed.length !== storedHash.length) return false;
  // constant-time comparison
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Generates a new random API key in the format `<prefix>_<32 hex chars>`.
 *
 * Prefix conventions (each means one thing — never overload):
 *   - `bfa` — BuilderForce Agent instance API key (`agent_hosts.api_key_hash`)
 *   - `clk` — DEPRECATED alias of `bfa` (retired "claw" brand). Still ACCEPTED at
 *             auth for already-issued keys; never minted for new agents. Drop once
 *             all `clk_*` keys have rotated to `bfa_*`.
 *   - `clu` — Legacy user-bootstrap API key (`users.api_key_hash`)
 *   - `bfk` — Tenant API key for the LLM gateway (`tenant_api_keys.key_hash`)
 *   - `bfai` — Developer API key for the public read-only API (`developer_api_keys.key_hash`)
 *   - `whsec` — Outbound-webhook signing secret (`webhook_subscriptions.secret`)
 *   - `bfq` — Quality error-ingest key, per source (`error_sources.key_hash`)
 *   - `bff` — Product Feedback ingest key, per project collector (`feedback_collectors.key_hash`)
 */
export function generateApiKey(prefix: 'bfa' | 'clk' | 'clu' | 'bfk' | 'bfai' | 'whsec' | 'bfq' | 'bff'): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex   = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}

// ---------------------------------------------------------------------------
// PBKDF2 password hashing (for web / marketplace users)
// ---------------------------------------------------------------------------

const ITERATIONS = 100_000;
const HASH_ALG   = 'SHA-256';
const KEY_LEN    = 256; // bits

/**
 * Hash a plaintext password with PBKDF2.
 * Returns `<saltHex>:<derivedKeyHex>` (safe to store in the DB).
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: HASH_ALG },
    keyMaterial,
    KEY_LEN,
  );

  const toHex = (buf: Uint8Array) =>
    Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');

  return `${toHex(salt)}:${toHex(new Uint8Array(derived))}`;
}

/**
 * Verify a plaintext password against a stored PBKDF2 hash.
 */
export async function verifyPassword(
  password: string,
  stored:   string,
): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;

  const fromHex = (hex: string) =>
    new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));

  const salt = fromHex(saltHex);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: HASH_ALG },
    keyMaterial,
    KEY_LEN,
  );

  const derivedHex = Array.from(new Uint8Array(derived))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return derivedHex === hashHex;
}
