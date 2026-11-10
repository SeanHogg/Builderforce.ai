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
 * Findings use the platform's four severities (CRITICAL/HIGH/MEDIUM/LOW) so the merge gate and the
 * incident rule need no translation. A committed live credential is CRITICAL; a code pattern that is
 * only dangerous in context is MEDIUM (informs, never holds a merge).
 */
import { DEFAULT_SECRET_PATTERNS, redactText } from '@builderforce/secret-redaction';
import type { FindingSeverity, NormalizedFinding } from '@builderforce/sarif';

export type DiffScanKind = 'secret' | 'sast';

interface Rule {
  id: string;
  kind: DiffScanKind;
  severity: FindingSeverity;
  title: string;
  cwe: string;
  pattern: RegExp;
  remediation: string;
  /**
   * SAST rules only: skip files matching this (tests / fixtures legitimately contain unsafe samples).
   * SECRET rules are NEVER path-excluded - a committed credential is a credential wherever it sits -
   * so for them this field is ignored (see {@link scanFileContent}).
   */
  skipPaths?: RegExp;
  /** A SECRET rule too noisy to hold a merge in a test / fixture path reports at this severity THERE
   *  (still scanned, still recorded) instead of being skipped. */
  testPathSeverity?: FindingSeverity;
}

const TEST_OR_FIXTURE = /(^|\/)(__tests__|__mocks__|tests?|fixtures?|e2e|examples?)(\/|$)|\.(test|spec)\.[^.]+$|\.md$|\.mdx$/i;

