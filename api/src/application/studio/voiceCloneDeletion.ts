/**
 * Delete a voice clone (owner only) — the right-to-delete path: purge its R2
 * objects (reference + every synthesized voiceover), remove the row (its license
 * bookkeeping cascades), and invalidate every list it could still appear in,
 * including each licensee's.
 */

import { eq } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { studioVoiceCloneLicenses, studioVoiceClones, studioVoiceovers } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { invalidateMarketplaceClones, invalidateUsableClones } from './voiceCloneCatalog';

export type DeleteVoiceCloneResult = 'deleted' | 'not_found' | 'forbidden';

export async function deleteVoiceClone(
  db: Db,
  env: Env,
  { tenantId, cloneId }: { tenantId: number; cloneId: number },
): Promise<DeleteVoiceCloneResult> {
  const [clone] = await db
    .select()
    .from(studioVoiceClones)
    .where(scopedToTenant(studioVoiceClones, tenantId, eq(studioVoiceClones.id, cloneId)))
    .limit(1);
  if (!clone) return 'not_found';
  if (clone.tenantId !== tenantId) return 'forbidden';

  // Right-to-delete: collect the tenants who licensed this clone BEFORE the row
  // cascade removes the license bookkeeping. Their cached list (which merges in
  // licensed clones) must be invalidated too, or a deleted clone lingers in a
  // licensee's list for up to the cache TTL after the owner exercises deletion.
  const licenseeRows = await db
    .select({ tenantId: studioVoiceCloneLicenses.tenantId })
    .from(studioVoiceCloneLicenses)
    .where(eq(studioVoiceCloneLicenses.cloneId, cloneId));
  const licenseeTenantIds = [...new Set(licenseeRows.map((r) => r.tenantId))].filter(
    (id) => id !== tenantId,
  );

  // Purge R2 objects (reference + every synthesized voiceover) before the row
  // cascade removes their bookkeeping.
  if (env.UPLOADS) {
    if (clone.referenceKey) await env.UPLOADS.delete(clone.referenceKey).catch((error) => {
      reportCaughtError(error, { source: "application/studio/voiceCloneDeletion.ts", operation: "deleteVoiceClone" });
    });
    const voiceovers = await db
      .select({ audioKey: studioVoiceovers.audioKey })
      .from(studioVoiceovers)
      .where(scopedToTenant(studioVoiceovers, tenantId, eq(studioVoiceovers.cloneId, cloneId)));
    await Promise.all(voiceovers.map((v) => env.UPLOADS!.delete(v.audioKey).catch((error) => {
      reportCaughtError(error, { source: "application/studio/voiceCloneDeletion.ts", operation: "deleteVoiceClone" });
    })));
  }

  await db.delete(studioVoiceClones).where(scopedToTenant(studioVoiceClones, tenantId, eq(studioVoiceClones.id, cloneId)));
  await invalidateUsableClones(env, tenantId);
  if (clone.visibility === 'marketplace') await invalidateMarketplaceClones(env);
  // Invalidate every licensee's list cache so the deletion is immediate for them too.
  await Promise.all(licenseeTenantIds.map((id) => invalidateUsableClones(env, id)));
  return 'deleted';
}
