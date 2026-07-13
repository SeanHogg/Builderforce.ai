// DevDynamics Database Schema

import * as t from './types';

/**
 * Database table column definitions for DevDynamics schema.
 * These map to a relational database (PostgreSQL) with indexes for query performance.
 */

export const DevDynamicsTables = {
  // Core contributor profiles
  unified_contributors: {
    name: 'unified_contributors',
    columns: [
      'id uuid primary key',
      'display_name varchar not null',
      'avatar_url varchar',
      'email varchar unique not null',
      'email_verified_at timestamp',
      'created_at timestamp default now()',
      'updated_at timestamp default now()',
      'last_seen_at timestamp default now()',
    ],
    indexes: [
      'idx_contributors_email ON unified_contributors(email)',
      'idx_contributors_display_name ON unified_contributors(display_name)',
    ],
  },

  // Linked platform accounts for each contributor
  unified_accounts: {
    name: 'unified_accounts',
    columns: [
      'id uuid primary key',
      'contributor_id uuid references unified_contributors(id) on delete cascade',
      'provider varchar not null check (provider in (\'github\', \'bitbucket\', \'jira\'))',
      'provider_account_id varchar not null',
      'email varchar',
      'avatar_url varchar',
      'display_name varchar',
      'linked_at timestamp default now()',
    ],
    indexes: [
      'idx_accounts_contributor ON unified_accounts(contributor_id)',
      'idx_accounts_provider ON unified_accounts(provider, provider_account_id)',
      'idx_accounts_email ON unified_accounts(email)',
    ],
  },

  // Identity mapping links for manual/auto merging
  identity_links: {
    name: 'identity_links',
    columns: [
      'id uuid primary key',
      'primary_profile_id uuid not null references unified_contributors(id) on delete cascade',
      'secondary_profile_id uuid not null references unified_contributors(id) on delete cascade',
      'primary_platform varchar not null',
      'secondary_platform varchar not null',
      'primary_email varchar not null',
      'secondary_email varchar not null',
      'linked_at timestamp default now()',
      'linked_by varchar not null check (linked_by in (\'system_auto\', \'admin_user\'))',
    ],
    indexes: [
      'idx_identity_emails ON identity_links(primary_email, secondary_email)',
      'idx_identity_primary ON identity_links(primary_profile_id, secondary_platform)',
      'idx_identity_secondary ON identity_links(secondary_profile_id, primary_platform)',
    ],
  },

  // Team memberships
  team_memberships: {
    name: 'team_memberships',
    columns: [
      'id uuid primary key',
      'contributor_id uuid not null references unified_contributors(id) on delete cascade',
      'team_id varchar not null',
      'team_name varchar not null',
      'role varchar not null',
      'joined_at timestamp default now()',
      'is_active boolean default true',
    ],
    indexes: [
      'idx_membership_contributor ON team_memberships(contributor_id)',
      'idx_membership_team ON team_memberships(team_id)',
      'idx_membership_active ON team_memberships(is_active)',
    ],
  },

  // Normalized activity events
  activity_events: {
    name: 'activity_events',
    columns: [
      'id uuid primary key',
      'event_id varchar not null unique',
      'event_type varchar not null',
      'provider varchar not null',
      'contributor_id uuid references unified_contributors(id) on delete cascade',
      'account_id varchar not null',
      'org_id varchar',
      'project_id varchar',
      'repository_id varchar',
      'metadata jsonb not null',
      'timestamp timestamp not null',
      'processed_at timestamp default now()',
      'verified_at boolean default true',
    ],
    indexes: [
      'idx_events_event_id ON activity_events(event_id)',
      'idx_events_type_time ON activity_events(event_type, timestamp)',
      'idx_events_provider_time ON activity_events(provider, timestamp)',
      'idx_events_contributor_time ON activity_events(contributor_id, timestamp)',
      'idx_events_timestamp ON activity_events(timestamp)',
    ],
  },

  // Scheduled report definitions
  scheduled_report_configs: {
    name: 'scheduled_report_configs',
    columns: [
      'id uuid primary key',
      'name varchar not null',
      'report_type varchar not null',
      'schedule_timezone varchar not null',
      'schedule_cron varchar not null',
      'schedule_day_of_week integer',
      'schedule_time varchar not null',
      'recipient_scope_type varchar not null',
      'recipient_scope_id varchar',
      'recipient_scope_labels varchar[]',
      'recurrence varchar not null',
      'enabled boolean default true',
      'created_at timestamp default now()',
      'last_run_at timestamp',
      'next_run_at timestamp not null',
    ],
    indexes: [
      'idx_report_config_name ON scheduled_report_configs(name)',
      'idx_report_config_enabled_next ON scheduled_report_configs(enabled, next_run_at)',
      'idx_report_config_scope ON scheduled_report_configs(recipient_scope_type, recipient_scope_id)',
    ],
  },

  // Delivered reports
  delivered_reports: {
    name: 'delivered_reports',
    columns: [
      'id uuid primary key',
      'report_config_id uuid references scheduled_report_configs(id) on delete cascade',
      'report_type varchar not null',
      'generated_at timestamp default now()',
      'deadline timestamp',
      'recipient_scope_type varchar',
      'recipient_scope_id varchar',
      'scope_data jsonb not null',
      'summary_narrative text',
      'summary_data jsonb not null',
      'format varchar default \'markdown\'',
      'delivered_at timestamp',
    ],
    indexes: [
      'idx_delivered_config_time ON delivered_reports(report_config_id, generated_at desc)',
      'idx_delivered_generated ON delivered_reports(generated_at desc)',
    ],
  },
} as const;

