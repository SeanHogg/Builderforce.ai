/**
 * THE LIFE OF A HOSTED LISTING AFTER THE SELLER STOPS.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────
 * `unpublishCreationListing` flips a listing's visibility and every licence
 * deliberately outlives it. That is exactly right for a `copy`: the buyer holds their
 * own cards on their own board, and the seller can never reach them again. It is
 * UNENFORCEABLE for a `hosted` listing, because what the buyer holds is ACCESS to an
 * instance the SELLER runs, and no flag on our side obliges anyone to keep a cloud
 * bill paid.
 *
 * Withdrawal itself was never the undefined part — "the storefront goes away and
 * existing subscribers keep working" already falls out of the licence rule, and
 * `resolveListingAccess` is where it falls out. What had no definition at all was
 * ABANDONMENT: the seller who stops answering. Until this module existed a
 * subscriber's remedy was to find a dead address and file a support ticket.
 *
 * ── WHAT THIS MODULE IS AND IS NOT ───────────────────────────────────────────────
 * It is the STATE: when the storefront closed, when the address was last seen
 * serving, and — derived from those, never stored — which of the four lifecycle
 * states the listing is in. The states, the windows and what each one permits are in
 * the shared contract (`resolveHostedLifecycle`), because they are a promise quoted
 * to a buyer before they subscribe and to a seller before they publish; a number that
 * lives only in a cron job is a promise nobody can read.
 *
 * It is NOT the money. Whether a subscription is charged this period is W1C's to
 * execute; this answers `billable` and that is the whole of the interface between
 * them — one rule, called, rather than a second reading of the same timestamps.
 */

import { eq, sql } from 'drizzle-orm';
import {
  resolveHostedLifecycle,
  type HostedLifecycle,
} from '@builderforce/creation-canvas-contract';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { hostedListingLifecycle } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
// TYPE-only, and deliberately: `creationListings.ts` imports the writers below at
// run time, so a value import back the other way would close a module cycle. The
// sweep that genuinely needs both sides lives in `creationListings.hostedSweep.ts`,
// which depends on both and is depended on by neither.
import type { ListingBody } from './creationListings';

/**
 * A subscriber asks "is my app alive" on every page they open, and the answer only
 * changes when a sweep writes. Bounded keyspace — one key per listing — so it is
 * invalidated by key on every write rather than behind a version token.
 */
const lifecycleCacheKey = (listingId: string) => `marketplace:hosted:${listingId}`;
const LIFECYCLE_TTL_SECONDS = 300;

/** The listing this seam applies to at all. Everything else is a `copy`. */
export function isHostedListing(body: ListingBody | null): boolean {
  return body?.delivery === 'hosted';
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Record what a probe found.
 *
 * ── THE ONE PIECE OF LOGIC HERE ──────────────────────────────────────────────────
 * A failing probe sets `unreachable_since` only if it is not already set — the clock
 * starts at the FIRST dark observation and does not restart on the second, or a
 * listing that is down for a year would never leave `grace`. A succeeding probe
 * clears it outright, which is what makes a four-minute deploy cost nothing.
 *
 * Written as one UPSERT rather than a read-then-write: two sweeps overlapping on the
 * same listing would otherwise race, and the loser would reset a clock that had been
 * running for a fortnight.
 */
export async function recordHostedProbe(
  db: Db,
  env: Env,
  input: { tenantId: number; listingId: string; url: string | null; ok: boolean },
): Promise<void> {
  const now = new Date();
  await db
    .insert(hostedListingLifecycle)
    .values({
      listingId: input.listingId,
      tenantId: input.tenantId,
      unreachableSince: input.ok ? null : now,
      lastProbeAt: now,
      lastProbeOk: input.ok,
      lastProbeUrl: input.url?.slice(0, 1024) ?? null,
    })
    .onConflictDoUpdate({
      target: hostedListingLifecycle.listingId,
      set: {
        unreachableSince: input.ok
          ? sql`null`
          : sql`coalesce(${hostedListingLifecycle.unreachableSince}, ${now})`,
        lastProbeAt: now,
        lastProbeOk: input.ok,
        lastProbeUrl: input.url?.slice(0, 1024) ?? null,
        updatedAt: now,
      },
    });
  await invalidateCached(env, lifecycleCacheKey(input.listingId));
}

/**
 * Record that the seller closed the shop window — or reopened it.
 *
 * Deliberately does NOT touch `unreachable_since`. Withdrawing a hosted listing is a
 * decision to stop SELLING, and a seller who keeps their instance running for the
 * people already on it owes nothing further. Conflating the two would start an
 * abandonment clock against a seller behaving perfectly.
 */
export async function recordHostedWithdrawal(
  db: Db,
  env: Env,
  input: { tenantId: number; listingId: string; withdrawn: boolean },
): Promise<void> {
  const now = new Date();
  const withdrawnAt = input.withdrawn ? now : null;
  await db
    .insert(hostedListingLifecycle)
    .values({ listingId: input.listingId, tenantId: input.tenantId, withdrawnAt })
    .onConflictDoUpdate({
      target: hostedListingLifecycle.listingId,
      set: { withdrawnAt, updatedAt: now },
    });
  await invalidateCached(env, lifecycleCacheKey(input.listingId));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface HostedListingStatus extends HostedLifecycle {
  listingId: string;
  withdrawnAtISO: string | null;
  lastProbeAtISO: string | null;
  lastProbeUrl: string | null;
}

/**
 * Where this hosted listing stands, right now.
 *
 * Cross-tenant and DECLARED as such: the row lives in the SELLER's workspace and the
 * person who most needs the answer is a subscriber in a different one — or in no
 * workspace at all, since a `hosted` purchase issues a `site_user` rather than a
 * tenant membership. The access predicate in place of a tenant filter is the listing
 * id, which the caller only has because it resolved a public catalogue row.
 *
 * Never returns null for a listing with no row: no row means nothing has ever been
 * observed dark, which is the `operating` state and not an absence of information.
 */
export async function hostedListingStatus(
  db: Db,
  env: Env,
  listingId: string,
): Promise<HostedListingStatus> {
  return getOrSetCached(env, lifecycleCacheKey(listingId), async () => {
    const [row] = await db
      .select()
      .from(hostedListingLifecycle)
      .where(acrossTenants(hostedListingLifecycle, 'public_catalogue',
        eq(hostedListingLifecycle.listingId, listingId)))
      .limit(1);
    return {
      listingId,
      withdrawnAtISO: row?.withdrawnAt?.toISOString() ?? null,
      lastProbeAtISO: row?.lastProbeAt?.toISOString() ?? null,
      lastProbeUrl: row?.lastProbeUrl ?? null,
      ...resolveHostedLifecycle({ unreachableSinceISO: row?.unreachableSince?.toISOString() ?? null }),
    } satisfies HostedListingStatus;
  }, { kvTtlSeconds: LIFECYCLE_TTL_SECONDS });
}

