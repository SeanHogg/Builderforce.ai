// DevDynamics - Bitbucket Integration Adapter
// Normalizes Bitbucket webhooks and API responses into standard ActivityEvent format

import type { ActivityEvent } from './types';
import { ActivityIngestor } from './activity-ingestor';

/**
 * Bitbucket webhook types that map to activity events
 */
const BITBUCKET_EVENT_TYPES: Record<string, ActivityEvent['eventType'] | null> = {
  repo: {
    push: 'commit_push',
    PullRequestCreated: null, // Handled separately
    PullRequestUpdated: null, // Handled separately
    PullRequestMerged: 'pr_merged',
    PullRequestDeleted: null,
  },
};

export class BitbucketAdapter {
  private ingestor: ActivityIngestor;

  constructor(ingestor: ActivityIngestor) {
    this.ingestor = ingestor;
  }

  /**
   * Handle a Bitbucket webhook payload and return resolved activity events.
   */
  async handleWebhook(payload: any): Promise<ActivityEvent[]> {
    const events: ActivityEvent[] = [];
    const webhookEvent = BITBUCKET_EVENT_TYPES.repository?.[payload.header.event] || null;
    const timestamp = payload.body?.comment?.utcTimestamp || payload.body?.push?.date || new Date().toISOString();

    if (webhookEvent === 'commit_push' && payload.header.event === 'repo:push') {
      events.push(this.normalizePushEvent(payload, timestamp));
    } else if (webhookEvent === 'pr_merged' && payload.header.event === 'PullRequestMerged') {
      events.push(this.normalizePullRequestEvent(payload, timestamp));
    }

    return events;
  }

  /**
   * Normalize repo:push events into commit_push activity events.
   */
  private normalizePushEvent(payload: any, timestamp: string): ActivityEvent {
    const repo = payload.repository || {};
    const workspace = repo.workspace || {};
    const orgId = workspace.slug;
    const repoId = repo.uuid || repo.id;

    const commits = payload.body?.push?.commits || [];
    const author = commits[0]?.author?.user || {};

    return {
      id: crypto.randomUUID(),
      eventId: `${repo.uuid}:${commits.map((c: any) => c.pushId).join(',')}:${timestamp}`,
      eventType: 'commit_push',
      provider: 'bitbucket',
      contributorId: '',
      accountId: author.uuid || author.name || 'unknown',
      orgId,
      projectId: repo.name,
      repositoryId: repoId,
      metadata: {
        branchName: payload.body?.push?.branch ?: [],
        filesChanged: commits.reduce((sum: number, c: any) => sum + (c.changeTypeCount || 0), 0),
        commitSha: commits.reduce((last: any, c: any) => last || c.pushId, ''),
      },
      timestamp,
      processedAt: new Date().toISOString(),
      verifiedAt: true,
    };
  }

  /**
   * Normalize PullRequestMerged events into pr_merged activity events.
   */
  private normalizePullRequestEvent(payload: any, timestamp: string): ActivityEvent {
    const pr = payload.pullRequest || {};
    const repo = payload.repository || {};
    const workspace = repo.workspace || {};

    return {
      id: crypto.randomUUID(),
      eventId: `pr:${pr.id}:merged:${pr.mergedOn || timestamp}`,
      eventType: 'pr_merged',
      provider: 'bitbucket',
      contributorId: '',
      accountId: pr.author?.uuid || pr.author?.name || pr.links?.author?.href?.split('/').pop() || 'unknown',
      orgId: workspace.slug,
      projectId: repo.name,
      repositoryId: repo.uuid || repo.id,
      metadata: {
        pullRequestId: pr.id.toString(),
      },
      timestamp: pr.mergedOn || timestamp,
      processedAt: new Date().toISOString(),
      verifiedAt: true,
    };
  }

  /**
   * Ingest events directly from a Bitbucket API response.
   */
  async ingestFromApi(
    workspaces: any[], // Array from /workspaces
    repositories: any[], // Array from /repositories/:workspace
    pullRequests: any[], // Array from /repositories/:workspace/:repoSlug/pullrequests
  ): Promise<ActivityEvent[]> {
    const events: ActivityEvent[] = [];

    for (const pr of pullRequests) {
      const workspace = pr.workspace || {};
      const repo = pr.repository || {};
      const orgId = workspace.slug;
      const repoId = repo.uuid || repo.id;

      if (pr.state === 'MERGED') {
        // Only pr_merged -> commit_push is handled here; in v2 we might have committed pushes per commit for the merged ref too.
        events.push({
          id: crypto.randomUUID(),
          eventId: `pr:${pr.id}:merged:${pr.mergedOn || pr.updatedOn || new Date().toISOString()}`,
          eventType: 'pr_merged',
          provider: 'bitbucket',
          contributorId: '',
          accountId: pr.author?.uuid || pr.author?.name || pr.links?.author?.href?.split('/').pop() || 'unknown',
          orgId,
          projectId: repo.name,
          repositoryId: repoId,
          metadata: {
            pullRequestId: pr.id.toString(),
          },
          timestamp: pr.mergedOn || pr.updatedOn || new Date().toISOString(),
          processedAt: new Date().toISOString(),
          verifiedAt: true,
        });
      }
    }

    return events;
  }
}

export default BitbucketAdapter;