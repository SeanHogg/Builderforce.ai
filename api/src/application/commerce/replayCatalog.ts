/**
 * Session-replay recording packs — the published ladder (PRD 33 §8 S6 / D4).
 *
 * The unit is one KEPT recording of up to 2 MiB; a larger one costs
 * `ceil(bytes / 2 MiB)` units, never less than one. Packs last twelve months
 * from the grant. The free monthly allowance (5,000 recordings) is not a pack:
 * it is an implicit grant that resets on the calendar month, tracked as spend
 * against a `free:yyyy-mm` ledger account rather than a second balance table.
 *
 * The ladder's source of truth is the platform-published `session-replay`
 * capability listing (`catalog_items`, written by migration 1218): its `body`
 * carries `packs` and `freeMonthlyUnits`, and {@link loadReplayCatalog} reads
 * them (cached). The constants below are the parser's fallback for an
 * environment where that row is missing or malformed — the shop keeps selling
 * the D4 ladder rather than refusing.
 */

import { and, eq, isNull } from 'drizzle-orm';
import type { ReplayPackDto } from '@builderforce/interaction-contract';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { catalogItems } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { billableUnits, REPLAY_UNIT_BYTES } from '../../domain/replay/billing';
import { CAPABILITY_LISTING_KIND, CAPABILITY_PUBLISHER_REF } from '../../domain/tenant/capabilityFeatures';

export const SESSION_REPLAY_SLUG = 'session-replay';
export const SESSION_REPLAY_ADDON = 'session_replay';

/** One recording = one kept recording of up to this many bytes — owned by the domain billing rule. */
export { REPLAY_UNIT_BYTES };

/** Implicit monthly grant for an installed (or superadmin) workspace. */
export const REPLAY_FREE_MONTHLY_UNITS = 5_000;

/** Paid credits expire this many calendar months after the grant. */
export const REPLAY_CREDIT_TTL_MONTHS = 12;

/** Auto-recharge fires when remaining paid credits drop below this fraction of the chosen pack. */
export const REPLAY_AUTORECHARGE_THRESHOLD = 0.1;

/**
 * Ledger denomination for recording units. Intentionally a string, not a
 * `Denomination` from `kernel/denominations.ts` — that union is owned by
 * another workstream, and `prepaidBalance()` cannot name a unit the union
 * does not contain. The column itself is a varchar; writers here stamp this
 * value directly.
 */
export const REPLAY_RECORDINGS_DENOMINATION = 'replay_recordings';

/** One pack on the ladder — the wire shape (`ReplayPackDto`): `amountCents` is USD cents. */
export type ReplayPack = ReplayPackDto;

/**
 * D4 ladder. Ids are stable: they are what checkout metadata stamps, so a
 * rename would orphan in-flight sessions.
 */
export const REPLAY_PACKS: readonly ReplayPack[] = [
  { id: 'p10k', units: 10_000, amountCents: 4_000 },
  { id: 'p50k', units: 50_000, amountCents: 14_000 },
  { id: 'p150k', units: 150_000, amountCents: 24_000 },
  { id: 'p500k', units: 500_000, amountCents: 65_000 },
  { id: 'p1m', units: 1_000_000, amountCents: 120_000 },
];

/** Body shape the `session-replay` catalog item is expected to carry. */
export interface ReplayCatalogBody {
  addon: typeof SESSION_REPLAY_ADDON;
  freeMonthlyUnits: number;
  unitBytes: number;
  packs: ReplayPack[];
}

export const DEFAULT_REPLAY_CATALOG_BODY: ReplayCatalogBody = {
  addon: SESSION_REPLAY_ADDON,
  freeMonthlyUnits: REPLAY_FREE_MONTHLY_UNITS,
  unitBytes: REPLAY_UNIT_BYTES,
  packs: [...REPLAY_PACKS],
};

export function replayPack(id: string, packs: readonly ReplayPack[] = REPLAY_PACKS): ReplayPack | null {
  return packs.find((pack) => pack.id === id) ?? null;
}

