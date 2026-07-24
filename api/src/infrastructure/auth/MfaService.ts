import { hashSecret } from './HashService';
import { deriveTenantAesKey } from '../../application/integrations/credentialCrypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Ciphertext version marker for the HARDENED sealing scheme. A stored blob that
 * begins with `v2:` was sealed with PBKDF2 (100k, per-tenant salt) under a dedicated
 * encryption secret (see {@link deriveTenantAesKey}); anything WITHOUT this prefix is a
 * pre-versioning legacy blob sealed with a single unsalted SHA-256 of the caller's key
 * material (the old {@link deriveAesKey}). The legacy container is `b64(iv).b64(cipher)`,
 * and base64 never contains a `:`, so this prefix is an unambiguous discriminator.
 */
const V2_PREFIX = 'v2:';

function b64(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data));
}

function fromB64(input: string): Uint8Array {
  return Uint8Array.from(atob(input), (c) => c.charCodeAt(0));
}

function bytesToHex(data: Uint8Array): string {
  return Array.from(data).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (!clean || clean.length % 2 !== 0) return new Uint8Array();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    out[i / 2] = Number.parseInt(clean.slice(i, i + 2), 16);
  }
  return out;
}

function base32Encode(data: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0b11111];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0b11111];
  }

  return output;
}

function base32Decode(input: string): Uint8Array {
  const normalized = input.toUpperCase().replace(/=+$/g, '').replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (const char of normalized) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return new Uint8Array(out);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function deriveAesKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export function generateTotpSecret(bytes = 20): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return base32Encode(raw);
}

