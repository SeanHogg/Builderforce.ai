/**
 * Connected analytics properties — the read surface every measurement caller uses.
 *
 * Structurally identical to `advertising/adsService.ts` and `social/socialService.ts`,
 * and deliberately so: all three sit on `connector_connections`, and all three delegate
 * storage, decryption, readiness and "which account did you mean" to
 * {@link ../integrations/connectedAccounts}. What differs is only the vocabulary and
 * what is cached.
 *
 * ── CACHING ──────────────────────────────────────────────────────────────────
 * Analytics reads are expensive upstream (a GA4 report is a real query) and the numbers
 * move slowly — nobody's decision changes because a 15-minute-old session count moved.
 * So reads are cached by (tenant, connection, version, question), and the WINDOW is
 * part of the key: "last 7 days" and "last 30 days" are different questions and must
 * not share an answer.
 */

import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import {
  cacheVersionOf, createConnectedAccountsPort, type ResolvedAccount,
} from '../integrations/connectedAccounts';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import {
  ANALYTICS_CONNECTOR_KEYS, allAnalyticsProviders, analyticsProviderForConnector,
  AnalyticsProviderError,
  type AnalyticsBreakdownRow, type AnalyticsDimension, type AnalyticsMeasure,
  type AnalyticsMeasures, type AnalyticsPoint, type AnalyticsPropertyField,
  type AnalyticsProvider, type AnalyticsQuery, type AnalyticsSource,
} from './analyticsProviders';

/** What every caller outside this module sees about a connected property. */
export interface AnalyticsPropertyView {
  id: string;
  source: AnalyticsSource;
  sourceLabel: string;
  name: string;
  enabled: boolean;
  ready: boolean;
  missingFields: AnalyticsPropertyField[];
  /** What this platform can actually report — the UI must not offer a column that
   *  will always be blank. */
  measures: readonly AnalyticsMeasure[];
  dimensions: readonly AnalyticsDimension[];
  lastTestOk: boolean | null;
  lastUsedAt: string | null;
}

export interface AnalyticsSourceOption {
  source: AnalyticsSource;
  label: string;
  connectorKey: string;
  propertyFields: readonly AnalyticsPropertyField[];
  measures: readonly AnalyticsMeasure[];
  dimensions: readonly AnalyticsDimension[];
  connectedCount: number;
}

export interface AnalyticsRead {
  properties: AnalyticsPropertyView[];
  /** One entry per connected property that answered. */
  results: Array<{
    connectionId: string;
    source: AnalyticsSource;
    propertyName: string;
    summary: AnalyticsMeasures;
    daily: AnalyticsPoint[];
  }>;
  errors: Array<{ connectionId: string; source: AnalyticsSource; message: string }>;
  fetchedAtISO: string;
}

const SUMMARY_TTL_SECONDS = 15 * 60;
const SUMMARY_L1_TTL_MS = 60 * 1000;

/** The window is part of the key: two questions, two answers. */
const readKey = (tenantId: number, connectionId: string, version: string, question: string) =>
  `analytics:${question}:v1:${tenantId}:${connectionId}:${version}`;

const properties = createConnectedAccountsPort<AnalyticsProvider>({
  connectorKeys: ANALYTICS_CONNECTOR_KEYS,
  providerForConnector: analyticsProviderForConnector,
  providerId: (provider) => provider.source,
  noun: 'analytics property',
});

export type ResolvedAnalyticsProperty = ResolvedAccount<AnalyticsProvider>;

function toPropertyView(property: ResolvedAnalyticsProperty): AnalyticsPropertyView {
  return {
    ...property.base,
    source: property.provider.source,
    sourceLabel: property.provider.label,
    measures: property.provider.measures,
    dimensions: property.provider.dimensions,
  };
}

/** Every connected analytics property for the workspace. */
export async function listAnalyticsProperties(db: Db, env: Env, tenantId: number): Promise<AnalyticsPropertyView[]> {
  return (await properties.resolveAll(db, env, tenantId)).map(toPropertyView);
}

/** The catalog + how many of each is connected. Drives the empty state. */
export async function listAnalyticsSources(db: Db, env: Env, tenantId: number): Promise<AnalyticsSourceOption[]> {
  const connected = await listAnalyticsProperties(db, env, tenantId);
  return allAnalyticsProviders().map((provider) => ({
    source: provider.source,
    label: provider.label,
    connectorKey: provider.connectorKey,
    propertyFields: provider.propertyFields,
    measures: provider.measures,
    dimensions: provider.dimensions,
    connectedCount: connected.filter((p) => p.source === provider.source).length,
  }));
}

export type ResolveAnalyticsResult =
  | { ok: true; account: ResolvedAnalyticsProperty }
  | { ok: false; error: string };

