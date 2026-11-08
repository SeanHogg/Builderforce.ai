/**
 * Who may use a voice clone, and the refusals that answer "no" — shared by the
 * synthesis spine and by provenance issuing so neither re-derives the gate.
 *
 * Each refusal carries the status it answers with (`statusOf` reads it), so no
 * route re-decides whether a missing consent attestation is a 403 or a 422.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { studioVoiceCloneLicenses } from '../../infrastructure/database/schema';

export class VoiceCloneNotFound extends Error {
  readonly status = 404;
  constructor() { super('Voice clone not found.'); this.name = 'VoiceCloneNotFound'; }
}
export class VoiceCloneForbidden extends Error {
  readonly status = 403;
  constructor() { super('You do not own or hold a license for this voice.'); this.name = 'VoiceCloneForbidden'; }
}
export class VoiceCloneConsentRequired extends Error {
  readonly status = 422;
  constructor() { super('This voice clone has no consent attestation; synthesis is blocked.'); this.name = 'VoiceCloneConsentRequired'; }
}

/** Owner OR an active license. The single access predicate — routes never
 *  recompute it. */
export async function canUseClone(
  db: Db,
  clone: { id: number; tenantId: number },
  tenantId: number,
): Promise<boolean> {
  if (clone.tenantId === tenantId) return true;
  const [license] = await db
    .select({ id: studioVoiceCloneLicenses.id })
    .from(studioVoiceCloneLicenses)
    .where(
      and(
        eq(studioVoiceCloneLicenses.cloneId, clone.id),
        eq(studioVoiceCloneLicenses.tenantId, tenantId),
        eq(studioVoiceCloneLicenses.status, 'active'),
      ),
    )
    .limit(1);
  return Boolean(license);
}
