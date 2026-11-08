/**
 * The clones a workspace can use: the ones it OWNS plus the ones it holds an active
 * LICENSE for.
 *
 * Licensed voices belong to ANOTHER tenant, so they are selected by the buyer's
 * license rows (the access predicate), never by owner tenant — filtering them with
 * the buyer's own tenant id hid every voice a buyer had actually licensed. The
 * cross-tenant read is declared with `acrossTenants`, and is bounded to exactly the
 * clone ids this tenant's active licenses name.
 */

import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { studioVoiceCloneLicenses, studioVoiceClones } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';

/** Each of the two lists (owned, licensed) is capped; a workspace beyond it sees the newest. */
export const USABLE_CLONES_PER_LIST = 200;

export async function listUsableClones(
  db: Db,
  tenantId: number,
): Promise<Array<typeof studioVoiceClones.$inferSelect>> {
  // Deterministic: newest first, id as the tiebreak so equal timestamps never reshuffle.
  const owned = await db
    .select()
    .from(studioVoiceClones)
    .where(eq(studioVoiceClones.tenantId, tenantId))
    .orderBy(desc(studioVoiceClones.createdAt), desc(studioVoiceClones.id))
    .limit(USABLE_CLONES_PER_LIST);

  const licenseRows = await db
    .select({ cloneId: studioVoiceCloneLicenses.cloneId })
    .from(studioVoiceCloneLicenses)
    .where(and(eq(studioVoiceCloneLicenses.tenantId, tenantId), eq(studioVoiceCloneLicenses.status, 'active')))
    .orderBy(desc(studioVoiceCloneLicenses.id))
    .limit(USABLE_CLONES_PER_LIST);
  const licensedIds = licenseRows.map((r) => r.cloneId);
  const licensed = licensedIds.length
    ? await db
        .select()
        .from(studioVoiceClones)
        .where(acrossTenants(studioVoiceClones, 'subject_own_rows', inArray(studioVoiceClones.id, licensedIds)))
        .orderBy(desc(studioVoiceClones.createdAt), desc(studioVoiceClones.id))
        .limit(USABLE_CLONES_PER_LIST)
    : [];

  return [...owned, ...licensed];
}
