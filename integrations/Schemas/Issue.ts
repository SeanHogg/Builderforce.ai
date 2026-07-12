/**
 * Issue Schema — Shared by Jira Cloud and Linear
 *
 * This is the canonical `Issue` event emitted by project-tracking integrations.
 * All integrations (Jira, Linear, GitHub Actions, Sentry auto-create) must produce
 * events adhering to this contract.
 *
 * @see $PRD_CANONICAL_INTEGRATIONS task #310
 */

export interface Issue {
  eventId: string; // UUID v4. Unique per normalization event; distinct from source issue ID.
  sourceIntegration: 'JIRA' | 'LINEAR';
  issues: IssueItem[];
  sourceCreatedAt: Date | string;
  sourceUpdatedAt: Date | string;
  schemaVersion: '1.0';
}

export interface IssueItem {
  id: string; // Issue ID from source (e.g., JIRA-123, LINEAR-ABC)
  key: string; // Platform-level normalized key (e.g., ISSUE-{uuid})
  title: string;
  description: string;
  status: IssueStatus;
  sourceType: 'agile' | 'project' | 'bug';
  sourceRef: {
    id: string;
    // Project identifier from source (e.g., JIRA projectKey, Linear team/organization)
    projectIdentifier: string;
    organizationIdentifier?: string;
  };
  assignees: string[]; // Array of email addresses from source
  labels: string[];
  created: Date | string;
  updated: Date | string;
  // Optional linked PR/commit reference fields for change correlation
  linkedPullRequestId?: string;
  linkedCommitSha?: string;
  // Platform-assigned metadata
  linkedTicketId?: string; // For cross-integration linking (e.g., sent to action items)
}

/** Canonical status enum; all integrations must normalize to these values */
export enum IssueStatus {
  TODO = 'Todo',
  IN_PROGRESS = 'InProgress',
  DONE = 'Done',
  BLOCKED = 'Blocked',
  CANCELLED = 'Cancelled',
  REVIEW = 'Review'
}