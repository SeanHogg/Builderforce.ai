/**
 * delta/adapters/analyzer.ts — what every L3 analyzer adapter of the run delta is (PRD 41 §B7, §4 "Analyzer
 * adapters"): ONE tool, run on ONE side's tree through the host's {@link AnalyzerExec}, its output normalized to
 * run-delta's `AnalyzerResult` — sorted and canonical (B8.1), so the same tree always gives the same result.
 *
 * The result is structurally run-delta's `AnalyzerResult` (and each finding its `AnalyzerFinding`), declared
 * here because run-delta imports agent-tools: an import back would be a source-package cycle. The host hands it
 * to `DeltaPorts.analyze`; run-delta's `analyzerShape.test.ts` asserts the structural match at compile time.
 *
 * Never throws: a tool that is not bundled or present is `skipped` (`tool-absent`, `analyzer-unavailable`), one
 * that ran and broke is `failed` (`timeout`, `exit-failed`, `invalid-report`). No findings then — a missing
 * measurement is never zero findings.
 */

import type { FindingIdentity, PartitionRegistry } from '@seanhogg/builderforce-memory/knowledge';

/** run-delta `RuleFinding`, structurally. */
export interface ImportedRuleFinding {
  identity: FindingIdentity;
  severity: 'info' | 'warn' | 'error';
  /** An analyzer's output is always `measured`; the type is run-delta's whole range, so the shapes are interchangeable. */
  confidence: 'measured' | 'heuristic';
  params: Record<string, string | number>;
  evidence: Array<{ side: 'before' | 'after'; path: string; line?: number; snippet?: string; note?: string }>;
}

/** run-delta `AnalyzerFinding`, structurally. */
export interface AnalyzerRunFinding extends ImportedRuleFinding {
  kind: string;
}

/** run-delta `AnalyzerMetric`, structurally. */
export interface AnalyzerRunMetric {
  metricId: string;
  value: number;
  step: number;
  unit: string;
  betterWhen: 'lower' | 'higher';
  threshold: { warn: number; error: number; kind: 'abs' | 'pct' };
}

/** run-delta `AnalyzerResult`, structurally. */
export interface AnalyzerRunResult {
  tool: string;
  version: string;
  status: 'ok' | 'failed' | 'skipped';
  reason?: string;
  /** ISO date of the data the tool measured against (osv-scanner's offline database). */
  dataAsOf?: string;
  /**
   * The tool's raw report, for the shared L3 cache only (`l3Cache.ts`: the indexer's analysis is built from it). The host
   * strips it before the result reaches the engine.
   */
  raw?: unknown;
  findings: AnalyzerRunFinding[];
  metrics?: AnalyzerRunMetric[];
}

export interface ExecResult {
  /** False: the program could not be launched (not installed, not on PATH). */
  started: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  /** The output passed the host's bound: the run is not usable. */
  overflow?: boolean;
}

/**
 * The host's seams: a process runner (argument arrays, never a shell), file reads and scratch space. A program is never
 * run by a bare name: {@link which} resolves it to an absolute path from the user's PATH ONLY (never `.`, never the
 * repository), so a file the run wrote cannot stand in for a tool.
 */
export interface AnalyzerExec {
  /**
   * `windowsVerbatimArguments` (Windows only): the arguments go to the program unquoted — for `cmd.exe /d /s /c "<line>"`,
   * whose own quoting rules differ from the C runtime's (the dynamic tier's repository commands).
   */
  run(argv: readonly string[], opts: { cwd: string; timeoutMs: number; signal?: AbortSignal; env?: Readonly<Record<string, string>>; windowsVerbatimArguments?: boolean }): Promise<ExecResult>;
  /** The absolute path of a program on the user's PATH (excluding `.` and the repository); undefined when absent. */
  which(program: string): Promise<string | undefined>;
  /** A directory outside every repository, for runs that need no tree (probes, osv-scanner given a path). */
  neutralCwd(): string;
  readText(absPath: string): Promise<string | undefined>;
  /** Modification time (ms), undefined when absent. */
  mtime(absPath: string): Promise<number | undefined>;
  /** The newest modification time (ms) of any file under a directory; undefined when it holds none. */
  newestMtime(absDir: string): Promise<number | undefined>;
  writeText(absPath: string, text: string): Promise<void>;
  /** A fresh empty private directory (`mkdtemp`), removed by `dispose`. */
  tempDir(): Promise<{ path: string; dispose(): Promise<void> }>;
}

/** One changed file of the run on this side. */
export interface AnalyzerChangedFile {
  /** Root-relative POSIX path (the after-side path). */
  path: string;
  /** This side's text; absent = the file does not exist on this side. */
  text?: string;
  /** The before side's text (given on the after side, for changed-line measures). */
  beforeText?: string;
}

