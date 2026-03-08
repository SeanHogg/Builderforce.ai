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

/** Generates a new random API key in the format `clk_<32 hex chars>`. */
export function generateApiKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex   = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `clk_${hex}`;
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
