/**
 * AES-256-GCM credential encryption (Web Crypto — runs in Cloudflare Workers).
 *
 * The single source of truth for sealing/unsealing the `{ accessToken,
 * refreshToken?, apiToken? }` blob stored in integration_credentials.credentials_enc.
 * Extracted from integrationRoutes so every consumer (the integrations CRUD, the
 * Google Calendar sync, future providers) derives the key and the salt identically
 * — a drift here would make stored credentials undecryptable.
 *
 * Key derivation is PER TENANT. The base secret (INTEGRATION_ENCRYPTION_SECRET,
 * falling back to JWT_SECRET) is combined with the tenant id in the PBKDF2 salt so
 * one tenant's derived key can never unseal another tenant's ciphertext, even
 * though every row shares one base secret. The salt is `${SALT_BASE}:${tenantId}`.
 *
 * Backward compatibility: rows written BEFORE per-tenant derivation were sealed
 * with the fixed global salt (`SALT_BASE`, no tenant). A version marker is now
 * prefixed to the stored ciphertext:
 *   • no marker / `v1:` → legacy GLOBAL-salt blob   → decrypt with the global key.
 *   • `v2:`             → per-tenant blob           → decrypt with the tenant key.
 * encrypt() always writes `v2:` (per-tenant); decrypt() reads both. A tenantId is
 * required to write/read v2; legacy v1 blobs still decrypt with no tenantId so old
 * rows keep working unchanged.
 */

import type { Env } from '../../env';

/**
 * Canonical resolution order for the at-rest credential-encryption BASE secret.
 * The dedicated `CREDENTIAL_ENCRYPTION_SECRET` is preferred so that a leak of
 * `JWT_SECRET` (the session-signing key) no longer also decrypts stored credentials
 * — see finding M2. `INTEGRATION_ENCRYPTION_SECRET` is the intermediate fallback and
 * `JWT_SECRET` the last-resort legacy fallback (also the value passed as `legacySecret`
 * when reading pre-migration rows). ONE definition so every credential store agrees on
 * which secret seals its data (DRY — was previously copy-pasted per module).
 */
export function credentialSecret(env: Env): string {
  return env.CREDENTIAL_ENCRYPTION_SECRET ?? env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET;
}

/** Fixed PBKDF2 salt base. v1 (legacy) used exactly this; v2 appends `:${tenantId}`. */
const SALT_BASE = 'builderforce-integrations';

/** Ciphertext version marker. Absent prefix is treated as v1 (pre-versioning). */
const V1_PREFIX = 'v1:';
const V2_PREFIX = 'v2:';

/**
 * Derive an AES-256 key from a passphrase using PBKDF2. `salt` is the full salt
 * string — `SALT_BASE` for legacy v1, `${SALT_BASE}:${tenantId}` for per-tenant v2.
 */
async function deriveKey(passphrase: string, salt: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** The legacy global salt (no tenant) used by every pre-versioning v1 row. */
function globalSalt(): string {
  return SALT_BASE;
}

/** The per-tenant salt — folds the tenant id into the KDF so each tenant's
 *  derived key is distinct from every other tenant's under the same base secret. */
function tenantSalt(tenantId: number): string {
  return `${SALT_BASE}:${tenantId}`;
}

/**
 * Shared AES-256-GCM key derivation for OTHER credential stores that keep their
 * own single-string container format (e.g. MfaService's `iv.cipher` blobs for
 * tenant LLM provider keys / OAuth token blobs) but must NOT invent a second KDF.
 *
 * Uses the exact same PBKDF2 (100k, SHA-256) derivation as this module: with a
 * `tenantId` the key is bound to `${SALT_BASE}:${tenantId}` (per-tenant → ciphertext
 * is not portable across tenants); without one it uses the global salt (a dedicated-
 * secret, non-per-tenant key). Callers pass their OWN base secret (e.g. the dedicated
 * CREDENTIAL_ENCRYPTION_SECRET), so a shared salt base never lets keys collide across
 * modules — the secret differs.
 */
export async function deriveTenantAesKey(secret: string, tenantId?: number): Promise<CryptoKey> {
  return deriveKey(secret, tenantId == null ? globalSalt() : tenantSalt(tenantId));
}

/**
 * Encrypt a credential blob → versioned base64 ciphertext + hex IV. Always writes
 * a v2 (per-tenant) blob: the returned `enc` is `v2:<base64>`, sealed with a key
 * derived from the base secret AND `tenantId`, so it can only be decrypted by the
 * same tenant.
 */
export async function encryptCredentials(
  data: Record<string, unknown>,
  secret: string,
  tenantId: number,
): Promise<{ enc: string; iv: string }> {
  const key = await deriveKey(secret, tenantSalt(tenantId));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data)));
  return {
    enc: V2_PREFIX + btoa(String.fromCharCode(...new Uint8Array(enc))),
    iv: Array.from(iv).map((b) => b.toString(16).padStart(2, '0')).join(''),
  };
}

/**
 * Decrypt a stored credential blob, or null on any failure (bad key / tampered).
 *
 * Reads the version marker to pick the salt:
 *   • `v2:` → per-tenant key (requires `tenantId`).
 *   • `v1:` or no prefix (legacy) → global key — old rows written before per-tenant
 *     derivation still decrypt with no tenant context.
 */
export async function decryptCredentials(
  encB64: string,
  ivHex: string,
  secret: string,
  tenantId?: number,
): Promise<Record<string, unknown> | null> {
  try {
    let salt: string;
    let payload: string;
    if (encB64.startsWith(V2_PREFIX)) {
      // Per-tenant: a v2 blob is undecryptable without the owning tenant id, so a
      // missing/foreign tenantId correctly fails (returns null) rather than leaking.
      if (tenantId == null) return null;
      salt = tenantSalt(tenantId);
      payload = encB64.slice(V2_PREFIX.length);
    } else if (encB64.startsWith(V1_PREFIX)) {
      salt = globalSalt();
      payload = encB64.slice(V1_PREFIX.length);
    } else {
      // Pre-versioning legacy row: no prefix, global salt.
      salt = globalSalt();
      payload = encB64;
    }
    const key = await deriveKey(secret, salt);
    const iv = new Uint8Array(ivHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
    const dec = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      Uint8Array.from(atob(payload), (c) => c.charCodeAt(0)),
    );
    return JSON.parse(new TextDecoder().decode(dec));
  } catch {
    return null;
  }
}
