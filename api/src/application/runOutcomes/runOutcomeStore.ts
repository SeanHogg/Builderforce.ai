/**
 * THE writer of the run-outcomes tables (PRD 41 §D1) on the operational endpoint. The sync
 * importer, the cloud finalize attribution and the label sweep all write through here, so the
 * three rules live once:
 *
 *   • features are FROZEN: inserted once; a second write with a different digest is refused;
 *   • attributions are upserted per (run, repository, commit, path), a known branch or line
 *     count filling a gap and never being erased by a later NULL;
 *   • labels are upserted per kind by `labelSupersedes` (`domain/runOutcomes/runOutcomePolicy`),
 *     with its invariants restated in the statement itself as a race backstop: final is never
 *     replaced by censored, and an observed event (value true) is never replaced by null/false
 *     (a final row closing a censored-true one keeps the stored value, event time and evidence).
 */

import { eq, inArray, sql } from 'drizzle-orm';
import { carryStoredEvent as carryContractEvent, type RunOutcomeLabel } from '@builderforce/run-delta/predict';
import { siblingDatabaseOf, type Db } from '../../infrastructure/database/connection';
import { runCommitAttributions, runFeatures, runOutcomeLabels } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { labelPrecedenceOf, labelSupersedes } from '../../domain/runOutcomes/runOutcomePolicy';
import { chunked } from '../shared/chunked';
import type { ParsedAttribution, ParsedLabel, ParsedRunOutcome } from '../../domain/runOutcomes/runOutcomeRecord';

/** The database the run-outcomes tables live on (the core handle where it is not split out). */
export function runOutcomesDatabase(core: Db): Db {
  return siblingDatabaseOf(core, 'operational');
}

/** One label row addressed to its run. */
export interface LabelRow extends ParsedLabel {
  runId: string;
  repository: string;
}

/** Rows / ids per statement. */
export const RUN_OUTCOME_CHUNK = 500;
/** THE run-outcomes chunking (`chunked` at {@link RUN_OUTCOME_CHUNK}), shared by every module of this context. */
export const runOutcomeChunks = <T>(list: readonly T[]): T[][] => chunked(list, RUN_OUTCOME_CHUNK);
const chunks = runOutcomeChunks;

const date = (iso: string | undefined): Date | null => (iso ? new Date(iso) : null);

/** A labeller's contract label as a storable row. */
export function labelRowOf(runId: string, repository: string, label: RunOutcomeLabel): LabelRow {
  return {
    runId,
    repository,
    kind: label.kind,
    value: label.value,
    status: label.status,
    eventAt: date(label.eventAt),
    windowEndsAt: date(label.windowEndsAt),
    evidence: label.evidence,
    labellerVersion: label.labellerVersion,
    computedAt: new Date(label.computedAt),
  };
}

/** The label fields of a stored row or a {@link LabelRow}: what {@link contractLabelOf} reads. */
type LabelFields = Pick<typeof runOutcomeLabels.$inferSelect, 'value' | 'eventAt' | 'windowEndsAt' | 'labellerVersion' | 'computedAt'>
  & { kind: string; status: string; evidence: unknown };

/** A stored row (or a {@link LabelRow}) as the contract label the pure labellers take. */
export function contractLabelOf(row: LabelFields): RunOutcomeLabel {
  return {
    kind: row.kind as RunOutcomeLabel['kind'],
    value: row.value,
    status: row.status as RunOutcomeLabel['status'],
    ...(row.eventAt ? { eventAt: row.eventAt.toISOString() } : {}),
    ...(row.windowEndsAt ? { windowEndsAt: row.windowEndsAt.toISOString() } : {}),
    evidence: (row.evidence ?? {}) as Record<string, string | number>,
    labellerVersion: row.labellerVersion,
    computedAt: row.computedAt.toISOString(),
  };
}

export type RunOutcomeWrite = { ok: true } | { ok: false; detail: 'run_features_frozen' };

/** Write one run's features (once), attributions and labels. */
export async function writeRunOutcome(ops: Db, tenantId: number, projectId: number | null, record: ParsedRunOutcome): Promise<RunOutcomeWrite> {
  const f = record.features;
  const inserted = await ops.insert(runFeatures).values({
    tenantId,
    projectId,
    runId: record.runId,
    repository: record.repository,
    entryPoint: f.entryPoint,
    mode: f.mode,
    modelTier: f.modelTier,
    schemaVersion: f.schemaVersion,
    finalizedAt: f.finalizedAt,
    featureValues: f.values,
    digest: f.digest,
    requesterId: f.requesterId,
    approverId: f.approverId,
    reviewerId: f.reviewerId,
    agentId: f.agentId,
  }).onConflictDoNothing({ target: [runFeatures.tenantId, runFeatures.runId, runFeatures.repository] })
    .returning({ id: runFeatures.id });
  if (inserted.length === 0) {
    const [stored] = await ops.select({ digest: runFeatures.digest }).from(runFeatures)
      .where(scopedToTenant(runFeatures, tenantId, eq(runFeatures.runId, record.runId), eq(runFeatures.repository, record.repository)))
      .limit(1);
    if (stored && stored.digest !== f.digest) return { ok: false, detail: 'run_features_frozen' };
  }
  await upsertAttributions(ops, tenantId, record.runId, record.repository, record.attributions);
  await upsertLabelRows(ops, tenantId, record.labels.map((label) => ({ ...label, runId: record.runId, repository: record.repository })));
  return { ok: true };
}

