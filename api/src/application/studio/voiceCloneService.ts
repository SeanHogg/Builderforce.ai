import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * voiceCloneService — the synthesis spine for Voice PRD #1994.
 *
 * `synthesizeForClone` enforces the access + consent gates, then serves through a
 * read-through cache whose persistent tier IS the `studio_voiceovers` row: keyed
 * by sha256(cloneId + normalizedText + speed + lang), so identical re-synthesis
 * returns the stored audio instead of re-calling the (paid) TTS provider or
 * re-billing the ledger. Only a genuine first synthesis hits the provider, stores
 * audio to R2, persists the voiceover row, and meters the per-second cost.
 *
 * Layering: L1/L2 via getOrSetCached → L3 the unique-keyed DB row (survives KV
 * TTL) → provider only on a true miss. The unique cache_key + onConflictDoNothing
 * makes concurrent identical requests converge on one row (neon-http has no
 * interactive tx — we reconcile via conflict, not a lock).
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { usageDatabaseOf } from '../llm/usageLedger';
import type { Env } from '../../env';
import {
  llmUsageLog,
  studioVoiceClones,
  studioVoiceovers,
} from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { sha256Hex } from '../../infrastructure/crypto/digest';
import {
  isTtsProviderConfigured,
  synthesizeClonedAudio,
  TtsProviderUnavailable,
} from './ttsProvider';
import {
  canUseClone,
  VoiceCloneConsentRequired,
  VoiceCloneForbidden,
  VoiceCloneNotFound,
} from './voiceCloneAccess';
import { markServerClip } from './voiceClipMarking';
import { createVoiceProvenancePorts, findProvenanceForVoiceover } from './voiceProvenancePorts';
import { issueVoiceProvenance, VoiceProvenanceConflict } from './voiceProvenanceService';

// The access refusals and the access predicate live in voiceCloneAccess (shared
// with provenance issuing); re-exported so existing imports keep resolving.
export { VoiceCloneNotFound, VoiceCloneForbidden, VoiceCloneConsentRequired, canUseClone };

export class VoiceCloneReferenceMissing extends Error {
  readonly status = 422;
  constructor() { super('The clone has no reference sample to synthesize from.'); this.name = 'VoiceCloneReferenceMissing'; }
}

/** A concurrent identical synthesis won the race but its clip is withdrawn or not yet signed. Retry. */
export class VoiceCloneSynthesisConflict extends Error {
  readonly status = 409;
  constructor() { super('A concurrent synthesis of this clip did not complete. Retry.'); this.name = 'VoiceCloneSynthesisConflict'; }
}

export { TtsProviderUnavailable };

export interface SynthesizeParams {
  cloneId: number;
  tenantId: number;
  userId: string | null;
  text: string;
  speed?: number;
  language?: string;
  signal?: AbortSignal;
}

export interface SynthesisRecord {
  voiceoverId: number;
  audioKey: string;
  durationMs: number;
  wordTimestamps: Array<{ word: string; startMs: number; endMs: number }>;
  /** True when served from the persistent cache (no provider call, no new charge). */
  cached: boolean;
}

/** Normalise text so trivially-different inputs share a cache entry. */
function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** sha256 hex of the synthesis parameters — the read-through cache key. */
async function computeCacheKey(
  tenantId: number,
  cloneId: number,
  text: string,
  speed: number,
  language: string,
): Promise<string> {
  const material = `${tenantId}\u0000${cloneId}\u0000${normalizeText(text)}\u0000${speed}\u0000${language}`;
  return sha256Hex(material);
}

/** Millicents-per-second synthesis cost basis (env override, default 5 ≈ $0.05/min). */
function costPerSecondMillicents(env: Env): number {
  const parsed = Number(env.VOICE_CLONE_COST_MC_PER_SEC);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5;
}

/**
 * Synthesize (or cache-hit) cloned audio. Throws the typed errors above for the
 * route to map to 404/403/422/503.
 */
