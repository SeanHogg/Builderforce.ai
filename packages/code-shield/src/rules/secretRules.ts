import { SECRET_SHAPES, type SecretShape } from '@builderforce/secret-redaction';
import type { Rule } from './rule.js';

/**
 * Committed credentials. Never path-excluded: a credential is a credential wherever it sits.
 *
 * The recognisable-prefix rules are DERIVED from `SECRET_SHAPES` in `@builderforce/secret-redaction`, the ONE
 * secret detector: a new provider shape there is a new rule here with no edit to this file. Only the generic
 * `hardcoded-credential` assignment rule is code-shield's own (an assignment is not a prefix shape).
 */

/** Shapes whose rule id predates the derivation. Stored `ruleId`s (PR-gate findings) keep matching. */
const LEGACY_SHAPE_RULE_IDS: Readonly<Record<string, string>> = {
  'openai-key': 'secret.provider-api-key',
  'google-api-key': 'secret.provider-api-key',
  'stripe-key': 'secret.provider-api-key',
};

/** Shapes that are reported below CRITICAL: a chat/app token or a bare JWT is less often a deploy credential. */
const HIGH_SHAPES: ReadonlySet<string> = new Set([
  'slack-token', 'slack-rotating-token', 'slack-app-token', 'jwt', 'telegram-bot-url', 'telegram-bot-token', 'stripe-webhook-secret',
]);

const ATTACK_PRIVATE_KEY = 'T1552.004';
const ATTACK_CREDENTIALS = 'T1552.001';

/** The shape's regex without `g`/`y`: the engine calls `exec` per line, and a global regex carries `lastIndex` between calls. */
const stateless = (re: RegExp): RegExp => new RegExp(re.source, re.flags.replace(/[gy]/g, ''));

export function secretRuleFor(shape: SecretShape): Rule {
  const critical = !HIGH_SHAPES.has(shape.id);
  return {
    id: LEGACY_SHAPE_RULE_IDS[shape.id] ?? `secret.${shape.id}`,
    category: 'secret',
    severity: critical ? 'CRITICAL' : 'HIGH',
    weight: critical ? 50 : 30,
    cwe: 'CWE-798',
    attack: shape.id === 'private-key' ? ATTACK_PRIVATE_KEY : ATTACK_CREDENTIALS,
    scope: 'line',
    paths: 'secret',
    title: shape.id === 'private-key' ? 'Private key committed' : `${shape.label} committed`,
    pattern: stateless(shape.re),
    remediation: shape.id === 'private-key'
      ? 'Remove the key from the repository, rotate it, and load it from the secret store.'
      : 'Revoke and rotate the credential with its provider; never commit it, load it from the secret store.',
  };
}

const SHAPE_RULES: readonly Rule[] = SECRET_SHAPES.map(secretRuleFor);

export const SECRET_RULES: readonly Rule[] = [
  ...SHAPE_RULES,
  {
    id: 'secret.hardcoded-credential', category: 'secret', severity: 'HIGH', weight: 30, cwe: 'CWE-798', attack: 'T1552.001', scope: 'line', paths: 'secret',
    title: 'Hard-coded credential assignment',
    pattern: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*['"][^'"\s]{12,}['"]/i,
    remediation: 'Move the value to configuration / the secret store and reference it by name.',
    // A generic assignment in a test or fixture is usually a fake: reported, but as MEDIUM (informs, never holds a merge).
    testPathSeverity: 'MEDIUM',
  },
];
