/**
 * diffScanRules — the deterministic secret + static-analysis rules run over a pull request's
 * changed files (PRD 08 §10 "SAST + SCA + secret scan").
 *
 * PURE: `(path, content) → NormalizedFinding[]`. The rules are deliberately few and HIGH-SIGNAL —
 * this is the always-available first pass that runs wherever the platform can read the branch
 * (the Worker, through the provider API). It does not pretend to be a full SAST engine; a
 * SARIF report from CodeQL / Semgrep ingests through the same `vulnerability_findings` writer
 * (`vulnerabilityFindings.ingestScanFindings`) and the same gate.
 *
 * The rules and path filters live ONCE, in `@builderforce/code-shield` (shared with the WebContainers
 * Shield, the Visualizer and the skill installer); this file is the PR gate's adapter.
 *
 * Findings use the platform's four severities (CRITICAL/HIGH/MEDIUM/LOW) so the merge gate and the
 * incident rule need no translation. A committed live credential is CRITICAL; a code pattern that is
 * only dangerous in context is MEDIUM (informs, never holds a merge).
 */
import { DEFAULT_SECRET_PATTERNS, redactText } from '@builderforce/secret-redaction';
import type { NormalizedFinding } from '@builderforce/sarif';
import { SAST_RULES, SECRET_RULES, scanText, type Rule, type ThreatCategory } from '@builderforce/code-shield';

export {
  isBinaryAssetPath, isExcludedExecutablePath, isLockfilePath, isScannablePath, isSecretScannablePath,
} from '@builderforce/code-shield';

export type DiffScanKind = 'secret' | 'sast';

export const DIFF_SCAN_RULES: readonly Rule[] = [...SECRET_RULES, ...SAST_RULES];

const CATEGORY_OF_KIND: Record<DiffScanKind, ThreatCategory> = { secret: 'secret', sast: 'insecure-code' };

/**
 * Replace every span a SECRET rule matches with `[REDACTED:<rule id>]`. Applied to anything that leaves
 * for a third party (the review model's prompt) or is stored from its answer, regardless of the file's
 * path: a credential in a test fixture is still a credential. PURE.
 */
export function redactSecrets(text: string): string {
  // The patterns are the shared set (`@builderforce/secret-redaction`), a superset of this file's secret rules; only the label is ours.
  return redactText(text, DEFAULT_SECRET_PATTERNS, 'strict', (id) => `[REDACTED:secret.${id}]`);
}

/** Run the rules of the given kinds over one file's content. One finding per rule per line. */
export function scanFileContent(path: string, content: string, kinds: readonly DiffScanKind[]): NormalizedFinding[] {
  return scanText({ path, content }, 'pr-diff', kinds.map((k) => CATEGORY_OF_KIND[k])).map(
    ({ severity, ruleId, title, filePath, line, packageName, vulnerableVersion, fixedVersion, cwe, cve, description, remediation }) => ({
      severity, ruleId, title, filePath, line, packageName, vulnerableVersion, fixedVersion, cwe, cve, description, remediation,
    }),
  );
}
