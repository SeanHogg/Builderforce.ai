// DevDynamics - GitHub Integration Adapter
// Normalizes GitHub webhooks and API responses into standard ActivityEvent format

import type { ActivityEvent } from './types';
import { ActivityIngestor } from './activity-ingestor';

/**
 * GitHub webhook types that map to activity events
 */
const GITHUB_EVENT_TYPES: Record<string, ActivityEvent['eventType'] | null> = {
  PushEvent: 'commit_push',
  PullRequestEvent: null, // Handled separately with 'action' field
  PullRequestReviewEvent: null, // Handled separately with 'action' field
  IssueEvent: null, // Suggestion for Jira mapping
  Ping: null,
};

/**
 * GitHub webhook adapter — FR-3.2
 */
export class GitHubAdapter {
  private ingestor: ActivityIngestor;

  constructor(ingestor: ActivityIngestor) {
    this.ingestor = ingestor;
  }

  /**
   * Handle a GitHub webhook payload and return resolved activity events.
   */
  async handleWebhook(payload: any): Promise<ActivityEvent[]> {
    const events: ActivityEvent[] = [];
    const githubEvent = GITHUB_EVENT_TYPES[payload.type];
    const timestamp = payload.published_at || payload.createdAt || new Date().toISOString();

    if (githubEvent === 'commit_push' && payload.type === 'PushEvent') {
      events.push(this.normalizePushEvent(payload, timestamp));
    } else if (githubEvent === null && payload.type === 'PullRequestEvent') {
      events.push(...this.normalizePullRequestEvent(payload, timestamp));
    } else if (githubEvent === null && payload.type === 'PullRequestReviewEvent') {
      events.push(...this.normalizeReviewEvent(payload, timestamp));
    }

    return events;
  }

  /**
   * Normalize PushEvent into commit_push activity events.
   */
  private normalizePushEvent(payload: any, timestamp: string): ActivityEvent {
    const commits = payload.payload?.commits || [];
    const repository = payload.repository || {};
    const orgId = payload.repository?.full_name?.split('/')[0];
    const repoId = payload.repository?.id;

    return {
      id: crypto.randomUUID(),
      eventId: `${payload.repository.id}:${commits.map((c: any) => c.sha).join(',')}:${timestamp}`,
      eventType: 'commit_push' as ActivityEvent['eventType'],
      provider: 'github',
      contributorId: '', // Populated during ingestion by resolving ID
      accountId: payload.sender?.id?.toString() || 'unknown',
      orgId,
      projectId: repository.name,
      repositoryId: repoId?.toString(),
      metadata: {
        branchName: payload.ref || '',
        filesChanged: commits.reduce((sum: number, c: any) => sum + (c.additions || 0), 0),
        linesAdded: commits.reduce((sum: number, c: any) => sum + (c.additions || 0), 0),
        linesRemoved: commits.reduce((sum: number, c: any) => sum + (c.deletions || 0), 0),
        commitSha: commits.reduce((last: any, c: any) => last || c.sha, ''),
      },
      timestamp,
      processedAt: new Date().toISOString(),
      verifiedAt: true,
    };
  }

