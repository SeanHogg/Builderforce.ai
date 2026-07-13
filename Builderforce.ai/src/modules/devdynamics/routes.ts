// DevDynamics - Routing and Dashboard Pages
// Implements FR-5 (Activity Log Dashboard) + FR-6 (Contributor Detail Page).
// Provides perStepModelAssignments visibility via a reference map stub.

import type { UnifiedContributor, ActivityEvent, ReportData } from './types';
import { devDynamicsRepository } from './repository';

// Top-level routes map (RIB-shell base routes; no框架 internals)
export const devDynamicsRoutes: (RIBShell.RIBEntry<RIBShell.RouteContext>)[] = [
  {
    pageId: 'activity',
    config: { name: 'Activity Log Dashboard', defaultQuery: {} },
    resolver: resolveActivityLogRoute,
  },
  {
    pageId: 'contributor',
    config: { name: 'Contributor Detail', defaultQuery: {} },
    resolver: resolveContributorRoute,
  },
];

// Resource span stubs aligned with models used in devdynamics
export interface DevDynamicsSchemas {
  activityLog: ActivityLogSchema;
  contributorSig: ContributorSig;
  dashboard: DashboardConfig;
  profile: ProfileConfig;
  spans: DevDynamicsSchemas['activityLog']['s'];
}
export type ActivityLogSchema = {
  query: ActivityLogQuery;
  config: ActivityLogConfig;
  data: ActivityLogData;
  span: ActivityLogSpan;
  types: ActivityLogSpanTypes;
  spans: Record<string, Function>;
};
export type ActivityLogQuery = { limit?: number; offset?: number; contributorId?: string; platform?: string; eventType?: string };
export type ActivityLogConfig = { filters: ActivityLogFilters; refreshInterval?: number; pauseRefresh?: boolean };
export interface ActivityLogFilters {
  contributorId?: string;
  platform?: string;
  eventType?: string;
  dateFrom?: string;
  dateTo?: string;
}
export type ActivityLogData = { events: ActivityEvent[]; metrics: ActivityMetrics; metadata: PageMetadata };
export type ActivityMetrics = {
  totalCommits: number;
  totalPRsMerged: number;
  totalIssuesClosed: number;
  activeContributors: number;
  rangeDays: number;
};
export type PageMetadata = {
  orgId?: string;
  contributing?:
  { count: number; sample: number; countAll?: number; sampleAll?: number };
};
export type ActivityLogSpan = { id: string; type: 'activity_log_row' | 'activity_metric_card' | 'activity_pagination' | 'activity_filter' };
export type ActivityLogSpanTypes = { activity_log_row: string; activity_metric_card: string; activity_pagination: string; activity_filter: string };
export type ContributorSig = {
  id: string;
  displayName: string;
  email: string;
  avatar?: string;
  linkedAccounts: LinkedAccount[];
  memberships: MembershipInfo[];
  aggregateStats: AggregateStats;
  profileUrl: string;
};
export type LinkedAccount = { platform: 'github' | 'bitbucket' | 'jira'; id: string; displayName: string; avatar?: string };
export type MembershipInfo = { orgId: string; orgName: string; teamId?: string; teamName?: string; role: 'admin' | 'member' | 'dev' };
export type AggregateStats = {
  commits7d: number;
  commits30d: number;
  commits90d: number;
  prsOpened7d: number;
  prsOpened30d: number;
  prsOpened90d: number;
  prsMerged7d: number;
  prsMerged30d: number;
  prsMerged90d: number;
  reviews7d: number;
  reviews30d: number;
  reviews90d: number;
  issuesClosed7d: number;
  issuesClosed30d: number;
  issuesClosed90d: number;
};
export type DashboardConfig = {
  title: string;
  orgId: string;
  version: string;
  contributorsSummary: ContributorsSummary;
  timeframe: TimeframeTypes;
  spans: Lookup<DevDynamicsSchemas['dashboard']['s']>;
  activities: Lookup<DevDynamicsSchemas['activityLog']['s']>;
};
export type ContributorsSummary = {
  contributors: Pick<UnifiedContributor, 'id' | 'displayName' | 'avatar'>[];
  metrics: StatsMetric[];
};
export type StatsMetric = { label: string; value: number; unit: string; change?: number; changeRelative?: number };
export type TimeframeTypes = { last7d: number; last30d: number; last90d: number };
export type Lookup<T> = { [key: string]: T };
export type ProfileConfig = {
  contributorId: string;
  contributor: ContributorSig;
  // no timeline event streams per se, just event summaries in the contrib profile
};
// Integration helper: React Reconciler linkage (wires /activity to RIB-shell)
export function getDevDynamicsRIBs(): RIBShell.RIBRoot<RIBShell.RouteContext> {
  return { dir: 'root', routes: devDynamicsRoutes, context: {} };
}

