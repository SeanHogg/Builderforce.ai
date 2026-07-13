// DevDynamics - Jira Integration Adapter
// Normalizes Jira webhooks and API responses into standard ActivityEvent format

import type { ActivityEvent } from './types';
import { ActivityIngestor } from './activity-ingestor';

/**
 * Jira event types that map to activity events
 */
const JIRA_EVENT_TYPES: Record<string, ActivityEvent['eventType'] | null> = {
  issue_created: 'issue_created',
  issue_updated: 'issue_updated',
  issue_transitioned: null,
  issue_assigned: 'issue_assigned',
  comment_created: 'comment_created',
  comment_updated: 'comment_updated',
  comment_deleted: null,
};

export class JiraAdapter {
  private ingestor: ActivityIngestor;

  constructor(ingestor: ActivityIngestor) {
    this.ingestor = ingestor;
  }

  /**
   * Handle a Jira Cloud POST (Atlassian Connect) webhook payload.
   * NOTE: In the real implementation, this handler will be deployed
   * in microservices/endpoints matching Atlassian Connect app configuration
   * and will receive POST requests to /plugins/servlet/webhook/<event> with
   * a signed Cloud payload. For now, we normalize to a generic POST body
   * that includes type/action fields mirroring the structure.
   */
  async handleWebhook(payload: any): Promise<ActivityEvent[]> {
    const events: ActivityEvent[] = [];
    const timestamp = payload.webhookEvent?.[0]?.timestamp || payload.timestamp || new Date().toISOString();
    
    // Jira Connect payloads may use different shape than atlassian-connect.json endpoint conformations:
    // - webhookEventCollection.sort(...webhookEventSync) is NOT a Jira Cloud webhook payload shape.
    // - We therefore expect a top-level object where webhookEvent (singular) or webhooks (array) exist.
    // For this adapter we will attempt active destructure of either form and fill in common fields.
    const baseCommon: Record<string, any> = {};

    if (payload.webhookEvent) {
      baseCommon.event = payload.webhookEvent;
      baseCommon.issue = payload.issue;
      baseCommon.user = payload.user;
      // TODO: add fields like eventTime for per-event in the model
    } else if (Array.isArray(payload.webhookEvents)) {
      baseCommon.event = payload.webhookEvents[0]?.webhookEvent || payload.webhookEvents[0]?.event || '';
      baseCommon.issue = payload.webhookEvents[0]?.issue || payload.webhookEvents[0]?.issueV2?.issue;
      baseCommon.user = payload.webhookEvents[0]?.user || payload.user;
    } else {
      // fallback / error path: something invalid
      console.warn('Unable to parse Jira webhook types and define event mapping. Payload:', JSON.stringify(payload, null, 2));
      return [];
    }

    const webhookEntry = payload.webhookEvents?.[0] || baseCommon;
    const eventType = webhookEntry.webhookEvent || baseCommon.event || '';
    const action = webhookEntry.issue?.fields?.status?.name || '';

    // Map Jira event types to normalized activity events
    let mappedEventType: ActivityEvent['eventType'] | null = null;

    switch (eventType) {
      case 'jira:issue_created':
        mappedEventType = 'issue_created';
        break;
      case 'jira:issue_updated':
        // filter by action/status when applicable
        if (['status_changed', 'status_transitioned'].includes(webhookEntry.event?.toLowerCase())) {
          // Map Jira status transitions to normalized categories
          const normalizedStatus = this.normalizeIssueStatus(action);
          if (normalizedStatus.category) {
            mappedEventType = normalizedStatus.category === 'closed' ? 'issue_closed' : 'issue_updated';
          }
        }
        break;
      case 'jira:issue_closed':
        mappedEventType = 'issue_closed';
        break;
      case 'jira:comment_created':
        mappedEventType = 'comment_created';
        break;
      case 'jira:comment_updated':
        mappedEventType = 'comment_updated';
        break;
      default:
        // unknown or not yet supported (e.g., issue assigned handled below)
        break;
    }

    if (mappedEventType) {
      const event = this.normalizeJiraEvent(webhookEntry, timestamp, mappedEventType);
      if (event) events.push(event);
    }

    return events;
  }

  /**
   * Normalize Jira Cloud webhook to ActivityEvent
   */
  private normalizeJiraEvent(sw: any, timestamp: string, eventType: ActivityEvent['eventType']): ActivityEvent | null {
    const issue = sw.issue || {};
    const fields = issue.fields || {};
    const key = fields.key || issue.key || `ISSUE-${Date.now()}`;
    const projectKey = fields.project?.key || fields.projectId || '';
    const orgId = projectKey; // Using project key as org/facade for now
    const projectId = fields.issueTypeId; // Fallback for the normalizer; will be refined when project groups are defined

    return {
      id: crypto.randomUUID(),
      eventId: `${key}.${eventType}.${timestamp}`,
      eventType,
      provider: 'jira',
      contributorId: '',
      accountId: sw.user?.accountId || sw.userAccountId || 'unknown',
      orgId,
      projectId,
      metadata: {
        issueKey: key,
        status: fields.status?.name,
        priority: fields.priority?.name,
        issueSummary: fields.summary,
        assigneeId: fields.assignee?.accountId,
        commentBody: fields.comment?.body?.rendered || fields.commentBody,
        changeType: fields.changeType,
        issueTypeId: fields.issueTypeId,
        created: fields.created,
        updated: fields.updated,
        // TODO: 'isNotFiltering' keys from Jira webhook (not currently used by our model)
      },
      timestamp: new Date(timestamp).toISOString(),
      processedAt: new Date().toISOString(),
      verifiedAt: false,
    };
  }

