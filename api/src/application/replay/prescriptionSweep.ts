/**
 * The prescription SWEEP (PRD 33 §5.1.1–3) — the writer of the finding, impact,
 * prescription, change and visual columns of `replay_prescriptions`.
 *
 * Per site: build the aggregates (`prescriptionAggregates.ts`), run every rule,
 * and for each finding
 *   • an OPEN row for (site, rule, subject) has its finding + impact refreshed;
 *   • a subject DISMISSED in the last {@link DISMISS_SUPPRESS_DAYS} days stays dismissed;
 *   • otherwise a new `proposed` row is written (the open-row unique index makes a
 *     racing sweep's duplicate a no-op), and the finding's issue group is linked
 *     (`replay_issues.prescription_id`, status `proposed`).
 * Then the do-first rows still without a prescription are drafted
 * (`prescriptionDraft.ts`, ≤5 per site per day, THE shared AI budget).
 *
 * Registered as the `replay-prescriptions` daily sweep in `cronSweeps.ts` (which
 * also runs the verifier), and as "Find fixes now" — once an hour per site.
 */

import { and, eq, gte, inArray, isNull, notInArray, or } from 'drizzle-orm';
import type { ReplayPrescriptionSweepResultDto } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { replayIssues, replayPrescriptions, replayRouteDaily } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { invalidateCached, peekCached, setCached } from '../../infrastructure/cache/readThroughCache';
import { DomainError } from '../../domain/shared/errors';
import { DAY_MS } from '../../domain/shared/time';
import type { ReplayScope } from '../../domain/replay/replayScope';
import { detectFindings, PRESCRIPTION_RULE_BY_ID } from '../../domain/replay/prescriptions/rules';
import { estimateImpact } from '../../domain/replay/prescriptions/impact';
import { TERMINAL_STATUSES } from '../../domain/replay/prescriptions/prescriptionState';
import type { Finding } from '../../domain/replay/prescriptions/types';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { buildSiteAggregates, PRESCRIPTION_WINDOW_DAYS } from './prescriptionAggregates';
import { draftPrescriptions } from './prescriptionDraft';
import { rankRows, type PrescriptionRow } from './prescriptionReads';
import { verifySite } from './prescriptionVerify';
import {
  bumpSiteVersion,
  prescriptionSweepGateKey,
  prescriptionSweepNowKey,
  replayReadKeys,
} from './replayCacheKeys';
import { replayTelemetryDb } from './replayDatabase';
import { getSite, getSiteForTenant, type ReplaySiteRecord } from './replaySites';

const SOURCE = 'application/replay/prescriptionSweep.ts';
/** A dismissed subject is not proposed again for this long. */
export const DISMISS_SUPPRESS_DAYS = 30;
/** "Find fixes now" may run once per this many seconds per site. */
export const SWEEP_NOW_INTERVAL_SECONDS = 3_600;
/** Sites with rollups this recent are swept. */
const ACTIVE_WINDOW_DAYS = 2;
/** Issues a sweep may move to `proposed` (a person's or the verifier's status is never overwritten). */
const LINKABLE_ISSUE_STATUSES = ['new', 'ongoing', 'regressed'];

/** "Find fixes now" ran within the hour. The route answers 429. */
export class PrescriptionSweepLimitError extends DomainError {
  readonly status = 429;
  constructor() {
    super('Fixes were looked for less than an hour ago');
    this.name = 'PrescriptionSweepLimitError';
  }
}

const keyOf = (ruleId: string, subjectKey: string) => `${ruleId}\u001f${subjectKey}`;

/** What the sweep stores in `finding` (the DTO reads it back through `prescriptionReads`). */
function storedFinding(finding: Finding) {
  return {
    params: finding.params,
    evidence: finding.evidence,
    selector: finding.selector,
    label: finding.label,
    fingerprint: finding.fingerprint,
    affected: finding.affected,
    issueId: finding.issueId,
  };
}

/** Link the finding's issue group to its prescription, unless a person or the verifier owns its status. */
async function linkIssues(env: Env, db: Db, site: ReplaySiteRecord, links: Array<{ issueId: string; prescriptionId: string }>, now: Date): Promise<void> {
  const store = replayTelemetryDb(env, db);
  for (const link of links) {
    await store
      .update(replayIssues)
      .set({ prescriptionId: link.prescriptionId, status: 'proposed', updatedAt: now })
      .where(and(
        eq(replayIssues.tenantId, site.tenantId),
        eq(replayIssues.siteId, site.id),
        eq(replayIssues.id, link.issueId),
        isNull(replayIssues.prescriptionId),
        inArray(replayIssues.status, LINKABLE_ISSUE_STATUSES),
      ));
  }
}

