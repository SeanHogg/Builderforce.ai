/**
 * policy/verify/sandboxVerify.ts — the run-end verify executed in the run's sandbox:
 * the project's OWN declared checks (`typecheck` / `type-check` / `test`, planned by
 * `planInRunVerify`) run over the working tree, and their honest exit codes become the
 * verify outcome.
 *
 * Ported from `api/src/application/runtime/sandbox/sandboxVerify.ts`. A command that
 * could not even launch is a failure, never a pass; a command the wall-clock budget
 * cannot fit is reported as not finished (exit 124), never as a pass. The commands run
 * through the caller's shell port (`runFor`), so a heartbeat and a cancel can wrap them
 * on the host.
 *
 * No `node:*` imports, no DOM.
 */

import { planInRunVerify, type InRunVerifyCommandResult, type PackageScriptRunner } from "./inRunVerify.js";

/** At most this many planned commands run — a verify must not become a second run. */
const MAX_VERIFY_COMMANDS = 3;
/** The whole verify's budget — room for the memory write and the finalize that follow it. */
const VERIFY_BUDGET_MS = 9 * 60_000;
/** Below this, a command is not started: it could not finish. */
const MIN_COMMAND_MS = 30_000;
/** The conventional exit code of a command stopped by its time limit. */
const DID_NOT_FINISH = 124;

/** The sandbox's clone, as the caller reads and runs it. */
export interface VerifySandbox {
  /** Read a file in the clone (`package.json` for the scripts). */
  read(path: string): Promise<string | null>;
  /** List the clone's paths matching a basename glob (the runner's lockfile probe). */
  list(glob: string): Promise<string[]>;
}

/** The run's sandbox shell: heartbeat + cancel around a bounded command. */
export interface VerifyShell {
  runFor(command: string, timeoutMs: number): Promise<{ exitCode?: number }>;
}

export interface SandboxVerifyResult {
  packageScripts: Record<string, string> | null;
  runner: PackageScriptRunner;
  results: InRunVerifyCommandResult[];
}

/** The repo's declared package.json scripts, or null (missing / unreadable / malformed). */
async function readPackageScripts(sandbox: VerifySandbox): Promise<Record<string, string> | null> {
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

/** The package manager the repo's lockfile names (npm when none does). Only a ROOT
 *  lockfile selects the runner — a nested `packages/x/yarn.lock` does not. */
async function detectRunner(sandbox: VerifySandbox): Promise<PackageScriptRunner> {
  const atRoot = async (name: string): Promise<boolean> => {
    const listed = await sandbox.list(name).catch(() => [] as string[]);
    return (listed ?? []).includes(name);
  };
  if (await atRoot("pnpm-lock.yaml")) return "pnpm";
  if (await atRoot("yarn.lock")) return "yarn";
  return "npm";
}

/** Run the planned verify commands over the clone; their honest exit codes are the result. */
export async function runSandboxVerify(
  sandbox: VerifySandbox,
  shell: VerifyShell,
  now: () => number = Date.now,
): Promise<SandboxVerifyResult> {
  const [packageScripts, runner] = await Promise.all([readPackageScripts(sandbox), detectRunner(sandbox)]);
  const plan = planInRunVerify({ surface: "sandbox", packageScripts, runner });
  const results: InRunVerifyCommandResult[] = [];
  const deadline = now() + VERIFY_BUDGET_MS;
  for (const command of plan.commands.slice(0, MAX_VERIFY_COMMANDS)) {
    const left = deadline - now();
    if (left < MIN_COMMAND_MS) {
      results.push({ command, exitCode: DID_NOT_FINISH });
      continue;
    }
    const r = await shell.runFor(command, left);
    // A command that could not even launch is a failure, never a pass.
    results.push({ command, exitCode: typeof r.exitCode === "number" ? r.exitCode : 1 });
  }
  return { packageScripts, runner, results };
}
