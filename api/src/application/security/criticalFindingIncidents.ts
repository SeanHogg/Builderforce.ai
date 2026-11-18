/**
 * criticalFindingIncidents — a CRITICAL finding auto-opens a `security_incidents` row so the
 * response clock starts (PRD 08 §4.4 / §10: detection source `agent`).
 *
 * This is the `finding` kind of the finding-kind seam (findingIncidentKinds.ts), which owns the
 * mapping (title, impact, severity floor, `source_ref` prefix) and the ONE idempotent writer every
 * platform-opened incident goes through — the browser runtime's Security Shield is the other kind.
 *
 * IDEMPOTENT PER REPOSITORY + FINDING FINGERPRINT. The incident's `source_ref` is
 * `finding:<repoRef>:<fingerprint>` (the repo is part of the key: the same rule firing on the same
 * path in two repositories is two incidents) and the platform-ref unique index (migrations 1321,
 * 1354) makes `(tenant_id, segment_id, source_ref)` unique for that prefix, so the second time the
 * same finding is seen - a retried finalize, a re-scan - nothing new is opened.
 *
 * A RECURRENCE REOPENS. When the same finding comes back after its incident was resolved, the insert's
 * conflict branch sets the incident back to `open`, clears `resolved_at` and appends a dated line to
 * its timeline (`impact`), instead of silently leaving a resolved incident beside a live problem. An
 * incident that is still open is left exactly as it is.
 *
 * Only OPEN CRITICAL findings open an incident; every one opened or reopened here is also recorded in
 * the governance mutation-audit trail.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { vulnerabilityFindings } from '../../infrastructure/database/schema';
import type { ActorIdentity } from '../activity/activityLog';
import { buildKindIncident, FINDING_KINDS, openKindIncident, type CriticalFindingForIncident } from './findingIncidentKinds';

export type { CriticalFindingForIncident } from './findingIncidentKinds';

export const FINDING_INCIDENT_SOURCE = FINDING_KINDS.finding.detectionSource;
export const findingIncidentRef = (repoRef: string, fingerprint: string): string => `${FINDING_KINDS.finding.refPrefix}:${repoRef}:${fingerprint}`;

export interface IncidentContext {
  tenantId: number;
  segmentId: string;
  /** Where it was found, e.g. the PR url - goes into the incident's impact text. */
  where: string | null;
  /** `owner/repo` the finding is in; part of the dedupe key. */
  repoRef: string;
}

/** The incident row for a finding. PURE - the same finding in the same repo always yields the same `sourceRef`. */
export function buildFindingIncident(f: CriticalFindingForIncident, ctx: IncidentContext) {
  return buildKindIncident('finding', { finding: f, repoRef: ctx.repoRef, where: ctx.where }, ctx);
}

/**
 * Open (or reopen) an incident for every OPEN CRITICAL finding of the given scans.
 * Returns how many incidents were newly opened or reopened.
 */
export async function openIncidentsForCriticalFindings(
  env: Env, db: Db, actor: ActorIdentity, ctx: IncidentContext, scanIds: readonly string[],
): Promise<number> {
  if (scanIds.length === 0) return 0;
  const criticals = await db
    .select({
      id: vulnerabilityFindings.id, title: vulnerabilityFindings.title, fingerprint: vulnerabilityFindings.fingerprint,
      filePath: vulnerabilityFindings.filePath, scanId: vulnerabilityFindings.scanId,
    })
    .from(vulnerabilityFindings)
    .where(and(
      eq(vulnerabilityFindings.tenantId, ctx.tenantId),
      inArray(vulnerabilityFindings.scanId, [...scanIds]),
      eq(vulnerabilityFindings.severity, 'CRITICAL'),
      eq(vulnerabilityFindings.status, 'open'),
    ));

  let changed = 0;
  for (const f of criticals) {
    const result = await openKindIncident(
      env, db, actor, 'finding', { finding: f, repoRef: ctx.repoRef, where: ctx.where },
      { tenantId: ctx.tenantId, segmentId: ctx.segmentId }, { findingId: f.id, scanId: f.scanId },
    );
    if (result.outcome === 'opened') changed += 1;
  }
  return changed;
}
