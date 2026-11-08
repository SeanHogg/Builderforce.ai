/**
 * The Drizzle + Worker-env implementation of {@link VoiceProvenancePorts} — the
 * only place the provenance use cases meet a table or a secret.
 */

import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { studioVoiceClones, voiceClipProvenance } from '../../infrastructure/database/schema';
import { hmacBase64Url } from '../../infrastructure/crypto/hmac';
import { hkdfSha256 } from '../../infrastructure/crypto/hkdf';
import { canUseClone } from './voiceCloneAccess';
import {
  CLIENT_REPORTED_ENGINE,
  pickAuthoritative,
  VoiceProvenanceUnavailable,
  type ProvenanceLookup,
  type VoiceProvenancePorts,
  type VoiceProvenanceRecord,
} from './voiceProvenanceService';

const KEY_LABEL = 'bf-voice-provenance/v1';

/** The signing key: its own secret when provisioned, else an HKDF-SHA256
 *  derivation from JWT_SECRET under the provenance label — never the raw JWT key. */
export async function provenanceSigningKey(
  env: Pick<Env, 'VOICE_PROVENANCE_SECRET' | 'JWT_SECRET'>,
): Promise<string | Uint8Array> {
  if (env.VOICE_PROVENANCE_SECRET) return env.VOICE_PROVENANCE_SECRET;
  if (!env.JWT_SECRET) throw new VoiceProvenanceUnavailable();
  return hkdfSha256(env.JWT_SECRET, KEY_LABEL);
}

function toRecord(row: typeof voiceClipProvenance.$inferSelect): VoiceProvenanceRecord {
  return {
    manifest: row.manifest,
    signature: row.signature,
    tenantId: row.tenantId,
    cloneId: row.cloneId,
    voiceName: row.voiceName,
    voiceoverId: row.voiceoverId,
    watermarked: row.watermarked,
  };
}

export function createVoiceProvenancePorts(
  db: Db,
  env: Pick<Env, 'VOICE_PROVENANCE_SECRET' | 'JWT_SECRET'>,
): VoiceProvenancePorts {
  return {
    async loadClone(cloneId) {
      const [clone] = await db
        .select({
          id: studioVoiceClones.id,
          tenantId: studioVoiceClones.tenantId,
          userId: studioVoiceClones.userId,
          consentAttestedAt: studioVoiceClones.consentAttestedAt,
          consentTextVersion: studioVoiceClones.consentTextVersion,
          name: studioVoiceClones.name,
        })
        .from(studioVoiceClones)
        .where(eq(studioVoiceClones.id, cloneId))
        .limit(1);
      return clone ?? null;
    },

    canUse: (clone, tenantId) => canUseClone(db, clone, tenantId),

    async insert(record) {
      const inserted = await db
        .insert(voiceClipProvenance)
        .values({
          id: record.manifest.clipId,
          tenantId: record.tenantId,
          cloneId: record.cloneId,
          voiceName: record.voiceName ?? null,
          voiceoverId: record.voiceoverId,
          engine: record.manifest.engine,
          audioSha256: record.manifest.audioSha256,
          watermarkId: record.manifest.watermarkId,
          watermarked: record.watermarked,
          manifest: record.manifest,
          signature: record.signature,
        })
        .onConflictDoNothing()
        .returning({ id: voiceClipProvenance.id });
      return inserted.length > 0 ? 'inserted' : 'duplicate';
    },

    async find(by: ProvenanceLookup) {
      const column =
        'watermarkId' in by ? eq(voiceClipProvenance.watermarkId, by.watermarkId)
        : 'audioSha256' in by ? eq(voiceClipProvenance.audioSha256, by.audioSha256)
        : eq(voiceClipProvenance.id, by.clipId);
      // Server-synthesised first, then oldest: a client can register ANY hash, so a self-reported
      // entry (however early) never displaces the registration of audio the server itself made.
      // The SQL order picks the candidates; `pickAuthoritative` is the rule itself.
      const rows = await db
        .select()
        .from(voiceClipProvenance)
        .where(column)
        .orderBy(sql`(${voiceClipProvenance.engine} = ${CLIENT_REPORTED_ENGINE})`, asc(voiceClipProvenance.createdAt))
        .limit(20);
      return pickAuthoritative(rows.map(toRecord));
    },

    async cloneLabel(cloneId) {
      const [row] = await db
        .select({ name: studioVoiceClones.name, visibility: studioVoiceClones.visibility })
        .from(studioVoiceClones)
        .where(eq(studioVoiceClones.id, cloneId))
        .limit(1);
      return row ?? null;
    },

    sign: async (input) => hmacBase64Url(await provenanceSigningKey(env), input),
    newClipId: () => crypto.randomUUID(),
    now: () => new Date(),
  };
}

/** Provenance for a voiceover the CALLER's tenant generated: the row's tenant must be
 *  the caller's, so a licensee walking another tenant's voiceover id finds nothing. */
export async function findProvenanceForVoiceover(db: Db, tenantId: number, voiceoverId: number): Promise<VoiceProvenanceRecord | null> {
  const [row] = await db
    .select()
    .from(voiceClipProvenance)
    .where(and(eq(voiceClipProvenance.voiceoverId, voiceoverId), eq(voiceClipProvenance.tenantId, tenantId)))
    .limit(1);
  return row ? toRecord(row) : null;
}
