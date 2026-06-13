/**
 * Web Push (RFC 8030 / 8291 / 8292) for Cloudflare Workers — no Node deps.
 *
 * The standard `web-push` npm package relies on Node's crypto/https and does not
 * run on Workers, so this hand-rolls the two pieces a push send needs, both on
 * the Web Crypto API (`crypto.subtle`, available in the Workers runtime):
 *
 *   1. VAPID auth (RFC 8292): an ES256-signed JWT identifying us to the push
 *      service, sent as `Authorization: vapid t=<jwt>, k=<public key>`.
 *   2. Payload encryption (RFC 8291, "aes128gcm" content encoding from RFC 8188):
 *      ECDH(server-ephemeral, client-public) → HKDF → AES-128-GCM over a single
 *      record. The body is `salt || rs || idlen || server_public || ciphertext`.
 *
 * Generate the VAPID keypair once with `node api/scripts/gen-vapid-keys.mjs`.
 */

export interface WebPushSubscription {
  endpoint: string;
  /** Client public key (base64url, uncompressed P-256 point, 65 bytes). */
  p256dh: string;
  /** Client auth secret (base64url, 16 bytes). */
  auth: string;
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

// ---------------------------------------------------------------------------
// base64url + byte helpers
// ---------------------------------------------------------------------------

function bytesToB64url(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

/** HKDF (extract + expand in one call — exactly the two-stage derivation RFC 8291 wants). */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

// ---------------------------------------------------------------------------
// VAPID JWT (ES256)
// ---------------------------------------------------------------------------

async function importVapidSigningKey(publicKeyB64: string, privateKeyB64: string): Promise<CryptoKey> {
  const pub = b64urlToBytes(publicKeyB64); // 0x04 || x(32) || y(32)
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    d: privateKeyB64,
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
    ext: true,
    key_ops: ['sign'],
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

async function buildVapidJwt(audience: string, subject: string, signingKey: CryptoKey): Promise<string> {
  const header = bytesToB64url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60; // push services cap VAPID exp at 24h
  const payload = bytesToB64url(utf8(JSON.stringify({ aud: audience, exp, sub: subject })));
  const signingInput = `${header}.${payload}`;
  // subtle ECDSA returns the raw (r||s) IEEE-P1363 signature ES256 expects.
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, utf8(signingInput));
  return `${signingInput}.${bytesToB64url(sig)}`;
}

// ---------------------------------------------------------------------------
// Payload encryption (aes128gcm, single record)
// ---------------------------------------------------------------------------

async function encryptPayload(payload: Uint8Array, p256dhB64: string, authB64: string): Promise<Uint8Array> {
  const clientPublic = b64urlToBytes(p256dhB64); // 65 bytes
  const authSecret = b64urlToBytes(authB64);     // 16 bytes

  // Per-message ephemeral server keypair.
  const serverKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const serverPublic = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey)); // 65 bytes

  const clientKey = await crypto.subtle.importKey('raw', clientPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, serverKeys.privateKey, 256),
  );

  // IKM = HKDF(salt=authSecret, ikm=ecdh, info="WebPush: info\0" || client || server)
  const keyInfo = concat(utf8('WebPush: info'), new Uint8Array([0]), clientPublic, serverPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, concat(utf8('Content-Encoding: aes128gcm'), new Uint8Array([0])), 16);
  const nonce = await hkdf(salt, ikm, concat(utf8('Content-Encoding: nonce'), new Uint8Array([0])), 12);

  // Single record: payload || 0x02 delimiter (0x02 = last record, no further padding).
  const record = concat(payload, new Uint8Array([0x02]));
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, record),
  );

  // Header: salt(16) || rs(4, big-endian) || idlen(1) || keyid(server public, 65)
  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + serverPublic.length);
  header.set(salt, 0);
  header[16] = (rs >>> 24) & 0xff;
  header[17] = (rs >>> 16) & 0xff;
  header[18] = (rs >>> 8) & 0xff;
  header[19] = rs & 0xff;
  header[20] = serverPublic.length; // 65
  header.set(serverPublic, 21);

  return concat(header, ciphertext);
}

// ---------------------------------------------------------------------------
// Public send
// ---------------------------------------------------------------------------

/**
 * Send one Web Push. Returns the push service's HTTP status:
 *   201/202 → delivered to the push service
 *   404/410 → subscription is gone; caller should delete the row
 *   others  → transient/error (caller may log)
 * Never throws on a network/encryption error — returns 0 so a bad row can't
 * abort a fan-out.
 */
export async function sendWebPush(
  sub: WebPushSubscription,
  payload: Record<string, unknown>,
  vapid: VapidKeys,
): Promise<number> {
  try {
    const audience = new URL(sub.endpoint).origin;
    const signingKey = await importVapidSigningKey(vapid.publicKey, vapid.privateKey);
    const jwt = await buildVapidJwt(audience, vapid.subject, signingKey);
    const body = await encryptPayload(utf8(JSON.stringify(payload)), sub.p256dh, sub.auth);

    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '2419200', // 28 days — hold until the device next reconnects
        Urgency: 'normal',
      },
      body,
    });
    return res.status;
  } catch {
    return 0;
  }
}
