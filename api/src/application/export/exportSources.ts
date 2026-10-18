/**
 * THE registry of export sources — every tabular download the api offers.
 *
 * Open/closed: a new download is a source declared in its own domain module and
 * one entry here. Nothing in the renderer, the generic route or the historical
 * adapters changes. `GET /api/exports/sources` lists these (filtered to what the
 * caller may pull), `GET /api/exports/sources/:id` serves one.
 *
 * NOT here, deliberately (they share `downloadResponse`, not this contract):
 * single-document downloads whose bytes are the artefact itself rather than rows
 * — the Office renders (`/api/exports/docx|pdf|pptx|xlsx`), a generated deck, an
 * invoice PDF, a workflow definition's YAML, an Evermind model's weights, a
 * canvas session's JSON document. Each is one entity behind its own access rule
 * (a share token, an invoice token, session membership), not a filtered table.
 */
import type { ExportSource } from './exportSource';
import { evidencePackExportSource, capitalizationExportSource, insightDatasetExportSource } from '../insights/insightsExportSources';
import { memberMetricsExportSource } from '../metrics/memberMetricsExport';
import { auditReportExportSource } from '../finops/auditReportExport';
import { taxYearExportSource } from '../finance/taxReportExport';
import { capexOpexExportSource } from '../pmo/capexOpexExport';
import { adminAuditLogExportSource, permissionMatrixExportSource } from '../admin/adminExportSources';
import { soc2EvidenceExportSource } from '../governance/soc2EvidenceExport';

const SOURCES: readonly ExportSource[] = [
  evidencePackExportSource,
  capitalizationExportSource,
  insightDatasetExportSource,
  memberMetricsExportSource,
  auditReportExportSource,
  taxYearExportSource,
  capexOpexExportSource,
  soc2EvidenceExportSource,
  adminAuditLogExportSource,
  permissionMatrixExportSource,
];

const BY_ID = new Map(SOURCES.map((s) => [s.id, s]));

export function getExportSource(id: string): ExportSource | undefined {
  return BY_ID.get(id);
}

export function listExportSources(): readonly ExportSource[] {
  return SOURCES;
}
