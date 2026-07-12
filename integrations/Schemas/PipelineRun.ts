/**
 * PipelineRun Schema — Canonical event emitted by GitHub Actions
 *
 * This is the canonical `PipelineRun` event exposed by the GitHub Actions integration.
 * Sentry and Datadog correlating integrations link releases to this schema.
 *
 * @see $PRD_CANONICAL_INTEGRATIONS task #310
 */

export interface PipelineRun {
  eventId: string; // UUID v4. Unique per normalization event.
  sourceIntegration: 'GITHUB_ACTIONS';
  runId: string; // GitHub Actions run number
  workflowName: string;
  repoOwner: string; // GitHub org/user
  repoName: string;
  branch: string;
  commitSha: string;
  triggeredBy: string; // Triggered by user, bot, or schedule
  triggeredByEmail?: string;
  status: PipelineStatus;
  duration?: number; // in milliseconds; -1 if in progress
  conclusion?: ConclusionType; // success, failure, neutral, cancelled, action_required
  steps: Step[];
  environment?: string; // e.g., production, staging, development
  triggeredAt: Date | string;
  completedAt?: Date | string;
  linkedChangeSetId?: string; // Lookup back to ChangeSet via commitSha (optional ingestion correlation)
  linkedIssueKey?: string; // If tied to semantic release (e.g., <issue-id>-*)
  // Platform-assigned metadata
  linkedTicketId?: string;
}

export interface Step {
  name: string;
  status: StepStatus;
  conclusion?: ConclusionType;
  tryNumber: number;
  runNumber?: number;
  startedAt: Date | string;
  completedAt?: Date | string;
  duration?: number; // in milliseconds; -1 if in progress
  // Build failure details: link to log URL if failed
  logUrl?: string; // Full logs URL for the step
}

export enum PipelineStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  FAILED = 'failed'
}

export enum StepStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  SKIPPED = 'skipped',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

export enum ConclusionType {
  SUCCESS = 'success',
  FAILURE = 'failure',
  NEUTRAL = 'neutral',
  CANCELLED = 'cancelled',
  ACTION_REQUIRED = 'action_required'
}