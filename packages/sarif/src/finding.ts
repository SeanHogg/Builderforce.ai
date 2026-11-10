/**
 * The platform's ONE scanner-finding shape — what every scanner report (SARIF, npm audit, the
 * platform's own array) is normalized to, and the row shape of the api's `vulnerability_findings`.
 * Moved here from `api/src/domain/security/scanReportParsers.ts` (PRD 41 §C12) so the api, the run
 * delta and the analyzer adapters read one vocabulary. Pure.
 */

export const FINDING_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export interface NormalizedFinding {
  severity: FindingSeverity;
  ruleId: string | null;
  title: string;
  filePath: string | null;
  line: number | null;
  packageName: string | null;
  vulnerableVersion: string | null;
  fixedVersion: string | null;
  cwe: string | null;
  cve: string | null;
  description: string | null;
  remediation: string | null;
}

export type Rec = Record<string, unknown>;
export const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
export const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);
const clip = (v: string | null, max: number): string | null => (v == null ? null : v.slice(0, max));

/** Fold any scanner's severity word onto the platform's four. Unknown → MEDIUM
 *  (a finding of unknown weight is still a finding; dropping it would hide it). */
export function normalizeSeverity(raw: unknown): FindingSeverity {
  const s = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (s === 'CRITICAL' || s === 'BLOCKER') return 'CRITICAL';
  if (s === 'HIGH' || s === 'ERROR' || s === 'MAJOR') return 'HIGH';
  if (s === 'MEDIUM' || s === 'MODERATE' || s === 'WARNING' || s === 'WARN' || s === 'MINOR') return 'MEDIUM';
  if (s === 'LOW' || s === 'NOTE' || s === 'INFO' || s === 'INFORMATIONAL' || s === 'NONE') return 'LOW';
  return 'MEDIUM';
}

/** Coerce one loosely-shaped record onto the finding shape; null when it has no title. */
export function toNormalizedFinding(r: Rec, severity: FindingSeverity): NormalizedFinding | null {
  const title = clip(str(r.title) ?? str(r.message) ?? str(r.name), 255);
  if (!title) return null;
  return {
    severity,
    ruleId: clip(str(r.ruleId), 120),
    title,
    filePath: clip(str(r.filePath), 500),
    line: int(r.line),
    packageName: clip(str(r.packageName), 255),
    vulnerableVersion: clip(str(r.vulnerableVersion), 64),
    fixedVersion: clip(str(r.fixedVersion), 64),
    cwe: clip(str(r.cwe), 40),
    cve: clip(str(r.cve), 40),
    description: str(r.description),
    remediation: str(r.remediation),
  };
}
