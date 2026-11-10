/**
 * Scanner-report parsers — three input formats, ONE finding shape.
 *
 * A vulnerability scan is recorded by the generic tracker (`vulnerability_scans`);
 * what it FOUND arrives as a report in whatever format the scanner emits. This
 * module turns each supported format into `NormalizedFinding` — the platform's
 * own shape (`@builderforce/sarif`), which is also the row shape of
 * `vulnerability_findings` — so the writer (`application/security/vulnerabilityFindings.ts`)
 * has one insert path and the rollup (`kernel/rollups/governance.ts`) has one
 * severity vocabulary.
 *
 * Supported:
 *   - `normalized`  — an array of the platform shape (a CI step can post directly).
 *   - `sarif`       — SARIF 2.1, parsed by THE SARIF interchange (`@builderforce/sarif`
 *                     `sarifToFindings`, PRD 41 §C12), shared with the run delta.
 *   - `npm-audit`   — npm audit v7+ (`vulnerabilities` map keyed by package).
 *
 * Pure — no I/O, no clock — so every branch is unit-testable with a literal.
 * `findingFingerprint` is the identity the unique index enforces (migration
 * 1132): the same finding in a re-posted report hashes to the same value.
 */

import { normalizeSeverity, sarifToFindings, toNormalizedFinding, type NormalizedFinding } from '@builderforce/sarif';
import { sha256Hex } from '../shared/hash';

export type ScanReportFormat = 'normalized' | 'sarif' | 'npm-audit';
export const SCAN_REPORT_FORMATS: readonly ScanReportFormat[] = ['normalized', 'sarif', 'npm-audit'];
export const isScanReportFormat = (v: unknown): v is ScanReportFormat =>
  typeof v === 'string' && (SCAN_REPORT_FORMATS as readonly string[]).includes(v);

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The platform's own shape: an array (or `{ findings: [...] }`) of finding records. */
export function normalizedFindings(input: unknown): NormalizedFinding[] {
  const list: unknown[] = Array.isArray(input) ? input : isRec(input) && Array.isArray(input.findings) ? input.findings : [];
  const out: NormalizedFinding[] = [];
  for (const item of list) {
    if (!isRec(item)) continue;
    const f = toNormalizedFinding(item, normalizeSeverity(item.severity));
    if (f) out.push(f);
  }
  return out;
}

// ── npm audit (v7+) ────────────────────────────────────────────────────────────

/** npm audit v7+: the `vulnerabilities` map — one finding per package, its
 *  first advisory (`via[]` object) supplying title/URL/CWE. */
export function npmAuditToFindings(report: unknown): NormalizedFinding[] {
  if (!isRec(report) || !isRec(report.vulnerabilities)) return [];
  const out: NormalizedFinding[] = [];
  for (const [name, entry] of Object.entries(report.vulnerabilities)) {
    if (!isRec(entry)) continue;
    const advisory = Array.isArray(entry.via) ? entry.via.find(isRec) : undefined;
    const fix = entry.fixAvailable;
    const fixedVersion = isRec(fix) ? str(fix.version) : null;
    const cwe = advisory && Array.isArray(advisory.cwe) ? str(advisory.cwe[0]) : null;
    const url = advisory ? str(advisory.url) : null;
    const advisoryTitle = advisory ? str(advisory.title) : null;
    const packageName = str(entry.name) ?? name;
    const f = toNormalizedFinding({
      title: advisoryTitle ? `${packageName}: ${advisoryTitle}` : `${packageName}: vulnerable dependency`,
      ruleId: url ? `npm-advisory:${url.split('/').pop() ?? url}` : `npm-audit:${packageName}`,
      packageName,
      vulnerableVersion: str(entry.range),
      fixedVersion,
      cwe,
      cve: advisory ? cveFromAdvisory(advisory) : null,
      description: url,
      remediation: fixedVersion
        ? `Upgrade ${packageName} to ${fixedVersion}`
        : fix === true ? `Run npm audit fix to upgrade ${packageName}` : null,
    }, normalizeSeverity(entry.severity ?? (advisory ? advisory.severity : undefined)));
    if (f) out.push(f);
  }
  return out;
}

function cveFromAdvisory(advisory: Rec): string | null {
  const direct = str(advisory.cve);
  if (direct) return direct;
  const text = `${str(advisory.title) ?? ''} ${str(advisory.url) ?? ''}`;
  return /CVE-\d{4}-\d{4,}/i.exec(text)?.[0]?.toUpperCase() ?? null;
}

/** Dispatch on the declared format. */
export function parseScanReport(format: ScanReportFormat, report: unknown): NormalizedFinding[] {
  if (format === 'sarif') return sarifToFindings(report);
  if (format === 'npm-audit') return npmAuditToFindings(report);
  return normalizedFindings(report);
}

// ── Identity ───────────────────────────────────────────────────────────────────

const FINGERPRINT_LENGTH = 40;

/** Stable identity of a finding: sha-256 hex prefix of the lower-cased
 *  `ruleId|filePath|line|packageName|cve|title` tuple. Unique per scan (1132). */
export async function findingFingerprint(f: NormalizedFinding): Promise<string> {
  const tuple = [f.ruleId, f.filePath, f.line, f.packageName, f.cve, f.title]
    .map((v) => (v == null ? '' : String(v)))
    .join('|')
    .toLowerCase();
  return (await sha256Hex(tuple)).slice(0, FINGERPRINT_LENGTH);
}
