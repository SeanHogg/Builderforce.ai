// DevDynamics Database Schema

import { UnifiedContributor, ActivityEvent, ScheduledReportConfig } from './types';

export interface DBUnifiedContributor extends Omit<UnifiedContributor, 'createdAt' | 'updatedAt' | 'lastSeenAt'> {
  createdAt: string; // ISO8601
  updatedAt: string;
  lastSeenAt: string;
  linkedAccounts: DBUnifiedAccount[];
  teamMemberships: DBTeamMembership[];
}

export interface DBUnifiedAccount extends Omit<UnifiedAccount, 'linkedAt'> {
  linkedAt: string;
}

export interface DBTeamMembership extends Omit<TeamMembership, 'joinedAt'> {
  joinedAt: string;
}

export interface DBActivityEvent extends Omit<ActivityEvent, 'timestamp' | 'processedAt'> {
  timestamp: string;
  processedAt: string;
}

export interface DBScheduledReportConfig extends Omit<ScheduledReportConfig, 'createdAt' | 'lastRunAt' | 'nextRunAt'> {
  createdAt: string;
  lastRunAt?: string;
  nextRunAt: string;
}

// Database Table Definitions
export const DevDynamicsTables = {
  // Core contributor profiles
  unified_contributors: {
    name: 'unified_contributors',
    columns: [
      'id (uuid primary key)',
      'display_name (varchar not null)',
      'avatar_url',
      'email (varchar unique not null)',
      'email_verified_at',
      'created_at (timestamp default now())',
      'updated_at (timestamp default now())',
      'last_seen_at (timestamp default now())',
    ],
    indexes: ['(email)', '(display_name)'],
  },

  // Linked platform accounts for each contributor
  unified_accounts: {
    name: 'unified_accounts',
    columns: [
      'id (uuid primary key)',
      'contributor_id (uuid references unified_contributors(id) on delete cascade)',
      'provider (varchar not null check (provider in (\\'github\\', \\'bitbucket\\', \\'jira\\')))',
      'provider_account_id (varchar not null)',
      'email',
      'avatar_url',
      'display_name',
      'linked_at (timestamp default now())',
    ],
    indexes: ['(contributor_id)', '(provider, provider_account_id)', '(email)'],
  },

  // Identity mapping links for manual/auto merging
  identity_links: {
    name: 'identity_links',
    columns: [
      'id (uuid primary key)',
      'primary_profile_id (uuid not null references unified_contributors(id) on delete cascade)',
      'secondary_profile_id (uuid not null references unified_contributors(id) on delete cascade)',
      'primary_platform (varchar not null)',
      'secondary_platform (varchar not null)',
      'primary_email (varchar not null)',
      'secondary_email (varchar not null)',
      'linked_at (timestamp default now())',
      'linked_by (varchar not null check (linked_by in (\\'system_auto\\', \\'admin_user\\')))',
    ],
    indexes: ['(primary_email, secondary_email)', '(primary_profile_id, secondary_platform)', '(secondary_profile_id, primary_platform)'],
  },

  // Team memberships
  team_memberships: {
    name: 'team_memberships',
    columns: [
      'id (uuid primary key)',
      'contributor_id (uuid not null references unified_contributors(id) on delete cascade)',
      'team_id (varchar not null)',
      'team_name (varchar not null)',
      'role (varchar not null)',
      'joined_at (timestamp default now())',
      'is_active (boolean default true)',
    ],
    indexes: ['(contributor_id)', '(team_id)', '(is_active)'],
  },

  // Normalized activity events
  activity_events: {
    name: 'activity_events',
    columns: [
      'id (uuid primary key)',
      'event_id (varchar not null unique)', // Original event ID for dedup
      'event_type (varchar not null check (event_type in (\\'commit_push\\', \\'pr_opened\\', \\'pr_reviewed\\', \\'pr_merged\\', \\'pr_closed\\', \\'jira_issue_created\\', \\'jira_issue_updated\\', \\'jira_issue_transitioned\\', \\'jira_issue_assigned\\', \\'jira_comment_added\\', \\'blocker_detected\\')))',
      'provider (varchar not null check (provider in (\\'github\\', \\'bitbucket\\', \\'jira\\')))',
      'contributor_id (uuid references unified_contributors(id) on delete cascade)',
      'account_id (varchar not null)',
      'org_id',
      'project_id',
      'repository_id',
      'metadata (jsonb not null)',
      'timestamp (timestamp not null)',
      'processed_at (timestamp default now())',
      'verified_at (boolean default true)',
    ],
    indexes: [
      '(event_id)',
      '(event_type, timestamp)',
      '(provider, timestamp)',
      '(contributor_id, timestamp)',
      '(timestamp)',
      'GIN(metadata gin_trgm_ops)',
    ],
  },

  // Scheduled report definitions
  scheduled_report_configs: {
    name: 'scheduled_report_configs',
    columns: [
      'id (uuid primary key)',
      'name (varchar not null)',
      'report_type (varchar not null check (report_type in (\\'daily_standup\\', \\'weekly_executive\\')))',
      'schedule_timezone (varchar not null)',
      'schedule_cron (varchar not null)',
      'schedule_day_of_week',
      'schedule_time (varchar not null check (schedule_time ~ \\'^([01]?[0-9]|2[0-3]):[0-5][0-9]$\\'))',
      'recipient_scope_type (varchar not null check (recipient_scope_type in (\\'org\\', \\'team\\')))',
      'recipient_scope_id',
      'recipient_scope_labels',
      'recurrence (varchar not null)',
      'enabled (boolean default true)',
      'created_at (timestamp default now())',
      'last_run_at',
      'next_run_at (timestamp not null)',
    ],
    indexes: [
      '(name)', 
      '(enabled, next_run_at)',
      '(recipient_scope_type, recipient_scope_id)',
    ],
  },

  // Delivered reports
  delivered_reports: {
    name: 'delivered_reports',
    columns: [
      'id (uuid primary key)',
      'report_config_id (uuid references scheduled_report_configs(id) on delete cascade)',
      'report_type (varchar not null)',
      'generated_at (timestamp default now())',
      'deadline',
      'recipient_scope_type',
      'recipient_scope_id',
      'scope_data (jsonb not null)',
      'summary_narrative (text)',
      'summary_data (jsonb not null)',
      'format (varchar default \\'markdown\\')',
      'delivered_at',
    ],
    indexes: [
      '(report_config_id, generated_at desc)',
      '(generated_at desc)',
      'GIN(scope_data)',
    ],
  },
} as const;

