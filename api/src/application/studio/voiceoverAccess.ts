/**
 * Access-checked reads of a STORED voiceover: its audio bytes (from R2) and its
 * signed provenance record. Both gate on the one clone-access predicate
 * (`canUseClone`: owner OR active license) and then read the voiceover scoped to
 * the CALLER's tenant, so a licensee never reaches another tenant's voiceover.
 */

import { eq } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { studioVoiceClones, studioVoiceovers } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { canUseClone } from './voiceCloneService';
import { findProvenanceForVoiceover } from './voiceProvenancePorts';
import type { VoiceProvenanceRecord } from './voiceProvenanceService';

export interface VoiceoverRef {
  tenantId: number;
  cloneId: number;
  voiceoverId: number;
}

type Refusal = { ok: false; reason: 'not_found' | 'forbidden' };

/** The clone exists and the caller may use it. */
async function gateClone(db: Db, tenantId: number, cloneId: number): Promise<Refusal | null> {
  const [clone] = await db
    .select({ id: studioVoiceClones.id, tenantId: studioVoiceClones.tenantId })
    .from(studioVoiceClones)
    .where(eq(studioVoiceClones.id, cloneId))
    .limit(1);
  if (!clone) return { ok: false, reason: 'not_found' };
  if (!(await canUseClone(db, clone, tenantId))) return { ok: false, reason: 'forbidden' };
  return null;
}

export type VoiceoverProvenanceResult =
  | Refusal
  | ({ ok: true } & Pick<VoiceProvenanceRecord, 'manifest' | 'signature' | 'watermarked'>);

/** A stored voiceover's signed provenance. */
export async function readVoiceoverProvenance(db: Db, ref: VoiceoverRef): Promise<VoiceoverProvenanceResult> {
  const refused = await gateClone(db, ref.tenantId, ref.cloneId);
  if (refused) return refused;
  // Scoped to the CALLER's tenant: a licensee never reads another tenant's voiceover provenance.
  const record = await findProvenanceForVoiceover(db, ref.tenantId, ref.voiceoverId);
  if (!record || record.cloneId !== ref.cloneId) return { ok: false, reason: 'not_found' };
  return { ok: true, manifest: record.manifest, signature: record.signature, watermarked: record.watermarked };
}

export type VoiceoverAudioResult =
  | Refusal
  | { ok: false; reason: 'no_storage' | 'expired' }
  | { ok: true; body: ReadableStream; contentType: string };

/** A synthesized voiceover's audio, streamed from R2. */
export async function readVoiceoverAudio(db: Db, env: Env, ref: VoiceoverRef): Promise<VoiceoverAudioResult> {
  const refused = await gateClone(db, ref.tenantId, ref.cloneId);
  if (refused) return refused;

  const [vo] = await db
    .select({ audioKey: studioVoiceovers.audioKey, cloneId: studioVoiceovers.cloneId })
    .from(studioVoiceovers)
    .where(scopedToTenant(studioVoiceovers, ref.tenantId, eq(studioVoiceovers.id, ref.voiceoverId)))
    .limit(1);
  if (!vo || vo.cloneId !== ref.cloneId) return { ok: false, reason: 'not_found' };
  if (!env.UPLOADS) return { ok: false, reason: 'no_storage' };

  const obj = await env.UPLOADS.get(vo.audioKey);
  if (!obj) return { ok: false, reason: 'expired' };
  return { ok: true, body: obj.body, contentType: obj.httpMetadata?.contentType ?? 'audio/wav' };
}
