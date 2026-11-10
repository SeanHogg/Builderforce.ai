/**
 * delta/adapters/jscpd.ts — clone groups (PRD 41 §C7 reusability) from the bundled jscpd, on one side's tree.
 *
 * jscpd reports PAIRS. Pairs sharing one normalized fragment (memory `anchorWithSnippet`, the same snippet hash the
 * analysis issues use) are one `clone-group`: anchored on that fragment hash, its members the sorted files holding a
 * copy. A third copy added by the run keeps the anchor and adds a member, so memory's lineage reads it as
 * `changed (grew)` — never as one group resolved and another introduced. An edit INSIDE a cloned region changes the
 * fragment (so the anchor): the group then matches by member overlap (memory lineage rule 3, Jaccard ≥ 0.5; a group
 * always has ≥ 2 members), reading `changed`, not resolved plus introduced.
 *
 * Both sides measure ONE file universe: folders git ignores in the after tree are excluded (the before tree is built
 * from git's file list, so it has none of them).
 */

import { anchorWithSnippet, composeAnchor } from '@seanhogg/builderforce-memory/knowledge';
import { ignoredGlobs, okResult, relPath, type AnalyzerRunFinding, type DeltaAnalyzer } from './analyzer.js';
import { isRunResult, runBundled } from './bundledTool.js';

export const JSCPD_TOOL = 'jscpd';
const KIND = 'clone-group';

interface Pair {
  fragment?: unknown;
  firstFile?: { name?: unknown; start?: unknown; startLoc?: { line?: unknown } };
  secondFile?: { name?: unknown; start?: unknown; startLoc?: { line?: unknown } };
}

const lineOf = (f: Pair['firstFile']): number | undefined => {
  const n = Number(f?.startLoc?.line ?? f?.start);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** jscpd's report → clone groups (pure). Pairs without a fragment group by their own file pair. */
export function jscpdFindings(report: unknown, dir: string, side: 'before' | 'after'): AnalyzerRunFinding[] {
  const pairs = ((report as { duplicates?: unknown } | undefined)?.duplicates);
  if (!Array.isArray(pairs)) return [];
  const groups = new Map<string, { files: Map<string, number | undefined> }>();
  for (const raw of pairs as Pair[]) {
    const a = typeof raw.firstFile?.name === 'string' ? relPath(dir, raw.firstFile.name) : undefined;
    const b = typeof raw.secondFile?.name === 'string' ? relPath(dir, raw.secondFile.name) : undefined;
    if (!a || !b) continue;
    const key = typeof raw.fragment === 'string' && raw.fragment.trim()
      ? anchorWithSnippet('jscpd', raw.fragment)
      : `jscpd:${[a, b].sort().join('|')}`;
    const g = groups.get(key) ?? { files: new Map<string, number | undefined>() };
    groups.set(key, g);
    for (const [path, line] of [[a, lineOf(raw.firstFile)], [b, lineOf(raw.secondFile)]] as const) {
      const prev = g.files.get(path);
      g.files.set(path, prev === undefined ? line : line === undefined ? prev : Math.min(prev, line));
    }
  }
  return [...groups].map(([key, g]): AnalyzerRunFinding => {
    const members = [...g.files.keys()].sort();
    return {
      kind: KIND,
      identity: { id: `${KIND}:${key}:${members.join('|')}`, anchor: composeAnchor(KIND, 1, 'group', key), anchorKind: 'group', members },
      severity: 'warn',
      confidence: 'measured',
      params: { members: members.length },
      evidence: members.map((path) => {
        const line = g.files.get(path);
        return { side, path, ...(line !== undefined ? { line } : {}) };
      }),
    };
  });
}

export const jscpdAnalyzer: DeltaAnalyzer = {
  tool: JSCPD_TOOL,
  inputs: ['.jscpd.json'],
  // The run's business is the clone groups its changed files are in; the whole-tree result is cached unfiltered.
  relevant: (finding, changed) => finding.identity.members.some((m) => changed.has(m)),
  async run(side, exec, signal) {
    // One file universe on both sides: what git ignores in the after tree (build output) is excluded here too.
    const extra = ignoredGlobs(side.ignored);
    // Scoped to the workspace packages holding a changed file (the host's `scopes`, the same on both sides): a whole
    // monorepo is more than jscpd can hold (PRD 41 §B7, measured). Clones across packages stay with the static rule.
    const scopes = side.scopes && side.scopes.length > 0 ? [...side.scopes] : ['.'];
    const r = await runBundled('jscpd', side, exec, signal, {
      reportFile: 'jscpd-report.json',
      args: (args) => args
        .map((a) => (a.startsWith('--ignore=') && extra.length > 0 ? `${a},${extra.join(',')}` : a))
        .flatMap((a, i, all) => (i === all.length - 1 && a === '.' ? scopes : [a])),
    });
    if (isRunResult(r)) return r;
    return { ...okResult(JSCPD_TOOL, r.version, jscpdFindings(r.report, side.dir, side.side)), raw: r.report };
  },
};
