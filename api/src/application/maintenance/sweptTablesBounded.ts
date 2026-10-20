/**
 * Retention entries for relations that grew UNBOUNDED, and for expired credentials that were
 * never purged — declared as data, spread into {@link SWEPT_TABLES}.
 *
 * WHY A SIBLING FILE. `sweptTables.ts` already carries the registry's contract and its long
 * rationales; ~45 more entries would turn it into the god file the repo rules forbid. These
 * entries use exactly the same `SweptTable` shape, so retention, the daily vacuum and the
 * storage-pressure sweep pick them up with no further wiring.
 *
 * Measured 2026-10-17: core at 504/512 MB on Neon Free, `auth_tokens` 6,717 of 6,726 rows
 * expired and never purged, every `agent_run_principals` row expired.
 *
 * `reclaimable` is FALSE wherever the table is more than a best-effort diagnostic log
 * (credentials, delivery records, claims, analytics aggregates): the weekly `VACUUM FULL`
 * takes an ACCESS EXCLUSIVE lock, which is only acceptable for a feed whose writer may fail.
 *
 * Audit tables (execution_claims / execution_claim_evidence, agent_context_contributions,
 * agent_outbound_inspections, and agent_run_principals whose cascade hits agent_capability_grants)
 * used to be excluded because BEFORE DELETE triggers rejected every purge. 1238 / 0018 gate
 * DELETE on `SET LOCAL app.retention = 'on'` (UPDATE stays forbidden); the entries below
 * open that GUC in the same statement via set_config(..., true) so neon-http (no session)
 * still sees it. Window: 90 days, the SOC 2 evidence window of tool_audit_events.
 *
 * NOT HERE: `agent_host_sync_history` (declared in the Drizzle schema but no migration ever
 * created it, so there is nothing to sweep) and `replay_issue_representatives` (no time
 * column; it cascades from `replay_issues` / `replay_recordings`, which ARE swept).
 */
