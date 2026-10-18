import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { ackCounters, bufferCounter, drainCounters, type CounterDelta, type CounterKv, type DrainedCounter } from '../../infrastructure/cache/counterBuffer';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { deferPastResponse } from '../shared/requestScope';

/**
 * The approximate hit counters that used to be written inline on public reads:
 * skill downloads, agent-package pulls, enrichment-cache hits, landing views and
 * conversions. Each is `<column> = <column> + 1` on a row the request had just read,
 * i.e. a Postgres write per anonymous view. They now accumulate in KV
 * (`infrastructure/cache/counterBuffer`) and the `hit-counters` sweep applies them
 * as ONE statement per kind. `landing.convert` is the exception: a conversion is a
 * campaign result, so it is written directly (`applyHitDeltas`), never buffered.
 *
 * Adding a counter = one entry in {@link HIT_COUNTERS}; the sweep needs no change.
 */
interface HitCounterSpec {
  /** Trusted constants spliced as identifiers. */
  table: string;
  keyColumn: string;
  /** Cast applied to the buffered key text when matching `keyColumn`. */
  keyType: 'text' | 'integer';
  /** 'scoped' keys are `<tenantId>:<id>` and the update is tenant-guarded; 'nullable' allows
   *  a platform-wide (NULL tenant) row; 'none' keys are bare. */
  tenant: 'none' | 'scoped' | 'nullable';
  counterColumn: string;
  /** Column stamped with the latest hit time, when the surface shows "last used". */
  lastAtColumn?: string;
}

export const HIT_COUNTERS = {
  'skill.download': { table: 'marketplace_skills', keyColumn: 'slug', keyType: 'text', tenant: 'none', counterColumn: 'downloads' },
  'agent.package': { table: 'ide_agents', keyColumn: 'id', keyType: 'text', tenant: 'scoped', counterColumn: 'request_count', lastAtColumn: 'last_used_at' },
  'enrichment.hit': { table: 'enrichment_cache', keyColumn: 'id', keyType: 'integer', tenant: 'nullable', counterColumn: 'hit_count' },
  'landing.view': { table: 'landing_pages', keyColumn: 'id', keyType: 'integer', tenant: 'scoped', counterColumn: 'view_count' },
  'landing.convert': { table: 'landing_pages', keyColumn: 'id', keyType: 'integer', tenant: 'scoped', counterColumn: 'conversion_count' },
} as const satisfies Record<string, HitCounterSpec>;

export type HitCounterKind = keyof typeof HIT_COUNTERS;

const ident = (name: string): SQL => sql.raw(`"${name}"`);

/** Key for a tenant-guarded counter: `<tenantId>:<id>` (empty tenant = platform row). */
export function scopedHitKey(tenantId: number | null, id: string | number): string {
  return `${tenantId ?? ''}:${id}`;
}

function splitKey(spec: HitCounterSpec, key: string): { k: string; tn: number | null } | null {
  if (spec.tenant === 'none') return { k: key, tn: null };
  const at = key.indexOf(':');
  if (at < 0) return null;
  const tenantText = key.slice(0, at);
  const tn = tenantText === '' ? null : Number(tenantText);
  if (tn !== null && !Number.isInteger(tn)) return null;
  if (tn === null && spec.tenant === 'scoped') return null;
  return { k: key.slice(at + 1), tn };
}

