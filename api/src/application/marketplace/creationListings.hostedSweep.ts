/**
 * KEEPING THE HOSTED LIFECYCLE HONEST — the thing that keeps asking.
 *
 * ── WHY A SWEEP AND NOT A CHECK ON READ ──────────────────────────────────────────
 * `creationListings.hosted.ts` derives four lifecycle states from ONE observation:
 * when the address was first seen dark. Something has to make that observation, and
 * the obvious alternative — probe when a subscriber opens the app — is wrong twice
 * over. It puts an outbound fetch on the hottest cached path in the product, and it
 * only ever notices an outage while somebody is watching, which is precisely the
 * moment the grace clock should already have been running for a week. Abandonment is
 * defined by ELAPSED TIME, so the platform has to keep asking whether anyone is
 * looking or not.
 *
 * ── WHY IT IS ITS OWN FILE ───────────────────────────────────────────────────────
 * It is the one piece that needs both sides: the lifecycle writers and the listing's
 * published snapshot (where the address lives). Keeping it here leaves
 * `creationListings.ts → creationListings.hosted.ts` a one-way edge instead of a
 * module cycle.
 */

import { isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { catalogItems } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { deploymentProbe } from './stageChecks.probe';
import { liveUrl, type StageObject } from './stageChecks';
import { publishedSnapshot, type ListingBody } from './creationListings';
import { recordHostedProbe } from './creationListings.hosted';

/**
 * Bounded on purpose, and ordered by staleness.
 *
 * A sweep over an unbounded set is a sweep that times out and leaves whatever is at
 * the tail permanently unobserved — which for this seam means the listings nobody
 * has touched in months, the exact population most likely to be abandoned.
 */
const SWEEP_LIMIT = 200;

/**
 * Ask every published hosted listing's address whether it is still serving.
 *
 * Every probe goes through the SAME `deploymentProbe` Stage uses, so a listing
 * cannot pass Stage on one definition of "serving" and be marked dark by another.
 *
 * A listing with no resolvable address is skipped rather than marked dark: that is a
 * malformed listing, and the deployment harness already refuses to publish one.
 */
export async function runHostedListingSweep(
  db: Db,
  env: Env,
): Promise<{ probed: number; dark: number }> {
  const rows = await db
    .select({ id: catalogItems.id, tenantId: catalogItems.tenantId, body: catalogItems.body })
    .from(catalogItems)
    // Cross-tenant by definition: this is the platform keeping a promise it made to
    // buyers in every workspace, about sellers in every other one. The access
    // predicate is the delivery shape — only listings that sell ACCESS have an
    // address anyone is owed.
    .where(acrossTenants(catalogItems, 'public_catalogue',
      sql`${catalogItems.body}->>'delivery' = 'hosted'`,
      isNotNull(catalogItems.publishedAt)))
    .orderBy(sql`${catalogItems.updatedAt} asc`)
    .limit(SWEEP_LIMIT);

  const probe = deploymentProbe(db, env);
  let dark = 0;
  for (const row of rows) {
    const body = row.body as ListingBody | null;
    // A catalogue row with no tenant is a platform preset, not somebody's product —
    // it has no seller to hold to a promise and no subscriber to owe one to.
    if (!body?.snapshotId || row.tenantId == null) continue;
    // The address comes from the snapshot the listing is CURRENTLY serving, read
    // through the same cached, immutable-by-construction accessor the launch path
    // uses — so the sweep and the buyer are pointed at one address.
    const payload = await publishedSnapshot(db, env, body.snapshotId);
    const url = payload ? liveUrl(payload.objects as readonly StageObject[]) : null;
    if (!url) continue;
    const result = await probe(url);
    const ok = result.root === 'ok' && result.health !== 'breach';
    if (!ok) dark += 1;
    await recordHostedProbe(db, env, { tenantId: row.tenantId, listingId: row.id, url, ok });
  }
  return { probed: rows.length, dark };
}
