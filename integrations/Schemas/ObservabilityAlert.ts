/**
 * ObservabilityAlert Schema — Canonical event for Sentry and Datadog
 *
 * This is the canonical `ObservabilityAlert` event emitted by Sentry and Datadog
 * integrations. Utilities in GitHub Actions and smart routing use this for correlation.
 *
 * @see $PRD_CANONICAL_INTEGRATIONS task #310
 */

export interface ObservabilityAlert {
  eventId: string; // UUID v4. Unique per normalization event.
  source: 'SENTRY' | 'DATADOG';
  title: string;
  description: string;
  severity: AlertSeverity;
  sourceRef: {
    id: string;
    name: string;
    resourceType: 'project' | 'organization' | 'repository' | 'service' | 'environment';
  };
  environment: string; // Source environment (e.g., production, staging, dev, staging-2)
  firstSeen: Date | string;
  lastSeen: Date | string;
  resolved?: boolean;
  // Optional correlation to platform events
  linkedPipelineRunId?: string; // Via release tag match
  linkedChangeSetId?: string; // Via commit SHA match
  linkedIssueKey?: string; // For auto-created tickets
  // Platform-assigned metadata
  linkedTicketId?: string; // If auto-created in Jira/Linear
}

export enum AlertSeverity {
  ERROR = 'error',
  WARNING = 'warning',
  INFO = 'info',
  CRITICAL = 'critical',
  INFO_LOW = 'info_low' // For recovered or no-data
}