  /**
   * Normalize PullRequestEvent into pr_opened/pr_merged/pr_closed events.
   */
  private normalizePullRequestEvent(payload: any, timestamp: string): ActivityEvent[] {
    const action = payload.action; // opened, closed, merged, synchronize, etc.
    const event: ActivityEvent | null = (() => {
      switch (action) {
        case 'opened':
          return {
            id: crypto.randomUUID(),
            eventId: `pr:${payload.pull_request.number}:${action}:${timestamp}`,
            eventType: 'pr_opened',
            provider: 'github',
            contributorId: '',
            accountId: payload.sender?.id?.toString() || '',
            orgId: payload.repository?.full_name?.split('/')[0],
            projectId: payload.repository?.name,
            repositoryId: payload.repository?.id?.toString(),
            metadata: {
              pullRequestId: payload.pull_request.number.toString(),
              filesChanged: payload.pull_request.additions + payload.pull_request.deletions,
              linesAdded: payload.pull_request.additions,
              linesRemoved: payload.pull_request.deletions,
            },
            timestamp,
            processedAt: new Date().toISOString(),
            verifiedAt: true,
          };
        case 'closed':
          return {
            id: crypto.randomUUID(),
            eventId: `pr:${payload.pull_request.number}:${action}:${payload.pull_request.merged_at || timestamp}`,
            eventType: 'pr_closed',
            provider: 'github',
            contributorId: '',
            accountId: payload.sender?.id?.toString() || '',
            orgId: payload.repository?.full_name?.split('/')[0],
            projectId: payload.repository?.name,
            repositoryId: payload.repository?.id?.toString(),
            metadata: {
              pullRequestId: payload.pull_request.number.toString(),
            },
            timestamp: payload.pull_request.merged_at || timestamp,
            processedAt: new Date().toISOString(),
            verifiedAt: false, // Not merged yet
          };
        case 'merged':
          return {
            id: crypto.randomUUID(),
            eventId: `pr:${payload.pull_request.number}:merged:${payload.pull_request.merged_at || timestamp}`,
            eventType: 'pr_merged',
            provider: 'github',
            contributorId: '',
            accountId: payload.sender?.id?.toString() || '',
            orgId: payload.repository?.full_name?.split('/')[0],
            projectId: payload.repository?.name,
            repositoryId: payload.repository?.id?.toString(),
            metadata: {
              pullRequestId: payload.pull_request.number.toString(),
              filesChanged: payload.pull_request.additions + payload.pull_request.deletions,
              linesAdded: payload.pull_request.additions,
              linesRemoved: payload.pull_request.deletions,
            },
            timestamp: payload.pull_request.merged_at || timestamp,
            processedAt: new Date().toISOString(),
            verifiedAt: true,
          };
        default:
          return null;
      }
    })();

    return event ? [event] : [];
  }

  /**
   * Normalize PullRequestReviewEvent into pr_reviewed events.
   */
  private normalizeReviewEvent(payload: any, timestamp: string): ActivityEvent[] {
    const action = payload.action; // submitted, edited, dismissed
    if (action !== 'submitted') return [];

    const event: ActivityEvent = {
      id: crypto.randomUUID(),
      eventId: `pr_review:${payload.pull_request.number}:${payload.review.id}:${action}:${timestamp}`,
      eventType: 'pr_reviewed',
      provider: 'github',
      contributorId: '',
      accountId: payload.sender?.id?.toString() || '',
      orgId: payload.repository?.full_name?.split('/')[0],
      projectId: payload.repository?.name,
      repositoryId: payload.repository?.id?.toString(),
      metadata: {
        pullRequestId: payload.pull_request.number.toString(),
        reviewComments: payload.review.state === 'commented' 
          ? 1 
          : (payload.review.state === 'approved' ? null : null),
      },
      timestamp,
      processedAt: new Date().toISOString(),
      verifiedAt: true,
    };

    return [event];
  }

  /**
   * Ingest events directly from a GitHub API response (e.g., from a sync job).
   */
  async ingestFromApi(
    repositories: any[], // Array of repo objects from /user/repos
    prs: any[], // Array of PRs from /repos/:owner/:repo/pulls
  ): Promise<ActivityEvent[]> {
    const events: ActivityEvent[] = [];

    // Normalize PRs into events (opened, merged, closed)
    for (const pr of prs) {
      const orgId = pr.base.repo.owner.login;
      const repoId = pr.base.repo.id;
      
      if (pr.state === 'closed') {
        events.push({
          id: crypto.randomUUID(),
          eventId: `pr:${pr.number}:closed:${pr.closed_at}`,
          eventType: 'pr_closed',
          provider: 'github',
          contributorId: '',
          accountId: pr.user?.id?.toString() || '',
          orgId,
          projectId: pr.base.repo.name,
          repositoryId: repoId.toString(),
          metadata: {
            pullRequestId: pr.number.toString(),
          },
          timestamp: pr.closed_at,
          processedAt: new Date().toISOString(),
          verifiedAt: pr.merged_at ? true : false,
        });
      } else if (pr.merged_at) {
        events.push({
          id: crypto.randomUUID(),
          eventId: `pr:${pr.number}:merged:${pr.merged_at}`,
          eventType: 'pr_merged',
          provider: 'github',
          contributorId: '',
          accountId: pr.user?.id?.toString() || '',
          orgId,
          projectId: pr.base.repo.name,
          repositoryId: repoId.toString(),
          metadata: {
            pullRequestId: pr.number.toString(),
            filesChanged: pr.additions + pr.deletions,
            linesAdded: pr.additions,
            linesRemoved: pr.deletions,
          },
          timestamp: pr.merged_at,
          processedAt: new Date().toISOString(),
          verifiedAt: true,
        });
      }
    }

    return events;
  }
}

export default GitHubAdapter;