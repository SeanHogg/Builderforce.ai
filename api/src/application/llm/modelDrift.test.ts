/**
 * MODEL DRIFT RECONCILIATION — the guard that turns a vendor deprecation into a
 * red build instead of a 404 at dispatch weeks later.
 *
 * Two things in this repo are hand-maintained lists of vendor model ids: the per-
 * vendor `catalog` arrays (which compose FREE/PRO/CODING pools) and
 * {@link SUPERSEDED_MODEL_IDS} (which rewrites stale stored pins). Both are only
 * true for as long as the vendor keeps serving those ids, and nothing about the
 * repo notices when one stops. The observed failure is quiet: a retired id stays
 * at the head of a pool, every request burns an attempt on a 404, and the symptom
 * ("byo_unavailable", "degraded onto a non-coder") points nowhere near the cause.
 *
 * This test reconciles both lists against a COMMITTED SNAPSHOT of each vendor's
 * live `/models` payload (`vendors/liveModels.snapshot.json`, refreshed by
 * `npm run models:refresh`). The snapshot, not a live fetch, is what CI reads —
 * a guard that calls four vendor APIs on every push goes red for reasons nobody
 * caused, and a guard like that gets disabled. The teeth come from the staleness
 * gate below: the snapshot cannot be left un-refreshed indefinitely, and the
 * moment it IS refreshed every retired id fails here.
 *
 * SCOPE IS SOURCE-DRIVEN, deliberately. A vendor is judged only when the snapshot
 * carries a source for it — Cloudflare and direct-Anthropic need a credential this
 * repo does not hold, so their ids are out of scope rather than falsely reported
 * missing. Adding a source to `refresh-model-snapshot.mjs` is what widens the net.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  SUPERSEDED_MODEL_IDS,
  canonicalModelId,
  CODING_MODEL_POOL,
  FREE_MODEL_POOL,
  PRO_PAID_MODEL_POOL,
} from './modelPool';
import { getCatalog, catalogEntry, type VendorId } from './vendors';

/**
 * How long a snapshot may sit un-refreshed before the build fails. Long enough
 * that a normal week of work never trips it, short enough that a retired id is
 * caught in the same quarter it retires.
 */
const MAX_SNAPSHOT_AGE_DAYS = 45;

interface SnapshotSource {
  vendor: VendorId;
  url: string;
  reachable: boolean;
  lastError?: string;
  /** `tools: true|false` when the vendor reports capability, `null` when unknown. */
  models: Record<string, { tools: boolean | null }>;
}
interface Snapshot {
  fetchedAt: string;
  sources: Record<string, SnapshotSource>;
}

const snapshot: Snapshot = JSON.parse(
  readFileSync(fileURLToPath(new URL('./vendors/liveModels.snapshot.json', import.meta.url).href), 'utf8'),
);

/**
 * Liveness is PER VENDOR, never global. Model ids are not unique across vendors —
 * `google/gemma-4-31b-it` is served by both OpenRouter and NIM, and several ids
 * exist on one and not the other. A flattened id set would therefore pass a NIM
 * catalog entry that only OpenRouter serves, which is exactly the 404 this guard
 * exists to catch. The question is always "does THIS vendor serve this id".
 */
const LIVE_BY_VENDOR = new Map<VendorId, Map<string, { tools: boolean | null }>>();
for (const source of Object.values(snapshot.sources)) {
  const existing = LIVE_BY_VENDOR.get(source.vendor) ?? new Map();
  for (const [id, rec] of Object.entries(source.models)) existing.set(id, rec);
  LIVE_BY_VENDOR.set(source.vendor, existing);
}

/** Vendors the snapshot can speak for. Everything else is out of scope. */
const COVERED: ReadonlySet<VendorId> = new Set(LIVE_BY_VENDOR.keys());

const catalog = getCatalog();

/**
 * The vendor that would actually SERVE this id. Deliberately the catalog lookup
 * rather than `vendorForModel`, which falls back to OpenRouter for anything it
 * does not recognise — that fallback would claim every retired bare id as an
 * OpenRouter model and report it missing from a vendor that never served it.
 */
function servingVendor(id: string): VendorId | undefined {
  return catalogEntry(id)?.vendor;
}

/** Is this id one the snapshot is entitled to judge? */
function inScope(id: string): boolean {
  const vendor = servingVendor(id);
  return vendor !== undefined && COVERED.has(vendor);
}

/** Does the vendor that serves this id still list it? Only ask when {@link inScope}. */
function isLive(id: string): boolean {
  const vendor = servingVendor(id);
  return vendor !== undefined && (LIVE_BY_VENDOR.get(vendor)?.has(id) ?? false);
}

/** The vendor's own capability flag for this id — `null` when it reports none. */
function liveTools(id: string): boolean | null | undefined {
  const vendor = servingVendor(id);
  return vendor === undefined ? undefined : LIVE_BY_VENDOR.get(vendor)?.get(id)?.tools;
}

