/**
 * Filter-bar value suggestions (PRD 33 §2.1, §8 S4c `filter-options`): the distinct
 * values each open-vocabulary filter field takes on the site's KEPT recordings in
 * the window, most recordings first, capped at {@link FILTER_OPTIONS_MAX}.
 *
 * One grouped statement per field, run together; cached under the site version.
 * Enum fields (device, frustration) and free ranges (durations) need no lookup —
 * their values are contract data.
 */

import { and, desc, eq, gte, isNotNull, ne, sql, type SQL } from 'drizzle-orm';
import type { ReplayFilterOptionsDto } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { replayRecordings } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import type { ReplayScope } from '../../domain/replay/replayScope';
import { replayReadKeys } from './replayCacheKeys';
import { replayTelemetryDb } from './replayDatabase';
import { clampDays } from './replayReadModel';
import { DAY_MS } from '../../domain/shared/time';

export const FILTER_OPTIONS_MAX = 50;

/** Fields that read a scalar column. */
const COLUMN_FIELDS = {
  browser: replayRecordings.browser,
  os: replayRecordings.os,
  country: replayRecordings.country,
  referrer: replayRecordings.referrerHost,
  release: replayRecordings.releaseKey,
} as const;

/** Fields that read an element of an array / object column (FROM-clause set-returning function). */
const SET_FIELDS = {
  smartEvent: (alias: SQL) => sql`unnest(${replayRecordings.events}) as ${alias}`,
  tag: (alias: SQL) => sql`jsonb_object_keys(${replayRecordings.tags}) as ${alias}`,
} as const;

export const FILTER_OPTION_FIELDS = [...Object.keys(COLUMN_FIELDS), ...Object.keys(SET_FIELDS)] as readonly string[];

type Row = { value: unknown; n: unknown };

function toValues(rows: readonly Row[]): ReplayFilterOptionsDto['values'] {
  return rows
    .filter((row) => typeof row.value === 'string' && row.value.length > 0)
    .map((row) => ({ value: row.value as string, count: Number(row.n) || 0 }));
}

export async function filterOptions(
  env: Env,
  db: Db,
  scope: ReplayScope,
  input: { days?: number; field?: string | null; now?: Date } = {},
): Promise<ReplayFilterOptionsDto[]> {
  const days = clampDays(input.days);
  const fields = input.field ? FILTER_OPTION_FIELDS.filter((f) => f === input.field) : FILTER_OPTION_FIELDS;
  const store = replayTelemetryDb(env, db);
  const keys = await replayReadKeys(env, scope);
  return getOrSetCached(env, keys.filterOptions(input.field || '*', days), async () => {
    const since = new Date((input.now ?? new Date()).getTime() - days * DAY_MS);
    return Promise.all(fields.map(async (field): Promise<ReplayFilterOptionsDto> => {
      if (field in COLUMN_FIELDS) {
        const column = COLUMN_FIELDS[field as keyof typeof COLUMN_FIELDS];
        const n = sql<number>`count(*)::int`;
        const rows = await store
          .select({ value: column, n })
          .from(replayRecordings)
          .where(and(
            eq(replayRecordings.tenantId, scope.tenantId),
            eq(replayRecordings.siteId, scope.siteId),
            gte(replayRecordings.startedAt, since),
            isNotNull(column),
            ne(column, ''),
          ))
          .groupBy(column)
          .orderBy(desc(n))
          .limit(FILTER_OPTIONS_MAX);
        return { field, values: toValues(rows) };
      }
      const source = SET_FIELDS[field as keyof typeof SET_FIELDS](sql.raw('bf_opt(v)'));
      const result = await store.execute(sql`
        select bf_opt.v as value, count(*)::int as n
        from ${replayRecordings}, ${source}
        where ${replayRecordings.tenantId} = ${scope.tenantId}
          and ${replayRecordings.siteId} = ${scope.siteId}
          and ${replayRecordings.startedAt} >= ${since.toISOString()}::timestamp
        group by bf_opt.v
        order by n desc
        limit ${FILTER_OPTIONS_MAX}
      `);
      return { field, values: toValues((result as unknown as { rows: Row[] }).rows ?? []) };
    }));
  }, { kvTtlSeconds: 600, l1TtlMs: 60_000 });
}