/** Upsert one run's commit attributions. */
export async function upsertAttributions(ops: Db, tenantId: number, runId: string, repository: string, rows: readonly ParsedAttribution[]): Promise<void> {
  for (const part of chunks(rows)) {
    await ops.insert(runCommitAttributions).values(part.map((a) => ({
      tenantId, runId, repository,
      commitSha: a.commitSha,
      path: a.path,
      branch: a.branch,
      addedLines: a.addedLines,
      committedAt: a.committedAt,
      source: a.source,
    }))).onConflictDoUpdate({
      target: [runCommitAttributions.tenantId, runCommitAttributions.runId, runCommitAttributions.repository, runCommitAttributions.commitSha, runCommitAttributions.path],
      set: {
        branch: sql`coalesce(excluded.branch, ${runCommitAttributions.branch})`,
        addedLines: sql`coalesce(excluded.added_lines, ${runCommitAttributions.addedLines})`,
      },
    });
  }
}

/** The tenant's stored label rows for these runs, keyed `runId \0 repository \0 kind`. */
async function storedLabels(ops: Db, tenantId: number, runIds: readonly string[]): Promise<Map<string, typeof runOutcomeLabels.$inferSelect>> {
  const out = new Map<string, typeof runOutcomeLabels.$inferSelect>();
  for (const ids of chunks([...new Set(runIds)])) {
    const rows = await ops.select().from(runOutcomeLabels)
      .where(scopedToTenant(runOutcomeLabels, tenantId, inArray(runOutcomeLabels.runId, ids)));
    for (const row of rows) out.set(labelKey(row.runId, row.repository, row.kind), row);
  }
  return out;
}

const labelKey = (runId: string, repository: string, kind: string): string => `${runId}\0${repository}\0${kind}`;

type StoredLabel = typeof runOutcomeLabels.$inferSelect;

/**
 * The row actually written when `row` supersedes `current`: an observed event is never
 * erased. THE rule is the shared contract's `carryStoredEvent` (`@builderforce/run-delta/predict`,
 * also the device's); this only maps the rows onto contract labels and back. A stored
 * `value: true` meeting an incoming null/false keeps the stored value, `eventAt` and evidence;
 * the incoming status, window, version and `computedAt` still land. `row` itself is returned
 * when nothing is carried.
 */
export function carryStoredEvent(current: StoredLabel | undefined, row: LabelRow): LabelRow {
  const next = contractLabelOf(row);
  const carried = carryContractEvent(current ? contractLabelOf(current) : undefined, next);
  return carried === next ? row : labelRowOf(row.runId, row.repository, carried);
}

/** Upsert label rows, each only when it supersedes the stored one. Returns how many were written. */
export async function upsertLabelRows(ops: Db, tenantId: number, rows: readonly LabelRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const stored = await storedLabels(ops, tenantId, rows.map((r) => r.runId));
  const winners: LabelRow[] = [];
  for (const row of rows) {
    const current = stored.get(labelKey(row.runId, row.repository, row.kind));
    if (!labelSupersedes(current ? labelPrecedenceOf(current) : undefined, labelPrecedenceOf(row))) continue;
    winners.push(carryStoredEvent(current, row));
  }
  // Race backstops for a concurrent writer, restating the precedence in the statement:
  // a closed window never reopens, and a stored observed event (value true) is never
  // replaced by null/false — a final row closing it keeps the stored value, event and evidence.
  const t = runOutcomeLabels;
  const keepsStoredEvent = sql`(${t.value} is true and excluded.value is not true)`;
  for (const part of chunks(winners)) {
    await ops.insert(runOutcomeLabels).values(part.map((row) => ({
      tenantId,
      runId: row.runId,
      repository: row.repository,
      kind: row.kind,
      value: row.value,
      status: row.status,
      eventAt: row.eventAt,
      windowEndsAt: row.windowEndsAt,
      evidence: row.evidence,
      labellerVersion: row.labellerVersion,
      computedAt: row.computedAt,
    }))).onConflictDoUpdate({
      target: [runOutcomeLabels.tenantId, runOutcomeLabels.runId, runOutcomeLabels.repository, runOutcomeLabels.kind],
      set: {
        value: sql`case when ${keepsStoredEvent} then ${t.value} else excluded.value end`,
        status: sql`excluded.status`,
        eventAt: sql`case when ${keepsStoredEvent} then ${t.eventAt} else excluded.event_at end`,
        windowEndsAt: sql`excluded.window_ends_at`,
        evidence: sql`case when ${keepsStoredEvent} then ${t.evidence} else excluded.evidence end`,
        labellerVersion: sql`excluded.labeller_version`,
        computedAt: sql`excluded.computed_at`,
      },
      setWhere: sql`not (${t.status} = 'final' and excluded.status = 'censored')
        and not (${keepsStoredEvent} and not (${t.status} = 'censored' and excluded.status = 'final'))`,
    });
  }
  return winners.length;
}

