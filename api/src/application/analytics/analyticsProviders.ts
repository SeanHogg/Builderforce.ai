/**
 * GA4, Search Console, Plausible and PostHog behind ONE measurement port.
 *
 * This is the half of a campaign the paying network cannot report. An ad platform knows
 * what it charged and how many people clicked; only the site's own analytics knows what
 * happened next. `ad_insights` and this port together are what make "did the spend
 * work" answerable, and they must stay separate because a vendor should never be the
 * sole witness to its own effectiveness.
 *
 * ── NOT EVERY PLATFORM REPORTS EVERY MEASURE ─────────────────────────────────
 * Search Console has no concept of a session and PostHog has no concept of an organic
 * search position. Forcing all four into one fixed row shape would mean inventing
 * zeroes — and a zero is indistinguishable from "genuinely none", which is exactly the
 * confusion that makes an analytics number untrustworthy. So a provider DECLARES the
 * measures it reports, rows carry a partial map, and a caller that wants sessions from
 * Search Console gets an honest absence rather than a fabricated 0.
 */

/** Measures, normalized across the four platforms. */
export const ANALYTICS_MEASURES = [
  'sessions', 'users', 'pageviews', 'conversions', 'revenueCents',
  /** Search Console's grain: what an organic listing was shown and clicked. */
  'impressions', 'clicks',
] as const;
export type AnalyticsMeasure = typeof ANALYTICS_MEASURES[number];

/** What a platform reported. A measure it does not report is ABSENT, never 0. */
export type AnalyticsMeasures = Partial<Record<AnalyticsMeasure, number>>;

export const ANALYTICS_SOURCES = ['ga4', 'search_console', 'plausible', 'posthog'] as const;
export type AnalyticsSource = typeof ANALYTICS_SOURCES[number];

export function isAnalyticsSource(value: unknown): value is AnalyticsSource {
  return typeof value === 'string' && (ANALYTICS_SOURCES as readonly string[]).includes(value);
}

/** How a breakdown is cut. `channel` is the one attribution actually needs. */
export const ANALYTICS_DIMENSIONS = ['channel', 'campaign', 'page', 'query', 'country'] as const;
export type AnalyticsDimension = typeof ANALYTICS_DIMENSIONS[number];

export interface AnalyticsQuery {
  /** Inclusive YYYY-MM-DD bounds. */
  since: string;
  until: string;
  limit?: number;
}

export interface AnalyticsPoint {
  date: string;
  measures: AnalyticsMeasures;
}

export interface AnalyticsBreakdownRow {
  /** The raw dimension value, as the platform reported it. */
  key: string;
  measures: AnalyticsMeasures;
}

/** A non-secret field the connection must carry before this platform can be read. */
export interface AnalyticsPropertyField {
  key: string;
  label: string;
  help: string;
}

export interface AnalyticsCallResult {
  ok: boolean;
  status: number;
  data: unknown;
  error?: string;
}

export type AnalyticsCall = (actionKey: string, input?: Record<string, unknown>) => Promise<AnalyticsCallResult>;

export interface AnalyticsProvider {
  source: AnalyticsSource;
  label: string;
  connectorKey: string;
  propertyFields: readonly AnalyticsPropertyField[];
  /** The measures this platform actually reports. */
  measures: readonly AnalyticsMeasure[];
  /** The dimensions this platform can break down by. */
  dimensions: readonly AnalyticsDimension[];
  /** Totals over the window. */
  summary(call: AnalyticsCall, fields: Record<string, string>, query: AnalyticsQuery): Promise<AnalyticsMeasures>;
  /** The window, day by day. */
  daily(call: AnalyticsCall, fields: Record<string, string>, query: AnalyticsQuery): Promise<AnalyticsPoint[]>;
  /** The window, cut by one dimension. Refuses a dimension it cannot serve. */
  breakdown(
    call: AnalyticsCall, fields: Record<string, string>,
    dimension: AnalyticsDimension, query: AnalyticsQuery,
  ): Promise<AnalyticsBreakdownRow[]>;
}

