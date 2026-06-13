/**
 * AES-256-GCM credential encryption (Web Crypto — runs in Cloudflare Workers).
 *
 * The single source of truth for sealing/unsealing the `{ accessToken,
 * refreshToken?, apiToken? }` blob stored in integration_credentials.credentials_enc.
 * Extracted from integrationRoutes so every consumer (the integrations CRUD, the
 * Google Calendar sync, future providers) derives the key and the salt identically
 * — a drift here would make stored credentials undecryptable.
 */

const SALT = 'builderforce-integrations';

/** Derive an AES-256 key from a passphrase using PBKDF2 (fixed salt + iterations). */
async function deriveKey(passphrase: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(SALT), iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt a credential blob → base64 ciphertext + hex IV. */
export async function encryptCredentials(data: Record<string, unknown>, secret: string): Promise<{ enc: string; iv: string }> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data)));
  return {
    enc: btoa(String.fromCharCode(...new Uint8Array(enc))),
    iv: Array.from(iv).map((b) => b.toString(16).padStart(2, '0')).join(''),
  };
}

/** Decrypt a stored credential blob, or null on any failure (bad key / tampered). */
export async function decryptCredentials(encB64: string, ivHex: string, secret: string): Promise<Record<string, unknown> | null> {
  try {
    const key = await deriveKey(secret);
    const iv = new Uint8Array(ivHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
    const dec = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      Uint8Array.from(atob(encB64), (c) => c.charCodeAt(0)),
    );
    return JSON.parse(new TextDecoder().decode(dec));
  } catch {
    return null;
  }
}
