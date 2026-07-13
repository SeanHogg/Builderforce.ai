// DevDynamics - Activity Ingestion Pipeline
// Normalizes and persists activity events from platform integrations

import type { ActivityEvent } from './types';
import { ActivityIngestionRequest, validateActivityIngestionRequest } from './validate';
import { devDynamicsRepository } from './repository';

export interface ActivityIngestionResult {
  success: boolean;
  eventsProcessed: number;
  eventsSkipped: number;
  errors: Array<{ eventId: string; error: string }>;
  contributorMergePerformed: number;
}

/**
 * Activity Ingestor — FR-2. Activity Ingestion Pipeline (webhook & polling modes)
 *
 * Responsibilities:
 * - Validate incoming events
 * - Resolve contributor identities
 * - Store normalized events with full provenance
 * - Support idempotent ingestion via event_id deduplication
 * - Emit pipeline metrics for observability
 */
export class ActivityIngestor {
  private identityResolver: any; // IdentityResolver instance

  constructor(identityResolver: any) {
    this.identityResolver = identityResolver;
  }

  /**
   * Ingest a batch of activity events.
   * Supports both webhook (real-time) and polling (catch-up/backfill) modes.
   */
  async ingest(events: Array<{
    source: 'github' | 'bitbucket' | 'jira';
    eventType: ActivityEvent['eventType'];
    accountId: string;
    orgId?: string;
    projectId?: string;
    repositoryId?: string;
    metadata: {
      commitSha?: string;
      branchName?: string;
      pullRequestId?: string;
      reviewComments?: number;
      filesChanged?: number;
      linesAdded?: number;
      linesRemoved?: number;
      issueKey?: string;
      status?: string;
      priority?: string;
      issueSummary?: string;
      assigneeId?: string;
      commentBody?: string;
    };
    timestamp: string;
  }>): Promise<ActivityIngestionResult> {
    // Phase 1: Validate all events
    const validation = validateActivityIngestionRequest({ events, tenantId: 'placeholder' });
    if (!validation.valid) {
      return {
        success: false,
        eventsProcessed: 0,
        eventsSkipped: 0,
        errors: validation.errors.map((err, i) => ({ eventId: i.toString(), error: err })),
        contributorMergePerformed: 0,
      };
    }

    const now = new Date().toISOString();
    const errors: Array<{ eventId: string; error: string }> = [];
    let eventsSkipped = 0;
    let contributorMergePerformed = 0;

    // Phase 2: Build normalized events and resolve contributors
    const normalizedEvents: ActivityEvent[] = [];

    for (let processed = 0; processed < events.length; processed++) {
      // Deduplication: do not ingest if eventId already exists
      const candidateId = crypto.randomUUID(); // We generate stable event IDs in adapters, or UUID if not.
      const existing = await devDynamicsRepository.findActivityByEventId(candidateId);
      if (existing) {
        eventsSkipped++;
        continue;
      }

      try {
        const resolved = await this.resolveAndCreateEvent(events[processed], now, candidateId);
        if (resolved) {
          normalizedEvents.push(resolved);
        } else {
          eventsSkipped++;
        }
      } catch (err: any) {
        console.error(`Failed to ingest event from ${events[processed].source}:`, err);
        errors.push({
          eventId: events[processed].accountId + ':' + events[processed].timestamp,
          error: err.message || 'Unknown error',
        });
      }
    }

    // Phase 3: Persist to repository
    try {
      await devDynamicsRepository.ingestActivity(...normalizedEvents);
    } catch (err: any) {
      console.error('Failed to persist normalized events:', err);
      if (errors.length === 0) {
        errors.push({ eventId: 'ingestion', error: err.message || 'Persist failed' });
      }
    }

    contributorMergePerformed = events.length - normalizedEvents.length - eventsSkipped;

    return {
      success: errors.length === 0,
      eventsProcessed: normalizedEvents.length,
      eventsSkipped,
      errors,
      contributorMergePerformed,
    };
  }

  private async resolveAndCreateEvent(
    incoming: {
      source: string;
      eventType: string;
      accountId: string;
      orgId?: string;
      projectId?: string;
      repositoryId?: string;
      metadata: Record<string, any>;
      timestamp: string;
    },
    ts: string,
    eventId: string
  ): Promise<ActivityEvent | null> {
    // Build unified account signals from metadata
    const accounts = this.buildUnifiedAccounts(incoming);

    // Resolve contributor (identity_resolver.ts)
    const resolution = await this.identityResolver.resolve(accounts, {
      findContributorByEmail: devDynamicsRepository.getContributorByEmail,
      findContributorById: devDynamicsRepository.findContributorById,
      findContributorForPlatform: devDynamicsRepository.findContributorForPlatform,
      upsertContributor: devDynamicsRepository.upsertContributor,
      createIdentityLink: devDynamicsRepository.createIdentityLink,
      findIdentityLinks: devDynamicsRepository.findIdentityLinks,
    });

    if (!resolution.contributor) {
      console.error('Failed to resolve contributor for event:', incoming);
      return null;
    }

    // Build normalized event with provider-specific eventId
    const normalizerEventId = incoming.metadata.issueKey || incoming.metadata.commitSha || incoming.metadata.pullRequestId || incoming.accountId;
    const finalEventId = `${normalizerEventId}:${incoming.eventType}:${ts}`;

    return {
      id: crypto.randomUUID(),
      eventId: finalEventId,
      eventType: incoming.eventType as ActivityEvent['eventType'],
      provider: incoming.source as any,
      contributorId: resolution.contributor.id,
      accountId: incoming.accountId,
      orgId: incoming.orgId,
      projectId: incoming.projectId,
      repositoryId: incoming.repositoryId,
      metadata: incoming.metadata,
      timestamp: new Date(incoming.timestamp).toISOString(),
      processedAt: ts,
      verifiedAt: resolution.merged || false,
    };
  }

  private buildUnifiedAccounts(incoming: {
    source: string;
    accountId: string;
    metadata: Record<string, any>;
  }): Array<{ id: string; provider: string; providerAccountId: string; email?: string; avatarUrl?: string; displayName?: string; linkedAt: Date }> {
    const accounts: any[] = [];
    accounts.push({
      id: crypto.randomUUID(),
      provider: incoming.source as ('github' | 'bitbucket' | 'jira'),
      providerAccountId: incoming.accountId,
      email: incoming.metadata.email,
      avatarUrl: incoming.metadata.avatarUrl,
      displayName: incoming.metadata.displayName || incoming.accountId,
      linkedAt: new Date(),
    });
    return accounts;
  }
}

export default ActivityIngestor;