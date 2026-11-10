/**
 * delta/dynamic/host.ts — what the dynamic tier's runners (PRD 41 C6.2, C8.4) run through: the SAME process seam
 * as the L3 analyzer adapters ({@link AnalyzerExec}: argv arrays, never a shell; absolute working directories;
 * file reads), plus the two trees and a monotonic clock.
 *
 * SAFETY. The dynamic tier EXECUTES the project's code (tests, benchmarks, StrykerJS). It never runs in the user's
 * working tree: both sides run in scratch COPIES ({@link DynamicHost.tree}, real copies, never hard links — a test
 * that truncates a file must not reach the user's inode), so every report (coverage, `reports/mutation`) lands in a
 * copy and the user's own `coverage/` and `reports/` are never touched. Workspace tools run as `node <their bin>`
 * from the copy's linked `node_modules` (no `npm exec`, no download); a configured benchmark command runs through the
 * platform shell, resolved outside the repository.
 */

import type { AnalyzerExec, ExecResult } from '../adapters/analyzer.js';
import { codeLanguageOf } from '../../knowledge/codeMask.js';
import { isTestSourcePath } from '../../testPaths.js';

/**
 * The run's changed files the dynamic checks measure: JS/TS implementation files (what vitest relates tests to and
 * StrykerJS mutates), never tests, benches or type declarations. Sorted, deduped.
 */
export function changedCodeOf(paths: readonly string[]): string[] {
  return [...new Set(paths.filter((p) => codeLanguageOf(p) === 'js' && !isTestSourcePath(p) && !/\.bench\.[^/]+$|\.d\.[cm]?ts$/i.test(p)))].sort();
}

export interface DynamicHost {
  exec: AnalyzerExec;
  /** Absolute root of the user's working tree: READ-ONLY probes (installed packages) only — nothing runs here. */
  root: string;
  /**
   * The scratch copy of one side's tree (absolute root), made on first call and memoized (only a check that runs pays
   * for it): `after` = the working tree, `before` = it with the run's in-run files swapped back. Undefined when it could
   * not be made. The host disposes of both after the tier.
   */
  tree(side: 'before' | 'after'): Promise<string | undefined>;
  /** `process.platform`: `perf stat` instruction counts only on `linux`; `cmd.exe` on `win32`. */
  platform: string;
  /** The host's environment, read for `ComSpec` / `SystemRoot` (Windows shell). */
  env: Readonly<Record<string, string | undefined>>;
  /** Monotonic milliseconds (`performance.now`). */
  now(): number;
  /** Root-relative vitest `bench` files of the working tree (the host lists them; empty = none). */
  benchFiles: readonly string[];
}

/** The longest any one tool run may take, whatever budget is left. */
export const DYNAMIC_STEP_CAP_MS = 30 * 60_000;

export const joinPath = (dir: string, rel: string): string => `${dir.replace(/[\\/]+$/, '')}/${rel}`;

/** An installed package's bin entry (absolute) and version in `dir`'s `node_modules`; undefined when not installed. */
export async function packageBin(exec: AnalyzerExec, dir: string, pkg: string, bin: string): Promise<{ entry: string; version: string } | undefined> {
  const base = joinPath(dir, `node_modules/${pkg}`);
  const text = await exec.readText(`${base}/package.json`).catch(() => undefined);
  if (!text) return undefined;
  try {
    const m = JSON.parse(text) as { version?: unknown; bin?: unknown };
    const rel = typeof m.bin === 'string' ? m.bin : m.bin && typeof m.bin === 'object' ? (m.bin as Record<string, unknown>)[bin] : undefined;
    if (typeof rel !== 'string') return undefined;
    return { entry: joinPath(base, rel.replace(/^\.\//, '')), version: typeof m.version === 'string' ? m.version : '' };
  } catch {
    return undefined;
  }
}

/** Whether a package is installed in `dir`'s `node_modules`. */
export async function hasPackage(exec: AnalyzerExec, dir: string, pkg: string): Promise<boolean> {
  return (await exec.readText(joinPath(dir, `node_modules/${pkg}/package.json`)).catch(() => undefined)) !== undefined;
}

/** A repository command line as argv, plus how it must be passed. */
export interface ShellCommand {
  argv: string[];
  windowsVerbatimArguments: boolean;
}

/**
 * A repository command line for the platform shell, never resolved through PATH or the repository: on Windows
 * `%ComSpec%`, else `%SystemRoot%\System32\cmd.exe`, run `/d /s /c "<line>"` with verbatim arguments (cmd's quoting,
 * not the C runtime's); elsewhere `sh` from the user's PATH outside the repository (`AnalyzerExec.which`), else
 * `/bin/sh`. Undefined when there is no shell (`no-shell`).
 */
export async function shellCommand(host: Pick<DynamicHost, 'exec' | 'platform' | 'env'>, command: string): Promise<ShellCommand | undefined> {
  if (host.platform === 'win32') {
    const root = host.env.SystemRoot ?? host.env.SYSTEMROOT ?? host.env.windir;
    const cmd = host.env.ComSpec ?? host.env.COMSPEC ?? (root ? `${root.replace(/[\\/]+$/, '')}\\System32\\cmd.exe` : undefined);
    return cmd ? { argv: [cmd, '/d', '/s', '/c', `"${command}"`], windowsVerbatimArguments: true } : undefined;
  }
  const sh = (await host.exec.which('sh').catch(() => undefined)) ?? '/bin/sh';
  return { argv: [sh, '-c', command], windowsVerbatimArguments: false };
}

/** Milliseconds left before `deadline` (host clock), capped per step; at least 1. */
export const remaining = (host: Pick<DynamicHost, 'now'>, deadline: number): number =>
  Math.max(1, Math.min(DYNAMIC_STEP_CAP_MS, Math.floor(deadline - host.now())));

/** Why a run that started produced nothing usable. */
export const stepFailure = (r: ExecResult, signal: AbortSignal): string =>
  signal.aborted ? 'aborted' : r.timedOut ? 'timeout' : !r.started ? 'tool-unavailable' : 'exit-failed';

/** The first JSON value of a report file; undefined when absent or not JSON. */
export async function readJson(exec: AnalyzerExec, absPath: string): Promise<unknown> {
  const text = await exec.readText(absPath).catch(() => undefined);
  if (!text) return undefined;
  try { return JSON.parse(text) as unknown; } catch { return undefined; }
}

/** Both trees, or the reason one could not be made (`tree-unavailable`). */
export async function bothTrees(host: Pick<DynamicHost, 'tree'>): Promise<{ before: string; after: string } | 'tree-unavailable'> {
  const after = await host.tree('after');
  const before = after ? await host.tree('before') : undefined;
  return after && before ? { before, after } : 'tree-unavailable';
}