/** One side's tree, as an adapter sees it. */
export interface AnalyzerSide {
  side: 'before' | 'after';
  /** Absolute directory of the side's tree: the working tree after; the materialized before tree. */
  dir: string;
  /** The run's in-run changed files, sorted by path. */
  changed: readonly AnalyzerChangedFile[];
  /** Absolute entry scripts of bundled tools (`node <entry>`), by tool name; absent = not bundled here. */
  entries: Readonly<Record<string, string | undefined>>;
  /** Whether this host bundles its analyzers (an absent entry is then `analyzer-unavailable`, never downloaded). */
  bundled: boolean;
  /**
   * Root-relative folders git ignores in the AFTER tree (build output, caches). Both sides measure ONE file universe:
   * the before tree is built from git's file list, so the whole-tree tools exclude these on the after side too.
   */
  ignored?: readonly string[];
  /**
   * The directories (relative to `dir`) a whole-tree tool is scoped to on THIS run, the same on both sides (jscpd: the
   * workspace packages holding a changed file). Absent: the whole tree.
   */
  scopes?: readonly string[];
  /** The layer registry, read from the BEFORE side (a run cannot loosen its own layer rules): dependency-cruiser's `forbidden` rules. */
  partitions?: PartitionRegistry;
  /** osv-scanner's offline vulnerability database: where it lives, and whether it may be refreshed (online) now. */
  osv?: { dbDir: string; download: boolean };
  /** gitleaks' configuration and ignore list as of the BEFORE side (a run cannot silence its own leaks). */
  gitleaks?: { config?: string; ignore?: string };
  /** The repository's own Semgrep rules as of the BEFORE side (Semgrep never fetches rules here). Absent: not measured. */
  semgrep?: { config: string };
  /** A CodeQL database of THIS side's tree, and the source root its paths are relative to. Absent: not measured. */
  codeql?: {
    /** An existing database of this side's tree. */
    database?: string;
    sourceRoot?: string;
    /** The repository opted in: create this side's database here (offline, keyed by the tree), then analyze it. */
    create?: { dbDir: string; language: string };
  };
}

export interface DeltaAnalyzer {
  /** run-delta `ANALYZER_TOOLS` name. */
  tool: string;
  /**
   * The tool's declared input set besides source (lockfiles, manifests, its config), as file BASENAMES: the host hashes
   * their contents into the cache key, so a lockfile the knowledge manifest does not cover still invalidates a result.
   */
  inputs?: readonly string[];
  /**
   * Which findings of a (cached, whole-tree) result concern THIS run: the host keeps only those, on both sides, after the
   * cache (the cached result stays unfiltered, so another run's changed set reuses it). Absent: every finding.
   */
  relevant?(finding: AnalyzerRunFinding, changed: ReadonlySet<string>): boolean;
  run(side: AnalyzerSide, exec: AnalyzerExec, signal?: AbortSignal): Promise<AnalyzerRunResult>;
}

/** One tool run's ceiling (L3 is async and minutes on a cold run; the host bounds the whole tier as well). */
export const ANALYZER_TIMEOUT_MS = 5 * 60_000;

export const skipped = (tool: string, reason: string, version = ''): AnalyzerRunResult => ({ tool, version, status: 'skipped', reason, findings: [] });
export const failed = (tool: string, reason: string, version = ''): AnalyzerRunResult => ({ tool, version, status: 'failed', reason, findings: [] });

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A successful result, canonical: findings sorted by identity id (then kind), evidence sorted, metrics by id. */
export function okResult(tool: string, version: string, findings: AnalyzerRunFinding[], metrics?: AnalyzerRunMetric[]): AnalyzerRunResult {
  const sorted = findings
    .map((f) => ({ ...f, evidence: [...f.evidence].sort((a, b) => cmp(a.path, b.path) || (a.line ?? 0) - (b.line ?? 0)) }))
    .sort((a, b) => cmp(a.identity.id, b.identity.id) || cmp(a.kind, b.kind));
  return { tool, version, status: 'ok', findings: sorted, ...(metrics ? { metrics: [...metrics].sort((a, b) => cmp(a.metricId, b.metricId)) } : {}) };
}

/** A tool path → root-relative POSIX (absolute paths under `dir` are relativized; `./` dropped). */
export function relPath(dir: string, file: string): string {
  const d = dir.replace(/\\/g, '/').replace(/\/+$/, '');
  let f = file.replace(/\\/g, '/');
  const fold = /^[A-Za-z]:/.test(d) ? (s: string) => s.toLowerCase() : (s: string) => s;
  if (fold(f).startsWith(`${fold(d)}/`)) f = f.slice(d.length + 1);
  return f.replace(/^\.\//, '');
}

/** Why a run that started did not give a report. */
export const runFailure = (r: ExecResult): string => (r.overflow ? 'output-too-large' : r.timedOut ? 'timeout' : 'exit-failed');

/** The run did not finish usably (timed out, aborted, or its output overflowed). */
export const cutShort = (r: ExecResult): boolean => !!r.timedOut || !!r.overflow;

/** `[<absolute program>, ...args]` from the user's PATH, or undefined when the program is not there. */
export async function resolvedArgv(exec: AnalyzerExec, program: string, args: readonly string[]): Promise<string[] | undefined> {
  const abs = await exec.which(program);
  return abs ? [abs, ...args] : undefined;
}

/** Root-relative folders as glob excludes (`dist` → `**\/dist/**` is NOT used: a folder is matched from the root). */
export const ignoredGlobs = (ignored: readonly string[] | undefined): string[] => (ignored ?? []).map((d) => `${d.replace(/\/+$/, '')}/**`);

/** A regex source matching any of the root-relative folders (dependency-cruiser's `exclude.path`). */
export function ignoredRegex(ignored: readonly string[] | undefined): string | undefined {
  const dirs = (ignored ?? []).map((d) => d.replace(/\/+$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return dirs.length > 0 ? `^(?:${dirs.join('|')})(?:/|$)` : undefined;
}

/** `node <entry> …args` for a bundled tool; undefined when the host has no entry for it. */
export function bundledArgv(side: AnalyzerSide, tool: string, args: readonly string[]): string[] | undefined {
  const entry = side.entries[tool];
  return entry ? ['node', entry, ...args] : undefined;
}

/** The reason a bundled tool is missing: `analyzer-unavailable` on a host that bundles (A3), else `tool-absent`. */
export const missingReason = (side: AnalyzerSide): string => (side.bundled ? 'analyzer-unavailable' : 'tool-absent');