export class AnalyticsProviderError extends Error {
  constructor(message: string, readonly status = 502, readonly retryable = false) {
    super(message);
    this.name = 'AnalyticsProviderError';
  }
}

// ---------------------------------------------------------------------------
// Shared normalization
// ---------------------------------------------------------------------------

const rec = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const text = (value: unknown): string => (value == null ? '' : String(value));

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const int = (value: unknown): number => Math.round(num(value));

/** `20260815` (GA4's compact day) or `2026-08-15` → `2026-08-15`. */
function normalizeDay(value: unknown): string {
  const raw = text(value).trim();
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : '';
}

async function ask(call: AnalyticsCall, actionKey: string, input: Record<string, unknown> = {}): Promise<AnalyticsCallResult> {
  const result = await call(actionKey, input);
  if (!result.ok) {
    const retryable = result.status === 429 || (result.status >= 500 && result.status < 600);
    throw new AnalyticsProviderError(
      result.error?.slice(0, 400) || `The platform returned ${result.status}`,
      result.status || 502,
      retryable,
    );
  }
  return result;
}

function requireField(fields: Record<string, string>, key: string, label: string): string {
  const value = (fields[key] ?? '').trim();
  if (!value) throw new AnalyticsProviderError(`This connection is missing ${label}. Add it to the connection and try again.`, 409, false);
  return value;
}

function refuseDimension(provider: AnalyticsProvider, dimension: AnalyticsDimension): never {
  throw new AnalyticsProviderError(
    `${provider.label} cannot break down by ${dimension}. It supports: ${provider.dimensions.join(', ')}.`,
    400,
    false,
  );
}

