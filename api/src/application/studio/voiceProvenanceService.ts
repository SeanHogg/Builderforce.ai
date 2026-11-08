/**
 * Voice-clip provenance — issue and verify (the use cases; routes and the
 * synthesis spine call these, and nothing here touches a table).
 *
 * `issueVoiceProvenance` is the one door every synthesized clip goes through,
 * server or on-device: it enforces the same access + consent gates as synthesis,
 * builds the manifest, signs it and persists it. `verifyVoiceProvenance*` answer
 * the public question "did this platform make this clip, and under whose
 * consent" — by re-checking the signature, never by trusting a stored flag.
 */

import {
  parseVoiceProvenanceManifest,
  provenanceSigningInput,
  SHA256_HEX,
  VOICE_PROVENANCE_VERSION,
  WATERMARK_ID_HEX,
  type SignedVoiceProvenance,
  type VoiceProvenanceManifest,
} from '@builderforce/voice-provenance';
import { timingSafeEqual } from '../../infrastructure/crypto/constantTime';
import {
  VoiceCloneConsentRequired,
  VoiceCloneForbidden,
  VoiceCloneNotFound,
} from './voiceCloneAccess';

export class VoiceProvenanceInvalid extends Error {
  readonly status = 422;
  constructor(message: string) { super(message); this.name = 'VoiceProvenanceInvalid'; }
}
export class VoiceProvenanceConflict extends Error {
  readonly status = 409;
  constructor() { super('That watermark id or audio is already registered.'); this.name = 'VoiceProvenanceConflict'; }
}
export class VoiceProvenanceUnavailable extends Error {
  readonly status = 503;
  readonly code = 'provenance_unavailable';
  constructor() { super('Voice provenance signing is not configured.'); this.name = 'VoiceProvenanceUnavailable'; }
}

export interface ProvenanceClone {
  id: number;
  tenantId: number;
  userId: string | null;
  consentAttestedAt: Date | null;
  consentTextVersion: string | null;
  /** The voice's current name, snapshotted onto the record at issue time. */
  name?: string;
}

/** A persisted provenance row, as the ports exchange it. */
export interface VoiceProvenanceRecord extends SignedVoiceProvenance {
  tenantId: number;
  /** Null once the voice was deleted: the signed record outlives it. */
  cloneId: number | null;
  /** The voice's name when the clip was made (survives the clone's deletion). */
  voiceName?: string | null;
  voiceoverId: number | null;
  watermarked: boolean;
}

/** The engine tag of a clip whose registration the client reported itself. */
export const CLIENT_REPORTED_ENGINE = 'clone-client';

/**
 * Several registrations can claim one audio hash (a client may report ANY hash). The
 * authoritative one is a SERVER-synthesised registration (the server saw the bytes), and
 * only then the oldest: a self-reported entry registered first can never front-run a
 * server-made one. Used by the real ports on every lookup.
 */
export function pickAuthoritative<T extends { manifest: { engine: string; createdAt: string } }>(records: readonly T[]): T | null {
  let best: T | null = null;
  for (const r of records) {
    if (!best) { best = r; continue; }
    const rClient = r.manifest.engine === CLIENT_REPORTED_ENGINE;
    const bestClient = best.manifest.engine === CLIENT_REPORTED_ENGINE;
    if (rClient !== bestClient) { if (!rClient) best = r; continue; }
    if (r.manifest.createdAt < best.manifest.createdAt) best = r;
  }
  return best;
}

export type ProvenanceLookup =
  | { watermarkId: string }
  | { audioSha256: string }
  | { clipId: string };

export interface VoiceProvenancePorts {
  loadClone(cloneId: number): Promise<ProvenanceClone | null>;
  /** Owner or active licensee — the single access predicate. */
  canUse(clone: ProvenanceClone, tenantId: number): Promise<boolean>;
  /** `duplicate` when the watermark id or voiceover already has a row. */
  insert(record: VoiceProvenanceRecord): Promise<'inserted' | 'duplicate'>;
  find(by: ProvenanceLookup): Promise<VoiceProvenanceRecord | null>;
  /** The clone's display name and visibility, for the public view. */
  cloneLabel(cloneId: number): Promise<{ name: string; visibility: string } | null>;
  /** base64url HMAC over a signing input; throws VoiceProvenanceUnavailable with no key. */
  sign(input: string): Promise<string>;
  newClipId(): string;
  now(): Date;
}

