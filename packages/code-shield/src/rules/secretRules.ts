import type { Rule } from './rule.js';

/** Committed credentials. Never path-excluded: a credential is a credential wherever it sits. */
export const SECRET_RULES: readonly Rule[] = [
  {
    id: 'secret.private-key', category: 'secret', severity: 'CRITICAL', weight: 50, cwe: 'CWE-798', attack: 'T1552.004', scope: 'line', paths: 'secret',
    title: 'Private key committed',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/,
    remediation: 'Remove the key from the repository, rotate it, and load it from the secret store.',
  },
  {
    id: 'secret.aws-access-key', category: 'secret', severity: 'CRITICAL', weight: 50, cwe: 'CWE-798', attack: 'T1552.001', scope: 'line', paths: 'secret',
    title: 'AWS access key id committed',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
    remediation: 'Rotate the key in IAM and read credentials from the environment or a secret store.',
  },
  {
    id: 'secret.github-token', category: 'secret', severity: 'CRITICAL', weight: 50, cwe: 'CWE-798', attack: 'T1552.001', scope: 'line', paths: 'secret',
    title: 'GitHub token committed',
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{50,}\b/,
    remediation: 'Revoke the token on GitHub and use the integration credential store.',
  },
  {
    id: 'secret.slack-token', category: 'secret', severity: 'HIGH', weight: 30, cwe: 'CWE-798', attack: 'T1552.001', scope: 'line', paths: 'secret',
    title: 'Slack token committed',
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
    remediation: 'Revoke the token in Slack and store it as a secret.',
  },
  {
    id: 'secret.provider-api-key', category: 'secret', severity: 'CRITICAL', weight: 50, cwe: 'CWE-798', attack: 'T1552.001', scope: 'line', paths: 'secret',
    title: 'Provider API key committed',
    pattern: /\b(?:sk-(?:live|proj|ant)-[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{35})\b/,
    remediation: 'Revoke and rotate the key with its provider; never commit it.',
  },
  {
    id: 'secret.hardcoded-credential', category: 'secret', severity: 'HIGH', weight: 30, cwe: 'CWE-798', attack: 'T1552.001', scope: 'line', paths: 'secret',
    title: 'Hard-coded credential assignment',
    pattern: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*['"][^'"\s]{12,}['"]/i,
    remediation: 'Move the value to configuration / the secret store and reference it by name.',
    // A generic assignment in a test or fixture is usually a fake: reported, but as MEDIUM (informs, never holds a merge).
    testPathSeverity: 'MEDIUM',
  },
];
