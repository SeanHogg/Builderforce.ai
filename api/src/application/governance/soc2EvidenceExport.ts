/**
 * The SOC 2 evidence package export source — `GET /api/governance/soc2/export`.
 *
 * The segment's SOC 2 controls WITH their attached evidence (SEC-1 evidence
 * export). JSON stays the default and keeps its control-centric package shape —
 * an auditor or host pulls the whole posture in one call — and, as a registered
 * source, the same package is now also a CSV/XLSX grid (one row per control ×
 * evidence item) an auditor can filter, instead of a JSON blob they cannot.
 *
 * Read for any member, segment-threaded like every other governance read, so a
 * segmented tenant exports only the active segment's controls and evidence.
 */
import { and, eq } from 'drizzle-orm';
import { TenantRole } from '../../domain/shared/types';
import { socControls, socEvidence } from '../../infrastructure/database/schema';
import { exportStamp, type TenantExportSource } from '../export/exportSource';

export const soc2EvidenceExportSource: TenantExportSource = {
  id: 'governance.soc2-evidence',
  label: 'SOC 2 evidence package',
  scope: 'tenant',
  minRole: TenantRole.VIEWER,
  formats: ['json', 'csv', 'xlsx'],
  async load(ctx) {
    const { db, tenantId, segmentId } = ctx;
    const [controls, evidence] = await Promise.all([
      db.select().from(socControls).where(and(eq(socControls.tenantId, tenantId), eq(socControls.segmentId, segmentId))),
      db.select().from(socEvidence).where(and(eq(socEvidence.tenantId, tenantId), eq(socEvidence.segmentId, segmentId))),
    ]);

    // Group evidence under its control so the package is control-centric.
    const byControl = new Map<string, Array<typeof socEvidence.$inferSelect>>();
    for (const e of evidence) {
      const list = byControl.get(e.controlId) ?? [];
      list.push(e);
      byControl.set(e.controlId, list);
    }
    const controlsWithEvidence = controls.map((ctl) => ({ ...ctl, evidence: byControl.get(ctl.id) ?? [] }));

    // The grid: a control with no evidence still gets its row (an empty evidence
    // cell IS the finding an auditor is looking for).
    const rows = controlsWithEvidence.flatMap((ctl) => {
      const head = [ctl.controlRef, ctl.category, ctl.name, ctl.status, ctl.ownerId];
      return ctl.evidence.length === 0
        ? [[...head, null, null, null, null, null]]
        : ctl.evidence.map((e) => [...head, e.title, e.evidenceType, e.url, e.note, e.createdAt]);
    });

    return {
      filename: `soc2-evidence-${exportStamp(ctx.now)}`,
      title: 'SOC 2 evidence package',
      table: {
        columns: ['control_ref', 'category', 'control', 'status', 'owner', 'evidence_title', 'evidence_type', 'evidence_url', 'evidence_note', 'evidence_added_at'],
        rows,
      },
      json: {
        framework: 'SOC 2',
        exportedAt: new Date(ctx.now).toISOString(),
        tenantId,
        segmentId,
        controlCount: controlsWithEvidence.length,
        evidenceCount: evidence.length,
        controls: controlsWithEvidence,
      },
    };
  },
};
