/**
 * Crypto utilities using the Web Crypto API (SubtleCrypto).
 *
 * These work natively in Cloudflare Workers without any npm dependencies.
 */

import { bytesToHex, hexToBytes, randomHex } from '../../domain/shared/bytes';
import { sha256Hex } from '../../domain/shared/hash';
import { timingSafeEqual } from '../crypto/constantTime';

/** SHA-256 hex digest of a string – used to store API keys. */
export function hashSecret(value: string): Promise<string> {
  return sha256Hex(value);
}

/** Constant-time comparison of a plaintext secret against a stored SHA-256 hex hash. */
export async function verifySecret(value: string, storedHash: string): Promise<boolean> {
  return timingSafeEqual(await hashSecret(value), storedHash);
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
 *   - `bfai` — RETIRED (migration 0472). Was the developer API key for the public
 *             read-only API, on a `developer_api_keys` table that no longer exists.
 *             Issued keys were copied into `tenant_api_keys` with their hash intact
 *             and still AUTHENTICATE; the prefix is simply never minted again,
 *             because a developer is a tenant and mints a `bfk_*`. Not in the union
 *             below: a prefix nothing can issue is not a parameter.
 *   - `whsec` — Outbound-webhook signing secret (`webhook_subscriptions.secret`)
 *   - `bfq` — Quality error-ingest key, per source (`error_sources.key_hash`)
 *   - `bff` — Product Feedback ingest key, per project collector (`feedback_collectors.key_hash`)
 *   - `bfx` — xAPI LRS Basic credential, both halves (`connections.external_account`
 *             for the public key, `credentials` for the sealed secret)
 */
export function generateApiKey(prefix: 'bfa' | 'clk' | 'clu' | 'bfk' | 'whsec' | 'bfq' | 'bff' | 'bfx'): string {
  return `${prefix}_${randomHex(16)}`;
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

  return `${bytesToHex(salt)}:${bytesToHex(derived)}`;
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

  const salt = hexToBytes(saltHex);

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

  return timingSafeEqual(bytesToHex(derived), hashHex);
}
