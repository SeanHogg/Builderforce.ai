/**
 * voiceEmbeddingVault — the owner's speaker embedding (a biometric), sealed at rest.
 *
 * Sealing reuses the ONE per-tenant AES-256-GCM helper (credentialCrypto) — no new
 * crypto. The ciphertext lives in `studio_voice_clones.embedding_enc/iv`, bound to
 * its clone with AEAD additional data (`voice-embedding:v1:<tenant>:<clone>`), so a
 * blob copied onto another clone's row (same tenant key!) fails to open. Only the
 * clone's OWNER (same tenant AND the enrolling user) may open it; buyers/licensees
 * and every list/marketplace payload never see it.
 *
 * The seal key is HKDF-derived ('bf-voice-embedding-v1') from the credential base secret.
 * Legacy rows that still hold the plaintext `embedding` jsonb are sealed + nulled on
 * their first owner fetch (expand/contract: the column itself is dropped later).
 */

import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { studioVoiceClones, tenantMembers } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { hkdfSha256 } from '../../infrastructure/crypto/hkdf';
import { credentialSecret, decryptCredentials, encryptCredentials } from '../integrations/credentialCrypto';
import { VoiceCloneForbidden, VoiceCloneNotFound } from './voiceCloneService';

export interface SealedEmbedding { enc: string; iv: string }

/** The speaker identity: the vector plus the sample rate it was enrolled at (the
 *  on-device engine needs both; null for legacy rows that never recorded it). */
export interface OwnerEmbedding { embedding: number[]; sampleRate: number | null }

export function parseSampleRate(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The longest speaker embedding accepted (floats). Real speaker vectors are a few hundred. */
export const MAX_EMBEDDING_LENGTH = 4096;

/** Coerce arbitrary input to a finite number[] of 1..{@link MAX_EMBEDDING_LENGTH} (or null).
 *  NaN, Infinity and non-numeric entries reject the whole vector. */
export function parseEmbedding(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_EMBEDDING_LENGTH) return null;
  const out = raw.map((v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN));
  return out.every(Number.isFinite) ? out : null;
}

/** The embedding's own sealing secret: HKDF-derived from the credential base secret, so a
 *  key that opens other credentials never opens a speaker embedding (and vice versa). */
