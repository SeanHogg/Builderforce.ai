/**
 * The typecheck tier of the verifier (PRD 45 §4.4 typecheck.ts): the OWNING
 * package's declared typecheck script, run through `runSandboxVerify` behind VSIX
 * `VerifyShell` / `VerifySandbox` ports — the plan FILTERED to typecheck scripts
 * ONLY (the full tier never runs the package's whole test suite; `targetedTests.ts`
 * runs only the changed file's own tests).
 *
 * The shell port runs through the host's real process runner (`execRunner`), which
 * returns the REAL process exit code — never one parsed out of the model's output —
 * and takes an argument array, never a shell string (Windows `.cmd` shims are launched
 * there, for the package managers only). A command that does not finish within its
 * budget is exit 124 — recorded "unavailable", never "pass" (OD-3).
 */

import * as path from "path";
import { planInRunVerify, type PackageScriptRunner } from "@builderforce/run-guards";
import type { CheckRecord } from "./types";
import { DID_NOT_FINISH, execRunner, type Argv, type Runner } from "./execRunner";

/** The sandbox's clone, as the caller reads it (`runSandboxVerify`'s `VerifySandbox`). */
export interface VerifySandboxLike {
  read(p: string): Promise<string | null>;
  list(glob: string): Promise<string[]>;
}

/** The ONE bounded shell every verify tier runs through: an argument array, never a shell string. */
export interface VerifyShellLike {
  runFor(argv: Argv, timeoutMs: number): Promise<{ exitCode?: number }>;
}

/** The whole verify's budget — room for the checks that follow it. */
export const VERIFY_BUDGET_MS = 9 * 60_000;
/** Below this a command is not started: it could not finish. */
const MIN_COMMAND_MS = 30_000;
/** At most this many commands run — a verify must not become a second run. */
const MAX_VERIFY_COMMANDS = 3;

/** A planned script command (`pnpm run typecheck`) as argv; null when a word is not a plain token. */
function argvOf(command: string): Argv | null {
  const words = command.trim().split(/\s+/);
  return words.length && words.every((w) => /^[\w@.:/=+-]+$/.test(w)) ? words : null;
}

/** The runner the lockfile names (npm when none does) — only a ROOT lockfile selects it. */
async function detectRunner(sandbox: VerifySandboxLike): Promise<PackageScriptRunner> {
  const atRoot = async (name: string): Promise<boolean> =>
    (await sandbox.list(name).catch(() => [] as string[])).includes(name);
  if (await atRoot("pnpm-lock.yaml")) return "pnpm";
  if (await atRoot("yarn.lock")) return "yarn";
  return "npm";
}

/** The shell port `runSandboxVerify` calls: the host's real process runner, exit code real. */
export function vsixVerifyShell(cwd: string, runner: Runner = execRunner): VerifyShellLike {
  return {
    runFor: (argv, timeoutMs) => runner(argv, { cwd, timeout: timeoutMs }),
  };
}

/** The sandbox port: reads the owning package's package.json and the lockfile probe. */
export function vsixVerifySandbox(pkgDir: string, readFile: (p: string) => Promise<string | null>): VerifySandboxLike {
  return {
    read: (p) => readFile(path.join(pkgDir, p)),
    list: async (glob) => ((await readFile(path.join(pkgDir, glob))) !== null ? [glob] : []),
  };
}

/** The repo's declared package.json scripts, or null (missing / unreadable / malformed). */
async function readPackageScripts(sandbox: VerifySandboxLike): Promise<Record<string, string> | null> {
  const content = await sandbox.read("package.json").catch(() => null);
  if (content === null) return null;
  try {
    const scripts = (JSON.parse(content) as { scripts?: unknown }).scripts;
    if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) return null;
    return Object.fromEntries(Object.entries(scripts).filter((e): e is [string, string] => typeof e[1] === "string"));
  } catch {
    return null;
  }
}

/** Keep ONLY typecheck commands — the plan filtered so `test` scripts never run here. */
const TYPECHECK_ONLY = (command: string): boolean => /\b(typecheck|type-check)\b/.test(command);

/**
 * The package's OWN declared checks (`runSandboxVerify`), the plan filtered to
 * typecheck scripts only, the REAL exit codes becoming the records. A command that
 * cannot launch is a failure (exit 1), never a pass; one the budget cannot fit is
 * exit 124 (`DID_NOT_FINISH`) — recorded "unavailable", not "pass" (OD-3).
 */
export async function runTypecheckVerify(
  sandbox: VerifySandboxLike,
  shell: VerifyShellLike,
  opts?: { now?: () => number; budgetMs?: number },
): Promise<CheckRecord[]> {
  const now = opts?.now ?? Date.now;
  const budgetMs = opts?.budgetMs ?? VERIFY_BUDGET_MS;
  const [packageScripts, runner] = await Promise.all([readPackageScripts(sandbox), detectRunner(sandbox)]);
  const plan = planInRunVerify({ surface: "sandbox", packageScripts, runner });
  const commands = plan.commands.filter(TYPECHECK_ONLY).slice(0, MAX_VERIFY_COMMANDS);
  const deadline = now() + budgetMs;
  const records: CheckRecord[] = [];
  for (const command of commands) {
    const left = deadline - now();
    const argv = argvOf(command);
    // Not started when the budget cannot fit it, or when the script name is not a plain token: "unavailable".
    const exitCode = left < MIN_COMMAND_MS || !argv
      ? DID_NOT_FINISH
      : await shell.runFor(argv, left).then((r) => (typeof r.exitCode === "number" ? r.exitCode : 1));
    records.push({
      kind: "typecheck",
      name: command,
      outcome: exitCode === DID_NOT_FINISH ? "unavailable" : exitCode === 0 ? "pass" : "fail",
      exitCode,
      findings: [],
      at: now(),
    });
  }
  return records;
}