/**
 * Units charged for a visit. Zero or negative bytes still cost one unit — a
 * heartbeat with no payload is still a visit that occupied a slot.
 */
export function unitsForBytes(bytes: number): number {
  return billableUnits(bytes);
}

/** Calendar month key (`yyyy-mm`, UTC) the free allowance resets on. */
export function replayPeriod(at: Date = new Date()): string {
  const y = at.getUTCFullYear();
  const m = String(at.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function replayCreditExpiresAt(grantedAt: Date, months: number = REPLAY_CREDIT_TTL_MONTHS): Date {
  const expires = new Date(grantedAt.getTime());
  expires.setUTCMonth(expires.getUTCMonth() + months);
  return expires;
}

/**
 * Same-tenant + same-pack + same UTC hour = one Stripe session, so a
 * double-click does not open two checkouts the buyer could pay twice.
 */
export function replayCheckoutIdempotencyKey(tenantId: number, packId: string, now: Date = new Date()): string {
  const hour = now.toISOString().slice(0, 13).replace('T', '-');
  return `replay-pack:${tenantId}:${packId}:${hour}`;
}

function asPositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

function parsePack(value: unknown): ReplayPack | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || row.id.length === 0) return null;
  const units = asPositiveInt(row.units);
  const amountCents = asPositiveInt(row.amountCents);
  if (units === null || amountCents === null) return null;
  return { id: row.id, units, amountCents };
}

/**
 * Read packs out of a catalog item's jsonb body. Returns null when the body
 * is missing, malformed, or has no usable packs — callers fall back to
 * {@link REPLAY_PACKS} rather than refusing to sell.
 */
export function packsFromCatalogBody(body: unknown): ReplayPack[] | null {
  if (!body || typeof body !== 'object') return null;
  const raw = (body as { packs?: unknown }).packs;
  if (!Array.isArray(raw)) return null;
  const packs: ReplayPack[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const pack = parsePack(entry);
    if (!pack || seen.has(pack.id)) continue;
    seen.add(pack.id);
    packs.push(pack);
  }
  return packs.length > 0 ? packs : null;
}

export function freeMonthlyFromCatalogBody(body: unknown): number {
  if (!body || typeof body !== 'object') return REPLAY_FREE_MONTHLY_UNITS;
  const value = asPositiveInt((body as { freeMonthlyUnits?: unknown }).freeMonthlyUnits);
  return value ?? REPLAY_FREE_MONTHLY_UNITS;
}

/** What the published listing says, with the D4 fallbacks applied. */
export interface ReplayCatalog {
  /** `catalog_items.id` of the listing, or null when the row does not exist. */
  listingId: string | null;
  packs: readonly ReplayPack[];
  freeMonthlyUnits: number;
}

const REPLAY_CATALOG_CACHE_KEY = 'replay:catalog:session-replay';

/**
 * The platform's `session-replay` capability row. Platform-published only
 * (`tenant_id IS NULL`, `publisher_ref = 'builderforce'`), so a seller's listing
 * that happens to share the slug can never price a pack.
 */
export async function loadReplayCatalog(env: Env | undefined, db: Db): Promise<ReplayCatalog> {
  return getOrSetCached(env, REPLAY_CATALOG_CACHE_KEY, async (): Promise<ReplayCatalog> => {
    const [row] = await db
      .select({ id: catalogItems.id, body: catalogItems.body })
      .from(catalogItems)
      .where(acrossTenants(catalogItems, 'public_catalogue', and(
        eq(catalogItems.slug, SESSION_REPLAY_SLUG),
        eq(catalogItems.kind, CAPABILITY_LISTING_KIND),
        isNull(catalogItems.tenantId),
        eq(catalogItems.publisherRef, CAPABILITY_PUBLISHER_REF),
      )))
      .limit(1);
    return {
      listingId: row?.id ?? null,
      packs: (row ? packsFromCatalogBody(row.body) : null) ?? REPLAY_PACKS,
      freeMonthlyUnits: row ? freeMonthlyFromCatalogBody(row.body) : REPLAY_FREE_MONTHLY_UNITS,
    };
  }, { kvTtlSeconds: 10 * 60 });
}