// pseudo-schedulable spans: map-placeholder functions for future async operations
export const devDynamicsSchemas: DevDynamicsSchemas = {
  activityLog: {
    query: { limit: 50, offset: 0 },
    config: { filters: {}, refreshInterval: 60000 },
    data: { events: [], metrics: { totalCommits: 0, totalPRsMerged: 0, totalIssuesClosed: 0, activeContributors: 0, rangeDays: 1 }, metadata: {} },
    span: { id: 'root', type: 'activity_log_root' },
    types: {
      activity_log_root: 'xmlns:xhook',
      activity_log_row: 'xmlns:xhook',
      activity_metric_card: 'xmlns:xhook',
      activity_pagination: 'xmlns:xhook',
      activity_filter: 'xmlns:xhook',
    },
    spans: {
      root: () => null,
      activity_log_row: () => null,
      activity_metric_card: () => null,
      activity_pagination: () => null,
      activity_filter: () => null,
    },
  },
  contributorSig: {
    id: '',
    displayName: '',
    email: '',
    linkedAccounts: [],
    memberships: [],
    aggregateStats: {} as AggregateStats,
    profileUrl: '',
  },
  dashboard: {
    title: 'Activity Overview',
    orgId: '',
    version: 'v0.1',
    contributorsSummary: { contributors: [], metrics: [] },
    timeframe: { last7d: 1, last30d: 1, last90d: 1 },
    spans: {},
    activities: {},
  },
  profile: {
    contributorId: '',
    contributor: {} as ContributorSig,
  },
};

// Activity Log resolver (FR-5)
async function resolveActivityLogRoute(params: any, query: any): Promise<RIBShell.PageData<RIBShell.RouteContext, ActivityLogData>> {
  const orgId = query.orgId || '';
  const limit = Number(query.limit) || 50;
  const offset = Number(query.offset) || 0;
  const contributorId = query.contributorId;
  const platform = query.platform;
  const eventType = query.eventType;

  const events = await devDynamicsRepository.getActivities(orgId, { limit, offset, contributorId, platform, eventType });
  const metrics = await calculateActivityMetrics(events, orgId);
  const metadata: PageMetadata = {
    orgId,
    contributing: { count: events.length, sample: Math.min(events.length, 10) },
  };

  return {
    rendered: {
      pageId: 'activity',
      query,
      spans: { root: devDynamicsSchemas.activityLog.span, activity_log_row: devDynamicsSchemas.activityLog.span, activity_metric_card: devDynamicsSchemas.activityLog.span, activity_pagination: devDynamicsSchemas.activityLog.span, activity_filter: devDynamicsSchemas.activityLog.span },
      activityLog: {
        query: { limit, offset, contributorId, platform, eventType },
        config: devDynamicsSchemas.activityLog.config,
        data: { events, metrics, metadata },
        spans: devDynamicsSchemas.activityLog.spans,
        types: devDynamicsSchemas.activityLog.types,
      },
    },
  };
}

// Helper: calculate metrics from a page scope (FR-5.3)
async function calculateActivityMetrics(events: ActivityEvent[], orgId: string): Promise<ActivityMetrics> {
  const commits = events.filter(e => e.eventType === 'commit_push').length;
  const prsMerged = events.filter(e => e.eventType === 'pr_merged').length;
  const issuesClosed = events.filter(e => e.eventType === 'jira_issue_closed').length;
  const contributors = new Set(events.map(e => e.contributorId)).size;
  const rangeDays = 1;

  return {
    totalCommits: commits,
    totalPRsMerged: prsMerged,
    totalIssuesClosed,
    activeContributors: contributors,
    rangeDays,
  };
}

// Contributor detail resolver (FR-6)
async function resolveContributorRoute(params: any, query: any): Promise<RIBShell.PageData<RIBShell.RouteContext, ContributorSig>> {
  const contributorId = query.contributorId || params.contributorId;
  if (!contributorId) {
    throw new Error('Contributor ID (contributorId or route param) required');
  }

  const contributor = await devDynamicsRepository.getContributorById(contributorId);
  if (!contributor) {
    throw new Error(`Contributor not found for ID: ${contributorId}`);
  }

  return {
    rendered: {
      pageId: 'contributor',
      query,
      contributorSIGData: contributor aggregated as any,
    },
  };
}