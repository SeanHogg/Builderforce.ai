/**
 * soc2Overview — the two reads the SOC 2 page adds for the DevSecOps layer: the segment's recent
 * evidence (so AUTOMATED evidence can be seen, with its provenance) and the governance-auditor's
 * open gaps. Both are scoped by `(tenantId, segmentId)`; routes call these instead of touching tables.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { governanceAuditGaps, socControls, socEvidence } from '../../infrastructure/database/schema';
import { scopedToSegment } from '../../infrastructure/database/tenantScope';
import type { SegmentScope } from '../shared/segmentScope';

export const EVIDENCE_LIST_CAP = 200;

/** Newest evidence first, with the control it belongs to. */
export async function listRecentEvidence(db: Db, scope: SegmentScope, limit = 100) {
  return db
    .select({
      id: socEvidence.id,
      controlId: socEvidence.controlId,
      controlRef: socControls.controlRef,
      title: socEvidence.title,
      evidenceType: socEvidence.evidenceType,
      url: socEvidence.url,
      note: socEvidence.note,
      sourceRef: socEvidence.sourceRef,
      uploadedBy: socEvidence.uploadedBy,
      createdAt: socEvidence.createdAt,
    })
    .from(socEvidence)
    .innerJoin(socControls, eq(socControls.id, socEvidence.controlId))
    .where(scopedToSegment(socEvidence, scope.tenantId, scope.segmentId))
    .orderBy(desc(socEvidence.createdAt))
    .limit(Math.min(Math.max(1, limit), EVIDENCE_LIST_CAP));
}

/** The auditor's currently OPEN gaps, newest first. */
export async function listOpenGaps(db: Db, scope: SegmentScope) {
  return db
    .select({
      id: governanceAuditGaps.id,
      gapType: governanceAuditGaps.gapType,
      subjectRef: governanceAuditGaps.subjectRef,
      controlId: governanceAuditGaps.controlId,
      detail: governanceAuditGaps.detail,
      detectedAt: governanceAuditGaps.detectedAt,
    })
    .from(governanceAuditGaps)
    .where(and(
      scopedToSegment(governanceAuditGaps, scope.tenantId, scope.segmentId),
      eq(governanceAuditGaps.status, 'open'),
    ))
    .orderBy(desc(governanceAuditGaps.detectedAt))
    .limit(EVIDENCE_LIST_CAP);
}
