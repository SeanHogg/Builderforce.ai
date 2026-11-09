/**
 * The test tier of the verifier (PRD 45 §4.4 targetedTests): for each changed
 * `x.ts(x)` the CO-LOCATED tests `x.test.ts(x)` / `x.*.test.ts(x)` are found and
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

/** The file operations the tier needs — the real fs, or an in-memory fake in tests. */
export interface TestFileSystem {
  readFile(p: string): Promise<string | null>;
  exists(p: string): Promise<boolean>;
}

export interface TestShell {
  runFor(command: string, timeoutMs: number): Promise<{ exitCode?: number }>;
}

const SOURCE_RE = /\.(ts|tsx|mts|cts)$/i;
const DID_NOT_FINISH = 124;
/** A test run's budget; over it, the run is "unavailable", not "pass" (OD-3). */
const TEST_TIMEOUT_MS = 120_000;

/** "x.ts" → ["x.test.ts", "x.test.tsx", "x.spec.ts", "x.spec.tsx"] co-located candidates. */
function coLocatedTestNames(absPath: string): string[] {
  const dir = path.dirname(absPath);
  const base = path.basename(absPath);
  const m = /^(.+)\.(ts|tsx|mts|cts)$/i.exec(base);
  if (!m) return [];
  const stem = m[1];
  return ["test.ts", "test.tsx", "spec.ts", "spec.tsx"].map((ext) => path.join(dir, `${stem}.${ext}`));
}

/** Which runner the package's `test` script names ("vitest" → vitest, else jest). */
function runnerFromTestScript(testScript: string): "vitest" | "jest" {
  return /\bvitest\b/.test(testScript) ? "vitest" : "jest";
}

/** The package runner command for ONLY these test files. */
export function targetedTestCommand(runner: "vitest" | "jest", files: readonly string[]): string {
  const list = files.map((f) => `"${f}"`).join(" ");
  return runner === "vitest" ? `vitest run ${list}` : `jest ${list}`;
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
    for (const src of files) {
      for (const candidate of coLocatedTestNames(src)) {
        if (await fs.exists(candidate)) {
          tests.push(candidate);
          break;
        }
      }
    }
    if (tests.length === 0) continue; // no co-located test: the gate's newSourceNeedsTest refuses

    const command = targetedTestCommand(runnerFromTestScript(testScript), tests);
    const r = await shell.runFor(command, timeoutMs);
    const exitCode = typeof r.exitCode === "number" ? r.exitCode : 1;
    records.push({
      kind: "test",
      name: command,
      outcome: exitCode === DID_NOT_FINISH ? "unavailable" : exitCode === 0 ? "pass" : "fail",
      exitCode,
      findings: [],
      at: now(),
    });
  }
  return records;
}