/** Apply drained deltas of ONE kind in a single UPDATE … FROM jsonb_to_recordset. */
export async function applyHitDeltas(db: Db, kind: HitCounterKind, deltas: readonly CounterDelta[]): Promise<void> {
  const spec: HitCounterSpec = HIT_COUNTERS[kind];
  const rows = deltas.flatMap((d) => {
    const id = splitKey(spec, d.key);
    return id ? [{ k: id.k, tn: id.tn, n: d.n, at: d.t }] : [];
  });
  if (rows.length === 0) return;

  const keyMatch = sql`t.${ident(spec.keyColumn)} = d.k::${sql.raw(spec.keyType)}`;
  const tenantMatch = spec.tenant === 'none' ? sql`` : spec.tenant === 'scoped'
    ? sql` AND t."tenant_id" = d.tn`
    : sql` AND t."tenant_id" IS NOT DISTINCT FROM d.tn`;
  const lastAt = spec.lastAtColumn
    ? sql`, ${ident(spec.lastAtColumn)} = GREATEST(COALESCE(t.${ident(spec.lastAtColumn)}, 'epoch'::timestamp), (to_timestamp(d.at / 1000.0) AT TIME ZONE 'UTC'))`
    : sql``;

  await db.execute(sql`
    UPDATE ${ident(spec.table)} AS t
    SET ${ident(spec.counterColumn)} = t.${ident(spec.counterColumn)} + d.n${lastAt}
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS d(k text, tn integer, n integer, at bigint)
    WHERE ${keyMatch}${tenantMatch}
  `);
}

/**
 * Count one hit. Buffered in KV and applied by the sweep; when there is no KV to
 * buffer in, applied directly so the count is never silently dropped. Deferred past
 * the response — a visitor never waits on a counter.
 */
export async function recordHit(env: CounterKv, db: Db, kind: HitCounterKind, key: string): Promise<void> {
  const at = Date.now();
  const task = bufferCounter(env, kind, key, 1, at)
    .then(async (buffered) => {
      if (!buffered) await applyHitDeltas(db, kind, [{ kind, key, n: 1, t: at }]);
    })
    .catch((error) => {
      reportCaughtError(error, { source: 'application/counters/hitCounters.ts', operation: 'recordHit', level: 'warning', context: { kind } });
    });
  if (!deferPastResponse(task)) await task;
}

export function isHitCounterKind(kind: string): kind is HitCounterKind {
  return Object.prototype.hasOwnProperty.call(HIT_COUNTERS, kind);
}

/**
 * The sweep: list one page of flushed counters, apply one statement per kind, and delete
 * a kind's KV keys only after ITS statement succeeded. A failed kind keeps its keys and
 * is retried next tick, so nothing is lost; a delete that fails after a good apply
 * re-applies that delta once (a slight over-count, accepted over losing hits). Bounded
 * at one list + <=100 deletes so it stays far under the invocation's KV-operation budget.
 */
export async function flushHitCounters(env: CounterKv, db: Db): Promise<number> {
  const { counters, strayNames, complete } = await drainCounters(env);
  if (!complete) {
    reportCaughtError(new Error('hit-counter backlog: more than one KV list page pending'), {
      source: 'application/counters/hitCounters.ts', operation: 'flushHitCounters', level: 'warning',
    });
  }
  if (counters.length === 0) {
    await ackCounters(env, strayNames);
    return 0;
  }
  const byKind = new Map<HitCounterKind, DrainedCounter[]>();
  const retired: string[] = [];
  for (const d of counters) {
    if (!isHitCounterKind(d.kind)) { retired.push(...d.names); continue; } // a kind retired since it was buffered: drop it
    byKind.set(d.kind, [...(byKind.get(d.kind) ?? []), d]);
  }
  const kinds = [...byKind.entries()];
  const results = await Promise.allSettled(kinds.map(([kind, deltas]) => applyHitDeltas(db, kind, deltas)));
  const toDelete = [...strayNames, ...retired];
  let applied = 0;
  results.forEach((r, i) => {
    const [kind, deltas] = kinds[i]!;
    if (r.status === 'rejected') {
      reportCaughtError(r.reason, { source: 'application/counters/hitCounters.ts', operation: 'flushHitCounters', context: { kind } });
      return;
    }
    applied += deltas.length;
    for (const d of deltas) toDelete.push(...d.names);
  });
  await ackCounters(env, toDelete);
  return applied;
}
