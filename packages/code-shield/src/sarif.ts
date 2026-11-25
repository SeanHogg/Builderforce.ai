import { sarifLocation, sarifLog, type FindingSeverity, type SarifLevel, type SarifLog, type SarifReportingDescriptor, type SarifResult } from '@builderforce/sarif';
import type { ScanReport } from './types.js';

const LEVEL: Record<FindingSeverity, SarifLevel> = { CRITICAL: 'error', HIGH: 'error', MEDIUM: 'warning', LOW: 'note' };

/** The report as a SARIF 2.1.0 log. Incomplete files are listed in the run properties, never omitted silently. */
export function toSarif(report: ScanReport): SarifLog {
  const rules = new Map<string, SarifReportingDescriptor>();
  const results: SarifResult[] = [];
  for (const file of report.files) {
    for (const f of file.findings) {
      const ruleId = f.ruleId ?? 'code-shield.unknown';
      if (!rules.has(ruleId)) {
        rules.set(ruleId, { id: ruleId, shortDescription: { text: f.title }, properties: { category: f.category, ...(f.cwe ? { cwe: f.cwe } : {}), ...(f.attack ? { attack: f.attack } : {}) } });
      }
      results.push({
        ruleId, level: LEVEL[f.severity], message: { text: f.description ?? f.title },
        locations: [sarifLocation(file.path, f.line ?? undefined)],
        properties: { weight: f.weight, sha256: file.sha256 },
      });
    }
  }
  const incompleteFiles = report.files.filter((f) => !f.complete).map((f) => ({ path: f.path, reason: f.incompleteReason }));
  return sarifLog([{
    tool: { driver: { name: 'builderforce-code-shield', rules: [...rules.values()] } },
    results,
    properties: { complete: report.complete, score: report.score, action: report.action, incompleteFiles },
  }]);
}
