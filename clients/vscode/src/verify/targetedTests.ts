/**
 * The test tier of the verifier (PRD 45 §4.4 targetedTests): for each changed
 * `x.ts(x)` the CO-LOCATED tests `x.test.ts(x)` / `x.spec.ts(x)` / `x.*.test.ts(x)`
 * (the last when the file system can list the directory) are found — a changed test
 * file is its own test — and
 * run with the package's own runner — `vitest run <files>` or `jest <files>`, read
 * from the package's `test` script. NEVER the full suite: a "test" evidence record
 * must prove the changed file's own tests ran, not that the package's whole suite
 * happened to pass.
 *
 * A changed file whose co-located test does not exist yields no test record — the
 * `outgoingGate`'s `newSourceNeedsTest` rule is what refuses a new source file
 * without a test; this tier never invents one.
 */

import * as path from "path";
import type { CheckRecord } from "./types";
import { DID_NOT_FINISH, type Argv } from "./execRunner";
import type { VerifyShellLike } from "./typecheck";

/** The file operations the tier needs — the real fs, or an in-memory fake in tests. */
export interface TestFileSystem {
  readFile(p: string): Promise<string | null>;
  exists(p: string): Promise<boolean>;
  /** The entry names in a directory — finds `x.<part>.test.ts`. Optional: without it only `x.test|spec.ts(x)` are found. */
  list?(dir: string): Promise<string[]>;
}

/**
 * The path semantics a run's file names use. The host passes the platform `path`;
 * a test passes `path.win32` to exercise Windows-style absolute paths on any OS
 * (vitest's CI runs on Linux, where a backslash path would otherwise be mangled).
 */
export interface TestPathImpl {
  dirname(p: string): string;
  basename(p: string): string;
  relative(from: string, to: string): string;
  join(...parts: string[]): string;
}

/** The one verify shell (`typecheck.ts`): an argument array, never a shell string. */
export type TestShell = VerifyShellLike;

const SOURCE_RE = /\.(ts|tsx|mts|cts)$/i;
/** A test run's budget; over it, the run is "unavailable", not "pass" (OD-3). */
export const TEST_TIMEOUT_MS = 120_000;

/** A test file itself: `x.test.ts`, `x.spec.tsx`, `x.mint.test.ts`, … */
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|mts|cts)$/i;

/** "x.ts" → ["x.test.ts", "x.test.tsx", "x.spec.ts", "x.spec.tsx"] co-located candidates. */
export function coLocatedTestNames(absPath: string): string[] {
  const dir = path.dirname(absPath);
  const base = path.basename(absPath);
  const m = /^(.+)\.(ts|tsx|mts|cts)$/i.exec(base);
  if (!m) return [];
  const stem = m[1];
  return ["test.ts", "test.tsx", "spec.ts", "spec.tsx"].map((ext) => path.join(dir, `${stem}.${ext}`));
}

/**
 * The tests that prove one changed file: a changed TEST file is its own test; a source
 * `x.ts` has `x.test.ts(x)` / `x.spec.ts(x)` and, when the directory can be listed, every
 * `x.<part>.test.ts(x)` beside it (`session.mint.test.ts` tests `session.ts`).
 */
export async function testsFor(absPath: string, fs: TestFileSystem, pathImpl: TestPathImpl = path): Promise<string[]> {
  if (TEST_FILE_RE.test(absPath)) return (await fs.exists(absPath)) ? [absPath] : [];
  const found: string[] = [];
  for (const candidate of coLocatedTestNames(absPath)) if (await fs.exists(candidate)) found.push(candidate);
  const m = /^(.+)\.(ts|tsx|mts|cts)$/i.exec(pathImpl.basename(absPath));
  if (m && fs.list) {
    const dir = pathImpl.dirname(absPath);
    const prefix = `${m[1]}.`.toLowerCase();
    const names = await fs.list(dir).catch(() => [] as string[]);
    for (const name of names) {
      const full = pathImpl.join(dir, name);
      if (name.toLowerCase().startsWith(prefix) && TEST_FILE_RE.test(name) && !found.includes(full)) found.push(full);
    }
  }
  return found;
}

/** Which runner the package's `test` script names ("vitest" → vitest, else jest). */
function runnerFromTestScript(testScript: string): "vitest" | "jest" {
  return /\bvitest\b/.test(testScript) ? "vitest" : "jest";
}