import { and, eq, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { acrossTenants, type TenantOwnedTable } from '../../infrastructure/database/tenantScope';
import { boundedDelete } from './boundedPurge';
import type { SweptConnection, SweptTable } from './sweptTables';
import {
  agentContextContributions,
  agentInferenceLogs,
  agentOutboundInspections,
  agentRunPrincipals,
  alertEvents,
  authTokens,
  authUserSessions,
  catalogAdoptionEvents,
  connectorCallLogs,
  deliveries,
  deviceAuthorizations,
  emailDeliveryFailures,
  emailOtpChallenges,
  evermindLearningCandidates,
  evermindLearningRuns,
  executionClaimEvidence,
  executionClaims,
  executionLimits,
  ideTrainingLogs,
  magicLinkTokens,
  marketingHeatmapPages,
  marketingSessionPrompts,
  marketingSessions,
  monitorEvents,
  newsletterEvents,
  outboundFetchLog,
  previewSessions,
  projectInsightEvents,
  replayReleases,
  replayVisitSummaries,
  resourceLeases,
  runModelOutcomes,
  telemetrySpans,
  usageSnapshots,
  webhookDeliveries,
} from '../../infrastructure/database/schema';

const CORE: readonly SweptConnection[] = ['primary'];
/** Tables whose writers moved to the operational endpoint but whose core copy was never dropped. */
const BOTH: readonly SweptConnection[] = ['transactional', 'primary'];

/**
 * SOC 2 evidence window — same 90 days as `tool_audit_events` (sweptTables.ts). Claims
 * cite those events; trust-history and run-principal rows are the matching audit trail
 * for a run, so they share the window rather than inventing a third.
 */
export const AUDIT_RETENTION_DAYS = 90;

/** Opens the 1238/0018 DELETE gate for the rest of this statement (SET LOCAL equivalent). */
const retentionGate = sql`set_config('app.retention', 'on', true) = 'on'`;

interface BoundedEntry {
  relation: string;
  connections: readonly SweptConnection[];
  table: PgTable;
  /** The column the window ages by. Omit when `expired` supplies the whole predicate. */
  column?: PgColumn;
  /** Extra conjunct narrowing which aged rows are safe to delete. */
  only?: (cutoff: Date) => SQL | undefined;
  /** Whole predicate, for entries that are not a plain age (sessions, execution limits). */
  expired?: (cutoff: Date) => SQL;
  /** The table, when it owns a `tenantId` — declares the sweep's cross-tenant reason. */
  tenanted?: TenantOwnedTable;
  days: number;
  floor?: number;
  reclaimable?: boolean;
  /**
   * BEFORE DELETE on this table rejects unless `app.retention = 'on'`. AND the gate
   * into the delete itself — neon-http has no session, so a prior `SET LOCAL` would
   * not apply to a later round-trip.
   */
  gated?: boolean;
  rationale: string;
}

function entry(o: BoundedEntry): SweptTable {
  return {
    relation: o.relation,
    connections: o.connections,
    retentionDays: o.days,
    ...(o.floor != null ? { pressureFloorDays: o.floor } : {}),
    ...(o.reclaimable === false ? { reclaimable: false } : {}),
    rationale: o.rationale,
    purge: (db, cutoff) => {
      const aged = o.expired
        ? o.expired(cutoff)
        : and(lt(o.column!, cutoff), o.only?.(cutoff))!;
      const predicate = o.gated ? and(aged, retentionGate)! : aged;
      return boundedDelete(db, o.table, o.tenanted ? acrossTenants(o.tenanted, 'scheduled_sweep', predicate) : predicate);
    },
  };
}

/** Append-only telemetry and event feeds that had no window at all. */
export const BOUNDED_TELEMETRY_TABLES: readonly SweptTable[] = [
  // ── Immutable audit (DELETE only when SET LOCAL app.retention = 'on') ──
  // 90 days = tool_audit_events SOC 2 window. Claims cite those events (RESTRICT);
  // purging claims (CASCADE evidence) unblocks the trail. UPDATE stays forbidden.
  entry({ relation: 'execution_claims', connections: BOTH, table: executionClaims, tenanted: executionClaims, column: executionClaims.createdAt, days: AUDIT_RETENTION_DAYS, reclaimable: false, gated: true,
    rationale: 'SOC 2 execution claims. 90-day window matches tool_audit_events; evidence CASCADE. BEFORE DELETE honours app.retention=on.' }),
  entry({ relation: 'execution_claim_evidence', connections: BOTH, table: executionClaimEvidence, tenanted: executionClaimEvidence, column: executionClaimEvidence.createdAt, days: AUDIT_RETENTION_DAYS, reclaimable: false, gated: true,
    rationale: 'Citations from claims to tool_audit_events (ON DELETE RESTRICT). Same 90-day window; must drain before the trail can be purged.' }),
  entry({ relation: 'agent_context_contributions', connections: CORE, table: agentContextContributions, tenanted: agentContextContributions, column: agentContextContributions.createdAt, days: AUDIT_RETENTION_DAYS, reclaimable: false, gated: true,
    rationale: 'Per-run context-contribution trust history. 90-day audit window; DELETE gated on app.retention.' }),
  entry({ relation: 'agent_outbound_inspections', connections: CORE, table: agentOutboundInspections, tenanted: agentOutboundInspections, column: agentOutboundInspections.createdAt, days: AUDIT_RETENTION_DAYS, reclaimable: false, gated: true,
    rationale: 'Per-run outbound inspection trust history. 90-day audit window; DELETE gated on app.retention.' }),
  entry({ relation: 'agent_run_principals', connections: CORE, table: agentRunPrincipals, tenanted: agentRunPrincipals, column: agentRunPrincipals.createdAt, days: AUDIT_RETENTION_DAYS, reclaimable: false, gated: true,
    rationale: 'Per-run machine principals. 90-day window; capability grants CASCADE. Grants DELETE trigger honours app.retention so the cascade can fire.' }),
  entry({ relation: 'telemetry_spans', connections: CORE, table: telemetrySpans, tenanted: telemetrySpans, column: telemetrySpans.createdAt, days: 30, floor: 7,
    rationale: 'OTel workflow spans forwarded from agents; read while debugging a recent run.' }),
  entry({ relation: 'connector_call_logs', connections: CORE, table: connectorCallLogs, tenanted: connectorCallLogs, column: connectorCallLogs.createdAt, days: 90, floor: 14,
    rationale: 'Per-call connector log, read only while diagnosing a failing integration.' }),
  entry({ relation: 'outbound_fetch_log', connections: CORE, table: outboundFetchLog, tenanted: outboundFetchLog, column: outboundFetchLog.createdAt, days: 90, floor: 14,
    rationale: 'Outbound-fetch audit stream (SSRF / egress diagnostics); a quarter covers any investigation.' }),
  entry({ relation: 'agent_inference_logs', connections: CORE, table: agentInferenceLogs, column: agentInferenceLogs.createdAt, days: 90, floor: 14,
    rationale: 'Per-inference agent log; the cost figures live in llm_usage_log, which is rolled up separately.' }),
  entry({ relation: 'catalog_adoption_events', connections: CORE, table: catalogAdoptionEvents, tenanted: catalogAdoptionEvents, column: catalogAdoptionEvents.createdAt, days: 180, reclaimable: false,
    rationale: 'Marketplace adoption stream; half a year covers the trend charts.' }),
  entry({ relation: 'newsletter_events', connections: CORE, table: newsletterEvents, column: newsletterEvents.createdAt, days: 400, reclaimable: false,
    rationale: 'Open/click events; 400d keeps a full year-over-year comparison.' }),
  entry({ relation: 'email_delivery_failures', connections: CORE, table: emailDeliveryFailures, column: emailDeliveryFailures.createdAt, days: 90, reclaimable: false,
    rationale: 'Failed-send diagnostics; retries are decided on the delivery row, not on this log.' }),
  entry({ relation: 'webhook_deliveries', connections: CORE, table: webhookDeliveries, tenanted: webhookDeliveries, column: webhookDeliveries.createdAt, days: 90, reclaimable: false,
    only: () => isNull(webhookDeliveries.nextRetryAt),
    rationale: 'Webhook attempts. `next_retry_at IS NULL` is terminal (delivered or exhausted), so a row still awaiting a retry is never deleted.' }),
  entry({ relation: 'deliveries', connections: CORE, table: deliveries, tenanted: deliveries, column: deliveries.createdAt, days: 180, reclaimable: false,
    only: () => inArray(deliveries.status, ['sent', 'delivered', 'bounced', 'failed']),
    rationale: 'Outbound message ledger. Only settled statuses age out; queued / sending rows are work that has not happened yet.' }),
  entry({ relation: 'monitor_events', connections: CORE, table: monitorEvents, tenanted: monitorEvents, column: monitorEvents.createdAt, days: 90, reclaimable: false,
    rationale: 'Monitor check events; uptime history beyond a quarter is not charted.' }),
  entry({ relation: 'alert_events', connections: CORE, table: alertEvents, tenanted: alertEvents, column: alertEvents.createdAt, days: 180, reclaimable: false,
    rationale: 'Fired-alert history; six months covers the incident review window.' }),
  entry({ relation: 'ide_training_logs', connections: CORE, table: ideTrainingLogs, column: ideTrainingLogs.createdAt, days: 90, floor: 14,
    rationale: 'IDE training-run log lines, read while a run is being watched.' }),
  // The anonymous-visitor window, same as activity_log's visitor predicate (VISITOR_RETENTION_DAYS).
  entry({ relation: 'marketing_sessions', connections: CORE, table: marketingSessions, column: marketingSessions.lastSeenAt, days: 90, reclaimable: false,
    rationale: 'Anonymous marketing sessions on the visitor window; a conversion is recorded on the user row, not here.' }),
  entry({ relation: 'marketing_session_prompts', connections: CORE, table: marketingSessionPrompts, column: marketingSessionPrompts.createdAt, days: 90, reclaimable: false,
    rationale: 'Guest prompts typed before signup, on the visitor window.' }),
  entry({ relation: 'marketing_heatmap_pages', connections: CORE, table: marketingHeatmapPages, tenanted: marketingHeatmapPages, column: marketingHeatmapPages.updatedAt, days: 90, reclaimable: false,
    rationale: 'Rebuilt per-page density aggregates (screenshots cascade); a page not recomputed for a quarter is not viewed.' }),
  entry({ relation: 'project_insight_events', connections: CORE, table: projectInsightEvents, tenanted: projectInsightEvents, column: projectInsightEvents.createdAt, days: 180, reclaimable: false,
    rationale: 'Project insight signal stream; six months covers the trend lines.' }),
  // One row per text-learn (1240). Candidates CASCADE from their run, so a run whose
  // candidate still awaits review is never aged out — a manager's queue is not telemetry.
  entry({ relation: 'evermind_learning_runs', connections: CORE, table: evermindLearningRuns, tenanted: evermindLearningRuns, column: evermindLearningRuns.createdAt, days: 90, reclaimable: false,
    only: () => sql`not exists (select 1 from ${evermindLearningCandidates} where ${evermindLearningCandidates.runId} = ${evermindLearningRuns.id} and ${evermindLearningCandidates.status} = 'pending')`,
    rationale: 'Evermind learning-pipeline run ledger (one row per text-learn). 90 days bounds the KR window; runs with a pending candidate are kept so the review queue never loses work.' }),
  // ── Run telemetry, dual-resident (writers on the operational endpoint, core residue) ──
  entry({ relation: 'usage_snapshots', connections: BOTH, table: usageSnapshots, tenanted: usageSnapshots, column: usageSnapshots.ts, days: 90, floor: 14,
    rationale: 'Host usage gauges and per-run token snapshots; billing reads llm_usage_log.' }),
  entry({ relation: 'run_model_outcomes', connections: BOTH, table: runModelOutcomes, tenanted: runModelOutcomes, column: runModelOutcomes.createdAt, days: 400, reclaimable: false,
    rationale: 'Learned-routing outcome rows; 400d keeps the full-year signal the router weighs.' }),
  entry({ relation: 'replay_visit_summaries', connections: BOTH, table: replayVisitSummaries, column: replayVisitSummaries.generatedAt, days: 400, reclaimable: false,
    rationale: 'AI summaries of recordings; the recordings themselves go at 90d, this is the 13-month Insights window.' }),
  entry({ relation: 'replay_releases', connections: BOTH, table: replayReleases, tenanted: replayReleases, column: replayReleases.lastSeenAt, days: 400, reclaimable: false,
    rationale: 'Insights release markers not seen for 13 months — their daily rows are gone.' }),
];

/** Credentials and leases past their own expiry. Window = expiry + a 7-day grace. */
const EXPIRED_GRACE_DAYS = 7;

export const EXPIRED_CREDENTIAL_TABLES: readonly SweptTable[] = [
  entry({ relation: 'auth_tokens', connections: CORE, table: authTokens, tenanted: authTokens, column: authTokens.expiresAt, days: EXPIRED_GRACE_DAYS, reclaimable: false,
    rationale: 'JWT jti ledger. 6,717 of 6,726 rows were expired and never purged; a token expired for a week can no longer be presented or refreshed.' }),
  entry({ relation: 'auth_user_sessions', connections: CORE, table: authUserSessions, days: 90, reclaimable: false,
    expired: (cutoff) => or(
      and(isNotNull(authUserSessions.revokedAt), lt(authUserSessions.revokedAt, cutoff)),
      and(eq(authUserSessions.isActive, false), lt(authUserSessions.lastSeenAt, cutoff)),
    )!,
    rationale: 'Sessions revoked or deactivated more than 90 days ago (the device list never shows them). Tokens reference a session ON DELETE SET NULL.' }),
  entry({ relation: 'magic_link_tokens', connections: CORE, table: magicLinkTokens, column: magicLinkTokens.expiresAt, days: EXPIRED_GRACE_DAYS, reclaimable: false,
    rationale: 'Single-use sign-in links, long dead a week after expiry.' }),
  entry({ relation: 'email_otp_challenges', connections: CORE, table: emailOtpChallenges, column: emailOtpChallenges.expiresAt, days: EXPIRED_GRACE_DAYS, reclaimable: false,
    rationale: 'One-time codes, long dead a week after expiry.' }),
  entry({ relation: 'device_authorizations', connections: CORE, table: deviceAuthorizations, tenanted: deviceAuthorizations, column: deviceAuthorizations.expiresAt, days: EXPIRED_GRACE_DAYS, reclaimable: false,
    rationale: 'Device-code grants (CLI / VS Code sign-in); the issued key is encrypted on the row, so leaving expired ones is also a hygiene gap.' }),
  // execution_limits has no expiry of its own and is keyed by execution, not principal: a row
  // is dead once its run has no live principal. Order-independent — it tests the principal's
  // expiry, not its existence — so it still works now that principals themselves are swept.
  entry({ relation: 'execution_limits', connections: CORE, table: executionLimits, tenanted: executionLimits, days: EXPIRED_GRACE_DAYS + 30, reclaimable: false,
    expired: (cutoff) => and(
      lt(executionLimits.createdAt, cutoff),
      sql`not exists (select 1 from ${agentRunPrincipals} where ${agentRunPrincipals.executionId} = ${executionLimits.executionId} and ${agentRunPrincipals.expiresAt} >= ${cutoff.toISOString()}::timestamp)`,
    )!,
    rationale: 'Per-run spend/step caps older than 37 days whose run has no unexpired principal.' }),
  entry({ relation: 'preview_sessions', connections: CORE, table: previewSessions, tenanted: previewSessions, column: previewSessions.lastSeenAt, days: 30, reclaimable: false,
    rationale: 'Dev-server preview ingress rows; one not served a request in 30 days is not live whatever its status says (idle eviction reads last_seen_at).' }),
  entry({ relation: 'resource_leases', connections: CORE, table: resourceLeases, tenanted: resourceLeases, column: resourceLeases.expiresAt, days: EXPIRED_GRACE_DAYS, reclaimable: false,
    rationale: 'Coordination leases past expiry cannot block a claim; a week-old one is only residue.' }),
];
