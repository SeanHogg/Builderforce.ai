/**
 * WebAuthn / passkey primitives — CBOR, COSE and the two assertions that matter.
 *
 * ── WHY THIS IS HAND-ROLLED ──────────────────────────────────────────────────
 * The API runs on Workers, where the whole of WebAuthn verification is already
 * available through WebCrypto: ECDSA P-256 and RSASSA-PKCS1-v1_5 imports and
 * `crypto.subtle.verify`. What WebCrypto does NOT give you is the two container
 * formats the browser hands back — a CBOR `attestationObject` and a COSE_Key
 * inside its authenticator data. Those are a few hundred bytes of well-specified
 * parsing, so this module implements exactly the subset the spec requires and
 * nothing more, rather than pulling a dependency into the Worker bundle.
 *
 * ── WHAT IS DELIBERATELY NOT DONE ────────────────────────────────────────────
 * Attestation STATEMENTS are not verified. A passkey (a discoverable, synced
 * credential) is registered with `attestation: 'none'` by every mainstream
 * platform authenticator, and the statement carries no trust signal we could act
 * on without an FIDO metadata service. We parse the attested credential data out
 * of the attestation object — the credential id and its public key — and verify
 * everything that is actually load-bearing: the RP id hash, the user-presence
 * flag, the challenge binding through clientDataJSON, the origin, and (for an
 * assertion) the signature itself. That is the same posture as `attestation:
 * 'none'`, stated rather than implied.
 *
 * Layer note: this is infrastructure (it speaks WebCrypto and byte formats). The
 * use case — what a challenge means, when a credential may be used, what a sign
 * count regression implies — lives in `application/auth/PasskeyService.ts`.
 */

import { base64UrlToBytes, bytesToBase64Url } from './jws';

export { base64UrlToBytes, bytesToBase64Url };

/** Authenticator data flag bits (WebAuthn L2 §6.1). */
const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_BACKUP_ELIGIBLE = 0x08;
const FLAG_BACKED_UP = 0x10;
const FLAG_ATTESTED_CREDENTIAL_DATA = 0x40;

/** COSE algorithm identifiers we accept. Everything else is refused at register. */
export const COSE_ALG_ES256 = -7;
export const COSE_ALG_RS256 = -257;
export const SUPPORTED_COSE_ALGORITHMS = [COSE_ALG_ES256, COSE_ALG_RS256] as const;

export type CoseAlgorithm = (typeof SUPPORTED_COSE_ALGORITHMS)[number];

export interface ParsedAuthenticatorData {
  rpIdHash: Uint8Array;
  flags: number;
  userPresent: boolean;
  userVerified: boolean;
  backupEligible: boolean;
  backedUp: boolean;
  signCount: number;
  aaguid: string | null;
  credentialId: Uint8Array | null;
  /** The raw COSE_Key bytes for the credential public key, when present. */
  credentialPublicKey: Uint8Array | null;
}

export interface ParsedClientData {
  type: string;
  challenge: string;
  origin: string;
  crossOrigin?: boolean;
}

// ---------------------------------------------------------------------------
// CBOR — the canonical subset RFC 8949 permits in WebAuthn structures
// ---------------------------------------------------------------------------

interface CborCursor { readonly bytes: Uint8Array; offset: number }

export type CborValue =
  | number
  | bigint
  | string
  | Uint8Array
  | boolean
  | null
  | CborValue[]
  | Map<CborValue, CborValue>;

/** Read one byte, refusing to read past the end rather than silently yielding NaN. */
function byteAt(bytes: Uint8Array, index: number): number {
  const value = bytes[index];
  if (value === undefined) throw new Error('CBOR input truncated');
  return value;
}

function readUint(cursor: CborCursor, length: number): number {
  let value = 0;
  for (let i = 0; i < length; i += 1) {
    value = value * 256 + byteAt(cursor.bytes, cursor.offset + i);
  }
  cursor.offset += length;
  return value;
}

/** Argument decoding shared by every major type: the low 5 bits, or a follow-on integer. */
function readArgument(cursor: CborCursor, info: number): number {
  if (info < 24) return info;
  if (info === 24) return readUint(cursor, 1);
  if (info === 25) return readUint(cursor, 2);
  if (info === 26) return readUint(cursor, 4);
  if (info === 27) {
    // 64-bit. WebAuthn structures never legitimately exceed 2^53 here (they are
    // lengths and sign counts), so a Number is exact for every real value and a
    // value that is not is a malformed input rather than something to support.
    const value = readUint(cursor, 8);
    if (!Number.isSafeInteger(value)) throw new Error('CBOR integer out of range');
    return value;
  }
  throw new Error(`Unsupported CBOR additional info ${info}`);
}

