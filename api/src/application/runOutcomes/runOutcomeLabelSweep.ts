/**
 * The daily run-outcome label jobs (PRD 41 §D1, WS16) over the ops database — cron key
 * `run-outcome-labels`. One pass, bounded:
 *
 *   1. CENSORING. Every censored label whose window has ended is finalized by the pure
 *      `finalizeCensored` (null ⇒ false, observed ⇒ true; status final).
 *   2. CI RED AFTER MERGE and REVIEW REJECTED. Per tenant with recently attributed runs, each
 *      run whose two server-side kinds are not both final is matched to the pull request its
 *      commits landed through (branch + repository → `pull_requests`), and labelled by the
 *      pure `labelCiRedAfterMerge` / `labelReviewRejected`. The rules live in those labellers;
 *      this module only reads the facts and writes what they return.
 *   3. FAIRNESS. Both caps rotate: tenants by a per-day window over their ids
 *      (`rotatingWindow`), a tenant's runs least-recently-labelled first (`labelCandidates`),
 *      so nothing past a cap is starved; a run that can never get a final label leaves the set.
 *
 * Writes go through `upsertLabelRows`, so a label already final is never reopened and a
 * device's newer row is never overwritten by an older one.
 *
 * NOT HERE: `reverted` and `followup-fix` for CLOUD runs. Both need git history (blame at a
 * fix's parent, later reverting commits) the server does not hold; the VSIX labels them on
 * the device and syncs them.
 */

