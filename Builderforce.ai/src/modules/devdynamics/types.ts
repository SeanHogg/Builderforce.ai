// DevDynamics — Dev Analytics & Team Intelligence
// Core type definitions for the DevDynamics system-of-record

/**
 * Unified Contributor Profile
 * Represents a single contributor across all platforms (GitHub, Bitbucket, Jira).
 */
export interface UnifiedContributor {
  id: string; // UUID
  displayName: string; // User-provided display name or fallback from platform
  avatarUrl?: string; // Platform avatar URL
  email: string; // Primary for identity resolution
  emailVerifiedAt?: Date;
  linkedAccounts: UnifiedAccount[];
  teamMemberships: TeamMembership[];
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt: Date;
}

/**
 * Unified Account (platform-specific contributor identity)
 */
export interface UnifiedAccount {
  id: string;
  provider: 'github' | 'bitbucket' | 'jira';
  providerAccountId: string; // Username (GitHub), email (Jira)
  email?: string;
  avatarUrl?: string;
  displayName?: string;
  linkedAt: Date;
}

/**
 * Platform-specific contributor metadata
 */
export interface PlatformContributor {
  id: string;
  provider: 'github' | 'bitbucket' | 'jira';
  login?: string; // GitHub username
  email?: string;
  avatarUrl?: string;
  displayName?: string;
  nodeId?: string;
}

/**
 * Activity Event Types
 */
export type ActivityEventType =
  | 'commit_push'
  | 'pr_opened'
  | 'pr_reviewed'
  | 'pr_merged'
  | 'pr_closed'
  | 'jira_issue_created'
  | 'jira_issue_updated'
  | 'jira_issue_transitioned'
  | 'jira_issue_assigned'
  | 'jira_comment_added'
  | 'blocker_detected';

/**
 * Activity Event (normalized ingestion)
 */
export interface ActivityEvent {
  id: string; // UUID
  eventId: string; // Original event ID for deduplication
  eventType: ActivityEventType;
  provider: 'github' | 'bitbucket' | 'jira';
  contributorId: string; // References UnifiedContributor.id
  accountId: string; // Original platform account ID for source linking
  orgId?: string; // GitHub org, Bitbucket workspace, Jira project
  projectId?: string; // Jira project key or repo name
  repositoryId?: string; // Repo or issue key
  metadata: {
    // Platform-specific fields
    commitSha?: string;
    branchName?: string;
    pullRequestId?: string;
    reviewComments?: number;
    filesChanged?: number;
    linesAdded?: number;
    linesRemoved?: number;
    issueKey?: string;
    status?: string; // Jira status before transition
    priority?: string;
    issueSummary?: string;
    assigneeId?: string;
    commentBody?: string;
  };
  timestamp: Date; // Event occurrence time (UTC)
  processedAt: Date; // When ingestion completed
  verifiedAt?: boolean; // Whether identity resolution was successful
}

/**
 * Identity Mapping (manual or deduplicated)
 */
export interface IdentityLink {
  id: string;
  primaryProfileId: string; // UnifiedContributor.id
  secondaryProfileId: string; // UnifiedContributor.id
  primaryPlatform: 'github' | 'bitbucket' | 'jira';
  secondaryPlatform: 'github' | 'bitbucket' | 'jira';
  primaryEmail: string;
  secondaryEmail: string;
  linkedAt: Date;
  linkedBy: 'system_auto' | 'admin_user';
}

/**
 * Team Membership
 */
export interface TeamMembership {
  id: string;
  contributorId: string; // UnifiedContributor.id
  teamId: string;
  teamName: string;
  role: 'engineering' | 'design' | 'product' | 'research' | 'devops' | 'qa' | 'other';
  joinedAt: Date;
  isActive: boolean;
}

/**
 * Scheduled Report Definition
 */
export interface ScheduledReportConfig {
  id: string;
  name: string;
  reportType: 'daily_standup' | 'weekly_executive';
  schedule: {
    timezone: string; // IANA timezone
    cron: string; // Cron expression
    dayOfWeek?: number; // 0-6 for weekly (Sunday=0)
    time: string; // HH:mm
  };
  recipientScope: {
    type: 'org' | 'team';
    scopeId?: string; // orgId (all) or teamId (specific team)
    labels?: string[]; // Filters by team/delivery capability label
  };
  recurrence: 'weekdays' | 'weekly' | 'monthly' | 'one_off';
  enabled: boolean;
  createdAt: Date;
  lastRunAt?: Date;
  nextRunAt: Date;
}

/**
 * Delivered Report (generated output)
 */
export interface DeliveredReport {
  id: string;
  reportConfigId: string;
  reportType: 'daily_standup' | 'weekly_executive';
  generatedAt: Date;
  deadline?: Date; // Target delivery time
  recipientScope: ScheduledReportConfig['recipientScope'];
  scopeData: {
    orgId: string;
    contributors: UnifiedContributor[]; // Subset scoped for this report
    teams: { id: string; name: string; activityAggregates: ActivitySummary }[];
  };
  summary: {
    narrative: string; // LLM-generated prose (< 300 words for executive)
    data: ReportData; // Structured data table
  };
  format: 'markdown' | 'pdf';
  deliveredAt?: Date;
}

/**
 * Aggregated Activity Summary (for reports/filtering)
 */
export interface ActivitySummary {
  contributorId: string;
  commitsLast24h: number;
  prsOpenedLast24h: number;
  prsReviewedLast24h: number;
  prsMergedLast24h: number;
  issuesTransitionedLast24h: number;
  issuesCommentedOnLast24h: number;
  blockersDetectedLast24h: number;
  allActivityLast24h: ActivityEvent[];
}

/**
 * Dashboard Metrics (team-level)
 */
export interface DashboardMetrics {
  period: {
    start: Date;
    end: Date;
  };
  orgId: string;
  contributorsActive: number;
  commits: {
    total: number;
    uniqueContributors: number;
    byTeam: Record<string, number>; // teamId -> commits
  };
  prs: {
    opened: number;
    merged: number;
    cycleTimeAvgDays: number; // Average days open to merge
    cycleTimeP95Days: number;
    blocked: number; // Open > X days without review
  };
  issues: {
    created: number;
    completed: number;
    completionRate: number; // Completed / Created
  };
  topContributors: {
    contributorId: string;
    displayName: string;
    commits: number;
    prsMerged: number;
    reviewsCount: number;
  }[];
  anomalousActivity: Array<{
    contributorId: string;
    displayName: string;
    reason: 'low_commits' | 'low_prs' | 'high_blockers';
    threshold: number;
  }>;
}

/**
 * Report Data (structured output)
 */
export interface ReportData {
  contributors: Array<{
    contributorId: string;
    displayName: string;
    commitsLast24h: number;
    prsOpenedLast24h: number;
    prsReviewedLast24h: number;
    prsMergedLast24h: number;
    issuesTransitionedLast24h: number;
    issuesCommentedOnLast24h: number;
    blockersDetected: number;
    activityUrl: string; // Activity log link
    profileUrl: string; // Contributor detail page link
  }>;
  teams: Array<{
    teamId: string;
    teamName: string;
    commitsTotal: number;
    prsMergedTotal: number;
    averageCycleTime: number;
    blockers: number;
  }>;
  general: {
    totalCommits: number;
    totalPRsMerged: number;
    totalIssuesCompleted: number;
    averageCycleTime: number;
    blockerCount: number;
    openBlockersSummary: string; // Narrative summary of blockers
  };
}