function decodeItem(cursor: CborCursor): CborValue {
  const initial = byteAt(cursor.bytes, cursor.offset);
  cursor.offset += 1;
  const majorType = initial >> 5;
  const info = initial & 0x1f;

  switch (majorType) {
    case 0: // unsigned integer
      return readArgument(cursor, info);
    case 1: // negative integer
      return -1 - readArgument(cursor, info);
    case 2: { // byte string
      const length = readArgument(cursor, info);
      const slice = cursor.bytes.subarray(cursor.offset, cursor.offset + length);
      if (slice.length !== length) throw new Error('CBOR byte string truncated');
      cursor.offset += length;
      return slice;
    }
    case 3: { // text string
      const length = readArgument(cursor, info);
      const slice = cursor.bytes.subarray(cursor.offset, cursor.offset + length);
      if (slice.length !== length) throw new Error('CBOR text string truncated');
      cursor.offset += length;
      return new TextDecoder().decode(slice);
    }
    case 4: { // array
      const length = readArgument(cursor, info);
      const items: CborValue[] = [];
      for (let i = 0; i < length; i += 1) items.push(decodeItem(cursor));
      return items;
    }
    case 5: { // map
      const length = readArgument(cursor, info);
      const map = new Map<CborValue, CborValue>();
      for (let i = 0; i < length; i += 1) {
        const key = decodeItem(cursor);
        map.set(key, decodeItem(cursor));
      }
      return map;
    }
    case 7: // simple values
      if (info === 20) return false;
      if (info === 21) return true;
      if (info === 22) return null;
      if (info === 23) return null; // undefined — WebAuthn never depends on the distinction
      throw new Error(`Unsupported CBOR simple value ${info}`);
    default:
      throw new Error(`Unsupported CBOR major type ${majorType}`);
  }
}

/**
 * Decode ONE CBOR item and report where it ended. WebAuthn's attestation object is
 * a single map that may be followed by trailing bytes in some authenticators, so the
 * caller needs the end offset rather than a strict whole-buffer parse.
 */
export function decodeCbor(bytes: Uint8Array): { value: CborValue; bytesRead: number } {
  const cursor: CborCursor = { bytes, offset: 0 };
  const value = decodeItem(cursor);
  return { value, bytesRead: cursor.offset };
}

