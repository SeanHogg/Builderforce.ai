/**
 * "When did this sweep last look at item X?" for a cron sweep, kept OUT of Postgres.
 *
 * A per-repo sweep needs a rotation key — the moment it last checked each item — so
 * the next tick knows what is due. Storing that as a column (or as a run row) makes
 * every check a database write even when the check found nothing, and on Neon any
 * write keeps the compute from autosuspending. This keeps the whole map as ONE entry
 * on the shared read-through cache (L1 + `AUTH_CACHE_KV`): one KV read per tick, and
 * one KV write per tick that actually checked something.
 *
 * Each caller passes a DB fallback per item (the column it used to stamp, now written
 * only alongside a real change), and an item's last check is the NEWER of the two.
 * So a cold or unbound KV degrades to the old column cadence, never to "everything is
 * due forever" or "nothing is ever due".
 *
 * Not a lock: two writers racing on the ledger can lose a stamp, which only costs one
 * extra check of that item. Callers must therefore be idempotent per check.
 */
import { peekCached, setCached, type CacheEnv } from './readThroughCache';

/** Default retention for a stamp: older ones are pruned on save so the map stays bounded. */
const DEFAULT_RETAIN_MS = 3 * 86_400_000;
/** The KV entry outlives the retention, so a quiet weekend does not reset the rotation. */
const LEDGER_KV_TTL_SECONDS = 7 * 86_400;
/** In-isolate freshness: short, so a reader in the cron isolate sees another isolate's stamps soon. */
const LEDGER_L1_TTL_MS = 60_000;

type StampMap = Record<string, number>;
export type StampFallback = Date | string | number | null | undefined;

export interface SweepStampLedger {
  /** The KV stamp for `id` (epoch ms), or null. */
  at(id: string): number | null;
  /** The effective last check: the newer of the KV stamp and the DB `fallback`. */
  lastChecked(id: string, fallback?: StampFallback): number | null;
  /**
   * The rows whose last check is at least `intervalMs` old (never-checked first, then
   * oldest-checked first), at most `limit`. Pure over the loaded ledger.
   */
  due<T>(rows: readonly T[], opts: {
    id: (row: T) => string;
    fallback?: (row: T) => StampFallback;
    intervalMs: number;
    limit: number;
    now?: number;
  }): T[];
  /** Record a check of `id` now (in memory until {@link save}). */
  stamp(id: string, now?: number): void;
  /** Persist the stamps — a no-op when nothing was stamped since load. */
  save(): Promise<void>;
}

function toMs(value: StampFallback): number | null {
  if (value == null) return null;
  const ms = typeof value === 'number' ? value : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Load the stamp ledger stored under `key`. Never throws: a miss reads as "no stamps". */
export async function loadSweepStamps(
  env: CacheEnv,
  key: string,
  opts: { retainMs?: number } = {},
): Promise<SweepStampLedger> {
  const stored = await peekCached<StampMap>(env, key);
  // Copy: L1 may hand back the very object it holds, which must not be mutated in place.
  const stamps: StampMap = stored && typeof stored === 'object' ? { ...stored } : {};
  const retainMs = opts.retainMs ?? DEFAULT_RETAIN_MS;
  let dirty = false;

  const at = (id: string): number | null => toMs(stamps[id]);
  const lastChecked = (id: string, fallback?: StampFallback): number | null => {
    const kv = at(id);
    const db = toMs(fallback);
    if (kv == null) return db;
    return db == null ? kv : Math.max(kv, db);
  };

  return {
    at,
    lastChecked,
    due(rows, { id, fallback, intervalMs, limit, now = Date.now() }) {
      return rows
        .map((row) => ({ row, last: lastChecked(id(row), fallback?.(row)) }))
        .filter(({ last }) => last == null || now - last >= intervalMs)
        .sort((a, b) => (a.last ?? -Infinity) - (b.last ?? -Infinity))
        .slice(0, Math.max(0, limit))
        .map(({ row }) => row);
    },
    stamp(id, now = Date.now()) {
      stamps[id] = now;
      dirty = true;
    },
    async save() {
      if (!dirty) return;
      const floor = Date.now() - retainMs;
      const kept: StampMap = {};
      for (const [id, ms] of Object.entries(stamps)) if (ms >= floor) kept[id] = ms;
      await setCached(env, key, kept, { kvTtlSeconds: LEDGER_KV_TTL_SECONDS, l1TtlMs: LEDGER_L1_TTL_MS });
      dirty = false;
    },
  };
}
