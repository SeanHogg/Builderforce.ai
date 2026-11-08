/**
 * voiceLicenseService — acquiring a marketplace voice.
 *
 * A FREE (price 0) published marketplace voice is licensed to the caller's tenant
 * directly: one `studio_voice_clone_licenses` row, which `canUseClone` already
 * honours. A PRICED voice is refused with `VoiceCloneLicensePaymentRequired` — the
 * paid path goes through the web checkout, so no client can mint a paid license by
 * calling this. Idempotent (unique clone+tenant); a revoked license stays revoked.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { studioVoiceCloneLicenses, studioVoiceClones } from '../../infrastructure/database/schema';
import { VoiceCloneNotFound } from './voiceCloneService';

export class VoiceCloneLicensePaymentRequired extends Error {
  readonly status = 402;
  constructor() { super('This voice is paid. Buy it on the web.'); this.name = 'VoiceCloneLicensePaymentRequired'; }
}

export async function acquireFreeVoiceLicense(
  db: Db,
  p: { cloneId: number; tenantId: number; userId: string | null },
): Promise<{ cloneId: number; licensedTenantId: number } | { applied: false; reason: 'license_revoked' }> {
  const [clone] = await db.select().from(studioVoiceClones).where(eq(studioVoiceClones.id, p.cloneId)).limit(1);
  // A voice that is not published to the marketplace does not exist to a buyer.
  if (!clone || clone.visibility !== 'marketplace' || clone.status !== 'published') throw new VoiceCloneNotFound();
  if (clone.priceMillicents > 0) throw new VoiceCloneLicensePaymentRequired();
  // The owner already has it; nothing to grant.
  if (clone.tenantId === p.tenantId) return { cloneId: clone.id, licensedTenantId: p.tenantId };

  await db
    .insert(studioVoiceCloneLicenses)
    .values({ tenantId: p.tenantId, userId: p.userId, cloneId: clone.id, status: 'active' })
    // An existing row stays as it is — a license the owner revoked is not undone here.
    .onConflictDoNothing({ target: [studioVoiceCloneLicenses.cloneId, studioVoiceCloneLicenses.tenantId] });
  // The insert did nothing if a row existed; a REVOKED one (owner revoked, or refunded) must be
  // reported, never answered as a grant.
  const [held] = await db
    .select({ status: studioVoiceCloneLicenses.status })
    .from(studioVoiceCloneLicenses)
    .where(and(eq(studioVoiceCloneLicenses.cloneId, clone.id), eq(studioVoiceCloneLicenses.tenantId, p.tenantId)))
    .limit(1);
  if (held?.status === 'revoked') return { applied: false, reason: 'license_revoked' };
  return { cloneId: clone.id, licensedTenantId: p.tenantId };
}
