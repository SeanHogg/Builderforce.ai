/**
 * Built-in MEASUREMENT connectors — where a campaign's effect is observed.
 *
 * These close the loop the ad and social connectors open. A network reports what IT
 * did (spend, impressions, clicks); only the site analytics platform reports what
 * happened AFTER the click — sessions, signups, revenue. Attribution is the difference
 * between the two, so the platform that answers "did the spend work" cannot be the
 * platform being paid. That is why these are their own connectors and their own port
 * ({@link ../../analytics/analyticsProviders}) rather than more actions on an ad manifest.
 *
 * ── PROPERTY IS A SCOPE FIELD, NOT A CREDENTIAL ──────────────────────────────
 * Every one of these tokens reaches several properties, sites or projects, and reading
 * the wrong one produces a number that is confidently wrong rather than an error. So
 * the property/site/project id is a NON-SECRET auth field on the connection, exactly as
 * the ad account id is for a spend account.
 */

import type { ConnectorManifest } from '../connectorManifest';
import { b, ba, bn, bo, p, q, qn } from './dsl';

// ---------------------------------------------------------------------------
// Google Analytics 4
// ---------------------------------------------------------------------------

const ga4: ConnectorManifest = {
  key: 'google-analytics-4', name: 'Google Analytics 4', category: 'data', icon: '📈',
  description: 'Read sessions, conversions, revenue and acquisition channels from a GA4 property.',
  baseUrl: 'https://analyticsdata.googleapis.com/v1beta', docsUrl: 'https://developers.google.com/analytics/devguides/reporting/data/v1',
  auth: { kind: 'bearer', fields: [
    { key: 'token', label: 'OAuth access token', secret: true, required: true, help: 'A token with https://www.googleapis.com/auth/analytics.readonly.' },
    { key: 'propertyId', label: 'GA4 property ID', secret: false, required: false, placeholder: '123456789', help: 'Digits only — the property this connection reports on. Admin → Property Settings.' },
  ] },
  actions: [
    { key: 'run_report', label: 'Run report', description: 'Read GA4 metrics by dimension over a date range — sessions, users, conversions and revenue.', method: 'POST', path: '/properties/{property_id}:runReport', mutates: false, required: ['property_id', 'dateRanges', 'metrics'], params: {
      property_id: p('Numeric GA4 property id'), dateRanges: ba('Array of {startDate,endDate}, accepting YYYY-MM-DD or NdaysAgo'), dimensions: ba('Array of {name}, e.g. [{"name":"sessionDefaultChannelGroup"}]'), metrics: ba('Array of {name}, e.g. [{"name":"sessions"},{"name":"conversions"}]'), dimensionFilter: bo('Filter expression over dimensions'), orderBys: ba('Sort specification'), limit: bn('Rows to return'), offset: bn('Row offset'), keepEmptyRows: { type: 'boolean', in: 'body', description: 'Include rows whose every metric is zero' },
    } },
    { key: 'run_realtime_report', label: 'Run realtime report', description: 'Read GA4 activity from the last 30 minutes — what a campaign that just launched is doing.', method: 'POST', path: '/properties/{property_id}:runRealtimeReport', mutates: false, required: ['property_id', 'metrics'], params: { property_id: p('Numeric GA4 property id'), dimensions: ba('Array of {name}'), metrics: ba('Array of {name}, e.g. [{"name":"activeUsers"}]'), limit: bn('Rows to return') } },
    { key: 'get_metadata', label: 'Get available metrics', description: 'List the dimensions and metrics this GA4 property supports, including custom ones.', method: 'GET', path: '/properties/{property_id}/metadata', mutates: false, required: ['property_id'], params: { property_id: p('Numeric GA4 property id') } },
  ],
};

// ---------------------------------------------------------------------------
// Google Search Console
// ---------------------------------------------------------------------------

const searchConsole: ConnectorManifest = {
  key: 'google-search-console', name: 'Google Search Console', category: 'data', icon: '🔎',
  description: 'Read organic search impressions, clicks, position and the queries a site ranks for.',
  baseUrl: 'https://searchconsole.googleapis.com/webmasters/v3', docsUrl: 'https://developers.google.com/webmaster-tools/v1/searchanalytics/query',
  auth: { kind: 'bearer', fields: [
    { key: 'token', label: 'OAuth access token', secret: true, required: true, help: 'A token with https://www.googleapis.com/auth/webmasters.readonly.' },
    { key: 'siteUrl', label: 'Property URL', secret: false, required: false, placeholder: 'sc-domain:example.com', help: 'Either sc-domain:example.com for a domain property, or the exact https://example.com/ URL prefix.' },
  ] },
  actions: [
    { key: 'list_sites', label: 'List properties', description: 'List the Search Console properties this token can read.', method: 'GET', path: '/sites', mutates: false, resultPath: 'siteEntry', params: {} },
    { key: 'query_search_analytics', label: 'Query search analytics', description: 'Read organic clicks, impressions, CTR and average position by query, page, country or device.', method: 'POST', path: '/sites/{site_url}/searchAnalytics/query', mutates: false, required: ['site_url', 'startDate', 'endDate'], resultPath: 'rows', params: {
      site_url: p('URL-encoded property, e.g. sc-domain%3Aexample.com'), startDate: b('YYYY-MM-DD'), endDate: b('YYYY-MM-DD'), dimensions: ba('Array such as ["query"], ["page"] or ["date"]'), type: b('web, image, video, news or discover'), dimensionFilterGroups: ba('Filter groups over the chosen dimensions'), rowLimit: bn('Rows to return, up to 25000'), startRow: bn('Row offset'), dataState: b('final or all — all includes fresh, still-changing data'),
    } },
    { key: 'inspect_url', label: 'Inspect a URL', description: 'Read the index status of one page — whether Google has it, and what it saw.', method: 'POST', path: '/urlInspection/index:inspect', mutates: false, required: ['inspectionUrl', 'siteUrl'], params: { inspectionUrl: b('The full URL to inspect'), siteUrl: b('The property the URL belongs to'), languageCode: b('BCP-47 language for the result text') } },
  ],
};