export function buildOtpAuthUrl(opts: {
  accountName: string;
  secret: string;
  issuer?: string;
  digits?: number;
  period?: number;
}): string {
  const issuer = opts.issuer ?? 'BuilderForce Link';
  const digits = opts.digits ?? 6;
  const period = opts.period ?? 30;
  const label = `${issuer}:${opts.accountName}`;
  const query = new URLSearchParams({
    secret: opts.secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(digits),
    period: String(period),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${query.toString()}`;
}

export async function generateTotpCode(
  secret: string,
  timestampMs: number = Date.now(),
  digits = 6,
  periodSeconds = 30,
): Promise<string> {
  const keyBytes = base32Decode(secret);
  const counter = Math.floor(timestampMs / (periodSeconds * 1000));
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);

  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', key, buffer));

  const offset = hmac[hmac.length - 1]! & 0x0f;
  const codeInt =
    ((hmac[offset]! & 0x7f) << 24)
    | ((hmac[offset + 1]! & 0xff) << 16)
    | ((hmac[offset + 2]! & 0xff) << 8)
    | (hmac[offset + 3]! & 0xff);

  return String(codeInt % 10 ** digits).padStart(digits, '0');
}

export async function verifyTotpCode(
  secret: string,
  code: string,
  window = 1,
): Promise<boolean> {
  const normalized = code.replace(/\s+/g, '').replace(/[^0-9]/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;

  const now = Date.now();
  for (let skew = -window; skew <= window; skew++) {
    const generated = await generateTotpCode(secret, now + skew * 30_000);
    if (constantTimeEqual(generated, normalized)) return true;
  }
  return false;
}

export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    const hex = bytesToHex(bytes).toUpperCase();
    codes.push(`${hex.slice(0, 4)}-${hex.slice(4, 8)}`);
  }
  return codes;
}

export async function hashRecoveryCode(code: string): Promise<string> {
  return hashSecret(normalizeRecoveryCode(code));
}

export function normalizeRecoveryCode(code: string): string {
  const sanitized = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (sanitized.length !== 8) return sanitized;
  return `${sanitized.slice(0, 4)}-${sanitized.slice(4, 8)}`;
}

/**
 * Options that opt a call into the HARDENED (v2) sealing scheme and thread the
 * secrets/tenant binding it needs. Omit entirely for the legacy 2-arg behavior
 * (kept byte-for-byte identical so un-migrated call sites are untouched).
 */
export interface SecretStorageOptions {
  /**
   * Tenant id folded into the PBKDF2 salt so a tenant's ciphertext can never be
   * unsealed with another tenant's derived key (fixes ciphertext portability).
   * Presence of `tenantId` (or `upgrade`) is what makes a WRITE emit a `v2:` blob.
   */
  tenantId?: number;
  /**
   * Force the v2 scheme with NO per-tenant binding (global-salt, dedicated-secret)
   * for stores that have no natural tenant scope but still want off-JWT_SECRET keys.
   */
  upgrade?: boolean;
  /**
   * Key material for reading PRE-v2 (legacy) rows when those rows were sealed under a
   * DIFFERENT secret than the `keyMaterial` now used for v2 writes — e.g. tenant LLM
   * provider keys historically sealed with JWT_SECRET but now written under the
   * dedicated CREDENTIAL_ENCRYPTION_SECRET. When omitted, `keyMaterial` itself is the
   * legacy fallback (correct for callers whose secret hasn't changed).
   */
  legacySecret?: string;
}

/**
 * Seal a secret for at-rest storage.
 *
 * • With `opts.tenantId` (or `opts.upgrade`): the HARDENED v2 scheme — PBKDF2 (100k)
 *   with a per-tenant salt, under the caller-supplied dedicated `keyMaterial`. Output
 *   is `v2:<b64(iv)>.<b64(cipher)>`. Reusing {@link deriveTenantAesKey} means there is
 *   no third crypto scheme — it is the same KDF as credentialCrypto.
 * • Without `opts` (legacy 2-arg calls): the original single unsalted SHA-256 scheme,
 *   output `<b64(iv)>.<b64(cipher)>` — UNCHANGED, so callers not yet migrated keep
 *   producing (and, via the dual-read below, reading) the exact same format.
 */
export async function encryptSecretForStorage(
  secret: string,
  keyMaterial: string,
  opts?: SecretStorageOptions,
): Promise<string> {
  const useV2 = !!opts && (opts.tenantId != null || opts.upgrade === true);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(secret);
  const key = useV2 ? await deriveTenantAesKey(keyMaterial, opts!.tenantId) : await deriveAesKey(keyMaterial);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain),
  );
  const blob = `${b64(iv)}.${b64(cipher)}`;
  return useV2 ? `${V2_PREFIX}${blob}` : blob;
}

/**
 * Unseal an at-rest secret — VERSIONED DUAL-READ.
 *
 * This is the backward-compatibility hinge: existing rows were sealed with the old
 * single-SHA scheme and MUST keep opening while new writes upgrade in place (a lazy,
 * non-destructive migration — rows re-seal as v2 only on their next WRITE, never via a
 * bulk SQL re-encrypt, which is impossible since we can't decrypt in SQL).
 *
 *   • `v2:` prefix → hardened path: PBKDF2 + per-tenant salt via {@link deriveTenantAesKey}
 *     under the dedicated `keyMaterial` (+ `opts.tenantId` for the per-tenant binding).
 *   • no prefix    → legacy path: single unsalted SHA-256 of `opts.legacySecret ?? keyMaterial`.
 *     The fallback to `keyMaterial` means callers whose secret never changed still open
 *     their old rows; callers that moved to a dedicated secret pass the old JWT_SECRET as
 *     `legacySecret` so their pre-migration rows keep decrypting.
 */
export async function decryptSecretFromStorage(
  payload: string,
  keyMaterial: string,
  opts?: SecretStorageOptions,
): Promise<string> {
  const isV2 = payload.startsWith(V2_PREFIX);
  const body = isV2 ? payload.slice(V2_PREFIX.length) : payload;
  const [ivB64, cipherB64] = body.split('.');
  if (!ivB64 || !cipherB64) throw new Error('Malformed encrypted payload');

  const iv = fromB64(ivB64);
  const cipher = fromB64(cipherB64);
  const key = isV2
    ? await deriveTenantAesKey(keyMaterial, opts?.tenantId)
    : await deriveAesKey(opts?.legacySecret ?? keyMaterial);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return new TextDecoder().decode(plain);
}

export function parseTokenTimeToDate(unixSeconds: number): Date {
  return new Date(unixSeconds * 1000);
}

export function secretFromHex(hex: string): string {
  return base32Encode(hexToBytes(hex));
}
