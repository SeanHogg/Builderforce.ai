/**
 * SARIF 2.1 import — every `runs[].results[]`, enriched from `tool.driver.rules[]`.
 *
 * Level → severity: error=HIGH, warning=MEDIUM, note/none=LOW; a `security-severity` property on the
 * rule (CodeQL, Semgrep) promotes by its CVSS-style score. Two reads over the same walk:
 *  - {@link sarifToFindings}: the platform's {@link NormalizedFinding} (the vulnerability-findings rows);
 *  - {@link readSarifResults}: the same finding plus what a run delta needs to keep — the producing tool
 *    and version, the raw level, `baselineState`, `partialFingerprints` and the region snippet — so an
 *    exported delta round-trips and an external tool's results map into delta findings.
 */

import { isRec, normalizeSeverity, str, toNormalizedFinding, type FindingSeverity, type NormalizedFinding, type Rec } from './finding.js';
import { SARIF_BASELINE_STATES, type SarifBaselineState, type SarifLevel } from './emit.js';

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

/** One SARIF result as read: the normalized finding plus the interchange fields a run delta keeps. */
export interface SarifResultRecord extends NormalizedFinding {
  /** `tool.driver.name`; `unknown` when the log names none. */
  tool: string;
  toolVersion: string | null;
  /** The result's own `level`, when it is one of the four SARIF levels. */
  level: SarifLevel | null;
  baselineState: SarifBaselineState | null;
  /** `partialFingerprints`, string values only (e.g. `anchor/v1`). */
  partialFingerprints: Record<string, string>;
  /** `region.snippet.text` of the first location, when present. */
  snippet: string | null;
  /** The result's `properties` bag, as written. */
  properties: Rec;
}

const LEVELS: ReadonlySet<string> = new Set(['none', 'note', 'warning', 'error']);
const BASELINE: ReadonlySet<string> = new Set(SARIF_BASELINE_STATES);

function fingerprints(raw: unknown): Record<string, string> {
  if (!isRec(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) if (typeof value === 'string') out[key] = value;
  return out;
}

/** Every result of every run, in log order. Results with no title (no message, rule text or id) are skipped. */
export function readSarifResults(sarif: unknown): SarifResultRecord[] {
  if (!isRec(sarif) || !Array.isArray(sarif.runs)) return [];
  const out: SarifResultRecord[] = [];
  for (const run of sarif.runs) {
    if (!isRec(run)) continue;
    const driver = isRec(run.tool) ? run.tool.driver : null;
    const rules = sarifRules(driver);
    if (!Array.isArray(run.results)) continue;
    const tool = (isRec(driver) ? str(driver.name) : null) ?? 'unknown';
    const toolVersion = isRec(driver) ? str(driver.version) ?? str(driver.semanticVersion) : null;
    for (const result of run.results) {
      if (!isRec(result)) continue;
      const ruleId = str(result.ruleId);
      const rule = ruleId ? rules.get(ruleId) : undefined;
      const message = str(isRec(result.message) ? result.message.text : null);
      const location = Array.isArray(result.locations) && isRec(result.locations[0]) ? result.locations[0] : null;
      const physical = location && isRec(location.physicalLocation) ? location.physicalLocation : null;
      const artifact = physical && isRec(physical.artifactLocation) ? physical.artifactLocation : null;
      const region = physical && isRec(physical.region) ? physical.region : null;
      const f = toNormalizedFinding({
        title: message ?? rule?.description ?? ruleId,
        ruleId,
        filePath: artifact ? str(artifact.uri) : null,
        line: region ? region.startLine : null,
        cwe: rule?.cwe ?? null,
        description: rule?.description ?? null,
        remediation: rule?.help ?? null,
      }, sarifSeverity(result.level, rule));
      if (!f) continue;
      const level = typeof result.level === 'string' && LEVELS.has(result.level) ? (result.level as SarifLevel) : null;
      const baselineState = typeof result.baselineState === 'string' && BASELINE.has(result.baselineState)
        ? (result.baselineState as SarifBaselineState)
        : null;
      const snippet = region && isRec(region.snippet) && typeof region.snippet.text === 'string' ? region.snippet.text : null;
      out.push({
        ...f,
        tool,
        toolVersion,
        level,
        baselineState,
        partialFingerprints: fingerprints(result.partialFingerprints),
        snippet,
        properties: isRec(result.properties) ? result.properties : {},
      });
    }
  }
  return out;
}

/** SARIF 2.1 → the platform's finding rows. */
export function sarifToFindings(sarif: unknown): NormalizedFinding[] {
  return readSarifResults(sarif).map((r): NormalizedFinding => ({
    severity: r.severity,
    ruleId: r.ruleId,
    title: r.title,
    filePath: r.filePath,
    line: r.line,
    packageName: r.packageName,
    vulnerableVersion: r.vulnerableVersion,
    fixedVersion: r.fixedVersion,
    cwe: r.cwe,
    cve: r.cve,
    description: r.description,
    remediation: r.remediation,
  }));
}