// ---------------------------------------------------------------------------
// Plausible
// ---------------------------------------------------------------------------

const plausible: ConnectorManifest = {
  key: 'plausible', name: 'Plausible Analytics', category: 'data', icon: '📊',
  description: 'Read privacy-friendly site analytics — visitors, sources, pages and goal conversions.',
  // Self-hosted Plausible is common, so the host is a connection field rather than a
  // constant. The default keeps the hosted case a one-field connect.
  baseUrl: 'https://{{auth.host}}/api', docsUrl: 'https://plausible.io/docs/stats-api',
  auth: { kind: 'bearer', fields: [
    { key: 'token', label: 'API key', secret: true, required: true, help: 'Plausible → Settings → API keys.' },
    { key: 'host', label: 'Host', secret: false, required: true, placeholder: 'plausible.io', help: 'plausible.io for the hosted service, or your own domain for a self-hosted instance.' },
    { key: 'siteId', label: 'Site ID', secret: false, required: false, placeholder: 'example.com', help: 'The domain exactly as it is registered in Plausible.' },
  ] },
  actions: [
    { key: 'aggregate', label: 'Aggregate stats', description: 'Read totals for a period — visitors, pageviews, bounce rate, visit duration and goal conversions.', method: 'GET', path: '/v1/stats/aggregate', mutates: false, required: ['site_id'], resultPath: 'results', params: { site_id: q('Registered site domain'), period: q('12mo, 6mo, month, 30d, 7d, day or custom'), date: q('Anchor date, or start,end for a custom period'), metrics: q('Comma list such as visitors,pageviews,bounce_rate,visit_duration,events'), filters: q('Filter expression, e.g. visit:source==Google') } },
    { key: 'timeseries', label: 'Timeseries stats', description: 'Read the same metrics broken down by day, week or month.', method: 'GET', path: '/v1/stats/timeseries', mutates: false, required: ['site_id'], resultPath: 'results', params: { site_id: q('Registered site domain'), period: q('12mo, 6mo, month, 30d, 7d or custom'), date: q('Anchor date, or start,end for a custom period'), metrics: q('Comma list such as visitors,pageviews,events'), interval: q('date, week or month'), filters: q('Filter expression') } },
    { key: 'breakdown', label: 'Breakdown by property', description: 'Read stats grouped by source, campaign, page, country or device — how a campaign actually arrived.', method: 'GET', path: '/v1/stats/breakdown', mutates: false, required: ['site_id', 'property'], resultPath: 'results', params: { site_id: q('Registered site domain'), property: q('Property such as visit:source, visit:utm_campaign, event:page or visit:country'), period: q('12mo, month, 30d, 7d or custom'), date: q('Anchor date, or start,end for a custom period'), metrics: q('Comma list such as visitors,events'), limit: qn('Rows to return'), page: qn('Page number'), filters: q('Filter expression') } },
  ],
};

// ---------------------------------------------------------------------------
// PostHog
// ---------------------------------------------------------------------------

const posthog: ConnectorManifest = {
  key: 'posthog', name: 'PostHog', category: 'data', icon: '🦔',
  description: 'Read product analytics — events, funnels, retention and the activation a campaign produced.',
  baseUrl: 'https://{{auth.host}}/api', docsUrl: 'https://posthog.com/docs/api',
  auth: { kind: 'bearer', fields: [
    { key: 'token', label: 'Personal API key', secret: true, required: true, placeholder: 'phx_…', help: 'PostHog → Settings → Personal API keys, scoped to the project you want read.' },
    { key: 'host', label: 'Host', secret: false, required: true, placeholder: 'us.posthog.com', help: 'us.posthog.com, eu.posthog.com, or your self-hosted domain.' },
    { key: 'projectId', label: 'Project ID', secret: false, required: false, placeholder: '12345', help: 'The numeric project this connection reads.' },
  ] },
  actions: [
    { key: 'query', label: 'Run a query', description: 'Run a HogQL or insight query — the general read path for events, funnels and retention.', method: 'POST', path: '/projects/{project_id}/query/', mutates: false, required: ['project_id', 'query'], params: { project_id: p('Numeric PostHog project id'), query: bo('Query object, e.g. {"kind":"HogQLQuery","query":"select count() from events"}') } },
    { key: 'list_events', label: 'List events', description: 'Read recent raw events for a project.', method: 'GET', path: '/projects/{project_id}/events/', mutates: false, required: ['project_id'], resultPath: 'results', params: { project_id: p('Numeric PostHog project id'), event: q('Event name to filter on'), after: q('ISO 8601 lower bound'), before: q('ISO 8601 upper bound'), limit: qn('Rows to return') } },
    { key: 'list_insights', label: 'List insights', description: 'Read the saved insights on a project, so a board can pin one someone already built.', method: 'GET', path: '/projects/{project_id}/insights/', mutates: false, required: ['project_id'], resultPath: 'results', params: { project_id: p('Numeric PostHog project id'), limit: qn('Rows to return'), offset: qn('Row offset'), search: q('Filter insights by name') } },
  ],
};

export const ANALYTICS_CONNECTORS: readonly ConnectorManifest[] = [ga4, searchConsole, plausible, posthog];
