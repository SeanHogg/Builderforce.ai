/**
 * THE training-data reader (PRD 41 §D1, §12.8) — the only one the WS18 training driver
 * (`scripts/train-run-models.cjs`) uses — and the cross-tenant consent it obeys.
 *
 *   • {@link readTenantTrainingRows}: ONE tenant's runs, full rows (features, people ids under
 *     D14, final labels). Tenant-scoped.
 *   • {@link readCrossTenantTrainingRows}: runs of every tenant whose consent is ON, reduced to
 *     the numeric feature vector and its final labels. No tenant, run, repository, path or
 *     person id leaves this module on that path (§D1: "aggregated features"); the run-end time
 *     is truncated to its day, and the limit is shared fairly across tenants.
 *   • {@link getTrainingConsent} / {@link setTrainingConsent}: a tenant's explicit decision,
 *     else the plan default (free ⇒ on, every paid plan ⇒ off — `crossTenantConsent`).
 *
 * Classifiers train on FINAL labels only; a censored row is never returned here.
 */

import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { runFeatures, runOutcomeLabels, runOutcomeTrainingConsent, tenants } from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { RUN_FEATURES_SCHEMA_VERSION } from '@builderforce/run-delta/predict';
import { crossTenantConsent } from '../../domain/runOutcomes/runOutcomePolicy';
import { runOutcomeChunks as chunks, runOutcomesDatabase } from './runOutcomeStore';

const DEFAULT_LIMIT = 5000;
const MAX_LIMIT = 50_000;

const boundedLimit = (limit: number | undefined): number => Math.min(Math.max(1, Math.floor(limit ?? DEFAULT_LIMIT)), MAX_LIMIT);

/** One final label as training reads it. */
export interface TrainingLabel {
  kind: string;
  value: boolean | null;
  eventAt: string | null;
  labellerVersion: number;
}

/** A tenant's own training row (D14 access rules apply to `people`). */
export interface TenantTrainingRow {
  runId: string;
  repository: string;
  projectId: number | null;
  schemaVersion: number;
  finalizedAt: string;
  entryPoint: string;
  mode: string;
  modelTier: string | null;
  values: Record<string, number | null>;
  digest: string;
  people: { requesterId: string | null; approverId: string | null; reviewerId: string | null; agentId: string | null };
  labels: TrainingLabel[];
}

/**
 * A cross-tenant row: the numeric vector and its final labels, nothing that names anyone or
 * anything. `finalizedAt` is the DAY (`YYYY-MM-DD`): a precise run-end time could be joined
 * back to one tenant's activity. Each label keeps its `labellerVersion` so a model can drop
 * rows of a superseded labeller.
 */
export interface AggregateTrainingRow {
  schemaVersion: number;
  finalizedAt: string;
  values: Record<string, number | null>;
  labels: Array<{ kind: string; value: boolean | null; labellerVersion: number }>;
}

export interface TrainingWindow {
  /** Only runs finalized at or after this time. */
  since?: Date;
  limit?: number;
  /**
   * The ONE feature schema version this read returns (default: the current one). Every record is stored under its own
   * version, and a fit never mixes two: a driver wanting an older version's rows asks for it explicitly.
   */
  schemaVersion?: number;
}

const versionOf = (window: TrainingWindow) => eq(runFeatures.schemaVersion, window.schemaVersion ?? RUN_FEATURES_SCHEMA_VERSION);

type FeatureRow = typeof runFeatures.$inferSelect;
type LabelRow = typeof runOutcomeLabels.$inferSelect;

const runKey = (tenantId: number, runId: string, repository: string): string => `${tenantId}\0${runId}\0${repository}`;