import { and, desc, eq, gte, isNotNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { finalizeCensored, labelCiRedAfterMerge, labelReviewRejected, type RunOutcomeLabel } from '@builderforce/run-delta/predict';
import type { Db } from '../../infrastructure/database/connection';
import { DAY_MS } from '../../domain/shared/time';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { runCommitAttributions, runOutcomeLabels } from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { ciLabelInput, pickRunPullRequest, reviewLabelInput, type RunReviewSignoff } from '../../domain/runOutcomes/labelInputs';
import { contractLabelOf, labelRowOf, runOutcomesDatabase, upsertLabelRows, type LabelRow } from './runOutcomeStore';
import { pullRequestsOfRun, pullRequestsOnBranches, reviewSignoffsByTask } from './runOutcomeLabelSources';

/** Runs committed longer ago than this are no longer re-labelled (a PR open that long is abandoned). */
export const LABEL_LOOKBACK_DAYS = 120;
const MAX_TENANTS_PER_PASS = 200;
export const MAX_RUNS_PER_TENANT = 200;
/** Days after its last chance a run that can never get a final CI/review label leaves the candidates. */
export const NO_PR_GRACE_DAYS = 14;
const MAX_CENSORED_PER_PASS = 2000;

/** The kinds the server labels from its own records. */
const SERVER_KINDS = ['ci-red-after-merge', 'review-rejected'] as const;

export interface LabelSweepResult {
  finalized: number;
  tenants: number;
  runs: number;
  labelled: number;
}

/** Finalize every censored label whose window has ended. Returns how many rows changed. */
export async function finalizeDueCensoredLabels(ops: Db, now: Date): Promise<number> {
  const due = await ops.select().from(runOutcomeLabels)
    .where(acrossTenants(runOutcomeLabels, 'scheduled_sweep',
      eq(runOutcomeLabels.status, 'censored'), isNotNull(runOutcomeLabels.windowEndsAt), lt(runOutcomeLabels.windowEndsAt, now)))
    .limit(MAX_CENSORED_PER_PASS);
  const byTenant = new Map<number, LabelRow[]>();
  for (const row of due) {
    const finalized = finalizeCensored(contractLabelOf(row), now.toISOString());
    const list = byTenant.get(row.tenantId) ?? [];
    list.push(labelRowOf(row.runId, row.repository, finalized));
    byTenant.set(row.tenantId, list);
  }
  let written = 0;
  for (const [tenantId, rows] of byTenant) written += await upsertLabelRows(ops, tenantId, rows);
  return written;
}

/** One run the CI / review labellers still have something to learn about. */
export interface LabelCandidate {
  runId: string;
  repository: string;
  branches: string[];
  paths: string[];
  lastCommittedAt: Date;
  /** Server kinds already final for this run (skipped). */
  finalKinds: string[];
}

const textArray = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

/**
 * The window of `ids` (sorted ascending) this pass covers: `cap` ids starting at
 * `(pass × cap) mod n`, wrapping. Consecutive passes walk the whole list, so no tenant past the
 * cap is starved. All of them when `n ≤ cap`. Pure.
 */
export function rotatingWindow<T>(ids: readonly T[], cap: number, pass: number): T[] {
  const n = ids.length;
  if (n <= cap) return [...ids];
  const start = (((pass * cap) % n) + n) % n;
  return Array.from({ length: cap }, (_, i) => ids[(start + i) % n]!);
}

/**
 * This pass's candidates out of a tenant's keys (ordered: never-labelled first by newest commit, then labelled by last
 * label time ascending). The labelled keys take their slots FIRST, stalest first — at least half the cap whenever there
 * are that many, the whole leftover when the never-labelled ones are fewer — so a flood of runs that never match a PR
 * can never starve a matched run; the never-labelled keys rotate ({@link rotatingWindow}) through the rest. Pure.
 */
export function candidateWindow<K extends { lastLabelledAt: string | Date | null }>(keys: readonly K[], pass: number, cap = MAX_RUNS_PER_TENANT): K[] {
  const never = keys.filter((k) => k.lastLabelledAt === null);
  const labelled = keys.filter((k) => k.lastLabelledAt !== null);
  const labelledSlots = Math.min(labelled.length, Math.max(cap - never.length, Math.ceil(cap / 2)));
  return [...labelled.slice(0, labelledSlots), ...rotatingWindow(never, cap - labelledSlots, pass)];
}

/** The sweep's pass number: one per UTC day, so a daily cron advances the tenant window every run. */
export const sweepPassOf = (now: Date): number => Math.floor(now.getTime() / DAY_MS);

/** Tenants with runs committed since `since`, ordered by id, rotated by {@link rotatingWindow} per pass. */
export async function tenantsWithRecentRuns(ops: Db, since: Date, now: Date, cap = MAX_TENANTS_PER_PASS): Promise<number[]> {
  const rows = await ops.select({ tenantId: runCommitAttributions.tenantId }).from(runCommitAttributions)
    .where(acrossTenants(runCommitAttributions, 'scheduled_sweep', gte(runCommitAttributions.committedAt, since)))
    .groupBy(runCommitAttributions.tenantId);
  const ids = rows.map((r) => r.tenantId).sort((a, b) => a - b);
  return rotatingWindow(ids, cap, sweepPassOf(now));
}

/** The run's server-kind label rows, correlated to the grouped attribution row. */
const serverLabelsOfRun = (extra: SQL) => sql`from ${runOutcomeLabels}
  where ${runOutcomeLabels.tenantId} = ${runCommitAttributions.tenantId}
    and ${runOutcomeLabels.runId} = ${runCommitAttributions.runId}
    and ${runOutcomeLabels.repository} = ${runCommitAttributions.repository}
    and ${runOutcomeLabels.kind} in ('ci-red-after-merge', 'review-rejected') ${extra}`;

const finalServerKinds = sql`array(select ${runOutcomeLabels.kind} ${serverLabelsOfRun(sql`and ${runOutcomeLabels.status} = 'final'`)})`;

/**
 * When the sweep last wrote this run's server labels (NULL: never). Every pass that matches a
 * PR rewrites at least the non-final kind it recomputes (a newer `computedAt` supersedes), so
 * ordering by it ascending, NULLS FIRST, round-robins the candidates. MAX, not min: a FINAL
 * row's `computed_at` never moves again, so a min would pin a run with one final kind to the
 * front forever.
 */
const lastServerLabelAt = sql`(select max(${runOutcomeLabels.computedAt}) ${serverLabelsOfRun(sql``)})`;

/** No server label was ever written ⇔ the run never matched a pull request (a matched PR always gets `review-rejected`). */
const neverMatched = sql`not exists (select 1 ${serverLabelsOfRun(sql``)})`;

/** Its PR closed (review-rejected final, window = the close) with no CI label at all: none can come any more. */
const closedWithoutCi = (cutoff: string) => sql`exists (select 1 ${serverLabelsOfRun(sql`and ${runOutcomeLabels.kind} = 'review-rejected'
    and ${runOutcomeLabels.status} = 'final' and ${runOutcomeLabels.windowEndsAt} < ${cutoff}::timestamptz`)})
  and not exists (select 1 ${serverLabelsOfRun(sql`and ${runOutcomeLabels.kind} = 'ci-red-after-merge'`)})`;

/**
 * A tenant's recently committed runs whose server kinds are not all final. A run that can never
 * get a final CI/review label is dropped {@link NO_PR_GRACE_DAYS} days after its last chance: no
 * matched PR 14 days after its last commit, or a PR that closed 14 days ago with no CI label.
 *
 * FAIRNESS. ALL candidate KEYS are read (keys only), ordered least recently labelled first
 * (never-labelled first, then newest commit), and this pass takes {@link candidateWindow} of them:
 * the stalest labelled keys first, the never-labelled ones rotated per day like the tenants. A plain `limit` after NULLS FIRST let runs that
 * never match a PR (NULL through their whole grace) fill every pass and starve matched runs; the
 * rotation visits every key within ⌈n / {@link MAX_RUNS_PER_TENANT}⌉ passes. Branches and paths
 * are then loaded for that window only.
 */
export async function labelCandidates(ops: Db, tenantId: number, since: Date, now = new Date()): Promise<LabelCandidate[]> {
  const t = runCommitAttributions;
  const cutoff = new Date(now.getTime() - NO_PR_GRACE_DAYS * DAY_MS).toISOString();
  const keys = await ops.select({ runId: t.runId, repository: t.repository, lastLabelledAt: sql<string | null>`${lastServerLabelAt}` }).from(t)
    .where(scopedToTenant(t, tenantId, gte(t.committedAt, since), sql`cardinality(${finalServerKinds}) < ${SERVER_KINDS.length}`))
    .groupBy(t.tenantId, t.runId, t.repository)
    .having(sql`not (${neverMatched} and max(${t.committedAt}) < ${cutoff}::timestamptz) and not (${closedWithoutCi(cutoff)})`)
    .orderBy(sql`${lastServerLabelAt} asc nulls first`, desc(sql`max(${t.committedAt})`), t.runId, t.repository);
  const window = candidateWindow(keys, sweepPassOf(now));
  if (window.length === 0) return [];
  const inWindow = or(...window.map((k) => and(eq(t.runId, k.runId), eq(t.repository, k.repository))))!;
  const rows = await ops.select({
    runId: t.runId,
    repository: t.repository,
    lastCommittedAt: sql<string>`max(${t.committedAt})`,
    branches: sql<string[] | null>`array_remove(array_agg(distinct ${t.branch}), null)`,
    paths: sql<string[] | null>`array_agg(distinct ${t.path})`,
    finalKinds: sql<string[] | null>`${finalServerKinds}`,
  }).from(t)
    .where(scopedToTenant(t, tenantId, gte(t.committedAt, since), inWindow))
    .groupBy(t.tenantId, t.runId, t.repository);
  const order = new Map(window.map((k, i) => [`${k.runId}\0${k.repository}`, i] as const));
  rows.sort((a, b) => (order.get(`${a.runId}\0${a.repository}`) ?? 0) - (order.get(`${b.runId}\0${b.repository}`) ?? 0));
  return rows.map((r) => ({
    runId: r.runId,
    repository: r.repository,
    branches: textArray(r.branches),
    paths: textArray(r.paths),
    lastCommittedAt: new Date(r.lastCommittedAt),
    finalKinds: textArray(r.finalKinds),
  }));
}

/** Label one tenant's candidates; returns the rows to write. */
async function labelTenant(core: Db, tenantId: number, candidates: readonly LabelCandidate[], since: Date, now: Date): Promise<LabelRow[]> {
  const prs = await pullRequestsOnBranches(core, tenantId, candidates.flatMap((c) => c.branches));
  const picked = candidates.map((c) => ({ c, pr: pickRunPullRequest(pullRequestsOfRun(prs, c.repository, new Set(c.branches)), c.lastCommittedAt) }));
  const taskIds = picked.flatMap(({ pr }) => (pr?.taskId != null ? [pr.taskId] : []));
  const signoffs = taskIds.length > 0 ? await reviewSignoffsByTask(core, tenantId, taskIds, since) : new Map<number, RunReviewSignoff[]>();
  const rows: LabelRow[] = [];
  for (const { c, pr } of picked) {
    const labels: Array<RunOutcomeLabel | undefined> = [];
    if (!c.finalKinds.includes('ci-red-after-merge')) {
      // No concluded CI run observed on the merge ⇒ no label at all (never a censored null
      // that would finalize to "not red" on no evidence).
      const ci = ciLabelInput(pr, c.paths, now);
      if (ci) labels.push(labelCiRedAfterMerge(ci));
    }
    if (!c.finalKinds.includes('review-rejected')) {
      labels.push(labelReviewRejected(reviewLabelInput(pr, pr?.taskId != null ? signoffs.get(pr.taskId) ?? [] : [], now)));
    }
    for (const label of labels) if (label) rows.push(labelRowOf(c.runId, c.repository, label));
  }
  return rows;
}

/** The whole daily pass. `core` is the request's core handle; the ops handle is derived. */
export async function runRunOutcomeLabelSweep(core: Db, now = new Date()): Promise<LabelSweepResult> {
  const ops = runOutcomesDatabase(core);
  const finalized = await finalizeDueCensoredLabels(ops, now);
  const since = new Date(now.getTime() - LABEL_LOOKBACK_DAYS * DAY_MS);
  const tenants = await tenantsWithRecentRuns(ops, since, now);
  let runs = 0;
  let labelled = 0;
  for (const tenantId of tenants) {
    // One tenant's bad row never stops the others' labels.
    try {
      const candidates = await labelCandidates(ops, tenantId, since, now);
      if (candidates.length === 0) continue;
      runs += candidates.length;
      labelled += await upsertLabelRows(ops, tenantId, await labelTenant(core, tenantId, candidates, since, now));
    } catch (error) {
      reportCaughtError(error, { source: 'application/runOutcomes/runOutcomeLabelSweep.ts', operation: 'runRunOutcomeLabelSweep', context: { logMessage: '[run-outcome-labels] tenant pass failed', details: { tenantId } } });
    }
  }
  return { finalized, tenants: tenants.length, runs, labelled };
}
