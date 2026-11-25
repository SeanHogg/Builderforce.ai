import type { FindingSeverity, ScanFinding, ThreatCategory } from './types.js';

export interface FindingInput {
  readonly ruleId: string;
  readonly category: ThreatCategory;
  readonly severity: FindingSeverity;
  readonly weight: number;
  readonly title: string;
  readonly remediation: string;
  readonly path: string;
  readonly line?: number;
  readonly cwe?: string;
  readonly attack?: string;
  readonly packageName?: string;
}

const MAX_PATH = 500;

/**
 * The one place a ScanFinding is built. The description carries the rule title and location only: the
 * matched text is never copied, because for a secret rule it IS the secret.
 */
export function buildFinding(input: FindingInput): ScanFinding {
  const where = input.line ? `${input.path}:${input.line}` : input.path;
  return {
    severity: input.severity,
    ruleId: input.ruleId,
    title: input.title,
    filePath: input.path.slice(0, MAX_PATH),
    line: input.line ?? null,
    packageName: input.packageName ?? null,
    vulnerableVersion: null,
    fixedVersion: null,
    cwe: input.cwe ?? null,
    cve: null,
    description: `${input.title} at ${where}.`,
    remediation: input.remediation,
    category: input.category,
    weight: input.weight,
    ...(input.attack ? { attack: input.attack } : {}),
  };
}