/** Add two measure maps without inventing a key neither side reported. */
export function addMeasures(a: AnalyticsMeasures, b: AnalyticsMeasures): AnalyticsMeasures {
  const out: AnalyticsMeasures = { ...a };
  for (const [key, value] of Object.entries(b) as Array<[AnalyticsMeasure, number]>) {
    out[key] = (out[key] ?? 0) + value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Google Analytics 4
// ---------------------------------------------------------------------------

/** GA4 answers with parallel `dimensionHeaders` / `rows[].dimensionValues` arrays, so
 *  a row is only readable alongside the header order that produced it. */
function ga4Rows(payload: unknown): Array<{ dimensions: string[]; metrics: string[] }> {
  const body = rec(payload);
  return list(body.rows).map((raw) => {
    const row = rec(raw);
    return {
      dimensions: list(row.dimensionValues).map((v) => text(rec(v).value)),
      metrics: list(row.metricValues).map((v) => text(rec(v).value)),
    };
  });
}

const GA4_METRICS = ['sessions', 'totalUsers', 'screenPageViews', 'conversions', 'totalRevenue'];

const ga4Measures = (metrics: string[]): AnalyticsMeasures => ({
  sessions: int(metrics[0]),
  users: int(metrics[1]),
  pageviews: int(metrics[2]),
  conversions: int(metrics[3]),
  // GA4 reports revenue as a decimal in the property currency.
  revenueCents: Math.round(num(metrics[4]) * 100),
});

const GA4_DIMENSION: Record<AnalyticsDimension, string | null> = {
  channel: 'sessionDefaultChannelGroup',
  campaign: 'sessionCampaignName',
  page: 'pagePath',
  country: 'country',
  query: null,
};

const ga4: AnalyticsProvider = {
  source: 'ga4', label: 'Google Analytics 4', connectorKey: 'google-analytics-4',
  measures: ['sessions', 'users', 'pageviews', 'conversions', 'revenueCents'],
  dimensions: ['channel', 'campaign', 'page', 'country'],
  propertyFields: [{ key: 'propertyId', label: 'GA4 property ID', help: 'The numeric property this connection reports on.' }],

  async summary(call, fields, query) {
    const propertyId = requireField(fields, 'propertyId', 'the GA4 property ID');
    const result = await ask(call, 'run_report', {
      property_id: propertyId,
      dateRanges: [{ startDate: query.since, endDate: query.until }],
      metrics: GA4_METRICS.map((name) => ({ name })),
    });
    const rows = ga4Rows(result.data);
    return rows[0] ? ga4Measures(rows[0].metrics) : {};
  },

  async daily(call, fields, query) {
    const propertyId = requireField(fields, 'propertyId', 'the GA4 property ID');
    const result = await ask(call, 'run_report', {
      property_id: propertyId,
      dateRanges: [{ startDate: query.since, endDate: query.until }],
      dimensions: [{ name: 'date' }],
      metrics: GA4_METRICS.map((name) => ({ name })),
      orderBys: [{ dimension: { dimensionName: 'date' } }],
      limit: 400,
    });
    return ga4Rows(result.data).flatMap((row) => {
      const date = normalizeDay(row.dimensions[0]);
      return date ? [{ date, measures: ga4Measures(row.metrics) }] : [];
    });
  },

  async breakdown(call, fields, dimension, query) {
    const propertyId = requireField(fields, 'propertyId', 'the GA4 property ID');
    const name = GA4_DIMENSION[dimension];
    if (!name) refuseDimension(ga4, dimension);
    const result = await ask(call, 'run_report', {
      property_id: propertyId,
      dateRanges: [{ startDate: query.since, endDate: query.until }],
      dimensions: [{ name }],
      metrics: GA4_METRICS.map((metric) => ({ name: metric })),
      limit: query.limit ?? 50,
    });
    return ga4Rows(result.data).map((row) => ({
      key: row.dimensions[0] ?? '(not set)',
      measures: ga4Measures(row.metrics),
    }));
  },
};

// ---------------------------------------------------------------------------
// Google Search Console
// ---------------------------------------------------------------------------

const SEARCH_CONSOLE_DIMENSION: Record<AnalyticsDimension, string | null> = {
  query: 'query',
  page: 'page',
  country: 'country',
  channel: null,
  campaign: null,
};

const searchConsoleMeasures = (row: Record<string, unknown>): AnalyticsMeasures => ({
  clicks: int(row.clicks),
  impressions: int(row.impressions),
});

const searchConsole: AnalyticsProvider = {
  source: 'search_console', label: 'Google Search Console', connectorKey: 'google-search-console',
  // Deliberately short: Search Console genuinely does not know about a session or a
  // conversion, and saying so is more useful than reporting zero for both.
  measures: ['clicks', 'impressions'],
  dimensions: ['query', 'page', 'country'],
  propertyFields: [{ key: 'siteUrl', label: 'Property URL', help: 'sc-domain:example.com, or the exact https://example.com/ URL prefix.' }],

  async summary(call, fields, query) {
    const siteUrl = requireField(fields, 'siteUrl', 'the property URL');
    const result = await ask(call, 'query_search_analytics', {
      site_url: encodeURIComponent(siteUrl), startDate: query.since, endDate: query.until, rowLimit: 1,
    });
    const row = rec(list(result.data)[0]);
    return searchConsoleMeasures(row);
  },

  async daily(call, fields, query) {
    const siteUrl = requireField(fields, 'siteUrl', 'the property URL');
    const result = await ask(call, 'query_search_analytics', {
      site_url: encodeURIComponent(siteUrl), startDate: query.since, endDate: query.until,
      dimensions: ['date'], rowLimit: 400,
    });
    return list(result.data).flatMap((raw) => {
      const row = rec(raw);
      const date = normalizeDay(list(row.keys)[0]);
      return date ? [{ date, measures: searchConsoleMeasures(row) }] : [];
    });
  },

  async breakdown(call, fields, dimension, query) {
    const siteUrl = requireField(fields, 'siteUrl', 'the property URL');
    const name = SEARCH_CONSOLE_DIMENSION[dimension];
    if (!name) refuseDimension(searchConsole, dimension);
    const result = await ask(call, 'query_search_analytics', {
      site_url: encodeURIComponent(siteUrl), startDate: query.since, endDate: query.until,
      dimensions: [name], rowLimit: query.limit ?? 50,
    });
    return list(result.data).map((raw) => {
      const row = rec(raw);
      return { key: text(list(row.keys)[0]) || '(not set)', measures: searchConsoleMeasures(row) };
    });
  },
};

// ---------------------------------------------------------------------------
// Plausible
// ---------------------------------------------------------------------------

const PLAUSIBLE_METRICS = 'visitors,visits,pageviews,events';

const plausibleMeasures = (row: Record<string, unknown>): AnalyticsMeasures => ({
  users: int(rec(row.visitors).value ?? row.visitors),
  sessions: int(rec(row.visits).value ?? row.visits),
  pageviews: int(rec(row.pageviews).value ?? row.pageviews),
  conversions: int(rec(row.events).value ?? row.events),
});

const PLAUSIBLE_DIMENSION: Record<AnalyticsDimension, string | null> = {
  channel: 'visit:source',
  campaign: 'visit:utm_campaign',
  page: 'event:page',
  country: 'visit:country',
  query: null,
};

const plausible: AnalyticsProvider = {
  source: 'plausible', label: 'Plausible Analytics', connectorKey: 'plausible',
  measures: ['sessions', 'users', 'pageviews', 'conversions'],
  dimensions: ['channel', 'campaign', 'page', 'country'],
  propertyFields: [{ key: 'siteId', label: 'Site ID', help: 'The domain exactly as it is registered in Plausible.' }],

  async summary(call, fields, query) {
    const siteId = requireField(fields, 'siteId', 'the site ID');
    const result = await ask(call, 'aggregate', {
      site_id: siteId, period: 'custom', date: `${query.since},${query.until}`, metrics: PLAUSIBLE_METRICS,
    });
    return plausibleMeasures(rec(result.data));
  },

  async daily(call, fields, query) {
    const siteId = requireField(fields, 'siteId', 'the site ID');
    const result = await ask(call, 'timeseries', {
      site_id: siteId, period: 'custom', date: `${query.since},${query.until}`,
      metrics: PLAUSIBLE_METRICS, interval: 'date',
    });
    return list(result.data).flatMap((raw) => {
      const row = rec(raw);
      const date = normalizeDay(row.date);
      return date ? [{ date, measures: plausibleMeasures(row) }] : [];
    });
  },

  async breakdown(call, fields, dimension, query) {
    const siteId = requireField(fields, 'siteId', 'the site ID');
    const property = PLAUSIBLE_DIMENSION[dimension];
    if (!property) refuseDimension(plausible, dimension);
    const result = await ask(call, 'breakdown', {
      site_id: siteId, property, period: 'custom', date: `${query.since},${query.until}`,
      metrics: PLAUSIBLE_METRICS, limit: query.limit ?? 50,
    });
    return list(result.data).map((raw) => {
      const row = rec(raw);
      // The dimension's own value comes back under its property name, minus the prefix.
      const key = text(row[property.split(':')[1] ?? property] ?? row.name ?? row.source);
      return { key: key || '(not set)', measures: plausibleMeasures(row) };
    });
  },
};

// ---------------------------------------------------------------------------
// PostHog
// ---------------------------------------------------------------------------

/** PostHog answers a HogQL query with `results` as positional arrays plus a `columns`
 *  header, so a column is only addressable through its index in that header. */
function hogRows(payload: unknown): { columns: string[]; rows: unknown[][] } {
  const body = rec(payload);
  return {
    columns: list(body.columns).map(text),
    rows: list(body.results).map((row) => (Array.isArray(row) ? row : [row])),
  };
}

const POSTHOG_DIMENSION: Record<AnalyticsDimension, string | null> = {
  channel: "properties.$referring_domain",
  campaign: "properties.utm_campaign",
  page: "properties.$pathname",
  country: "properties.$geoip_country_name",
  query: null,
};

async function hogQuery(call: AnalyticsCall, projectId: string, query: string): Promise<{ columns: string[]; rows: unknown[][] }> {
  const result = await ask(call, 'query', { project_id: projectId, query: { kind: 'HogQLQuery', query } });
  return hogRows(result.data);
}

/** A HogQL literal. Only dates and dimension names reach this, but an unescaped quote
 *  would still be a query-injection seam, so quoting happens in one place. */
const hogString = (value: string): string => `'${value.replace(/['\\]/g, '')}'`;

const posthog: AnalyticsProvider = {
  source: 'posthog', label: 'PostHog', connectorKey: 'posthog',
  // PostHog counts events and people, not sessions in the GA sense.
  measures: ['users', 'pageviews', 'conversions'],
  dimensions: ['channel', 'campaign', 'page', 'country'],
  propertyFields: [{ key: 'projectId', label: 'Project ID', help: 'The numeric PostHog project this connection reads.' }],

  async summary(call, fields, query) {
    const projectId = requireField(fields, 'projectId', 'the project ID');
    const { rows } = await hogQuery(call, projectId, [
      'SELECT count(DISTINCT person_id), countIf(event = \'$pageview\'), count()',
      `FROM events WHERE timestamp >= toDate(${hogString(query.since)}) AND timestamp <= toDate(${hogString(query.until)}) + 1`,
    ].join(' '));
    const row = rows[0] ?? [];
    return { users: int(row[0]), pageviews: int(row[1]), conversions: int(row[2]) };
  },

  async daily(call, fields, query) {
    const projectId = requireField(fields, 'projectId', 'the project ID');
    const { rows } = await hogQuery(call, projectId, [
      'SELECT toDate(timestamp) AS day, count(DISTINCT person_id), countIf(event = \'$pageview\'), count()',
      `FROM events WHERE timestamp >= toDate(${hogString(query.since)}) AND timestamp <= toDate(${hogString(query.until)}) + 1`,
      'GROUP BY day ORDER BY day',
    ].join(' '));
    return rows.flatMap((row) => {
      const date = normalizeDay(row[0]);
      return date ? [{ date, measures: { users: int(row[1]), pageviews: int(row[2]), conversions: int(row[3]) } }] : [];
    });
  },

  async breakdown(call, fields, dimension, query) {
    const projectId = requireField(fields, 'projectId', 'the project ID');
    const property = POSTHOG_DIMENSION[dimension];
    if (!property) refuseDimension(posthog, dimension);
    const { rows } = await hogQuery(call, projectId, [
      `SELECT ${property} AS bucket, count(DISTINCT person_id), countIf(event = '$pageview'), count()`,
      `FROM events WHERE timestamp >= toDate(${hogString(query.since)}) AND timestamp <= toDate(${hogString(query.until)}) + 1`,
      `GROUP BY bucket ORDER BY count() DESC LIMIT ${Math.min(Math.max(query.limit ?? 50, 1), 200)}`,
    ].join(' '));
    return rows.map((row) => ({
      key: text(row[0]) || '(not set)',
      measures: { users: int(row[1]), pageviews: int(row[2]), conversions: int(row[3]) },
    }));
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const PROVIDERS: Readonly<Record<AnalyticsSource, AnalyticsProvider>> = {
  ga4, search_console: searchConsole, plausible, posthog,
};

export function getAnalyticsProvider(source: string): AnalyticsProvider | null {
  return isAnalyticsSource(source) ? PROVIDERS[source] : null;
}

export function allAnalyticsProviders(): readonly AnalyticsProvider[] {
  return ANALYTICS_SOURCES.map((s) => PROVIDERS[s]);
}

/** Reverse lookup — a connection knows its connector key, not its source. */
export function analyticsProviderForConnector(connectorKey: string): AnalyticsProvider | null {
  return allAnalyticsProviders().find((p) => p.connectorKey === connectorKey) ?? null;
}

/** Every connector key that IS an analytics property, for one-query connection filters. */
export const ANALYTICS_CONNECTOR_KEYS: readonly string[] = allAnalyticsProviders().map((p) => p.connectorKey);
