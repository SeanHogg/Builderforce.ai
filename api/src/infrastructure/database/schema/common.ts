/**
 * Schema — common context.
 *
 * Split out of the single 7,500-line `schema.ts`, which held all 322 tables
 * in one file and was the largest source file in the repo by a factor of three.
 * `schema.ts` is now a barrel that re-exports every context, so nothing that
 * imports from it had to change.
 *
 * Imports between context modules are circular by nature — a task references a
 * project, a project references a tenant, and ownership runs in both directions
 * across contexts. That is safe here because EVERY table→table reference sits
 * inside a lazy callback (`references(() => other.id)`, and the index /
 * primaryKey builders), so no cross-module value is dereferenced while the
 * modules are still evaluating. `schema.tables.test.ts` renders SQL for every
 * exported table to keep that guarantee honest.
 */
import {
  customType,
  pgEnum,
  text,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { segments, tenants, users } from './identity';
import { swimlanes, tasks } from './work';

export const tsvector = customType<{ data: string }>({
  dataType() { return 'tsvector'; },
});


// ---------------------------------------------------------------------------
// Enum columns (Builderforce orchestration)
// ---------------------------------------------------------------------------

export const projectStatusEnum = pgEnum('project_status', [
  'active', 'completed', 'archived', 'on_hold',
]);


// Task status is a free-form varchar (see migration 0076): a project's swimlanes
// define its board columns, so a task's status is whatever lane key it sits in.
// The canonical default statuses live in the app-layer `TaskStatus` enum.

export const taskPriorityEnum = pgEnum('task_priority', [
  'low', 'medium', 'high', 'urgent',
]);


export const agentTypeEnum = pgEnum('agent_type', [
  'claude', 'openai', 'ollama', 'http',
]);


// Task type is a fixed, automation-driven dimension (unlike the free-form
// per-board `status` lane key): a plain `task`, or an `epic` that decomposes
// into child tasks (parent_task_id) — see migration 0112.
export const taskTypeEnum = pgEnum('task_type', [
  'task', 'epic', 'gap', 'security',
  // Incident ticket (migration 0325): a first-class board card the Incident Manager
  // agent works, bridged to a prod_incidents record.
  'incident',
  // Hireable work-item kinds (migration 0293): a full product/scope brief a
  // Product-Manager agent authors + publishes for a fixed-bid build, and a UI/UX
  // design (or design-review) gig. Both are publishable to the Gig Marketplace.
  'product', 'design',
]);


export const tenantStatusEnum = pgEnum('tenant_status', [
  'active', 'suspended', 'archived',
]);


export const tenantRoleEnum = pgEnum('tenant_role', [
  'owner', 'manager', 'developer', 'viewer',
]);


// Segment tier (see README "Segment tier"): the isolation level between tenant
// and entity for tenants that are themselves multi-tenant.
export const segmentStatusEnum = pgEnum('segment_status', [
  'active', 'suspended', 'archived',
]);


// How a tenant authenticates users: 'direct' = BuilderForce is the IdP
// (local/OAuth/magic-link, the current model); 'embedded' = an external host is
// the OIDC IdP and identity arrives as claims.
export const tenantKindEnum = pgEnum('tenant_kind', [
  'embedded', 'direct',
]);


// Whether a tenant sub-divides into segments. 'single' tenants are pinned to one
// default segment; 'segmented' tenants get one segment per end-client.
export const tenantIsolationModeEnum = pgEnum('tenant_isolation_mode', [
  'single', 'segmented',
]);


export const sourceControlProviderEnum = pgEnum('source_control_provider', [
  'github', 'bitbucket',
]);


export const authTokenTypeEnum = pgEnum('auth_token_type', [
  'web', 'tenant', 'api', 'host',
]);


export const legalDocumentTypeEnum = pgEnum('legal_document_type', [
  'terms', 'privacy',
]);


export const newsletterSubscriptionStatusEnum = pgEnum('newsletter_subscription_status', [
  'subscribed', 'unsubscribed', 'suppressed',
]);


export const newsletterEventTypeEnum = pgEnum('newsletter_event_type', [
  'subscribed', 'unsubscribed', 'template_sent', 'email_opened', 'email_clicked',
]);


export const privacyRequestTypeEnum = pgEnum('privacy_request_type', [
  'ccpa', 'gdpr',
]);


export const privacyRequestStatusEnum = pgEnum('privacy_request_status', [
  'pending', 'completed', 'closed',
]);


export const executionStatusEnum = pgEnum('execution_status', [
  'pending', 'submitted', 'running', 'completed', 'failed', 'cancelled',
  // Non-terminal: a cloud run that called ask_human and is waiting on a person
  // (migration 0120). Not spending, not terminal — resumes once the question is
  // answered. The reaper's running/pending/submitted sweeps deliberately skip it.
  'paused',
]);


export const agentHostStatusEnum = pgEnum('agent_host_status', ['active', 'inactive', 'suspended']);

export const agentHostDirectoryStatusEnum = pgEnum('agent_host_directory_status', ['pending', 'synced', 'error']);


export const specStatusEnum = pgEnum('spec_status', ['draft', 'ready', 'in_progress', 'complete']);

export const workflowTypeEnum = pgEnum('workflow_type', ['feature', 'bugfix', 'refactor', 'planning', 'adversarial', 'custom']);

export const workflowStatusEnum = pgEnum('workflow_status', ['pending', 'running', 'completed', 'failed', 'cancelled']);

export const workflowTaskStatusEnum = pgEnum('workflow_task_status', ['pending', 'running', 'completed', 'failed', 'cancelled']);

export const approvalStatusEnum = pgEnum('approval_status', ['pending', 'approved', 'rejected', 'expired', 'answered']);


export const artifactTypeEnum = pgEnum('artifact_type', ['skill', 'persona', 'content']);

export const assignmentScopeEnum = pgEnum('assignment_scope', ['tenant', 'host', 'project', 'task', 'agent']);

export const pricingModelEnum = pgEnum('pricing_model', ['flat_fee', 'consumption']);


export const managedAgentHostRequestStatusEnum = pgEnum('managed_agent_host_request_status', [
  'pending', 'provisioning', 'active', 'cancelled', 'failed',
]);


// ---------------------------------------------------------------------------
// Workforce member profiles + lifecycle metrics (migrations 0116–0118)
// ---------------------------------------------------------------------------

/** Which workforce sub-population a member_ref points at — shared by team_members
 *  (0114), member_profiles, and member_metrics_period. Declared here (ahead of the
 *  Workforce Teams section) so all consumers can reference it. */
export const teamMemberKindEnum = pgEnum('team_member_kind', [
  'human', 'cloud_agent', 'host_agent',
]);


export const memberExperienceLevelEnum = pgEnum('member_experience_level', [
  'junior', 'mid', 'senior', 'staff', 'principal',
]);

export const memberAvailabilityStatusEnum = pgEnum('member_availability_status', [
  'available', 'busy', 'focus', 'ooo', 'on_call',
]);

export const memberProfileSyncSourceEnum = pgEnum('member_profile_sync_source', [
  'manual', 'google_calendar',
]);


export const deploymentStatusEnum = pgEnum('deployment_status', [
  'success', 'failed', 'rolled_back',
]);


// ===========================================================================
// PHASE 6 — Dev Analytics & Team Intelligence (DevDynamics)
// ===========================================================================

// ---------------------------------------------------------------------------
// 6a — Integration providers + credentials
// ---------------------------------------------------------------------------

export const integrationProviderEnum = pgEnum('integration_provider', [
  'github', 'gitlab', 'bitbucket', 'jira', 'confluence', 'freshservice', 'rally', 'freshworks',
  'freshdesk',
  'google_calendar',
  // 0221 — single-pane / migration connectors
  'servicenow', 'linear', 'sentry', 'pagerduty', 'monday', 'asana', 'clickup',
  // 0353 — BYO web-search vendor keys (backs the cloud agent's `web_search` tool).
  // Ids MUST match WEB_SEARCH_VENDOR_IDS in application/runtime/webSearchVendors.ts.
  'brave_search',
  // 0355 — Google connectors (OAuth offline credentials). Gmail backs the email
  // workflow node; Google Drive can back a project's file storage.
  'gmail', 'google_drive',
]);


export const integrationSyncStatusEnum = pgEnum('integration_sync_status', [
  'idle', 'syncing', 'success', 'error',
]);


// ---------------------------------------------------------------------------
// 6c — Activity events (commits, PRs, reviews, issues)
// ---------------------------------------------------------------------------

export const activityEventTypeEnum = pgEnum('activity_event_type', [
  'commit', 'pr_opened', 'pr_merged', 'pr_closed', 'pr_reviewed',
  'issue_created', 'issue_resolved', 'issue_commented',
]);


// ---------------------------------------------------------------------------
// 6f — Scheduled reports + subscriptions
// ---------------------------------------------------------------------------

export const reportTypeEnum = pgEnum('report_type', [
  'standup', 'code_review', 'project_status', 'executive_summary', 'portfolio_rollup',
]);


export const reportScheduleEnum = pgEnum('report_schedule', [
  'daily', 'weekly', 'monthly',
]);


// ───────────────────────────────────────────────────────────────────────────
// Studio voice cloning (Voice PRD #1994). A clone is an enrolled voice identity
// (a reference sample in R2 + a cached speaker embedding); synthesis output is
// persisted to studio_voiceovers, which doubles as the read-through synthesis
// cache (keyed by sha256(cloneId+text+speed+lang)). Licensing lets one tenant
// use another's published clone. Migration 0127.
// ───────────────────────────────────────────────────────────────────────────

/** Who may use/see a clone: only its owner, anyone with the link, or listed in
 *  the marketplace catalog. */
export const voiceCloneVisibilityEnum = pgEnum('voice_clone_visibility', [
  'private',
  'unlisted',
  'marketplace',
]);


/** Lifecycle: enrolling, usable, or published to the marketplace. */
export const voiceCloneStatusEnum = pgEnum('voice_clone_status', ['draft', 'ready', 'published']);


// ---------------------------------------------------------------------------
// Alerts — threshold alert rules on platform metrics (migration 0234).
//
// A user defines a rule (metric + comparator + threshold + window); the daily
// runAlertSweep evaluates each enabled rule by reusing the existing metric
// collectors and, when it trips (respecting cooldown), raises an alert_event and
// notifies via the shared Slack/email channels (approvalNotifier). The system
// 'eval_drift' alert always fires from runEvalDriftSweep without a rule.
// tenant+segment scoped (uuid PK) like the other planning trackers.
// ---------------------------------------------------------------------------

/** Metric keys a rule may target (kept in lockstep with metricEvaluators). */
export type AlertMetric =
  | 'token_spend_usd'
  | 'token_spend_pct_of_cap'
  | 'cost_per_merged_pr_usd'
  | 'dora_change_failure_rate'
  | 'dora_lead_time_hours'
  | 'ai_effectiveness_score'
  | 'eval_drift';