/** One site's sweep. */
export async function sweepSite(
  env: Env,
  db: Db,
  site: ReplaySiteRecord,
  opts: { now?: Date } = {},
): Promise<ReplayPrescriptionSweepResultDto> {
  const now = opts.now ?? new Date();
  const agg = await buildSiteAggregates(env, db, site, { now });
  const findings = detectFindings(agg);

  const rows: PrescriptionRow[] = await db
    .select()
    .from(replayPrescriptions)
    .where(and(
      eq(replayPrescriptions.siteId, site.id),
      or(
        notInArray(replayPrescriptions.status, [...TERMINAL_STATUSES]),
        and(eq(replayPrescriptions.status, 'dismissed'), gte(replayPrescriptions.updatedAt, new Date(now.getTime() - DISMISS_SUPPRESS_DAYS * DAY_MS))),
      ),
    ));
  const open = new Map(rows.filter((r) => !(TERMINAL_STATUSES as readonly string[]).includes(r.status)).map((r) => [keyOf(r.ruleId, r.subjectKey), r]));
  const dismissed = new Set(rows.filter((r) => r.status === 'dismissed').map((r) => keyOf(r.ruleId, r.subjectKey)));

  const result: ReplayPrescriptionSweepResultDto = { found: findings.length, created: 0, refreshed: 0, prescribed: 0 };
  const links: Array<{ issueId: string; prescriptionId: string }> = [];
  const fresh: PrescriptionRow[] = [];
  for (const finding of findings) {
    const key = keyOf(finding.ruleId, finding.subjectKey);
    if (dismissed.has(key)) continue;
    // `basis` keeps the cohorts the range came from (Test it sizes its sample from them); the DTO does not expose it.
    const impact = { ...estimateImpact(finding, finding.cohorts, agg.days), basis: finding.cohorts };
    const existing = open.get(key);
    if (existing) {
      const [updated] = await db
        .update(replayPrescriptions)
        .set({ finding: storedFinding(finding), impact, pagePath: finding.pagePath, updatedAt: now })
        .where(eq(replayPrescriptions.id, existing.id))
        .returning();
      result.refreshed += 1;
      if (updated) fresh.push(updated);
      if (finding.issueId) links.push({ issueId: finding.issueId, prescriptionId: existing.id });
      continue;
    }
    const rule = PRESCRIPTION_RULE_BY_ID.get(finding.ruleId);
    const [created] = await db
      .insert(replayPrescriptions)
      .values({
        siteId: site.id,
        ruleId: finding.ruleId,
        area: finding.area,
        source: 'rule',
        subjectKey: finding.subjectKey,
        pagePath: finding.pagePath,
        status: 'proposed',
        finding: storedFinding(finding),
        impact,
        acceptance: rule?.acceptance ?? null,
        createdAt: now,
        updatedAt: now,
      })
      // The open-row unique index: a sweep racing this one already wrote it.
      .onConflictDoNothing()
      .returning();
    if (!created) continue;
    result.created += 1;
    fresh.push(created);
    if (finding.issueId) links.push({ issueId: finding.issueId, prescriptionId: created.id });
  }

  if (links.length > 0) await linkIssues(env, db, site, links, now);
  const toDraft = rankRows(fresh.filter((r) => r.status === 'proposed' && !r.prescription));
  result.prescribed = await draftPrescriptions(env, db, site, toDraft, agg, now);
  if (result.created + result.refreshed + result.prescribed > 0) await bumpSiteVersion(env, site.id);
  return result;
}

/** "Find fixes now": once an hour per site, on fresh aggregates. */
export async function sweepNow(env: Env, db: Db, scope: ReplayScope, opts: { now?: Date } = {}): Promise<ReplayPrescriptionSweepResultDto> {
  const site = await getSiteForTenant(env, db, scope.tenantId, scope.siteId);
  const gate = prescriptionSweepNowKey(site.id);
  if (await peekCached<boolean>(env, gate)) throw new PrescriptionSweepLimitError();
  await setCached(env, gate, true, { kvTtlSeconds: SWEEP_NOW_INTERVAL_SECONDS });
  await invalidateCached(env, (await replayReadKeys(env, scope)).prescriptionAggregates(PRESCRIPTION_WINDOW_DAYS));
  return sweepSite(env, db, site, opts);
}

export interface PrescriptionSweepRunResult {
  sites: number;
  created: number;
  refreshed: number;
  prescribed: number;
  verified: number;
}

/** The daily run: every site with recent traffic, once per UTC day — sweep, then verify. */
export async function runPrescriptionSweep(env: Env, db: Db, now: Date = new Date()): Promise<PrescriptionSweepRunResult> {
  const sinceDay = new Date(now.getTime() - ACTIVE_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
  const active = await replayTelemetryDb(env, db)
    .select({ siteId: replayRouteDaily.siteId, tenantId: replayRouteDaily.tenantId })
    .from(replayRouteDaily)
    // A platform sweep over every workspace's sites; each site is then processed in its own scope.
    .where(acrossTenants(replayRouteDaily, 'scheduled_sweep', gte(replayRouteDaily.day, sinceDay)))
    .groupBy(replayRouteDaily.siteId, replayRouteDaily.tenantId);

  const out: PrescriptionSweepRunResult = { sites: 0, created: 0, refreshed: 0, prescribed: 0, verified: 0 };
  const day = now.toISOString().slice(0, 10);
  for (const row of active) {
    const gate = prescriptionSweepGateKey(row.siteId, day);
    try {
      if (await peekCached<boolean>(env, gate)) continue;
      const site = await getSite(env, db, row.siteId);
      if (!site || site.status !== 'active' || site.tenantId !== row.tenantId) continue;
      const swept = await sweepSite(env, db, site, { now });
      out.sites += 1;
      out.created += swept.created;
      out.refreshed += swept.refreshed;
      out.prescribed += swept.prescribed;
      out.verified += await verifySite(env, db, site, { now });
      await setCached(env, gate, true, { kvTtlSeconds: 2 * 86_400 });
    } catch (error) {
      reportCaughtError(error, { source: SOURCE, operation: 'runPrescriptionSweep', context: { details: { siteId: row.siteId } } });
    }
  }
  return out;
}