  /**
   * Lower-level API sync methods
   * Used by scheduled backfill or catch-up jobs.
   * See FR-2.2: support webhook and scheduled polling modes.
   */
  async ingestFromApi(
    projects: any[], // /api/3/project
    issues: any[], // /api/3/search?jql=project=XXX
    comments: any[], // /api/3/issue/{issueKey}/comment
  ): Promise<ActivityEvent[]> {
    const events: ActivityEvent[] = [];

    // issue_updated / issue_closed from search (approximation)
    for (const issue of issues) {
      const fields = issue.fields || {};
      const key = fields.key || issue.key || `ISSUE-${Date.now()}`;
      const projectKey = fields.project?.key || fields.projectId || '';
      const orgId = projectKey;
      const projectId = fields.issueTypeId; // placeholder
      
      // Normalize status: closed or resolved
      const normalizedStatus = this.normalizeIssueStatus(fields.status?.name);
      if (normalizedStatus.category === 'closed') {
        events.push({
          id: crypto.randomUUID(),
          eventId: `${key}:closed:${fields.status?.updated || new Date().toISOString()}`,
          eventType: 'issue_closed',
          provider: 'jira',
          contributorId: '',
          accountId: fields.assignee?.accountId || fields.reporter?.accountId || 'unknown',
          orgId,
          projectId,
          metadata: {
            issueKey: key,
            status: fields.status?.name,
            priority: fields.priority?.name,
            issueSummary: fields.summary,
            assigneeId: fields.assignee?.accountId,
          },
          timestamp: fields.status?.updated || new Date().toISOString(),
          processedAt: new Date().toISOString(),
          verifiedAt: true,
        });
      } else {
        events.push({
          id: crypto.randomUUID(),
          eventId: `${key}:updated:${fields.updated || new Date().toISOString()}`,
          eventType: 'issue_updated',
          provider: 'jira',
          contributorId: '',
          accountId: fields.updatedBy?.accountId || fields.assignee?.accountId || 'unknown',
          orgId,
          projectId,
          metadata: {
            issueKey: key,
            previousStatus: fields.status?.previousName,
            status: fields.status?.name,
            priority: fields.priority?.name,
            issueSummary: fields.summary,
            assigneeId: fields.assignee?.accountId,
          },
          timestamp: fields.updated || new Date().toISOString(),
          processedAt: new Date().toISOString(),
          verifiedAt: false,
        });
      }
    }

    // comment_created/updated from comment list
    for (const comment of comments) {
      const issueKey = comment.issueKey || `ISSUE-${Date.now()}`;
      const fields = comment.fields || {};
      const author = fields.createdBy?.id ? fields.createdBy.id : fields.createdBy;
      const key = fields.key || issueKey;
      const projectKey = fields.project?.key || 'PROJECT';
      const orgId = projectKey;
      const projectId = fields.issueTypeId; // placeholder

      events.push({
        id: crypto.randomUUID(),
        eventId: `${key}:${comment.id || Date.now()}:commented:${fields.created?.iso? : fields.created}`,
        eventType: 'comment_created',
        provider: 'jira',
        contributorId: '',
        accountId: author?.accountId || author,
        orgId,
        projectId,
        metadata: {
          issueKey: key,
          commentBody: fields.body?.rendered || comment.body?.rendered || '',
        },
        timestamp: fields.created?.iso || fields.created,
        processedAt: new Date().toISOString(),
        verifiedAt: true,
      });
    }

    return events;
  }

  /**
   * Normalize Jira status name into a closed/active category.
   */
  private normalizeIssueStatus(statusName?: string) {
    if (!statusName) return { category: 'unknown' };

    const key = statusName.toLowerCase();
    for (const entry of [
      { terms: ['closed', 'resolved', 'done'], category: 'closed' },
      { terms: ['unresolved', 'uncomplete', 'open'], category: 'active' },
      { terms: ['in_progress', 'inprogress', 'in progress'], category: 'active' },
      { terms: ['to_do', 'todo', 'todo'}, category: 'active' },
    ]) {
      if (entry.terms.some(t => key.includes(t))) {
        return { category: entry.category };
      }
    }
    return { category: 'unknown' };
  }
}

export default JiraAdapter;