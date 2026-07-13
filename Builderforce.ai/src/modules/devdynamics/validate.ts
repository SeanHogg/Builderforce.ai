// DevDynamics - Activity Event Validation
// Validates raw activity events from platform webhooks/polls

import type { ActivityEvent } from './types';

/**
 * Raw GitHub webhook payload shape
 */
export interface GitHubWebhookPayload {
  type: 'PushEvent' | 'PullRequestEvent' | 'PullRequestReviewEvent';
  repository: {
    name: string;
    full_name: string;
    owner: { login: string };
  };
  sender: {
    id: number;
    login: string;
    email?: string;
  };
  payload?: any;
  published_at?: string;
  createdAt?: string;
}

/**
 * Raw Bitbucket webhook payload shape
 */
export interface BitbucketWebhookPayload {
  event: 'repo:push' | 'pullrequest:created' | 'pullrequest:approved';
  repository: {
    name: string;
    full_name: string;
    scm: 'git';
  };
  actor: {
    username: string;
    email?: string;
    display_name: string;
  };
  pullrequest?: {
    id: number;
    title: string;
    state: 'OPEN' | 'MERGED' | 'CLOSED';
    created_on: string;
  };
  commit?: {
    hash: string;
    message: string;
    author: {
      raw: string;
    };
  };
  date: string;
}

/**
 * Raw Jira webhook payload shape
 */
export interface JiraWebhookPayload {
  issuetype: string;
  key: string;
  fields: {
    summary: string;
    status: { name: string };
    assignee?: { accountId: string };
    reporter: { accountId: string };
    priority?: string;
    created: string;
    updated: string;
    project: { key: string };
  };
  webhooks: string;
  comment?: {
    body: string;
    author: { accountId: string };
    created: string;
  };
  issue_id: string;
}

/**
 * API request shape for manual/polling activity ingestion
 */
export interface ActivityIngestionRequest {
  events: Array<{
    source: 'github' | 'bitbucket' | 'jira';
    eventType: ActivityEvent['eventType'];
    accountId: string;
    orgId?: string;
    projectId?: string;
    repositoryId?: string;
    metadata: {
      // GitHub
      commitSha?: string;
      branchName?: string;
      pullRequestId?: string;
      reviewComments?: number;
      filesChanged?: number;
      linesAdded?: number;
      linesRemoved?: number;
      // Jira
      issueKey?: string;
      status?: string;
      priority?: string;
      issueSummary?: string;
      assigneeId?: string;
      commentBody?: string;
    };
    timestamp: string;
  }>;
  tenantId: string;
}

/**
 * Validates an activity ingestion request
 */
export function validateActivityIngestionRequest(req: ActivityIngestionRequest): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!req.tenantId) {
    errors.push('tenantId is required');
  }

  if (!Array.isArray(req.events)) {
    errors.push('events must be an array');
  } else if (req.events.length === 0) {
    errors.push('events array cannot be empty');
  } else {
    for (let i = 0; i < req.events.length; i++) {
      const event = req.events[i];
      if (!event.source || !['github', 'bitbucket', 'jira'].includes(event.source)) {
        errors.push(`events[${i}].source must be one of github/bitbucket/jira`);
      }

      if (!event.eventType) {
        errors.push(`events[${i}].eventType is required`);
      } else {
        const validTypes: ActivityEvent['eventType'][] = [
          'commit_push',
          'pr_opened',
          'pr_reviewed',
          'pr_merged',
          'pr_closed',
          'jira_issue_created',
          'jira_issue_updated',
          'jira_issue_transitioned',
          'jira_issue_assigned',
          'jira_comment_added',
        ];
        if (!validTypes.includes(event.eventType)) {
          errors.push(`events[${i}].eventType "${event.eventType}" is not a valid activity event type`);
        }
      }

      if (!event.accountId) {
        errors.push(`events[${i}].accountId is required`);
      }

      if (!event.timestamp) {
        errors.push(`events[${i}].timestamp is required`);
      } else {
        const ts = new Date(event.timestamp);
        if (isNaN(ts.getTime())) {
          errors.push(`events[${i}].timestamp is not a valid ISO date`);
        }
      }

      if (!event.metadata || typeof event.metadata !== 'object') {
        errors.push(`events[${i}].metadata must be an object`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates a GitHub webhook signature
 */
export function validateGitHubSignature(payload: string, signature: string, secret: string): boolean {
  const crypto = require('crypto');
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const digest = 'sha256=' + hmac.digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}