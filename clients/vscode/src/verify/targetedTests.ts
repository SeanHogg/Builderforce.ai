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
export async function testsFor(absPath: string, fs: TestFileSystem): Promise<string[]> {
  if (TEST_FILE_RE.test(absPath)) return (await fs.exists(absPath)) ? [absPath] : [];
  const found: string[] = [];
  for (const candidate of coLocatedTestNames(absPath)) if (await fs.exists(candidate)) found.push(candidate);
  const m = /^(.+)\.(ts|tsx|mts|cts)$/i.exec(path.basename(absPath));
  if (m && fs.list) {
    const dir = path.dirname(absPath);
    const prefix = `${m[1]}.`.toLowerCase();
    const names = await fs.list(dir).catch(() => [] as string[]);
    for (const name of names) {
      const full = path.join(dir, name);
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
  opts?: { now?: () => number; timeoutMs?: number },
): Promise<CheckRecord[]> {
  const now = opts?.now ?? Date.now;
  const timeoutMs = opts?.timeoutMs ?? TEST_TIMEOUT_MS;

  // Collect the changed files by owning package (the nearest package.json upward).
  const byPkg = new Map<string, string[]>();
  for (const absPath of absPaths) {
    if (!SOURCE_RE.test(absPath)) continue;
    let dir = path.dirname(absPath);
    let pkgDir: string | null = null;
    for (let i = 0; i < 32; i += 1) {
      if (await fs.exists(path.join(dir, "package.json"))) {
        pkgDir = dir;
        break;
      }
      const parent = path.dirname(dir);
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
    const pkgJson = await fs.readFile(path.join(pkgDir, "package.json"));
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

    const command = targetedTestCommand(runnerFromTestScript(testScript), tests);
    // No budget left (a bounded caller): not started — "unavailable", never a pass.
    const r = timeoutMs > 0 ? await shell.runFor(command, timeoutMs) : { exitCode: DID_NOT_FINISH };
    const exitCode = typeof r.exitCode === "number" ? r.exitCode : 1;
    records.push({
      kind: "test",
      name: command.join(" "),
      outcome: exitCode === DID_NOT_FINISH ? "unavailable" : exitCode === 0 ? "pass" : "fail",
      exitCode,
      findings: [],
      at: now(),
    });
  }
  return records;
}