export async function synthesizeForClone(
  db: Db,
  env: Env,
  params: SynthesizeParams,
): Promise<SynthesisRecord> {
  const [clone] = await db
    .select()
    .from(studioVoiceClones)
    .where(eq(studioVoiceClones.id, params.cloneId))
    .limit(1);
  if (!clone) throw new VoiceCloneNotFound();

  if (!(await canUseClone(db, clone, params.tenantId))) throw new VoiceCloneForbidden();
  if (!clone.consentAttestedAt) throw new VoiceCloneConsentRequired();
  if (!isTtsProviderConfigured(env)) throw new TtsProviderUnavailable();
  if (!clone.referenceKey) throw new VoiceCloneReferenceMissing();

  const speed = params.speed ?? 1;
  const language = params.language ?? 'en';
  const cacheKey = await computeCacheKey(params.tenantId, params.cloneId, params.text, speed, language);

  return getOrSetCached(
    env,
    `voiceover:${cacheKey}`,
    () => loadOrSynthesize(db, env, { clone, cacheKey, speed, language, params }),
    { kvTtlSeconds: 3600 },
  );
}

async function loadOrSynthesize(
  db: Db,
  env: Env,
  ctx: {
    clone: typeof studioVoiceClones.$inferSelect;
    cacheKey: string;
    speed: number;
    language: string;
    params: SynthesizeParams;
  },
): Promise<SynthesisRecord> {
  const { clone, cacheKey, speed, language, params } = ctx;

  // L3: the persistent voiceover row (survives KV TTL).
  const [existing] = await db
    .select()
    .from(studioVoiceovers)
    .where(eq(studioVoiceovers.cacheKey, cacheKey))
    .limit(1);
  if (existing) {
    return {
      voiceoverId: existing.id,
      audioKey: existing.audioKey,
      durationMs: existing.durationMs,
      wordTimestamps: existing.wordTimestamps,
      cached: true,
    };
  }

  // True miss — load reference, synthesize, store, persist, meter.
  const refObj = await env.UPLOADS?.get(clone.referenceKey!);
  if (!refObj) throw new VoiceCloneReferenceMissing();
  const referenceAudio = await refObj.arrayBuffer();

  const out = await synthesizeClonedAudio(env, {
    referenceAudio,
    referenceContentType: refObj.httpMetadata?.contentType ?? 'audio/wav',
    text: params.text,
    speed,
    language,
    provider: clone.provider,
    ...(params.signal ? { signal: params.signal } : {}),
  });

  // Every clip is watermarked before it is stored. The key carries the watermark
  // id, so two racing identical requests each write their OWN object and the
  // provenance hash always describes the bytes the winning row points at.
  const marked = await markServerClip(out.audio, out.contentType);
  const audioKey = `${clone.tenantId}/voiceovers/${clone.id}/${cacheKey}-${marked.watermarkId}.wav`;
  await env.UPLOADS?.put(audioKey, marked.audio, {
    httpMetadata: { contentType: marked.contentType },
    customMetadata: { cloneId: String(clone.id), tenantId: String(clone.tenantId) },
  });

  const cost = Math.ceil(out.durationMs / 1000) * costPerSecondMillicents(env);

  // Insert the voiceover row; onConflictDoNothing makes concurrent identical
  // requests converge (the loser reads the winner's row, below).
  const inserted = await db
    .insert(studioVoiceovers)
    .values({
      tenantId: params.tenantId,
      cloneId: clone.id,
      cacheKey,
      text: params.text,
      audioKey,
      durationMs: out.durationMs,
      wordTimestamps: out.wordTimestamps,
      costUsdMillicents: cost,
    })
    .onConflictDoNothing({ target: studioVoiceovers.cacheKey })
    .returning({ id: studioVoiceovers.id });

  if (inserted.length === 0) {
    // Lost the race — drop our own copy of the audio and return the row the
    // winner persisted (no double-bill).
    await env.UPLOADS?.delete(audioKey).catch((error) => {
      reportCaughtError(error, { source: 'application/studio/voiceCloneService.ts', operation: 'loadOrSynthesize' });
    });
    const [winner] = await db
      .select()
      .from(studioVoiceovers)
      .where(eq(studioVoiceovers.cacheKey, cacheKey))
      .limit(1);
    // The winner's row is only servable once its provenance is signed: a winner that failed
    // signing is WITHDRAWN (row + audio deleted), and one still in flight has no manifest yet.
    // Either way this is a miss, and our own audio is already gone, so the caller retries.
    const winnerServable = winner
      ? Boolean(await findProvenanceForVoiceover(db, params.tenantId, winner.id))
      : false;
    if (!winner || !winnerServable) throw new VoiceCloneSynthesisConflict();
    return {
      voiceoverId: winner.id,
      audioKey: winner.audioKey,
      durationMs: winner.durationMs,
      wordTimestamps: winner.wordTimestamps,
      cached: true,
    };
  }

  // Sign the clip's provenance. Fail closed: a clip with no signed manifest must
  // not be served, so on failure the row and object are withdrawn and the error
  // surfaces (a retry re-synthesizes; nothing was billed yet). A duplicate means a
  // concurrent request already registered it — not an error.
  const voiceoverId = inserted[0]?.id ?? 0;
  try {
    await issueVoiceProvenance(createVoiceProvenancePorts(db, env), {
      tenantId: params.tenantId,
      userId: params.userId,
      cloneId: clone.id,
      voiceoverId: voiceoverId || null,
      engine: 'clone-server',
      model: clone.provider,
      audioSha256: marked.audioSha256,
      watermarkId: marked.watermarkId,
      watermarked: marked.watermarked,
    });
  } catch (error) {
    if (!(error instanceof VoiceProvenanceConflict)) {
      await withdrawVoiceover(db, env, voiceoverId, audioKey);
      throw error;
    }
  }

  // We are the synthesizer of record — bill the per-second cost to the ledger.
  // Synthesis is priced per second of audio, not by tokens, so we stamp
  // costUsdMillicents directly (recordUsageRow prices from the LLM catalog,
  // which has no entry for synthesis) on the same canonical ledger table.
  await meterSynthesis(db, params, clone.id, out.durationMs, cost);

  return {
    voiceoverId: inserted[0]?.id ?? 0,
    audioKey,
    durationMs: out.durationMs,
    wordTimestamps: out.wordTimestamps,
    cached: false,
  };
}

