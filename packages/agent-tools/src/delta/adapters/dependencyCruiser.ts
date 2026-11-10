/**
 * delta/adapters/dependencyCruiser.ts — the L3 cross-check of the B5 graph rules (PRD 41 §B7, §C7 modularity) from
 * the bundled dependency-cruiser, on one side's tree, with the analysis's own configuration
 * (`dependencyCruiserConfig`: the exclusions plus the layer registry's `forbidden` rules, read from the BEFORE side).
 *
 *  - `dependency-cycle`: one per distinct cycle, anchored on the hash of its sorted member set (never on one member, which
 *    a new file sorting first would move); a cycle that gains or loses a file matches by member overlap (memory lineage
 *    rule 3) and reads `changed`;
 *  - `forbidden-dependency`: one per violated `forbidden` rule edge, anchored on `<rule>@<from>→<to>`, at the rule's
 *    own severity.
 */

import { hashText } from '@seanhogg/builderforce-memory/ingest';
import { composeAnchor } from '@seanhogg/builderforce-memory/knowledge';
import { dependencyCruiserConfig } from '../../codeAnalysisTool.js';
import { ignoredRegex, okResult, relPath, type AnalyzerRunFinding, type DeltaAnalyzer } from './analyzer.js';
import { isRunResult, runBundled } from './bundledTool.js';

export const DEPENDENCY_CRUISER_TOOL = 'dependency-cruiser';

type Dep = { resolved?: unknown; circular?: unknown; cycle?: unknown };
type Mod = { source?: unknown; dependencies?: Dep[] };
type Violation = { from?: unknown; to?: unknown; type?: unknown; rule?: { name?: unknown; severity?: unknown } };

const SEVERITY: Readonly<Record<string, AnalyzerRunFinding['severity']>> = { error: 'error', warn: 'warn', info: 'info' };

const cycleNames = (cycle: unknown): string[] =>
  Array.isArray(cycle) ? cycle.map((c) => (typeof c === 'string' ? c : (c as { name?: unknown })?.name)).filter((n): n is string => typeof n === 'string') : [];

/** dependency-cruiser's JSON report → findings (pure). */
export function dependencyCruiserFindings(report: unknown, dir: string, side: 'before' | 'after'): AnalyzerRunFinding[] {
  const r = (report ?? {}) as { modules?: Mod[]; summary?: { violations?: Violation[] } };
  const out = new Map<string, AnalyzerRunFinding>();
  for (const m of Array.isArray(r.modules) ? r.modules : []) {
    if (typeof m.source !== 'string') continue;
    for (const d of m.dependencies ?? []) {
      if (!d.circular) continue;
      const names = cycleNames(d.cycle);
      const members = [...new Set([m.source, ...(names.length > 0 ? names : typeof d.resolved === 'string' ? [d.resolved] : [])].map((p) => relPath(dir, p)))].sort();
      if (members.length < 2) continue;
      const id = `dependency-cycle:${members.join('|')}`;
      if (out.has(id)) continue;
      out.set(id, {
        kind: 'dependency-cycle',
        identity: { id, anchor: composeAnchor('dependency-cycle', 1, 'group', `cycle:${hashText(members.join('\n'))}`), anchorKind: 'group', members },
        severity: 'warn', confidence: 'measured', params: { members: members.length },
        evidence: members.map((path) => ({ side, path })),
      });
    }
  }
  for (const v of r.summary?.violations ?? []) {
    if (v.type === 'cycle' || typeof v.from !== 'string' || typeof v.to !== 'string') continue;
    const from = relPath(dir, v.from), to = relPath(dir, v.to);
    const rule = typeof v.rule?.name === 'string' ? v.rule.name : 'forbidden';
    const id = `forbidden-dependency:${rule}:${from}->${to}`;
    out.set(id, {
      kind: 'forbidden-dependency',
      identity: { id, anchor: composeAnchor('forbidden-dependency', 1, 'file', `${rule}@${from}->${to}`), anchorKind: 'file', members: [from, to].sort() },
      severity: SEVERITY[String(v.rule?.severity)] ?? 'warn', confidence: 'measured', params: { rule, from, to },
      evidence: [{ side, path: from, note: rule }],
    });
  }
  return [...out.values()];
}

export const dependencyCruiserAnalyzer: DeltaAnalyzer = {
  tool: DEPENDENCY_CRUISER_TOOL,
  inputs: ['package.json', 'tsconfig.json', 'jsconfig.json', '.dependency-cruiser.js', '.dependency-cruiser.cjs', '.dependency-cruiser.json'],
  async run(side, exec, signal) {
    // The analysis's own configuration with the layer registry's rules (read from the BEFORE side by the host), plus the
    // folders git ignores in the after tree, so both sides measure one file universe.
    const config = dependencyCruiserConfig(side.partitions);
    const ignored = ignoredRegex(side.ignored);
    if (ignored) {
      const options = (config.options ?? {}) as { exclude?: { path?: string } };
      const base = options.exclude?.path;
      config.options = { ...options, exclude: { ...(options.exclude ?? {}), path: base ? `${base}|${ignored}` : ignored } };
    }
    const r = await runBundled('dependency-cruiser', side, exec, signal, {
      prepare: (scratch) => exec.writeText(`${scratch}/dependencies.json`, JSON.stringify(config)),
    });
    if (isRunResult(r)) return r;
    if (!Array.isArray(r.report.modules)) return { tool: DEPENDENCY_CRUISER_TOOL, version: r.version, status: 'failed', reason: 'invalid-report', findings: [] };
    return { ...okResult(DEPENDENCY_CRUISER_TOOL, r.version, dependencyCruiserFindings(r.report, side.dir, side.side)), raw: r.report };
  },
};