async function embeddingSecret(env: Env): Promise<string> {
  const bytes = await hkdfSha256(credentialSecret(env), 'bf-voice-embedding-v1');
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The AEAD context a clone's embedding is bound to. */
export const embeddingAad = (tenantId: number, cloneId: number): string => `voice-embedding:v1:${tenantId}:${cloneId}`;

export function sealEmbedding(
  env: Env,
  tenantId: number,
  cloneId: number,
  embedding: number[],
  sampleRate: number | null = null,
): Promise<SealedEmbedding> {
  return embeddingSecret(env).then((secret) =>
    encryptCredentials({ embedding, sampleRate }, secret, tenantId, embeddingAad(tenantId, cloneId)));
}

function toOwnerEmbedding(data: Record<string, unknown> | null): OwnerEmbedding | null {
  const embedding = parseEmbedding(data?.embedding);
  return embedding ? { embedding, sampleRate: parseSampleRate(data?.sampleRate) } : null;
}

/** Opens a blob sealed for THIS tenant + clone. Only `v2:` (per-tenant) blobs qualify. */
export async function openEmbedding(
  env: Env,
  tenantId: number,
  cloneId: number,
  sealed: SealedEmbedding,
): Promise<OwnerEmbedding | null> {
  if (!sealed.enc.startsWith('v2:')) return null;
  return toOwnerEmbedding(
    await decryptCredentials(sealed.enc, sealed.iv, await embeddingSecret(env), tenantId, embeddingAad(tenantId, cloneId)),
  );
}

type CloneRow = typeof studioVoiceClones.$inferSelect;

/** Roles that may act as owner for a clone with no enrolling user on record. */
const UNATTRIBUTED_OWNER_ROLES = ['owner', 'manager'] as const;

/** Owner = same tenant AND the enrolling user. An unattributed (null-user) row needs a tenant owner/manager. */
async function assertOwner(db: Db, clone: CloneRow | undefined, tenantId: number, userId: string | null): Promise<CloneRow> {
  if (!clone) throw new VoiceCloneNotFound();
  if (clone.tenantId !== tenantId) throw new VoiceCloneForbidden();
  if (clone.userId) {
    if (clone.userId !== userId) throw new VoiceCloneForbidden();
    return clone;
  }
  if (!userId) throw new VoiceCloneForbidden();
  const [member] = await db
    .select({ id: tenantMembers.id })
    .from(tenantMembers)
    .where(and(
      eq(tenantMembers.tenantId, tenantId),
      eq(tenantMembers.userId, userId),
      eq(tenantMembers.isActive, true),
      inArray(tenantMembers.role, [...UNATTRIBUTED_OWNER_ROLES]),
    ))
    .limit(1);
  if (!member) throw new VoiceCloneForbidden();
  return clone;
}

/** The caller's tenant's clone: another tenant's id reads as missing (404), never as present-but-forbidden. */
async function loadClone(db: Db, cloneId: number, tenantId: number): Promise<CloneRow | undefined> {
  const [row] = await db.select().from(studioVoiceClones).where(scopedToTenant(studioVoiceClones, tenantId, eq(studioVoiceClones.id, cloneId))).limit(1);
  return row;
}

async function persistSealed(db: Db, env: Env, clone: CloneRow, own: OwnerEmbedding): Promise<void> {
  const sealed = await sealEmbedding(env, clone.tenantId, clone.id, own.embedding, own.sampleRate);
  await db
    .update(studioVoiceClones)
    .set({ embeddingEnc: sealed.enc, embeddingIv: sealed.iv, embedding: null, updatedAt: new Date() })
    .where(and(eq(studioVoiceClones.id, clone.id), eq(studioVoiceClones.tenantId, clone.tenantId)));
}

/** Owner-only read. Returns null when the clone has no embedding. */
export async function getOwnerEmbedding(
  db: Db,
  env: Env,
  p: { cloneId: number; tenantId: number; userId: string | null },
): Promise<OwnerEmbedding | null> {
  const clone = await assertOwner(db, await loadClone(db, p.cloneId, p.tenantId), p.tenantId, p.userId);
  if (clone.embeddingEnc && clone.embeddingIv) {
    const sealed = { enc: clone.embeddingEnc, iv: clone.embeddingIv };
    // No unbound-AAD fallback: `embedding_enc` shipped (mig 1326) with the clone binding from day one.
    return openEmbedding(env, clone.tenantId, clone.id, sealed);
  }
  // The PLAINTEXT `embedding` jsonb predates 1326, so real legacy rows can exist: seal on first owner read.
  const legacy = parseEmbedding(clone.embedding);
  if (legacy) {
    const own = { embedding: legacy, sampleRate: null };
    await persistSealed(db, env, clone, own); // lazy expand→contract of the row
    return own;
  }
  return null;
}

/** Owner-only upload for clones that lack a server copy (one-time device migration).
 *  Never overwrites an existing embedding: the write is ONE conditional UPDATE
 *  (`embedding_enc IS NULL AND embedding IS NULL`), so two racing uploads cannot both
 *  win. Returns whether this call stored it. */
export async function storeOwnerEmbeddingIfMissing(
  db: Db,
  env: Env,
  p: { cloneId: number; tenantId: number; userId: string | null; embedding: number[]; sampleRate?: number | null },
): Promise<boolean> {
  const clone = await assertOwner(db, await loadClone(db, p.cloneId, p.tenantId), p.tenantId, p.userId);
  const sealed = await sealEmbedding(env, clone.tenantId, clone.id, p.embedding, p.sampleRate ?? null);
  const written = await db
    .update(studioVoiceClones)
    .set({ embeddingEnc: sealed.enc, embeddingIv: sealed.iv, updatedAt: new Date() })
    .where(and(
      eq(studioVoiceClones.id, clone.id),
      eq(studioVoiceClones.tenantId, clone.tenantId),
      isNull(studioVoiceClones.embeddingEnc),
      isNull(studioVoiceClones.embedding),
    ))
    .returning({ id: studioVoiceClones.id });
  return written.length > 0;
}
