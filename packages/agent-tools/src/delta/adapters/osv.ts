/**
 * delta/adapters/osv.ts — known vulnerabilities of the side's lockfiles (PRD 41 §C5.4), through osv-scanner when it is
 * on the user's PATH. The arguments and the report parser are the PreFetch dependency-audit executor's
 * (`prefetch/checkExecutors.ts`), reused, not copied.
 *
 * OFFLINE DATABASE. With a database folder from the host (`side.osv`, in the extension's own storage) the scan matches
 * against the local database only, refreshing it first when the host says it may (online, on the L3 schedule); a refresh
 * that fails falls back to the database already there. `dataAsOf` is the database's date (its newest file), which the
 * engine holds to the row's 14 days (`analyzer-data-stale:osv-scanner`). Without a folder the scan is online and dated today.
 *
 * One `vulnerable-dependency` finding per (lockfile, package, advisory group), anchored on the package and the group's
 * PRIMARY advisory id (its first by sort) — never its version — so an upgrade that keeps the advisory is `persisting` and
 * one that fixes it is `resolved`. Severity from the group's max CVSS score (≥ 7 error, ≥ 4 warn, else info; none: warn).
 * The program runs from a neutral folder, by its absolute path.
 */

import { composeAnchor } from '@seanhogg/builderforce-memory/knowledge';
import { jsonIn } from '../../prefetch/exec.js';
import { osvPackages, osvScanArgs, type OsvPackage } from '../../prefetch/checkExecutors.js';
import {
  ANALYZER_TIMEOUT_MS, cutShort, failed, okResult, relPath, resolvedArgv, runFailure, skipped,
  type AnalyzerExec, type AnalyzerRunFinding, type AnalyzerSide, type DeltaAnalyzer, type ExecResult,
} from './analyzer.js';

export const OSV_TOOL = 'osv-scanner';
const KIND = 'vulnerable-dependency';
/** The environment variable osv-scanner reads its local database folder from. */
export const OSV_DB_ENV = 'OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY';
/** Lockfiles and manifests osv-scanner reads: the cache key's declared input set. */
export const OSV_INPUTS = [
  'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'package.json',
  'requirements.txt', 'poetry.lock', 'Pipfile.lock', 'go.sum', 'Cargo.lock', 'Gemfile.lock', 'composer.lock',
] as const;

const severityOf = (score: number | undefined): AnalyzerRunFinding['severity'] =>
  score === undefined ? 'warn' : score >= 7 ? 'error' : score >= 4 ? 'warn' : 'info';

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The report's packages → findings (pure). Sorted before dedupe, so which duplicate is kept never depends on report order. */
export function osvFindings(packages: readonly OsvPackage[], dir: string, side: 'before' | 'after' = 'after'): AnalyzerRunFinding[] {
  const rows = packages.flatMap((p) => p.groups.map((g) => {
    const ids = [...g.ids].sort(cmp);
    return { source: relPath(dir, p.source), pkg: `${p.ecosystem ? `${p.ecosystem}/` : ''}${p.name}`, p, ids, score: g.maxSeverity };
  })).sort((a, b) => cmp(a.source, b.source) || cmp(a.pkg, b.pkg) || cmp(a.ids[0]!, b.ids[0]!) || cmp(a.p.version, b.p.version)
    || (b.score ?? -1) - (a.score ?? -1));
  const out = new Map<string, AnalyzerRunFinding>();
  for (const { source, pkg, p, ids, score } of rows) {
    const advisory = ids[0]!;
    const id = `${KIND}:${source}:${pkg}:${advisory}`;
    if (out.has(id)) continue;
    out.set(id, {
      kind: KIND,
      identity: { id, anchor: composeAnchor(KIND, 1, 'package', `${pkg}#${advisory}`), anchorKind: 'package', members: [source] },
      severity: severityOf(score),
      confidence: 'measured',
      params: { package: p.name, version: p.version, advisory: ids.join(', '), ...(p.ecosystem ? { ecosystem: p.ecosystem } : {}) },
      evidence: [{ side, path: source, note: advisory }],
    });
  }
  return [...out.values()];
}

/** The tool's version from `osv-scanner --version` (`osv-scanner version: 1.9.1`). */
export const osvVersion = (text: string): string => /(\d+\.\d+\.\d+)/.exec(text)?.[1] ?? '';

/** An ISO date (`YYYY-MM-DD`) of a time in ms. */
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

async function scan(exec: AnalyzerExec, argv: string[], side: AnalyzerSide, signal: AbortSignal | undefined): Promise<ExecResult> {
  return exec.run(argv, {
    cwd: exec.neutralCwd(), timeoutMs: ANALYZER_TIMEOUT_MS, ...(signal ? { signal } : {}),
    ...(side.osv ? { env: { [OSV_DB_ENV]: side.osv.dbDir } } : {}),
  });
}

export const osvAnalyzer: DeltaAnalyzer = {
  tool: OSV_TOOL,
  inputs: OSV_INPUTS,
  async run(side, exec, signal) {
    const probe = await resolvedArgv(exec, OSV_TOOL, ['--version']);
    if (!probe) return skipped(OSV_TOOL, 'tool-absent');
    const p = await exec.run(probe, { cwd: exec.neutralCwd(), timeoutMs: 30_000, ...(signal ? { signal } : {}) });
    if (!p.started) return skipped(OSV_TOOL, 'tool-absent');
    const version = osvVersion(`${p.stdout}\n${p.stderr}`);
    const major = Number(version.split('.')[0]) || 1;
    const program = probe[0]!;
    const offline = !!side.osv;
    let r = await scan(exec, [program, ...osvScanArgs(side.dir, { offline, download: side.osv?.download ?? false, major })], side, signal);
    // A refresh that could not reach the network: the database already there still answers.
    if (offline && side.osv?.download && !cutShort(r) && r.exitCode !== 0 && r.exitCode !== 1 && r.exitCode !== 128) {
      r = await scan(exec, [program, ...osvScanArgs(side.dir, { offline, major })], side, signal);
    }
    // Exit 1 = vulnerabilities found; 128 = no lockfiles to scan (a measurement of zero packages).
    if (!r.started || cutShort(r)) return failed(OSV_TOOL, r.started ? runFailure(r) : 'exit-failed', version);
    const newest = side.osv ? await exec.newestMtime(side.osv.dbDir) : Date.now();
    if (offline && newest === undefined) return failed(OSV_TOOL, 'no-database', version);
    const dataAsOf = isoDay(newest!);
    if (r.exitCode === 128) return { ...okResult(OSV_TOOL, version, []), dataAsOf };
    const report = jsonIn(r.stdout);
    if (!report || typeof report !== 'object') return failed(OSV_TOOL, r.exitCode === 0 || r.exitCode === 1 ? 'invalid-report' : runFailure(r), version);
    return { ...okResult(OSV_TOOL, version, osvFindings(osvPackages(report), side.dir, side.side)), dataAsOf };
  },
};