/** Pick the property a call means — resolves a lone one, asks when ambiguous. */
export async function resolveAnalyticsProperty(
  db: Db, env: Env, tenantId: number,
  ref: { connectionId?: string | null; source?: string | null },
): Promise<ResolveAnalyticsResult> {
  return properties.resolveOne(db, env, tenantId, {
    connectionId: ref.connectionId ?? null,
    providerId: ref.source ?? null,
  });
}

/** Clamp a requested window to something a platform will actually serve. */
export function analyticsWindowFrom(input: { since?: string | null; until?: string | null; days?: number | string | null }): AnalyticsQuery {
  const day = (date: Date) => date.toISOString().slice(0, 10);
  const valid = (value: string | null | undefined) => (/^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ? value! : null);
  const until = valid(input.until) ?? day(new Date());
  const since = valid(input.since);
  if (since) return { since, until };
  const requested = Number(input.days);
  // 28 days is the default because it is four whole weeks — a 30-day window compares
  // five Mondays against four Fridays and makes weekly seasonality look like a trend.
  const days = Number.isFinite(requested) && requested > 0 ? Math.min(Math.round(requested), 365) : 28;
  return { since: day(new Date(new Date(`${until}T00:00:00Z`).getTime() - days * 86_400_000)), until };
}

/** Read one property, cached. Errors are RETURNED so one revoked grant does not blank
 *  a panel showing three other platforms. */
async function readProperty(
  db: Db, env: Env, tenantId: number, property: ResolvedAnalyticsProperty,
  query: AnalyticsQuery, actorKind: 'agent' | 'user',
): Promise<{ summary: AnalyticsMeasures; daily: AnalyticsPoint[]; error?: string }> {
  const call = properties.callerFor(db, env, tenantId, property, actorKind);
  const version = cacheVersionOf(property.row);
  const window = `${query.since}_${query.until}`;
  try {
    const [summary, daily] = await Promise.all([
      getOrSetCached(
        env, readKey(tenantId, property.row.id, version, `summary:${window}`),
        () => property.provider.summary(call, property.fields, query),
        { kvTtlSeconds: SUMMARY_TTL_SECONDS, l1TtlMs: SUMMARY_L1_TTL_MS },
      ),
      getOrSetCached(
        env, readKey(tenantId, property.row.id, version, `daily:${window}`),
        () => property.provider.daily(call, property.fields, query),
        { kvTtlSeconds: SUMMARY_TTL_SECONDS, l1TtlMs: SUMMARY_L1_TTL_MS },
      ),
    ]);
    return { summary, daily };
  } catch (error) {
    const message = error instanceof AnalyticsProviderError
      ? error.message
      : error instanceof Error ? error.message : 'That analytics property could not be read.';
    reportCaughtError(error, {
      source: 'application/analytics/analyticsService.ts',
      operation: `readProperty:${property.provider.source}`,
    });
    return { summary: {}, daily: [], error: message };
  }
}

/** Read every connected property over one window. */
export async function readAnalytics(
  db: Db, env: Env, tenantId: number, query: AnalyticsQuery,
  ref: { connectionIds?: readonly string[] } = {}, actorKind: 'agent' | 'user' = 'user',
): Promise<AnalyticsRead> {
  const all = await properties.resolveAll(db, env, tenantId, ref.connectionIds);
  const selected = all.filter((p) => p.row.enabled && p.base.missingFields.length === 0);
  const reads = await Promise.all(selected.map((property) => readProperty(db, env, tenantId, property, query, actorKind)));

  return {
    properties: all.map(toPropertyView),
    results: reads.flatMap((read, index) => {
      const property = selected[index];
      if (!property || read.error) return [];
      return [{
        connectionId: property.row.id,
        source: property.provider.source,
        propertyName: property.row.name,
        summary: read.summary,
        daily: read.daily,
      }];
    }),
    errors: reads.flatMap((read, index) => {
      const property = selected[index];
      return read.error && property
        ? [{ connectionId: property.row.id, source: property.provider.source, message: read.error }]
        : [];
    }),
    fetchedAtISO: new Date().toISOString(),
  };
}

/**
 * Read one property broken down by a dimension.
 *
 * `channel` is the one attribution actually needs: it is what says whether the paid
 * spend in `ad_insights` produced any of the sessions this platform counted.
 */
export async function readAnalyticsBreakdown(
  db: Db, env: Env, tenantId: number, property: ResolvedAnalyticsProperty,
  dimension: AnalyticsDimension, query: AnalyticsQuery, actorKind: 'agent' | 'user' = 'user',
): Promise<AnalyticsBreakdownRow[]> {
  const call = properties.callerFor(db, env, tenantId, property, actorKind);
  return getOrSetCached(
    env,
    readKey(tenantId, property.row.id, cacheVersionOf(property.row), `breakdown:${dimension}:${query.since}_${query.until}:${query.limit ?? 50}`),
    () => property.provider.breakdown(call, property.fields, dimension, query),
    { kvTtlSeconds: SUMMARY_TTL_SECONDS, l1TtlMs: SUMMARY_L1_TTL_MS },
  );
}