// ---------------------------------------------------------------------------
// Authenticator data
// ---------------------------------------------------------------------------

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** aaguid is conventionally rendered as a UUID; the raw form is 16 opaque bytes. */
function formatAaguid(bytes: Uint8Array): string {
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function parseAuthenticatorData(bytes: Uint8Array): ParsedAuthenticatorData {
  if (bytes.length < 37) throw new Error('Authenticator data is too short');
  const rpIdHash = bytes.subarray(0, 32);
  const flags = bytes[32] ?? 0;
  const signCount = new DataView(bytes.buffer, bytes.byteOffset + 33, 4).getUint32(0, false);

  const parsed: ParsedAuthenticatorData = {
    rpIdHash,
    flags,
    userPresent: (flags & FLAG_USER_PRESENT) !== 0,
    userVerified: (flags & FLAG_USER_VERIFIED) !== 0,
    backupEligible: (flags & FLAG_BACKUP_ELIGIBLE) !== 0,
    backedUp: (flags & FLAG_BACKED_UP) !== 0,
    signCount,
    aaguid: null,
    credentialId: null,
    credentialPublicKey: null,
  };

  if ((flags & FLAG_ATTESTED_CREDENTIAL_DATA) === 0) return parsed;

  if (bytes.length < 55) throw new Error('Attested credential data is truncated');
  const aaguid = bytes.subarray(37, 53);
  const credentialIdLength = new DataView(bytes.buffer, bytes.byteOffset + 53, 2).getUint16(0, false);
  const credentialIdEnd = 55 + credentialIdLength;
  if (bytes.length < credentialIdEnd) throw new Error('Credential id is truncated');

  const credentialId = bytes.subarray(55, credentialIdEnd);
  const remainder = bytes.subarray(credentialIdEnd);
  // The COSE key is the next CBOR item; extension data (if any) follows it, so we
  // take exactly as many bytes as the decoder consumed rather than the whole tail.
  const { bytesRead } = decodeCbor(remainder);

  parsed.aaguid = formatAaguid(aaguid);
  parsed.credentialId = credentialId;
  parsed.credentialPublicKey = remainder.subarray(0, bytesRead);
  return parsed;
}

// ---------------------------------------------------------------------------
// COSE_Key → CryptoKey
// ---------------------------------------------------------------------------

function coseInt(map: Map<CborValue, CborValue>, label: number): number | undefined {
  const value = map.get(label);
  return typeof value === 'number' ? value : undefined;
}

function coseBytes(map: Map<CborValue, CborValue>, label: number): Uint8Array | undefined {
  const value = map.get(label);
  return value instanceof Uint8Array ? value : undefined;
}

export function coseAlgorithmOf(coseKey: Uint8Array): number {
  const { value } = decodeCbor(coseKey);
  if (!(value instanceof Map)) throw new Error('COSE key is not a map');
  const alg = coseInt(value, 3);
  if (alg === undefined) throw new Error('COSE key has no algorithm');
  return alg;
}

/**
 * Import a stored COSE_Key as a verification key. ES256 keys arrive as raw EC
 * coordinates (JWK is the shortest correct route) and RS256 keys as a modulus and
 * exponent (likewise), so both go through JWK rather than DER assembly.
 */
export async function importCosePublicKey(coseKey: Uint8Array): Promise<{ key: CryptoKey; algorithm: number }> {
  const { value } = decodeCbor(coseKey);
  if (!(value instanceof Map)) throw new Error('COSE key is not a map');

  const kty = coseInt(value, 1);
  const alg = coseInt(value, 3);
  if (alg === undefined) throw new Error('COSE key has no algorithm');

  if (alg === COSE_ALG_ES256) {
    if (kty !== 2) throw new Error('ES256 COSE key must be EC2');
    const crv = coseInt(value, -1);
    if (crv !== 1) throw new Error('ES256 COSE key must be on P-256');
    const x = coseBytes(value, -2);
    const y = coseBytes(value, -3);
    if (!x || !y) throw new Error('ES256 COSE key is missing a coordinate');
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', x: bytesToBase64Url(x), y: bytesToBase64Url(y), ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    return { key, algorithm: alg };
  }

  if (alg === COSE_ALG_RS256) {
    if (kty !== 3) throw new Error('RS256 COSE key must be RSA');
    const n = coseBytes(value, -1);
    const e = coseBytes(value, -2);
    if (!n || !e) throw new Error('RS256 COSE key is missing a parameter');
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: bytesToBase64Url(n), e: bytesToBase64Url(e), ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    return { key, algorithm: alg };
  }

  throw new Error(`Unsupported COSE algorithm ${alg}`);
}

/**
 * ECDSA signatures arrive DER-encoded from the authenticator and WebCrypto wants
 * the raw r‖s pair. RSA signatures are already raw.
 */
function derToRawEcdsaSignature(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new Error('ECDSA signature is not a DER sequence');
  const sequenceLength = byteAt(der, 1);
  let offset = (sequenceLength & 0x80) ? 2 + (sequenceLength & 0x7f) : 2;

  const readInteger = (): Uint8Array => {
    if (der[offset] !== 0x02) throw new Error('ECDSA signature component is not a DER integer');
    const length = byteAt(der, offset + 1);
    const start = offset + 2;
    offset = start + length;
    let value = der.subarray(start, start + length);
    // Strip the leading zero DER adds to keep a high bit from reading as negative,
    // then left-pad to the fixed 32-byte field width WebCrypto expects.
    while (value.length > 32 && value[0] === 0x00) value = value.subarray(1);
    if (value.length > 32) throw new Error('ECDSA signature component is too long');
    const padded = new Uint8Array(32);
    padded.set(value, 32 - value.length);
    return padded;
  };

  const r = readInteger();
  const s = readInteger();
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

export async function verifyWebAuthnSignature(input: {
  coseKey: Uint8Array;
  signature: Uint8Array;
  authenticatorData: Uint8Array;
  clientDataJson: Uint8Array;
}): Promise<boolean> {
  const { key, algorithm } = await importCosePublicKey(input.coseKey);
  const clientDataHash = new Uint8Array(await crypto.subtle.digest('SHA-256', input.clientDataJson));
  const signedPayload = new Uint8Array(input.authenticatorData.length + clientDataHash.length);
  signedPayload.set(input.authenticatorData, 0);
  signedPayload.set(clientDataHash, input.authenticatorData.length);

  if (algorithm === COSE_ALG_ES256) {
    const raw = derToRawEcdsaSignature(input.signature);
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, raw, signedPayload);
  }
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, input.signature, signedPayload);
}

// ---------------------------------------------------------------------------
// clientDataJSON and the RP binding
// ---------------------------------------------------------------------------

export function parseClientData(bytes: Uint8Array): ParsedClientData {
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<ParsedClientData>;
  if (typeof parsed.type !== 'string' || typeof parsed.challenge !== 'string' || typeof parsed.origin !== 'string') {
    throw new Error('clientDataJSON is missing a required member');
  }
  return { type: parsed.type, challenge: parsed.challenge, origin: parsed.origin, crossOrigin: parsed.crossOrigin };
}

export async function rpIdHash(rpId: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rpId)));
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/**
 * The registrable domain a passkey is scoped to, derived from the app's own base
 * URL. A passkey minted for `app.example.com` cannot be asserted anywhere else, so
 * this is the one value that must agree between the browser call and the server.
 */
export function rpIdFromOrigin(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

/** Pull the attested credential out of a registration's attestation object. */
export function parseAttestationObject(bytes: Uint8Array): {
  format: string;
  authenticatorData: ParsedAuthenticatorData;
  rawAuthenticatorData: Uint8Array;
} {
  const { value } = decodeCbor(bytes);
  if (!(value instanceof Map)) throw new Error('attestationObject is not a map');
  const format = value.get('fmt');
  const authData = value.get('authData');
  if (!(authData instanceof Uint8Array)) throw new Error('attestationObject has no authData');
  return {
    format: typeof format === 'string' ? format : 'unknown',
    authenticatorData: parseAuthenticatorData(authData),
    rawAuthenticatorData: authData,
  };
}