export interface IssueVoiceProvenanceInput {
  tenantId: number;
  userId: string | null;
  cloneId: number;
  voiceoverId?: number | null;
  /** 'clone-server' | 'clone-client'. */
  engine: string;
  model: string;
  audioSha256: string;
  watermarkId: string;
  watermarked?: boolean;
}

export async function issueVoiceProvenance(
  ports: VoiceProvenancePorts,
  input: IssueVoiceProvenanceInput,
): Promise<VoiceProvenanceRecord> {
  if (!SHA256_HEX.test(input.audioSha256)) throw new VoiceProvenanceInvalid('audioSha256 must be 64 lowercase hex characters.');
  if (!WATERMARK_ID_HEX.test(input.watermarkId)) throw new VoiceProvenanceInvalid('watermarkId must be 16 lowercase hex characters.');
  if (!input.engine || !input.model) throw new VoiceProvenanceInvalid('engine and model are required.');

  const clone = await ports.loadClone(input.cloneId);
  if (!clone) throw new VoiceCloneNotFound();
  if (!(await ports.canUse(clone, input.tenantId))) throw new VoiceCloneForbidden();
  if (!clone.consentAttestedAt) throw new VoiceCloneConsentRequired();

  const manifest: VoiceProvenanceManifest = {
    v: VOICE_PROVENANCE_VERSION,
    clipId: ports.newClipId(),
    cloneId: clone.id,
    ownerUserId: input.userId ?? clone.userId,
    tenantId: input.tenantId,
    consentTextVersion: clone.consentTextVersion ?? 'unversioned',
    engine: input.engine,
    model: input.model,
    createdAt: ports.now().toISOString(),
    audioSha256: input.audioSha256,
    watermarkId: input.watermarkId,
  };
  const record: VoiceProvenanceRecord = {
    manifest,
    signature: await ports.sign(provenanceSigningInput(manifest)),
    tenantId: input.tenantId,
    cloneId: clone.id,
    voiceName: clone.name ?? null,
    voiceoverId: input.voiceoverId ?? null,
    watermarked: input.watermarked ?? true,
  };
  if ((await ports.insert(record)) === 'duplicate') throw new VoiceProvenanceConflict();
  return record;
}

export type VoiceProvenanceVerdict =
  | { valid: true; manifest: VoiceProvenanceManifest; signature: string; watermarked: boolean; cloneDeleted?: boolean; voiceNameSnapshot?: string | null }
  | { valid: false; reason: 'not_found' | 'bad_signature' | 'malformed' };

async function signatureHolds(ports: VoiceProvenancePorts, m: VoiceProvenanceManifest, signature: string): Promise<boolean> {
  return timingSafeEqual(await ports.sign(provenanceSigningInput(m)), signature);
}

/**
 * What a stranger may learn from a valid clip. Deliberately NOT the manifest: it
 * names the owner and tenant, which the signature covers but the public has no
 * claim to. `voiceName` is null for any voice that is not published to the
 * marketplace, for a deleted voice, and ALWAYS for a self-reported clip (the registrant
 * chose the cloneId, so naming the voice would let anyone attach a marketplace voice's
 * name to audio of their choosing) — the client shows its own label.
 */
export type ProvenanceTrust = 'verified' | 'self_reported' | 'watermark_only';

export type PublicVoiceProvenance =
  | {
      valid: true;
      clipId: string;
      watermarked: boolean;
      voiceName: string | null;
      /** The voice behind the clip no longer exists (the signed record remains). */
      voiceDeleted: boolean;
      /** Server-computed trust: `verified` = the server synthesised the audio AND the supplied
       *  hash matches; `self_reported` = a client registered it and the supplied hash matches;
       *  `watermark_only` = no hash supplied, or it does not match. */
      trust: ProvenanceTrust;
      engine: string;
      model: string;
      consentTextVersion: string;
      createdAt: string;
      /** The registering client reported this clip itself; the server never saw the audio. */
      selfReported: boolean;
      /** True ONLY when the caller supplied an audio hash that equals the signed
       *  `manifest.audioSha256`. A watermark-id-only lookup says "watermark present",
       *  never "authentic": the watermark is a detection mark, not a proof. */
      audioMatchesSignedHash: boolean;
      /** Whether the caller supplied a hash to compare at all. */
      audioHashSupplied: boolean;
    }
  | { valid: false; reason: 'not_found' | 'bad_signature' | 'malformed' };