export const DIFF_SCAN_RULES: readonly Rule[] = [
  {
    id: 'secret.private-key', kind: 'secret', severity: 'CRITICAL', cwe: 'CWE-798',
    title: 'Private key committed',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/,
    remediation: 'Remove the key from the repository, rotate it, and load it from the secret store.',
    skipPaths: TEST_OR_FIXTURE,
  },
  {
    id: 'secret.aws-access-key', kind: 'secret', severity: 'CRITICAL', cwe: 'CWE-798',
    title: 'AWS access key id committed',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
    remediation: 'Rotate the key in IAM and read credentials from the environment or a secret store.',
    skipPaths: TEST_OR_FIXTURE,
  },
  {
    id: 'secret.github-token', kind: 'secret', severity: 'CRITICAL', cwe: 'CWE-798',
    title: 'GitHub token committed',
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{50,}\b/,
    remediation: 'Revoke the token on GitHub and use the integration credential store.',
    skipPaths: TEST_OR_FIXTURE,
  },
  {
    id: 'secret.slack-token', kind: 'secret', severity: 'HIGH', cwe: 'CWE-798',
    title: 'Slack token committed',
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
    remediation: 'Revoke the token in Slack and store it as a secret.',
    skipPaths: TEST_OR_FIXTURE,
  },
  {
    id: 'secret.provider-api-key', kind: 'secret', severity: 'CRITICAL', cwe: 'CWE-798',
    title: 'Provider API key committed',
    pattern: /\b(?:sk-(?:live|proj|ant)-[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{35})\b/,
    remediation: 'Revoke and rotate the key with its provider; never commit it.',
    skipPaths: TEST_OR_FIXTURE,
  },
  {
    id: 'secret.hardcoded-credential', kind: 'secret', severity: 'HIGH', cwe: 'CWE-798',
    title: 'Hard-coded credential assignment',
    pattern: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*['"][^'"\s]{12,}['"]/i,
    remediation: 'Move the value to configuration / the secret store and reference it by name.',
    // A generic assignment pattern in a test or fixture is usually a fake: it is reported, but as MEDIUM
    // (informs, never holds a merge) there. The vendor-specific rules above keep their severity everywhere.
    testPathSeverity: 'MEDIUM',
  },
  {
    id: 'sast.eval', kind: 'sast', severity: 'HIGH', cwe: 'CWE-95',
    title: 'Dynamic code execution (eval / new Function)',
    pattern: /(?<![\w.$])eval\s*\(|new\s+Function\s*\(/,
    remediation: 'Replace dynamic evaluation with a parser or a lookup table.',
    skipPaths: TEST_OR_FIXTURE,
  },
  {
    id: 'sast.shell-injection', kind: 'sast', severity: 'HIGH', cwe: 'CWE-78',
    title: 'Shell command built from a template or concatenation',
    pattern: /\b(?:exec|execSync|spawnSync?)\s*\(\s*(?:`[^`]*\$\{|['"][^'"]*['"]\s*\+)/,
    remediation: 'Pass arguments as an array to execFile / spawn without a shell; never interpolate input.',
    skipPaths: TEST_OR_FIXTURE,
  },
  {
    id: 'sast.sql-concat', kind: 'sast', severity: 'HIGH', cwe: 'CWE-89',
    title: 'SQL built by string interpolation',
    pattern: /\b(?:query|execute|raw)\s*\(\s*`\s*(?:SELECT|INSERT|UPDATE|DELETE)\b[^`]*\$\{/i,
    remediation: 'Use parameterised queries or the query builder; never interpolate values into SQL.',
    skipPaths: TEST_OR_FIXTURE,
  },
  {
    id: 'sast.tls-verification-disabled', kind: 'sast', severity: 'HIGH', cwe: 'CWE-295',
    title: 'TLS certificate verification disabled',
    pattern: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/,
    remediation: 'Keep certificate verification on; trust a private CA explicitly if one is needed.',
    skipPaths: TEST_OR_FIXTURE,
  },
  {
    id: 'sast.unsafe-html', kind: 'sast', severity: 'MEDIUM', cwe: 'CWE-79',
    title: 'Unescaped HTML injection (innerHTML / dangerouslySetInnerHTML)',
    pattern: /\.innerHTML\s*=|dangerouslySetInnerHTML/,
    remediation: 'Render text, or sanitise the markup with a vetted sanitiser before injecting it.',
    skipPaths: TEST_OR_FIXTURE,
  },
  {
    id: 'sast.weak-hash', kind: 'sast', severity: 'MEDIUM', cwe: 'CWE-327',
    title: 'Weak hash (MD5 / SHA-1)',
    pattern: /createHash\(\s*['"](?:md5|sha1)['"]\s*\)/i,
    remediation: 'Use SHA-256 or stronger; use a password hash (argon2/bcrypt) for credentials.',
    skipPaths: TEST_OR_FIXTURE,
  },
];

const norm = (path: string): string => path.replace(/\\/g, '/');

/** Pure binary assets: reading them as text means nothing, for ANY rule kind. */
export function isBinaryAssetPath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|ico|avif|mp[34]|wav|ogg|woff2?|ttf|otf|pdf|zip|gz|wasm|map)$/i.test(norm(path));
}

/**
 * Executable code the SAST rules and the reviewer DO NOT read - minified bundles, and scripts under
 * vendored / generated trees (`dist`, `build`, `vendor`, `node_modules`, `.next`) - plus WebAssembly.
 * They can still run, so a change that touches one has not been fully scanned: the scan is recorded
 * TRUNCATED with the reason "excluded executable path", the gate blocks, and a manager's override is
 * the way through. (Images, fonts and lockfiles are not executable and are excluded quietly.)
 */
export function isExcludedExecutablePath(path: string): boolean {
  const p = norm(path);
  if (/\.wasm$/i.test(p)) return true;
  if (/\.min\.js$/i.test(p)) return true;
  return /\.(?:m?js|cjs)$/i.test(p) && /(^|\/)(node_modules|dist|build|\.next|vendor)\//.test(p);
}

/** Lockfiles: machine-generated, hundreds of KB, and covered by the SCA scan (OSV), not by text rules. */
export const isLockfilePath = (path: string): boolean => /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/.test(norm(path));

/**
 * What the SECRET rules read: every changed file except pure binary assets and lockfiles - minified and
 * vendored files INCLUDED (a credential committed into a bundle is still committed).
 */
export function isSecretScannablePath(path: string): boolean {
  return !isBinaryAssetPath(path) && !isLockfilePath(path);
}

/** What the SAST rules and the reviewer read: not binary, not an excluded executable, not a vendored tree or a lockfile. */
export function isScannablePath(path: string): boolean {
  const p = norm(path);
  if (isBinaryAssetPath(p) || isExcludedExecutablePath(p)) return false;
  if (/(^|\/)(node_modules|dist|build|\.next|vendor|coverage)\//.test(p)) return false;
  return !isLockfilePath(p);
}

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
  const out: NormalizedFinding[] = [];
  const lines = content.split('\n');
  for (const rule of DIFF_SCAN_RULES) {
    if (!kinds.includes(rule.kind)) continue;
    // SECRET rules read every changed file (minified and vendored included); SAST reads only code worth reading.
    if (rule.kind === 'secret' ? !isSecretScannablePath(path) : !isScannablePath(path) || rule.skipPaths?.test(path)) continue;
    const severity = rule.kind === 'secret' && rule.testPathSeverity && TEST_OR_FIXTURE.test(path) ? rule.testPathSeverity : rule.severity;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // A minified file is ONE huge line: a secret in it must still be found, so the per-line cap that keeps
      // SAST regexes cheap does not apply to SECRET rules (a very large line is still bounded).
      if (line.length > (rule.kind === 'secret' ? 500_000 : 2_000) || !rule.pattern.test(line)) continue;
      out.push({
        severity, ruleId: rule.id, title: rule.title, filePath: path.slice(0, 500), line: i + 1,
        packageName: null, vulnerableVersion: null, fixedVersion: null, cwe: rule.cwe, cve: null,
        // The matching line is NOT copied into the description: for a secret rule it IS the secret.
        description: `${rule.title} at ${path}:${i + 1}.`,
        remediation: rule.remediation,
      });
    }
  }
  return out;
}
