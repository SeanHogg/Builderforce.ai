/**
 * Dependency-light source-quality policy for the shell-less cloud coding agent.
 *
 * This does not pretend to replace the project type-check. It catches deterministic,
 * high-signal mistakes in files the agent just wrote before a PR is opened, without
 * requiring node_modules or bundling the TypeScript compiler into the Worker.
 *
 * Every rule must be scoped to changed files, source-only, actionable, and low
 * false-positive because a finding blocks the agent's `finish`.
 */

export interface SourceQualityFinding {
  ruleId: string;
  line: number;
  message: string;
}

const TS_SOURCE = /\.[cm]?[jt]sx?$/i;

/**
 * Conditional JSX expressions do not reliably preserve contextual typing across
 * package declaration / React component boundaries. Require explicit typing here:
 *
 *   onSetVisibility={isOwner ? async (v) => ... : undefined}
 *
 * Ordinary contextually typed callbacks (`rows.map((row) => ...)`) are deliberately
 * outside this rule.
 */
const CONDITIONAL_JSX_CALLBACK =
  /\b(on[A-Z][A-Za-z0-9_$]*)\s*=\s*\{[^{}]{0,300}\?\s*(?:async\s*)?\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)\s*=>/g;

function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i += 1) if (source.charCodeAt(i) === 10) line += 1;
  return line;
}

export function inspectAgentSource(path: string, source: string): SourceQualityFinding[] {
  if (!TS_SOURCE.test(path)) return [];
  const findings: SourceQualityFinding[] = [];
  for (const match of source.matchAll(CONDITIONAL_JSX_CALLBACK)) {
    const prop = match[1]!;
    const parameter = match[2]!;
    findings.push({
      ruleId: 'typescript/explicit-conditional-jsx-callback',
      line: lineAt(source, match.index ?? 0),
      message:
        `Parameter '${parameter}' in conditional JSX callback '${prop}' needs an explicit type. `
        + 'Prefer a named callback typed from the component prop contract (for example, '
        + "`NonNullable<Props['onChange']>`) so API changes are checked at the boundary.",
    });
  }
  return findings;
}

