/**
 * Schema — Run deltas (PRD 41 §C14, WS11): what an agent run changed, per repository, as the server
 * keeps it. Written by the sync mirror importer for the `run-delta` local record
 * (`application/sync/importers/importMirrorRecord` → `importSyncedRunDelta`, through `application/runDelta/runDeltaStore`) and read by
 * `application/runDelta/runDeltaReads` (`GET /api/projects/:projectId/run-deltas`, `GET /api/run-deltas/:runId`).
 *
 * 3NF, migration 1344. A delta is identified by (tenant, run id, repo key): `run_id` is the shared run-id
 * space (`@builderforce/run-delta/run-ids`) and `repo_key` the client's per-run repository key; `repository`
 * is the synced repository identity (remote URL, else `local:<hash>`), never a local path. Dimensions are
 * ROWS because they are registry data (principle 5): a new dimension is a row, never a migration. The
 * introduced/resolved counts a list shows are sums over those rows, not stored twice. The full delta
 * (evidence included) is a blob in R2 keyed by digest (`runDeltaEvidence`); only what is filtered,
 * listed or embedded lives in Postgres.
 *
 * `project_id` is a plain id (cross-domain references are ids); the project gate is
 * `application/project/projectOwnership`. The only cross-context key is the tenant FK.
 *
 * `run_delta_findings.embedding` is the bge-m3 1024 space (`MEMORY_VECTOR_SPACES.bge_m3`, 1256's
 * convention): written by the memory embedding backfill's keyset sweep, never on the import path, so a
 * write never waits for (or fails for lack of) a vector.
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { tenants } from './identity';
import { vector } from './kernel';

/** One run's delta for one repository. Immutable once imported. */
export const runDeltas = pgTable('run_deltas', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  /** The project the run belonged to, when the client named one this tenant owns. */
  projectId:    bigint('project_id', { mode: 'number' }),
  runId:        varchar('run_id', { length: 128 }).notNull(),
  repoKey:      varchar('repo_key', { length: 128 }).notNull(),
  repository:   varchar('repository', { length: 512 }).notNull(),
  /** `vscode` | `cloud` | `web` (`RunDeltaSurface`). */
  surface:      varchar('surface', { length: 16 }).notNull(),
  /** `interactive` | `autonomous`. */
  mode:         varchar('mode', { length: 16 }).notNull(),
  /** `RunDelta.version`. */
  deltaVersion: smallint('delta_version').notNull(),
  /** sha256 of the canonical delta; also the R2 evidence key. */
  digest:       varchar('digest', { length: 64 }).notNull(),
  headline:     varchar('headline', { length: 20 }).notNull(),
  blastScore:   doublePrecision('blast_score').notNull(),
  blastBand:    varchar('blast_band', { length: 8 }).notNull(),
  /** The headline sentence MODEL (`HeadlineModel`): one value object, rendered by the localized UI. */
  summary:      jsonb('summary').notNull(),
  /** `RunDelta.blocking` codes, sorted. */
  blocking:     jsonb('blocking').$type<string[]>().notNull().default([]),
  computedAt:   timestamp('computed_at', { withTimezone: true }).notNull(),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('run_deltas_tenant_run_repo_key').on(t.tenantId, t.runId, t.repoKey),
  index('run_deltas_tenant_project_computed_idx').on(t.tenantId, t.projectId, t.computedAt, t.id),
  index('run_deltas_created_at_idx').on(t.createdAt),
]);

/** One dimension's verdict and counts in one delta. */
export const runDeltaDimensions = pgTable('run_delta_dimensions', {
  runDeltaId:  uuid('run_delta_id').notNull().references(() => runDeltas.id, { onDelete: 'cascade' }),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  dimensionId: varchar('dimension_id', { length: 64 }).notNull(),
  verdict:     varchar('verdict', { length: 20 }).notNull(),
  introduced:  integer('introduced').notNull(),
  resolved:    integer('resolved').notNull(),
  changed:     integer('changed').notNull(),
}, (t) => [
  primaryKey({ columns: [t.runDeltaId, t.dimensionId] }),
  index('run_delta_dimensions_tenant_idx').on(t.tenantId),
]);

/** One finding of one delta, with its card-text embedding. */
export const runDeltaFindings = pgTable('run_delta_findings', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  runDeltaId:     uuid('run_delta_id').notNull().references(() => runDeltas.id, { onDelete: 'cascade' }),
  /** `FindingIdentity.id` (exact identity; unbounded — it lists every member path). */
  identityId:     text('identity_id').notNull(),
  /** sha256 hex of `identity_id`: the unique key within a delta. */
  identityHash:   varchar('identity_hash', { length: 64 }).notNull(),
  /** `FindingIdentity.anchor` (line-free; SARIF `anchor/v1`). */
  anchor:         varchar('anchor', { length: 1024 }).notNull(),
  dimensionId:    varchar('dimension_id', { length: 64 }).notNull(),
  ruleId:         varchar('rule_id', { length: 128 }).notNull(),
  ruleVersion:    integer('rule_version').notNull(),
  severity:       varchar('severity', { length: 8 }).notNull(),
  lineage:        varchar('lineage', { length: 16 }).notNull(),
  confidence:     varchar('confidence', { length: 16 }).notNull(),
  /** The canonical card text the embedding is computed from (rule, anchor, snippet, evidence summary). */
  cardText:       text('card_text').notNull(),
  embedding:      vector('embedding', { dimensions: 1024 }),
  embeddingModel: varchar('embedding_model', { length: 64 }),
  embeddedAt:     timestamp('embedded_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('run_delta_findings_delta_identity_key').on(t.runDeltaId, t.identityHash),
  index('run_delta_findings_tenant_anchor_idx').on(t.tenantId, t.anchor),
  index('run_delta_findings_unembedded_idx').on(t.id).where(sql`${t.embedding} IS NULL`),
]);
