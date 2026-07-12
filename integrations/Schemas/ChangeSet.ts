/**
 * ChangeSet Schema — Canonical event emitted by GitHub
 *
 * This is the canonical `ChangeSet` event exposed by the GitHub integration.
 * GitHub Actions and observability integrations correlate platform events to this schema.
 *
 * @see $PRD_CANONICAL_INTEGRATIONS task #310
 */

export interface ChangeSet {
  eventId: string; // UUID v4. Unique per normalization event.
  sourceIntegration: 'GITHUB';
  repository: Repository;
  branch: string;
  commitSha: string;
  committedBy: string; // GitHub login
  committedByEmail?: string; // GitHub email
  commitMessage: string;
  commitTimestamp: Date | string;
  changeType: ChangeType;
  changes: CommitChange[];
  linkedIssueKey?: string; // Linked Jira/Linear issue key if pattern <issue-id>-* matches
  linkedPullRequestId?: string; // GitHub PR number if created/updated
  // Optional flags
  isPR?: boolean;
  isTaggedRelease?: boolean;
  // Platform-assigned metadata
  linkedPipelineRunId?: string; // For correlation back to pipeline health
}

export interface Repository {
  owner: string; // GitHub organization or user
  name: string;
  fullName: string; // full repo name for logging
  url: string;
}

export interface CommitChange {
  path: string; // File path changed
  oldRevision?: string;
  newRevision?: string;
  changeType: ChangeFileKind;
}

export enum ChangeType {
  PUSH = 'push',
  COMMIT = 'commit',
  PR_CREATED = 'pull_request_opened',
  PR_UPDATED = 'pull_request_updated',
  PR_CLOSED = 'pull_request_closed',
  TAGGED_RELEASE = 'create'
}

export enum ChangeFileKind {
  ADDED = 'added',
  DELETED = 'deleted',
  MODIFIED = 'modified',
  RENAMED = 'renamed'
}