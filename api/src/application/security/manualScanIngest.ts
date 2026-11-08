/**
 * manualScanIngest - a manager uploading a scanner report (SARIF, npm audit, the platform's own shape)
 * into a scan row via `POST /vuln-scans/:scanId/findings`.
 *
 * Ingesting closes the scan as `completed`, which is exactly what the merge gate trusts. So a platform-
 * recorded scan (linked to a PR, keyed to a commit, or triggered by an agent / the system / Run-scan) is
 * REFUSED here: otherwise a report uploaded into a `failed` or `truncated` scan of an agent PR would
 * flip it to completed + untruncated and open the gate with nobody having scanned anything. The report
 * of an external scanner for such a PR belongs in a scan the manager creates by hand; the sanctioned way
 * past an incomplete platform scan is the audited, commit-bound accept-risk override.
 */
import { eq } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { vulnerabilityScans } from '../../infrastructure/database/schema';
import { scopedToSegment } from '../../infrastructure/database/tenantScope';
import type { SegmentScope } from '../shared/segmentScope';
import { isPlatformRecordedScan } from './scanMutationGuard';
import {
  ingestScanFindings, type IngestScanFindingsInput, type IngestScanFindingsResult,
} from './vulnerabilityFindings';

export type ManualIngestOutcome =
  | { ok: true; result: IngestScanFindingsResult }
  | { ok: false; status: 403 | 404; error: string };

export async function ingestManualScanReport(
  db: Db, env: Env, scope: SegmentScope & { scanId: string }, input: Pick<IngestScanFindingsInput, 'format' | 'report'>,
): Promise<ManualIngestOutcome> {
  const [scan] = await db.select().from(vulnerabilityScans)
    .where(scopedToSegment(vulnerabilityScans, scope.tenantId, scope.segmentId, eq(vulnerabilityScans.id, scope.scanId)))
    .limit(1);
  if (!scan) return { ok: false, status: 404, error: 'scan not found' };
  if (isPlatformRecordedScan(scan)) {
    return {
      ok: false, status: 403,
      error: 'A scan recorded by the platform cannot take an uploaded report. Create a scan by hand for the report, or accept the risk on the pull request.',
    };
  }
  // Only format + report: a manual upload never sets `truncated`, `notes`, `category` or `replaceOpen`.
  const result = await ingestScanFindings(db, env, scope, { format: input.format, report: input.report });
  return result ? { ok: true, result } : { ok: false, status: 404, error: 'scan not found' };
}
