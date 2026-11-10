/**
 * The FULL verifier tier (PRD 45 §4.4 `VerifierPort.full`): for each requested file, the
 * language-server diagnostics, the OWNING package's typecheck (`typecheck.ts`), the file's
 * co-located tests (`targetedTests.ts`) and the project's repo guards (`repoGuards.ts`) — one
 * aggregated record per check kind, cached by `(absPath, sha-256 of the bytes, kind)` in the
 * one in-process cache (`cache.ts`).
 *
 * A package's typecheck and a project's guards run ONCE per call however many of its files
 * were asked about; a file's tests run per file (a test record must prove THAT file's tests
 * ran). A deleted file records nothing (PRD §4.2). Every record carries the REAL exit code the
 * host captured; one the budget cut short is "unavailable", never "pass" (OD-3).
 */

import { createHash } from "crypto";
import * as path from "path";
import type { CheckKind, CheckRecord } from "./types";
import type { VerifyCache } from "./cache";
import { runTypecheckVerify, vsixVerifySandbox, vsixVerifyShell, type VerifyShellLike } from "./typecheck";
import { targetedTestRecords } from "./targetedTests";
import { repoGuardRecord } from "./repoGuards";

export interface FullTierDeps {
  /** The workspace root: where the repo guards are looked for, and the bound of the package walk. */
  root: string;
  /** Every record a file's full tier produced, by `(absPath, hash, FULL_TIER)`. */
  cache: VerifyCache<readonly CheckRecord[]>;
  readText(abs: string): Promise<string | null>;
  /** The fast tier for exactly these files (`pathDiagnostics`). */
  diagnostics(absPaths: readonly string[]): Promise<CheckRecord | null>;
  /** The bounded shell rooted at `cwd` (default: the host's real process runner). */
  shell?(cwd: string): VerifyShellLike;
}

/** The cache's check name for a file's whole full-tier result. */
const FULL_TIER = "full";

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/** The nearest directory at or above `file` that holds a package.json, never above `root`. */
async function owningPackage(file: string, root: string, readText: FullTierDeps["readText"]): Promise<string | null> {
  let dir = path.dirname(file);
  const top = path.resolve(root);
  for (let i = 0; i < 32; i += 1) {
    if ((await readText(path.join(dir, "package.json"))) !== null) return dir;
    const parent = path.dirname(dir);
    if (parent === dir || path.resolve(dir) === top) return null;
    dir = parent;
  }
  return null;
}

/** Several records of one kind → one: the worst outcome wins (fail > unavailable > pass). */
function aggregate(kind: CheckKind, records: readonly CheckRecord[]): CheckRecord | null {
  if (!records.length) return null;
  const worst = records.find((r) => r.outcome === "fail") ?? records.find((r) => r.outcome === "unavailable") ?? records[0]!;
  return {
    kind,
    name: records.map((r) => r.name).join(" && "),
    outcome: worst.outcome,
    exitCode: worst.exitCode,
    findings: records.flatMap((r) => r.findings).slice(0, 20),
    at: Math.max(...records.map((r) => r.at)),
  };
}

/** The diagnostics record narrowed to one file's findings (the fast tier answers for all at once). */
function diagnosticsFor(record: CheckRecord | null, file: string, root: string): CheckRecord | null {
  if (!record) return null;
  const rel = path.relative(root, file).split(path.sep).join("/");
  const findings = record.findings.filter((f) => f.startsWith(`${rel}:`));
  const failed = findings.some((f) => f.split(/\s+/)[1] === "error");
  return { ...record, outcome: failed ? "fail" : "pass", findings };
}

/** Run the full tier for these absolute paths; cached kinds are not re-run. */
export async function runFullTier(absPaths: readonly string[], deps: FullTierDeps): Promise<Map<string, readonly CheckRecord[]>> {
  const shellAt = deps.shell ?? ((cwd: string) => vsixVerifyShell(cwd));
  const out = new Map<string, readonly CheckRecord[]>();
  const todo: { file: string; hash: string }[] = [];
  for (const file of absPaths) {
    const content = await deps.readText(file);
    if (content === null) continue; // deleted: no checks of its own (PRD §4.2)
    const hash = sha256(content);
    const cached = deps.cache.get(file, hash, FULL_TIER);
    if (cached) out.set(file, cached);
    else todo.push({ file, hash });
  }
  if (!todo.length) return out;

  const files = todo.map((t) => t.file);
  const diagnostics = await deps.diagnostics(files).catch(() => null);
  const guard = await repoGuardRecord(deps.root, { exists: async (p) => (await deps.readText(p)) !== null }, shellAt(deps.root)).catch(() => null);
  const typecheckByPkg = new Map<string, CheckRecord | null>();
  const testFs = { readFile: deps.readText, exists: async (p: string) => (await deps.readText(p)) !== null };

  for (const { file, hash } of todo) {
    const pkg = await owningPackage(file, deps.root, deps.readText);
    if (pkg && !typecheckByPkg.has(pkg)) {
      const records = await runTypecheckVerify(vsixVerifySandbox(pkg, deps.readText), shellAt(pkg)).catch(() => []);
      typecheckByPkg.set(pkg, aggregate("typecheck", records));
    }
    const tests = pkg ? aggregate("test", await targetedTestRecords([file], pkg, testFs, shellAt(pkg)).catch(() => [])) : null;
    const records = [diagnosticsFor(diagnostics, file, deps.root), pkg ? typecheckByPkg.get(pkg) ?? null : null, tests, guard]
      .filter((r): r is CheckRecord => !!r);
    deps.cache.set(file, hash, FULL_TIER, records);
    out.set(file, records);
  }
  return out;
}