/** Final labels of these features, keyed by run. */
async function finalLabelsOf(ops: Db, features: readonly FeatureRow[]): Promise<Map<string, LabelRow[]>> {
  const out = new Map<string, LabelRow[]>();
  const byTenant = new Map<number, string[]>();
  for (const f of features) byTenant.set(f.tenantId, [...(byTenant.get(f.tenantId) ?? []), f.runId]);
  for (const [tenantId, runIds] of byTenant) {
    for (const ids of chunks([...new Set(runIds)])) {
      const rows = await ops.select().from(runOutcomeLabels)
        .where(scopedToTenant(runOutcomeLabels, tenantId, inArray(runOutcomeLabels.runId, ids), eq(runOutcomeLabels.status, 'final')));
      for (const row of rows) {
        const key = runKey(row.tenantId, row.runId, row.repository);
        out.set(key, [...(out.get(key) ?? []), row]);
      }
    }
  }
  return out;
}

/** The cross-tenant projection: drops every identifier (pure; exported for its test). */
export function toAggregateRow(feature: Pick<FeatureRow, 'schemaVersion' | 'finalizedAt' | 'featureValues'>, labels: readonly Pick<LabelRow, 'kind' | 'value' | 'labellerVersion'>[]): AggregateTrainingRow {
  return {
    schemaVersion: feature.schemaVersion,
    finalizedAt: feature.finalizedAt.toISOString().slice(0, 10),
    values: { ...(feature.featureValues as Record<string, number | null>) },
    labels: labels.map((l) => ({ kind: l.kind, value: l.value, labellerVersion: l.labellerVersion })),
  };
}

/** One tenant's training rows (runs with at least one final label), oldest first. */
export async function readTenantTrainingRows(core: Db, tenantId: number, window: TrainingWindow = {}): Promise<TenantTrainingRow[]> {
  const ops = runOutcomesDatabase(core);
  const features = await ops.select().from(runFeatures)
    .where(scopedToTenant(runFeatures, tenantId, versionOf(window), window.since ? gte(runFeatures.finalizedAt, window.since) : undefined))
    .orderBy(asc(runFeatures.finalizedAt))
    .limit(boundedLimit(window.limit));
  const labels = await finalLabelsOf(ops, features);
  return features.flatMap((f) => {
    const own = labels.get(runKey(f.tenantId, f.runId, f.repository)) ?? [];
    if (own.length === 0) return [];
    return [{
      runId: f.runId,
      repository: f.repository,
      projectId: f.projectId,
      schemaVersion: f.schemaVersion,
      finalizedAt: f.finalizedAt.toISOString(),
      entryPoint: f.entryPoint,
      mode: f.mode,
      modelTier: f.modelTier,
      values: f.featureValues as Record<string, number | null>,
      digest: f.digest,
      people: { requesterId: f.requesterId, approverId: f.approverId, reviewerId: f.reviewerId, agentId: f.agentId },
      labels: own.map((l) => ({ kind: l.kind, value: l.value, eventAt: l.eventAt?.toISOString() ?? null, labellerVersion: l.labellerVersion })),
    }];
  });
}

/** Of these tenants, the ones whose cross-tenant consent is on (explicit row, else plan default). */
export async function consentingTenants(core: Db, tenantIds: readonly number[]): Promise<number[]> {
  if (tenantIds.length === 0) return [];
  const ops = runOutcomesDatabase(core);
  const explicit = new Map<number, boolean>();
  const plans = new Map<number, string>();
  for (const ids of chunks([...new Set(tenantIds)])) {
    const decided = await ops.select({ tenantId: runOutcomeTrainingConsent.tenantId, crossTenant: runOutcomeTrainingConsent.crossTenant })
      .from(runOutcomeTrainingConsent).where(inArray(runOutcomeTrainingConsent.tenantId, ids));
    for (const row of decided) explicit.set(row.tenantId, row.crossTenant);
    const planned = await core.select({ id: tenants.id, plan: tenants.plan }).from(tenants).where(inArray(tenants.id, ids));
    for (const row of planned) plans.set(row.id, row.plan);
  }
  // A tenant with no row on core (deleted) has no plan: the default for that is OFF.
  return [...new Set(tenantIds)].filter((id) => plans.has(id) && crossTenantConsent(explicit.get(id), plans.get(id)));
}

/**
 * Each consenting tenant's share of a cross-tenant read's `limit` (at least one run each), so
 * the limit is spread across tenants instead of being spent on the first ones. Pure.
 */
