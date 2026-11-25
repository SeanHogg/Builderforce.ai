import { TEST_OR_FIXTURE, type Rule } from './rule.js';

/** High-signal insecure-code patterns: the always-available first pass, not a full SAST engine. */
export const SAST_RULES: readonly Rule[] = [
  {
    id: 'sast.eval', category: 'insecure-code', severity: 'HIGH', weight: 20, cwe: 'CWE-95', scope: 'line', paths: 'code',
    title: 'Dynamic code execution (eval / new Function)',
    pattern: /(?<![\w.$])eval\s*\(|new\s+Function\s*\(/,
    remediation: 'Replace dynamic evaluation with a parser or a lookup table.',
    skipPaths: TEST_OR_FIXTURE,
  },
  {
    id: 'sast.shell-injection', category: 'insecure-code', severity: 'HIGH', weight: 20, cwe: 'CWE-78', scope: 'line', paths: 'code',
    title: 'Shell command built from a template or concatenation',
    pattern: /\b(?:exec|execSync|spawnSync?)\s*\(\s*(?:`[^`]*\$\{|['"][^'"]*['"]\s*\+)/,
    remediation: 'Pass arguments as an array to execFile / spawn without a shell; never interpolate input.',
    skipPaths: TEST_OR_FIXTURE,
  },
  {
    id: 'sast.sql-concat', category: 'insecure-code', severity: 'HIGH', weight: 20, cwe: 'CWE-89', scope: 'line', paths: 'code',
    title: 'SQL built by string interpolation',
    pattern: /\b(?:query|execute|raw)\s*\(\s*`\s*(?:SELECT|INSERT|UPDATE|DELETE)\b[^`]*\$\{/i,
    remediation: 'Use parameterised queries or the query builder; never interpolate values into SQL.',
    skipPaths: TEST_OR_FIXTURE,
  },
  {
    id: 'sast.tls-verification-disabled', category: 'insecure-code', severity: 'HIGH', weight: 20, cwe: 'CWE-295', scope: 'line', paths: 'code',
    title: 'TLS certificate verification disabled',
    pattern: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/,
    remediation: 'Keep certificate verification on; trust a private CA explicitly if one is needed.',
    skipPaths: TEST_OR_FIXTURE,
  },
  {
    id: 'sast.unsafe-html', category: 'insecure-code', severity: 'MEDIUM', weight: 10, cwe: 'CWE-79', scope: 'line', paths: 'code',
    title: 'Unescaped HTML injection (innerHTML / dangerouslySetInnerHTML)',
    pattern: /\.innerHTML\s*=|dangerouslySetInnerHTML/,
    remediation: 'Render text, or sanitise the markup with a vetted sanitiser before injecting it.',
    skipPaths: TEST_OR_FIXTURE,
  },
  {
    id: 'sast.weak-hash', category: 'insecure-code', severity: 'MEDIUM', weight: 10, cwe: 'CWE-327', scope: 'line', paths: 'code',
    title: 'Weak hash (MD5 / SHA-1)',
    pattern: /createHash\(\s*['"](?:md5|sha1)['"]\s*\)/i,
    remediation: 'Use SHA-256 or stronger; use a password hash (argon2/bcrypt) for credentials.',
    skipPaths: TEST_OR_FIXTURE,
  },
];
