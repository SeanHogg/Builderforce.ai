/**
 * The voice-clip provenance manifest — what the server signs for every
 * synthesized clip, and the one serialisation that signature covers.
 *
 * Signing happens server-side only (HMAC under a server secret, in the api's
 * `issueVoiceProvenance`); this module holds nothing secret. It declares the
 * shape and the CANONICAL JSON, because a signature is only as good as the
 * agreement on which bytes were signed: the issuer and the verifier both build
 * their input here, so they cannot disagree on key order or whitespace.
 */

export const VOICE_PROVENANCE_VERSION = 1 as const;

export interface VoiceProvenanceManifest {
  v: typeof VOICE_PROVENANCE_VERSION;
  /** The provenance row's id (uuid) — the clip's stable identity. */
  clipId: string;
  cloneId: number;
  /** The user who generated the clip. Null only when the session carried none. */
  ownerUserId: string | null;
  /** The tenant the clip was generated under (a licensee, for a licensed voice). */
  tenantId: number;
  /** The consent text version the clone's attestation was made under. */
  consentTextVersion: string;
  /** Which backend produced the audio: 'clone-server' | 'clone-client'. */
  engine: string;
  /** The model/provider behind that backend (e.g. the clone's `provider`). */
  model: string;
  /** ISO-8601 issue time. */
  createdAt: string;
  /** sha256 hex of the clip's PCM16 sample bytes AFTER watermarking. */
  audioSha256: string;
  /** The 64-bit watermark id (16 lowercase hex chars) embedded in the audio. */
  watermarkId: string;
}

export interface SignedVoiceProvenance {
  manifest: VoiceProvenanceManifest;
  /** base64url HMAC-SHA-256 over {@link provenanceSigningInput}. */
  signature: string;
}

const SIGNING_DOMAIN = 'bf-voice-provenance/v1';

/** Canonical JSON: fixed key order, no whitespace. */
export function canonicalManifestJson(m: VoiceProvenanceManifest): string {
  return JSON.stringify({
    v: m.v,
    clipId: m.clipId,
    cloneId: m.cloneId,
    ownerUserId: m.ownerUserId,
    tenantId: m.tenantId,
    consentTextVersion: m.consentTextVersion,
    engine: m.engine,
    model: m.model,
    createdAt: m.createdAt,
    audioSha256: m.audioSha256,
    watermarkId: m.watermarkId,
  });
}

/** The exact string the MAC covers — domain-separated so the same secret can
 *  never produce a signature valid in another context. */
export function provenanceSigningInput(m: VoiceProvenanceManifest): string {
  return `${SIGNING_DOMAIN}\n${canonicalManifestJson(m)}`;
}

export const SHA256_HEX = /^[0-9a-f]{64}$/;
export const WATERMARK_ID_HEX = /^[0-9a-f]{16}$/;

/** Narrow untrusted input to a manifest, or null when any field is off. */
export function parseVoiceProvenanceManifest(input: unknown): VoiceProvenanceManifest | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const str = (k: string): string | null => (typeof o[k] === 'string' ? (o[k] as string) : null);
  const int = (k: string): number | null =>
    typeof o[k] === 'number' && Number.isInteger(o[k]) ? (o[k] as number) : null;

  const clipId = str('clipId');
  const consentTextVersion = str('consentTextVersion');
  const engine = str('engine');
  const model = str('model');
  const createdAt = str('createdAt');
  const audioSha256 = str('audioSha256');
  const watermarkId = str('watermarkId');
  const cloneId = int('cloneId');
  const tenantId = int('tenantId');
  const owner = o.ownerUserId;
  if (o.v !== VOICE_PROVENANCE_VERSION) return null;
  if (owner !== null && typeof owner !== 'string') return null;
  if (
    clipId === null || consentTextVersion === null || engine === null || model === null ||
    createdAt === null || audioSha256 === null || watermarkId === null ||
    cloneId === null || tenantId === null
  ) return null;
  if (!SHA256_HEX.test(audioSha256) || !WATERMARK_ID_HEX.test(watermarkId)) return null;
  return {
    v: VOICE_PROVENANCE_VERSION,
    clipId,
    cloneId,
    ownerUserId: owner,
    tenantId,
    consentTextVersion,
    engine,
    model,
    createdAt,
    audioSha256,
    watermarkId,
  };
}