export function perTenantCap(limit: number, tenantCount: number): number {
  return Math.max(1, Math.floor(limit / Math.max(1, tenantCount)));
}

/**
 * Runs of every consenting tenant, as identifier-free vectors with their final labels — at
 * most {@link perTenantCap} runs per tenant (its oldest in the window), so no tenant starves
 * the others. A driver wanting more of one tenant's history narrows `since`.
 */
export async function readCrossTenantTrainingRows(core: Db, window: TrainingWindow = {}): Promise<AggregateTrainingRow[]> {
  const ops = runOutcomesDatabase(core);
  // The window is the access predicate a cross-tenant read must carry (epoch = everything).
  const since = and(gte(runFeatures.finalizedAt, window.since ?? new Date(0)), versionOf(window))!;
  const present = await ops.select({ tenantId: runFeatures.tenantId }).from(runFeatures)
    .where(acrossTenants(runFeatures, 'platform_aggregate', since))
    .groupBy(runFeatures.tenantId);
  const consenting = await consentingTenants(core, present.map((r) => r.tenantId));
  if (consenting.length === 0) return [];
  const limit = boundedLimit(window.limit);
  const cap = perTenantCap(limit, consenting.length);
  const features: FeatureRow[] = [];
  for (const ids of chunks(consenting)) {
    if (features.length >= limit) break;
    const scope = and(inArray(runFeatures.tenantId, ids), since);
    // FAIR: each tenant's oldest `cap` runs, ranked per tenant in one statement, so a tenant
    // with many runs cannot fill the limit before a later tenant is read at all.
    const firstOfEachTenant = sql`${runFeatures.id} in (select ranked.id from (
      select ${runFeatures.id} as id,
        row_number() over (partition by ${runFeatures.tenantId} order by ${runFeatures.finalizedAt}, ${runFeatures.id}) as tenant_rank
      from ${runFeatures} where ${scope}
    ) ranked where ranked.tenant_rank <= ${cap})`;
    features.push(...await ops.select().from(runFeatures)
      .where(acrossTenants(runFeatures, 'platform_aggregate', scope, firstOfEachTenant))
      .orderBy(asc(runFeatures.finalizedAt), asc(runFeatures.id))
      .limit(limit - features.length));
  }
  const labels = await finalLabelsOf(ops, features);
  return features.flatMap((f) => {
    const own = labels.get(runKey(f.tenantId, f.runId, f.repository)) ?? [];
    return own.length === 0 ? [] : [toAggregateRow(f, own)];
  });
}

/** A tenant's consent as the settings surface shows it. */
export interface TrainingConsent {
  crossTenant: boolean;
  /** False when `crossTenant` is the plan default (no explicit decision recorded). */
  explicit: boolean;
  decidedBy: string | null;
  decidedAt: string | null;
}

export async function getTrainingConsent(core: Db, tenantId: number): Promise<TrainingConsent> {
  const ops = runOutcomesDatabase(core);
  const [row] = await ops.select().from(runOutcomeTrainingConsent).where(eq(runOutcomeTrainingConsent.tenantId, tenantId)).limit(1);
  if (row) {
    return { crossTenant: row.crossTenant, explicit: true, decidedBy: row.decidedBy, decidedAt: row.decidedAt.toISOString() };
  }
  const [tenant] = await core.select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return { crossTenant: crossTenantConsent(undefined, tenant?.plan), explicit: false, decidedBy: null, decidedAt: null };
}

/** Record a tenant's explicit decision (the caller has already authorized `decidedBy`). */
export async function setTrainingConsent(core: Db, tenantId: number, crossTenant: boolean, decidedBy: string): Promise<void> {
  const decidedAt = new Date();
  await runOutcomesDatabase(core).insert(runOutcomeTrainingConsent)
    .values({ tenantId, crossTenant, decidedBy: decidedBy.slice(0, 128), decidedAt })
    .onConflictDoUpdate({ target: runOutcomeTrainingConsent.tenantId, set: { crossTenant, decidedBy: decidedBy.slice(0, 128), decidedAt } });
}