/** The trust level of a verdict; computed here, never taken from the caller. */
export function provenanceTrust(selfReported: boolean, audioMatchesSignedHash: boolean): ProvenanceTrust {
  if (!audioMatchesSignedHash) return 'watermark_only';
  return selfReported ? 'self_reported' : 'verified';
}

async function toPublicView(
  ports: VoiceProvenancePorts,
  verdict: VoiceProvenanceVerdict,
  claimedAudioSha256?: string,
): Promise<PublicVoiceProvenance> {
  if (!verdict.valid) return verdict;
  const { manifest } = verdict;
  const label = await ports.cloneLabel(manifest.cloneId);
  const selfReported = manifest.engine === CLIENT_REPORTED_ENGINE;
  const audioMatchesSignedHash = Boolean(claimedAudioSha256) && claimedAudioSha256 === manifest.audioSha256;
  return {
    valid: true,
    clipId: manifest.clipId,
    selfReported,
    audioHashSupplied: Boolean(claimedAudioSha256),
    audioMatchesSignedHash,
    trust: provenanceTrust(selfReported, audioMatchesSignedHash),
    watermarked: verdict.watermarked,
    // Deleted = the row's clone_id was nulled (ON DELETE SET NULL), or the label is gone.
    voiceDeleted: verdict.cloneDeleted === true || label === null,
    // A self-reported clip never names a voice. A deleted voice shows its snapshot; a live one
    // is named only when published to the marketplace.
    voiceName: selfReported ? null
      : (verdict.cloneDeleted === true || label === null) ? (verdict.voiceNameSnapshot ?? null)
      : label.visibility === 'marketplace' ? label.name : null,
    engine: manifest.engine,
    model: manifest.model,
    consentTextVersion: manifest.consentTextVersion,
    createdAt: manifest.createdAt,
  };
}

/** {@link verifyVoiceProvenance}, answered as the public view. The signature is
 *  still checked over the full manifest first. */
export async function verifyVoiceProvenancePublic(
  ports: VoiceProvenancePorts,
  by: ProvenanceLookup,
  /** A hash the caller computed from the audio they hold; compared to the signed one. */
  claimedAudioSha256?: string,
): Promise<PublicVoiceProvenance> {
  return toPublicView(ports, await verifyVoiceProvenance(ports, by), claimedAudioSha256);
}

/** {@link verifyVoiceProvenanceManifest}, answered as the public view. */
export async function verifyVoiceProvenanceManifestPublic(
  ports: VoiceProvenancePorts,
  claim: { manifest: unknown; signature: unknown },
  claimedAudioSha256?: string,
): Promise<PublicVoiceProvenance> {
  return toPublicView(ports, await verifyVoiceProvenanceManifest(ports, claim), claimedAudioSha256);
}

/** Look a clip up by watermark id, audio hash or clip id and re-verify its signature. */
export async function verifyVoiceProvenance(
  ports: VoiceProvenancePorts,
  by: ProvenanceLookup,
): Promise<VoiceProvenanceVerdict> {
  const record = await ports.find(by);
  if (!record) return { valid: false, reason: 'not_found' };
  if (!(await signatureHolds(ports, record.manifest, record.signature))) {
    return { valid: false, reason: 'bad_signature' };
  }
  return {
    valid: true, manifest: record.manifest, signature: record.signature, watermarked: record.watermarked,
    cloneDeleted: record.cloneId === null, voiceNameSnapshot: record.voiceName ?? null,
  };
}

/** Check a manifest + signature a caller holds (offline copy, a sidecar file). A
 *  forged or edited manifest fails the MAC; a genuine one is also confirmed to
 *  still be registered. */
export async function verifyVoiceProvenanceManifest(
  ports: VoiceProvenancePorts,
  claim: { manifest: unknown; signature: unknown },
): Promise<VoiceProvenanceVerdict> {
  const manifest = parseVoiceProvenanceManifest(claim.manifest);
  if (!manifest || typeof claim.signature !== 'string') return { valid: false, reason: 'malformed' };
  if (!(await signatureHolds(ports, manifest, claim.signature))) return { valid: false, reason: 'bad_signature' };
  const record = await ports.find({ clipId: manifest.clipId });
  if (!record) return { valid: false, reason: 'not_found' };
  return {
    valid: true, manifest, signature: claim.signature, watermarked: record.watermarked,
    cloneDeleted: record.cloneId === null, voiceNameSnapshot: record.voiceName ?? null,
  };
}