/**
 * The package runner command for ONLY these test files. Through `npx --no-install`: the runner
 * lives in the package's `node_modules/.bin`, which is not on the shell's PATH (a bare
 * `vitest` / `jest` cannot start), and `--no-install` never downloads one. An argument
 * array: the file paths are never interpolated into a shell string.
 */
export function targetedTestCommand(runner: "vitest" | "jest", files: readonly string[]): Argv {
  return runner === "vitest" ? ["npx", "--no-install", "vitest", "run", ...files] : ["npx", "--no-install", "jest", ...files];
}

/**
 * Find each changed source file's co-located test and run ONLY those files.
 * Returns one record per owning package (a package's targeted tests run together).
 */
export async function targetedTestRecords(
  absPaths: readonly string[],
  cwd: string,
  fs: TestFileSystem,
  shell: TestShell,
  opts?: { now?: () => number; timeoutMs?: number; pathImpl?: TestPathImpl },
): Promise<CheckRecord[]> {
  const now = opts?.now ?? Date.now;
  const timeoutMs = opts?.timeoutMs ?? TEST_TIMEOUT_MS;
  const p = opts?.pathImpl ?? path;

  // Collect the changed files by owning package (the nearest package.json upward).
  const byPkg = new Map<string, string[]>();
  for (const absPath of absPaths) {
    if (!SOURCE_RE.test(absPath)) continue;
    let dir = p.dirname(absPath);
    let pkgDir: string | null = null;
    for (let i = 0; i < 32; i += 1) {
      if (await fs.exists(p.join(dir, "package.json"))) {
        pkgDir = dir;
        break;
      }
      const parent = p.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    if (!pkgDir) continue;
    const list = byPkg.get(pkgDir) ?? [];
    list.push(absPath);
    byPkg.set(pkgDir, list);
  }

  const records: CheckRecord[] = [];
  for (const [pkgDir, files] of byPkg) {
    const pkgJson = await fs.readFile(p.join(pkgDir, "package.json"));
    if (pkgJson === null) continue;
    let scripts: { test?: string } = {};
    try {
      scripts = (JSON.parse(pkgJson) as { scripts?: { test?: string } }).scripts ?? {};
    } catch {
      continue;
    }
    const testScript = typeof scripts.test === "string" ? scripts.test : "";
    if (!testScript.trim()) continue;

    const tests: string[] = [];
    for (const src of files) for (const t of await testsFor(src, fs)) if (!tests.includes(t)) tests.push(t);
    if (tests.length === 0) continue; // no co-located test: the gate's newSourceNeedsTest refuses

    // The runner (vitest/jest) matches its file filter against paths RELATIVE to the
    // cwd it runs in — an absolute Windows path matches nothing and the run exits 1
    // with "No test files found", recorded as a failing check for a test that never
    // ran. Pass paths relative to the owning package (the shell's cwd).
    //
    // Forward slashes are REQUIRED, not cosmetic: `path.relative` yields backslashes
    // on Windows (`src\a.test.ts`), and the runner's filter matcher does not normalize
    // the argument's separators — it matches the literal string, so the backslash is
    // dropped and the glob becomes `srca.test.ts`, matching zero files → exit 1 → the
    // gate records `fail` for a test that never ran (the webviewHostBridge regression).
    // Repo-relative paths always use `/`, so this is a no-op off Windows.
    const command = targetedTestCommand(
      runnerFromTestScript(testScript),
      tests.map((t) => p.relative(pkgDir, t).replace(/\\/g, "/")),
    );
    // No budget left (a bounded caller): not started — "unavailable", never a pass.
    const r = timeoutMs > 0 ? await shell.runFor(command, timeoutMs) : { exitCode: DID_NOT_FINISH };
    const exitCode = typeof r.exitCode === "number" ? r.exitCode : 1;
    // Kept only on a fail: a passing check needs no output, an unavailable one never ran.
    const tail = typeof r.tail === "string" && r.tail.trim() ? r.tail : undefined;
    records.push({
      kind: "test",
      name: command.join(" "),
      outcome: exitCode === DID_NOT_FINISH ? "unavailable" : exitCode === 0 ? "pass" : "fail",
      exitCode,
      findings: [],
      at: now(),
      ...(exitCode !== 0 && exitCode !== DID_NOT_FINISH && tail ? { outputTail: tail } : {}),
    });
  }
  return records;
}