/**
 * DevDynamicsRepository — persistence interface for the DevDynamics system.
 * Implementations can use PostgreSQL, SQLite, or an in-memory store.
 */
export interface DevDynamicsRepository {
  // Contributor profile operations
  findOrCreateContributor(email: string, data: Partial<t.UnifiedAccount>): Promise<t.UnifiedContributor>;
  findContributorById(id: string): Promise<t.UnifiedContributor | null>;
  getContributorByEmail(email: string): Promise<t.UnifiedContributor | null>;
  findContributorForPlatform(provider: string, accountId: string): Promise<t.UnifiedContributor | null>;
  linkAccounts(contributorId: string, accounts: t.UnifiedAccount[]): Promise<void>;
  upsertContributor(data: Partial<t.UnifiedContributor>): Promise<t.UnifiedContributor>;

  // Identity mappings
  findIdentityLinks(contributorId: string): Promise<t.IdentityLink[]>;
  createIdentityLink(link: t.IdentityLink): Promise<void>;
  getAllContributors(limit?: number, offset?: number): Promise<t.UnifiedContributor[]>;

  // Activity ingestion
  ingestActivity(event: t.ActivityEvent): Promise<void>;
  findActivityByEventId(eventId: string): Promise<t.ActivityEvent | null>;
  getActivitiesForContributor(contributorId: string, startDate: string, endDate: string): Promise<t.ActivityEvent[]>;
  getActivities(orgId?: string, filters?: t.ActivityFilters): Promise<t.ActivityEvent[]>;
  countActivities(startDate?: string, endDate?: string): Promise<number>;
  findLatestEvents(limit: number): Promise<t.ActivityEvent[]>;

  // Scheduled reports
  findScheduledReportConfig(id: string): Promise<t.ScheduledReportConfig | null>;
  findScheduledReportConfigs(enabled?: boolean, reportType?: string): Promise<t.ScheduledReportConfig[]>;
  createScheduledReportConfig(config: t.ScheduledReportConfig): Promise<t.ScheduledReportConfig>;
  updateScheduledReportConfig(id: string, updates: Partial<t.ScheduledReportConfig>): Promise<void>;
  deleteScheduledReportConfig(id: string): Promise<void>;
  findPendingReports(earliestRunTime: string): Promise<t.ScheduledReportConfig[]>;

  // Delivered reports
  findDeliveredReport(id: string): Promise<t.DeliveredReport | null>;
  findDeliveredReports(configId: string): Promise<t.DeliveredReport[]>;
  createDeliveredReport(report: t.DeliveredReport): Promise<t.DeliveredReport>;
}