/** Undo a half-finished synthesis: remove the voiceover row and its audio. */
async function withdrawVoiceover(db: Db, env: Env, voiceoverId: number, audioKey: string): Promise<void> {
  try {
    if (voiceoverId) await db.delete(studioVoiceovers).where(eq(studioVoiceovers.id, voiceoverId));
    await env.UPLOADS?.delete(audioKey);
  } catch (error) {
    reportCaughtError(error, { source: 'application/studio/voiceCloneService.ts', operation: 'withdrawVoiceover' });
  }
}

/** Best-effort ledger insert for a synthesis charge — never fails the request. */
async function meterSynthesis(
  db: Db,
  params: SynthesizeParams,
  cloneId: number,
  durationMs: number,
  costUsdMillicents: number,
): Promise<void> {
  try {
    await usageDatabaseOf(db).insert(llmUsageLog).values({
      tenantId: params.tenantId,
      userId: params.userId,
      llmProduct: 'voice_clone',
      model: 'voice_clone_synthesis',
      useCase: 'voice_clone_synthesis',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      // jsonb column typed as a record — the object goes in as an object. Stringifying
      // it stored a JSON string inside the jsonb, which every metadata reader then
      // received as a string rather than the record it declares.
      metadata: { cloneId, durationMs },
      costUsdMillicents,
    });
  } catch (error) {
    /* metering must never fail the synthesis request */
  
    reportCaughtError(error, { source: "application/studio/voiceCloneService.ts", operation: "meterSynthesis" });
  }
}