describe('live `/models` snapshot', () => {
  it('is fresh enough to be evidence', () => {
    const ageDays = (Date.now() - Date.parse(snapshot.fetchedAt)) / 86_400_000;
    expect(
      ageDays,
      `The vendor-catalog snapshot is ${Math.floor(ageDays)} days old. Run \`npm run models:refresh\` `
      + '(from api/) and fix whatever drift it surfaces — a stale snapshot means this guard is '
      + 'reconciling against a vendor catalog that no longer exists.',
    ).toBeLessThan(MAX_SNAPSHOT_AGE_DAYS);
  });

  it('covers at least one vendor and records why any source is missing', () => {
    expect(Object.keys(snapshot.sources).length).toBeGreaterThan(0);
    for (const [id, source] of Object.entries(snapshot.sources)) {
      // An unreachable source keeps its last-known models plus the reason, so the
      // guard degrades to "judging on older evidence" rather than to a blind spot.
      if (!source.reachable) expect(source.lastError, `${id} is unreachable with no recorded reason`).toBeTruthy();
      expect(Object.keys(source.models).length, `${id} has an empty model list`).toBeGreaterThan(0);
    }
  });
});

describe('vendor catalog vs live `/models`', () => {
  it('serves every catalog id the snapshot is authoritative for', () => {
    const retired = catalog
      .filter((e) => COVERED.has(e.vendor) && !LIVE_BY_VENDOR.get(e.vendor)!.has(e.id))
      .map((e) => `${e.vendor}: ${e.id}`);
    expect(
      retired,
      'These catalog ids are no longer served by their vendor. A pool containing one burns an '
      + 'attempt on a 404 every request. Replace the id in its vendor module (and add a '
      + 'SUPERSEDED_MODEL_IDS row when a stored pin could still name it).',
    ).toEqual([]);
  });
});

describe('routing pools vs live `/models`', () => {
  /**
   * The pools are DISPATCH lists — every id in one is a model we will actually
   * send to. A retired id here is the exact "stale hardcoded id silently routes to
   * a 404 backstop" failure the register names.
   */
  it.each([
    ['FREE_MODEL_POOL', FREE_MODEL_POOL],
    ['PRO_PAID_MODEL_POOL', PRO_PAID_MODEL_POOL],
    ['CODING_MODEL_POOL', CODING_MODEL_POOL],
  ] as const)('%s routes only to ids the vendor still serves', (_label, pool) => {
    expect(pool.filter((id) => inScope(id) && !isLive(id))).toEqual([]);
  });

  /**
   * `supported_parameters: tools` is the filter the register asks for, and it only
   * binds on the CODING pool: the FREE/PRO pools legitimately carry chat-only
   * models for non-tool traffic, whereas a coding run's first turn IS a tool call.
   * `tools: null` (vendor reports no capability metadata, e.g. NIM) is "unknown",
   * never "incapable" — a guard that failed on unknown would force us to drop
   * every NIM model from the coding pool for a reason we never measured.
   */
  it('CODING_MODEL_POOL contains no model the vendor reports as tool-incapable', () => {
    const incapable = CODING_MODEL_POOL.filter((id) => liveTools(id) === false);
    expect(
      incapable,
      'A coding run\'s first turn is a tool call — a model without `tools` 400s or silently '
      + 'answers in prose. Remove these from CODING_MODEL_POOL.',
    ).toEqual([]);
  });
});

describe('SUPERSEDED_MODEL_IDS vs live `/models`', () => {
  /**
   * The successor is what we DISPATCH after a rewrite. If it is not live, the map
   * has swapped one undispatchable pin for another — strictly worse than leaving
   * the stale id alone, because the trace now names a model nobody pinned.
   */
  it('every successor is still served', () => {
    const dead = Object.entries(SUPERSEDED_MODEL_IDS)
      .filter(([, to]) => inScope(to) && !isLive(to))
      .map(([from, to]) => `${from} → ${to} (successor not served)`);
    expect(dead).toEqual([]);
  });

  /**
   * A key is either STILL SERVED (mapped early — fine, the rewrite is a forward
   * pin, not a repair) or RETIRED (which is what the row exists for). The case
   * that must not exist is a key that is still served AND is itself in the
   * catalog under a live entry we would rather have dispatched: that would mean
   * we are rewriting away from a working model. Assert the resolved end of every
   * chain lands somewhere live.
   */
  it('every key resolves through the chain to a live id', () => {
    const unresolved = Object.keys(SUPERSEDED_MODEL_IDS)
      .map((from) => [from, canonicalModelId(from)] as const)
      .filter(([, to]) => inScope(to) && !isLive(to))
      .map(([from, to]) => `${from} resolves to ${to}, which is not served`);
    expect(unresolved).toEqual([]);
  });

  /**
   * The drift the register actually asks for: a vendor retires an id we still
   * name in a catalog, and nobody adds the supersession row. Everything in scope
   * that has disappeared from live must have a row here.
   */
  it('every catalog id that has disappeared from live has a supersession row', () => {
    const unmapped = catalog
      .filter((e) => COVERED.has(e.vendor) && !LIVE_BY_VENDOR.get(e.vendor)!.has(e.id) && !SUPERSEDED_MODEL_IDS[e.id])
      .map((e) => e.id);
    expect(
      unmapped,
      'Add `old: new` to SUPERSEDED_MODEL_IDS (or drop the catalog entry) so stored pins on '
      + 'the retired id keep dispatching.',
    ).toEqual([]);
  });
});
