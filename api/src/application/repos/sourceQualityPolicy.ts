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

/** Blank comments and string/template literals while preserving offsets/newlines.
 * Policy rules inspect executable source, never examples in docs, tests, or comments. */
function maskNonCode(source: string): string {
  const chars = [...source];
  type State = 'code' | 'single' | 'double' | 'template' | 'line-comment' | 'block-comment';
  let state: State = 'code';
  for (let i = 0; i < chars.length; i += 1) {
    const c = chars[i]!;
    const next = chars[i + 1];
    if (state === 'code') {
      if (c === '/' && next === '/') { chars[i] = chars[i + 1] = ' '; state = 'line-comment'; i += 1; }
      else if (c === '/' && next === '*') { chars[i] = chars[i + 1] = ' '; state = 'block-comment'; i += 1; }
      else if (c === "'") { chars[i] = ' '; state = 'single'; }
      else if (c === '"') { chars[i] = ' '; state = 'double'; }
      else if (c === '`') { chars[i] = ' '; state = 'template'; }
      continue;
    }
    if (c === '\n' && state === 'line-comment') { state = 'code'; continue; }
    if (c === '\n') continue;
    const escaped = i > 0 && source[i - 1] === '\\';
    if (state === 'block-comment' && c === '*' && next === '/') {
      chars[i] = chars[i + 1] = ' '; state = 'code'; i += 1; continue;
    }
    chars[i] = ' ';
    if (!escaped && (
      (state === 'single' && c === "'")
      || (state === 'double' && c === '"')
      || (state === 'template' && c === '`')
    )) state = 'code';
  }
  return chars.join('');
}

export function inspectAgentSource(path: string, source: string): SourceQualityFinding[] {
  if (!TS_SOURCE.test(path)) return [];
  const findings: SourceQualityFinding[] = [];
  for (const match of maskNonCode(source).matchAll(CONDITIONAL_JSX_CALLBACK)) {
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
