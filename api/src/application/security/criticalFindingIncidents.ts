/**
 * criticalFindingIncidents — a CRITICAL finding auto-opens a `security_incidents` row so the
 * response clock starts (PRD 08 §4.4 / §10: detection source `agent`).
 *
 * IDEMPOTENT PER REPOSITORY + FINDING FINGERPRINT. The incident's `source_ref` is
 * `finding:<repoRef>:<fingerprint>` (the repo is part of the key: the same rule firing on the same
 * path in two repositories is two incidents) and migration 1321 makes `(tenant_id, segment_id,
 * source_ref)` unique for that prefix, so the second time the same finding is seen - a retried
 * finalize, a re-scan - nothing new is opened.
 *
 * A RECURRENCE REOPENS. When the same finding comes back after its incident was resolved, the insert's
 * conflict branch sets the incident back to `open`, clears `resolved_at` and appends a dated line to
 * its timeline (`impact`), instead of silently leaving a resolved incident beside a live problem. An
 * incident that is still open is left exactly as it is.
 *
 * Only OPEN CRITICAL findings open an incident; every one opened or reopened here is also recorded in
 * the governance mutation-audit trail.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { securityIncidents, vulnerabilityFindings } from '../../infrastructure/database/schema';
import type { ActorIdentity } from '../activity/activityLog';
import { recordGovernanceMutation } from '../governance/mutationAudit';

export const FINDING_INCIDENT_SOURCE = 'agent';
export const findingIncidentRef = (repoRef: string, fingerprint: string): string => `finding:${repoRef}:${fingerprint}`;

export interface CriticalFindingForIncident {
  id: string;
  title: string;
  fingerprint: string | null;
  filePath: string | null;
  scanId: string;
}

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
  const ref = f.fingerprint ?? `id:${f.id}`;
  return {
    tenantId: ctx.tenantId,
    segmentId: ctx.segmentId,
    title: `CRITICAL finding: ${f.title}`.slice(0, 255),
    severity: 'critical',
    status: 'open',
    detectionSource: FINDING_INCIDENT_SOURCE,
    impact: `A CRITICAL security finding was detected${f.filePath ? ` in ${f.filePath}` : ''}${ctx.where ? ` (${ctx.where})` : ''}. `
      + 'The merge is held until the finding is fixed or its risk is explicitly accepted.',
    sourceRef: findingIncidentRef(ctx.repoRef, ref),
  };
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
    const row = buildFindingIncident(f, ctx);
    const written = await db.insert(securityIncidents).values(row)
      .onConflictDoUpdate({
        target: [securityIncidents.tenantId, securityIncidents.segmentId, securityIncidents.sourceRef],
        // The unique index is PARTIAL (`finding:%` refs only); the conflict target must restate it.
        targetWhere: sql`source_ref LIKE 'finding:%'`,
        set: {
          status: 'open',
          resolvedAt: null,
          updatedAt: new Date(),
          impact: sql`COALESCE(${securityIncidents.impact}, '') || ${`\n[${new Date().toISOString().slice(0, 10)}] The finding recurred${ctx.where ? ` (${ctx.where})` : ''}; incident reopened.`}`,
        },
        // Only a RESOLVED / CLOSED incident reopens. One that is open - or in any in-progress state
        // (investigating, mitigating ...) - is being worked and is left exactly as it is.
        setWhere: sql`${securityIncidents.status} IN ('resolved', 'closed')`,
      })
      .returning({ id: securityIncidents.id });
    if (written.length === 0) continue; // already open for this fingerprint
    changed += 1;
    await recordGovernanceMutation(env, db, {
      actor, tenantId: ctx.tenantId, segmentId: ctx.segmentId, entity: 'incidents', entityId: written[0]!.id, action: 'open',
      after: row, note: { findingId: f.id, scanId: f.scanId },
    });
  }
  return changed;
}
