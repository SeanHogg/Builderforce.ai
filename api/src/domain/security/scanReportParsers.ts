/**
 * Scanner-report parsers — three input formats, ONE finding shape.
 *
 * A vulnerability scan is recorded by the generic tracker (`vulnerability_scans`);
 * what it FOUND arrives as a report in whatever format the scanner emits. This
 * module turns each supported format into `NormalizedFinding` — the platform's
 * own shape, which is also the row shape of `vulnerability_findings` — so the
 * writer (`application/security/vulnerabilityFindings.ts`) has one insert path
 * and the rollup (`kernel/rollups/governance.ts`) has one severity vocabulary.
 *
 * Supported:
 *   - `normalized`  — an array of the platform shape (a CI step can post directly).
 *   - `sarif`       — SARIF 2.1 (`runs[].results[]`, rule metadata from
 *                     `tool.driver.rules[]`). Level → severity: error=HIGH,
 *                     warning=MEDIUM, note/none=LOW; a `security-severity`
 *                     property on the rule (CodeQL, Semgrep) promotes to CRITICAL.
 *   - `npm-audit`   — npm audit v7+ (`vulnerabilities` map keyed by package).
 *
 * Pure — no I/O, no clock — so every branch is unit-testable with a literal.
 * `findingFingerprint` is the identity the unique index enforces (migration
 * 1132): the same finding in a re-posted report hashes to the same value.
 */

import { sha256Hex } from '../shared/hash';

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

export type ScanReportFormat = 'normalized' | 'sarif' | 'npm-audit';
export const SCAN_REPORT_FORMATS: readonly ScanReportFormat[] = ['normalized', 'sarif', 'npm-audit'];
export const isScanReportFormat = (v: unknown): v is ScanReportFormat =>
  typeof v === 'string' && (SCAN_REPORT_FORMATS as readonly string[]).includes(v);

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
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
function toFinding(r: Rec, severity: FindingSeverity): NormalizedFinding | null {
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

/** The platform's own shape: an array (or `{ findings: [...] }`) of finding records. */
export function normalizedFindings(input: unknown): NormalizedFinding[] {
  const list: unknown[] = Array.isArray(input) ? input : isRec(input) && Array.isArray(input.findings) ? input.findings : [];
  const out: NormalizedFinding[] = [];
  for (const item of list) {
    if (!isRec(item)) continue;
    const f = toFinding(item, normalizeSeverity(item.severity));
    if (f) out.push(f);
  }
  return out;
}

// ── SARIF 2.1 ──────────────────────────────────────────────────────────────────

interface SarifRule { id: string; cwe: string | null; description: string | null; help: string | null; securitySeverity: number | null }

function sarifRules(driver: unknown): Map<string, SarifRule> {
  const map = new Map<string, SarifRule>();
  if (!isRec(driver) || !Array.isArray(driver.rules)) return map;
  for (const rule of driver.rules) {
    if (!isRec(rule)) continue;
    const id = str(rule.id);
    if (!id) continue;
    const props = isRec(rule.properties) ? rule.properties : {};
    const tags = Array.isArray(props.tags) ? props.tags.filter((t): t is string => typeof t === 'string') : [];
    // CodeQL/Semgrep tag CWEs as `external/cwe/cwe-079`; some tools put it in `cwe`.
    const cweTag = tags.map((t) => /cwe-?(\d+)/i.exec(t)?.[1]).find((m): m is string => Boolean(m));
    const sev = Number(props['security-severity']);
    map.set(id, {
      id,
      cwe: str(props.cwe) ?? (cweTag ? `CWE-${cweTag}` : null),
      description: str(isRec(rule.fullDescription) ? rule.fullDescription.text : null) ?? str(isRec(rule.shortDescription) ? rule.shortDescription.text : null),
      help: str(isRec(rule.help) ? rule.help.text ?? rule.help.markdown : null),
      securitySeverity: Number.isFinite(sev) ? sev : null,
    });
  }
  return map;
}

/** SARIF `level` → severity, promoted by the rule's CVSS-style `security-severity` when present. */
function sarifSeverity(level: unknown, rule: SarifRule | undefined): FindingSeverity {
  const score = rule?.securitySeverity;
  if (score != null) {
    if (score >= 9) return 'CRITICAL';
    if (score >= 7) return 'HIGH';
    if (score >= 4) return 'MEDIUM';
    return 'LOW';
  }
  return normalizeSeverity(level ?? 'warning');
}

/** SARIF 2.1: every `runs[].results[]`, enriched from `tool.driver.rules`. */
export function sarifToFindings(sarif: unknown): NormalizedFinding[] {
  if (!isRec(sarif) || !Array.isArray(sarif.runs)) return [];
  const out: NormalizedFinding[] = [];
  for (const run of sarif.runs) {
    if (!isRec(run)) continue;
    const rules = sarifRules(isRec(run.tool) ? run.tool.driver : null);
    if (!Array.isArray(run.results)) continue;
    for (const result of run.results) {
      if (!isRec(result)) continue;
      const ruleId = str(result.ruleId);
      const rule = ruleId ? rules.get(ruleId) : undefined;
      const message = str(isRec(result.message) ? result.message.text : null);
      const location = Array.isArray(result.locations) && isRec(result.locations[0]) ? result.locations[0] : null;
      const physical = location && isRec(location.physicalLocation) ? location.physicalLocation : null;
      const artifact = physical && isRec(physical.artifactLocation) ? physical.artifactLocation : null;
      const region = physical && isRec(physical.region) ? physical.region : null;
      const f = toFinding({
        title: message ?? rule?.description ?? ruleId,
        ruleId,
        filePath: artifact ? str(artifact.uri) : null,
        line: region ? region.startLine : null,
        cwe: rule?.cwe ?? null,
        description: rule?.description ?? null,
        remediation: rule?.help ?? null,
      }, sarifSeverity(result.level, rule));
      if (f) out.push(f);
    }
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
    const f = toFinding({
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