// ORM Repository Interfaces
export interface DevDynamicsRepository {
  // Contributor profile operations
  findOrCreateContributor(email: string, contributorData: Partial<PlatformContributor>): Promise<UnifiedContributor>;
  findContributorById(id: string): Promise<UnifiedContributor | null>;
  getContributorByEmail(email: string): Promise<UnifiedContributor | null>;
  findContributorForPlatform(provider: string, accountId: string): Promise<UnifiedContributor | null>;
  linkAccounts(contributorId: string, accounts: Partial<UnifiedAccount>[]): Promise<void>;
  upsertContributor(contributor: Partial<UnifiedContributor>, accounts: Partial<UnifiedAccount>[]): Promise<UnifiedContributor>;

  // Identity mappings
  findIdentityLinks(contributorId: string, provider: string): Promise<UnifiedContributor[]>;
  createIdentityLink(link: IdentityLink): Promise<void>;
  getAllContributors(limit: number, offset: number): Promise<UnifiedContributor[]>;
  getContributorsLinkedByIdentities(limit: number, offset: number): Promise<UnifiedContributor[]>;

  // Activity ingestion
  ingestActivity(event: Omit<ActivityEvent, 'id' | 'eventId' | 'processedAt'>): Promise<ActivityEvent>;
  findActivityById(eventId: string): Promise<ActivityEvent | null>;
  getActivitiesForContributor(contributorId: string, startDate: Date, endDate: Date): Promise<ActivityEvent[]>;
  getActivities(orgId?: string, filters: ActivityFilters): Promise<ActivityEvent[]>;
  countActivities(startDate?: Date, endDate?: Date): Promise<number>;
  findLatestEvents(limit: number): Promise<ActivityEvent[]>;

  // Scheduled reports
  findScheduledReportConfig(id: string): Promise<ScheduledReportConfig | null>;
  findScheduledReportConfigs(filters: Pick<ScheduledReportConfig, 'enabled' | 'reportType' | 'recipientScope'>): Promise<ScheduledReportConfig[]>;
  createScheduledReportConfig(config: ScheduledReportConfig): Promise<ScheduledReportConfig>;
  updateScheduledReportConfig(id: string, updates: Partial<ScheduledReportConfig>): Promise<void>;
  deleteScheduledReportConfig(id: string): Promise<void>;
  findPendingReports(earliestRunTime: Date): Promise<ScheduledReportConfig[]>;

  // Delivered reports
  findDeliveredReport(id: string): Promise<DeliveredReport | null>;
  findDeliveredReports(configId: string): Promise<DeliveredReport[]>;
  createDeliveredReport(report: DeliveredReport): Promise<DeliveredReport>;
  findCompletedDeliveredReports(startDate: Date, endDate: Date, reportType?: 'daily_standup' | 'weekly_executive'): Promise<DeliveredReport[]>;
}

export interface ActivityFilters {
  provider?: 'github' | 'bitbucket' | 'jira';
  contributorId?: string;
  eventType?: ActivityEventType;
  orgId?: string;
  projectId?: string;
  startDate?: Date;
  endDate?: Date;
  pausedAutodeploy: boolean;
}