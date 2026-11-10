/**
 * Enrol a voice clone (Voice PRD #1994 §5): store the optional reference sample,
 * bind the optional Voice IDE project, write the consent-attested row, seal the
 * optional speaker embedding onto it, and invalidate the lists it now appears in.
 *
 * The request-shaped checks (paid-feature gate, name, consent affirmation, form
 * parsing) stay at the route; everything that touches storage is here.
 */

import { and, eq } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { ideProjects, studioVoiceClones } from '../../infrastructure/database/schema';
import { InternalError } from '../../domain/shared/errors';
import { sealEmbedding } from './voiceEmbeddingVault';
import { invalidateMarketplaceClones, invalidateUsableClones } from './voiceCloneCatalog';

const CONSENT_TEXT_VERSION = 'v1';

/** Minimal uploaded-file shape — the Worker FormData typing surfaces entries as
 *  `string`, so multipart file parts are cast to this instead of the DOM `File`. */
export interface UploadedFile {
  name: string;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface EnrolVoiceCloneInput {
  tenantId: number;
  userId: string;
  name: string;
  description: string | null;
  provider: string;
  visibility: 'private' | 'unlisted' | 'marketplace';
  /** Optional reference sample (needed for the server synth path). */
  reference: UploadedFile | null;
  /** Optional client-enrolled speaker embedding (the on-device path's identity), already parsed. */
  embedding: number[] | null;
  embeddingSampleRate: number | null;
  /** Requested Voice IDE project; validated against the caller's tenant here. */
  ideProjectId: number | null;
}

export type EnrolVoiceCloneResult =
  | { ok: true; clone: typeof studioVoiceClones.$inferSelect }
  | { ok: false; status: 422 | 503; error: string };

export async function enrolVoiceClone(db: Db, env: Env, input: EnrolVoiceCloneInput): Promise<EnrolVoiceCloneResult> {
  const { tenantId } = input;

  let referenceKey: string | null = null;
  const reference = input.reference;
  if (reference) {
    if (!env.UPLOADS) return { ok: false, status: 503, error: 'File storage not configured' };
    const ext = (reference.name.split('.').pop() ?? 'wav').toLowerCase();
    referenceKey = `${tenantId}/voice-clones/${crypto.randomUUID()}.${ext}`;
    await env.UPLOADS.put(referenceKey, await reference.arrayBuffer(), {
      httpMetadata: { contentType: reference.type || 'audio/wav' },
      customMetadata: { tenantId: String(tenantId), kind: 'voice-clone-reference' },
    });
  }

  // Optional Voice IDE project scoping (0224): bind the clone to the voice
  // project it was enrolled under, validating tenant ownership so a clone can't
  // be attached to another tenant's project.
  let ideProjectId: number | null = null;
  if (input.ideProjectId !== null) {
    const n = input.ideProjectId;
    const [ip] = await db
      .select({ id: ideProjects.id })
      .from(ideProjects)
      .where(and(eq(ideProjects.id, n), eq(ideProjects.tenantId, tenantId)))
      .limit(1);
    if (!ip) return { ok: false, status: 422, error: 'Invalid IDE project' };
    ideProjectId = n;
  }

  const [inserted] = await db
    .insert(studioVoiceClones)
    .values({
      tenantId,
      userId: input.userId,
      ideProjectId,
      name: input.name,
      description: input.description,
      provider: input.provider,
      referenceKey,
      visibility: input.visibility,
      status: 'ready',
      consentAttestedAt: new Date(),
      consentTextVersion: CONSENT_TEXT_VERSION,
    })
    .returning();
  if (!inserted) throw new InternalError('Failed to create voice clone');

  // The embedding is the owner's biometric: sealed per-tenant AND bound to this
  // clone's id (so it cannot be swapped onto another row), which only exists now.
  let created = inserted;
  if (input.embedding) {
    const sealed = await sealEmbedding(env, tenantId, inserted.id, input.embedding, input.embeddingSampleRate);
    const [withEmbedding] = await db
      .update(studioVoiceClones)
      .set({ embeddingEnc: sealed.enc, embeddingIv: sealed.iv })
      .where(and(eq(studioVoiceClones.id, inserted.id), eq(studioVoiceClones.tenantId, tenantId)))
      .returning();
    if (withEmbedding) created = withEmbedding;
  }

  await invalidateUsableClones(env, tenantId);
  if (input.visibility === 'marketplace') await invalidateMarketplaceClones(env);
  return { ok: true, clone: created };
}
