/**
 * Schema — Run outcomes (PRD 41 §D1, WS16): the ONE server home of a run's frozen
 * feature vector, its per-run commit attribution and its outcome labels — the training
 * data every Part D model learns from — plus each tenant's cross-tenant training consent.
 *
 * LIVES ON THE OPERATIONAL ENDPOINT ("training data lives in the ops database"):
 * `transactional-migrations/0032_run_outcomes.sql` creates it there; the primary track
 * carries the same DDL (`migrations/1342_run_outcomes.sql`) so single-database
 * environments, where the operational handle IS the core handle, have the tables too.
 * Resolved through `siblingDatabaseOf(db, 'operational')`.
 *
 * NO CROSS-DATABASE KEYS: tenant and project are plain ids, exactly like
 * `run_model_outcomes`. Tenant erasure is performed by `application/shared/siblingCascade`.
 *
 * 3NF. A run is identified by (tenant, run id, repository): `run_id` is the shared run-id
 * space (`cloud:<executionId>` for a cloud run, the device's own id otherwise) and
 * `repository` is the synced repository identity (remote URL, else `local:<hash>`), never
 * a local path. Features are one row per run and repository, attributions one per commit
 * and path, labels one per kind.
 *
 * The only reader the WS18 training driver uses is `application/runOutcomes/trainingStore`.
 */

import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * A run's feature vector, FROZEN at run end: inserted once (`ON CONFLICT DO NOTHING`),
 * never updated. A second write with a different `digest` is a conflict, not an overwrite.
 *
 * `requester_id` / `approver_id` / `reviewer_id` / `agent_id` are PERSON ids (D1 "People",
 * decided 2026-11-06). They are D14-restricted: only the tenant-scoped training read and
 * the D14 person-score policy may read them; the cross-tenant aggregate never selects them
 * and a trained artifact never contains them.
 */
export const runFeatures = pgTable('run_features', {
  id:            bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  projectId:     bigint('project_id', { mode: 'number' }),
  runId:         varchar('run_id', { length: 128 }).notNull(),
  repository:    varchar('repository', { length: 512 }).notNull(),
  /** `vscode` | `cloud` | `web` (`RunEntryPoint`). */
  entryPoint:    varchar('entry_point', { length: 16 }).notNull(),
  /** `interactive` | `autonomous`. */
  mode:          varchar('mode', { length: 16 }).notNull(),
  modelTier:     varchar('model_tier', { length: 64 }),
  /** `RUN_FEATURES_SCHEMA_VERSION` the vector was computed under. */
  schemaVersion: integer('schema_version').notNull(),
  finalizedAt:   timestamp('finalized_at', { withTimezone: true }).notNull(),
  /** The numeric vector, `{ [RunFeatureId]: number | null }` (`values` is a reserved word). */
  featureValues: jsonb('feature_values').notNull(),
  /** sha256 of the canonical vector (`featureDigest`), 64 hex chars. */
  digest:        varchar('digest', { length: 64 }).notNull(),
  requesterId:   varchar('requester_id', { length: 128 }),
  approverId:    varchar('approver_id', { length: 128 }),
  reviewerId:    varchar('reviewer_id', { length: 128 }),
  agentId:       varchar('agent_id', { length: 128 }),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  runKey: uniqueIndex('run_features_tenant_run_repo_key').on(t.tenantId, t.runId, t.repository),
  /** The cross-tenant training read and the retention sweep (1345 / 0033). */
  byFinalizedAt:       index('idx_run_features_finalized_at').on(t.finalizedAt),
  /** The tenant training read and the per-tenant ranked cross-tenant read (1345 / 0033). */
  byTenantFinalizedAt: index('idx_run_features_tenant_finalized_at').on(t.tenantId, t.finalizedAt),
}));

/**
 * Per-run commit attribution (D1 `followup-fix` step 4): a commit holding content the run
 * wrote. Recorded by the VSIX at commit time and by the cloud runtime at `cloudFinalize`.
 */
export const runCommitAttributions = pgTable('run_commit_attributions', {
  id:          bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  runId:       varchar('run_id', { length: 128 }).notNull(),
  repository:  varchar('repository', { length: 512 }).notNull(),
  commitSha:   varchar('commit_sha', { length: 64 }).notNull(),
  path:        varchar('path', { length: 1024 }).notNull(),
  branch:      varchar('branch', { length: 255 }),
  addedLines:  integer('added_lines'),
  committedAt: timestamp('committed_at', { withTimezone: true }).notNull(),
  /** `vscode-git` | `cloud-finalize`. */
  source:      varchar('source', { length: 16 }).notNull(),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  commitPath: uniqueIndex('run_commit_attributions_key').on(t.tenantId, t.runId, t.repository, t.commitSha, t.path),
  bySha:      index('idx_run_commit_attributions_sha').on(t.tenantId, t.commitSha),
  byBranch:   index('idx_run_commit_attributions_branch').on(t.tenantId, t.repository, t.branch),
  /** The label sweep's recent-runs scan and the retention sweep (1345 / 0033). */
  byCommittedAt: index('idx_run_commit_attributions_committed_at').on(t.committedAt),
}));

/**
 * One outcome label per run, repository and kind. `censored` until the window ends
 * (`value` true when the event was already seen, else NULL — never false); `final` after.
 * A newer `computed_at` replaces a row, except that a final row is never replaced by a
 * censored one, and an observed event (`value` true) is never replaced by null/false
 * (`domain/runOutcomes/runOutcomePolicy.labelSupersedes`).
 */
export const runOutcomeLabels = pgTable('run_outcome_labels', {
  id:              bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId:        integer('tenant_id').notNull(),
  runId:           varchar('run_id', { length: 128 }).notNull(),
  repository:      varchar('repository', { length: 512 }).notNull(),
  /** `RunLabelKind`. */
  kind:            varchar('kind', { length: 32 }).notNull(),
  value:           boolean('value'),
  /** `final` | `censored`. */
  status:          varchar('status', { length: 16 }).notNull(),
  eventAt:         timestamp('event_at', { withTimezone: true }),
  windowEndsAt:    timestamp('window_ends_at', { withTimezone: true }),
  /** Stable codes and ids, never content. */
  evidence:        jsonb('evidence').notNull().default({}),
  labellerVersion: integer('labeller_version').notNull(),
  computedAt:      timestamp('computed_at', { withTimezone: true }).notNull(),
}, (t) => ({
  labelKey:  uniqueIndex('run_outcome_labels_key').on(t.tenantId, t.runId, t.repository, t.kind),
  /** The censoring sweep: censored rows whose window has ended. */
  censoring: index('idx_run_outcome_labels_censoring').on(t.status, t.windowEndsAt),
  /** The retention sweep (1345 / 0033). */
  byComputedAt: index('idx_run_outcome_labels_computed_at').on(t.computedAt),
}));

/**
 * A tenant's EXPLICIT cross-tenant training decision (§12.8). No row = the plan default
 * (`free` on, every paid plan off). Never swept: a consent decision is not telemetry.
 */
export const runOutcomeTrainingConsent = pgTable('run_outcome_training_consent', {
  tenantId:    integer('tenant_id').primaryKey(),
  crossTenant: boolean('cross_tenant').notNull(),
  decidedBy:   varchar('decided_by', { length: 128 }),
  decidedAt:   timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
});
