/**
 * Session-replay recording packs — the published ladder (PRD 33 §8 S6 / D4).
 *
 * The unit is one visit of up to 2 MiB; a larger visit costs
 * `ceil(bytes / 2 MiB)` units, never less than one. Packs last twelve months
 * from the grant. The free monthly allowance (5,000 recordings) is not a pack:
 * it is an implicit grant that resets on the calendar month, tracked as spend
 * against a `free:yyyy-mm` ledger account rather than a second balance table.
 *
 * Pack prices also live on the `session-replay` catalog item's body when that
 * listing exists. This module is the fallback AND the parser, so checkout can
 * settle before the listing workstream lands, and picks up the listing's
 * prices the moment it does — without this slice writing `catalog_items`.
 */

export const SESSION_REPLAY_SLUG = 'session-replay';
export const SESSION_REPLAY_ADDON = 'session_replay';

/** One recording = one visit of up to this many bytes. */
export const REPLAY_UNIT_BYTES = 2_097_152;

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

export interface ReplayPack {
  id: string;
  units: number;
  /** USD cents charged for the pack. */
  cents: number;
}

/**
 * D4 ladder. Ids are stable: they are what checkout metadata stamps, so a
 * rename would orphan in-flight sessions.
 */
export const REPLAY_PACKS: readonly ReplayPack[] = [
  { id: 'p10k', units: 10_000, cents: 4_000 },
  { id: 'p50k', units: 50_000, cents: 14_000 },
  { id: 'p150k', units: 150_000, cents: 24_000 },
  { id: 'p500k', units: 500_000, cents: 65_000 },
  { id: 'p1m', units: 1_000_000, cents: 120_000 },
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
  if (!Number.isFinite(bytes) || bytes <= 0) return 1;
  return Math.max(1, Math.ceil(bytes / REPLAY_UNIT_BYTES));
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
  const cents = asPositiveInt(row.cents);
  if (units === null || cents === null) return null;
  return { id: row.id, units, cents };
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
