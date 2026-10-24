/**
 * The run-end verify, executed in the run's sandbox: the project's OWN declared checks
 * (`typecheck` / `type-check` / `test`, planned by `planInRunVerify`) run over the clone
 * that holds every committed write, and their honest exit codes become the verify
 * outcome. Ported from the container image's own run tail (`verifyThenRemember` in the
 * retired `server.mjs` loop) so the one engine verifies the same way on every plan.
 *
 * A run without a sandbox has no shell and keeps the branch-CI / static verdict.
 *
 * The commands run through the run's sandbox SHELL (`sandboxShell`), not the raw sandbox,
 * so a long test suite beats the heartbeat (the reaper never takes a finishing run for a
 * silent one) and the run's cancel kills it. They share one budget that keeps the whole
 * verify inside the finish tick's wall clock; a command the budget cannot fit is reported
 * as not finished (exit 124), never as a pass.
 */
import {
  planInRunVerify, type InRunVerifyCommandResult, type PackageScriptRunner,
} from '../cloudAgent/inRunVerify';
import type { ShellResult } from '@builderforce/agent-tools';
import type { RunSandbox } from './runSandbox';
import { reportedFallback } from '../../observability/caughtErrorReporter';

/** At most this many planned commands run — a verify must not become a second run. */
const MAX_VERIFY_COMMANDS = 3;
/** The whole verify's budget — under a Durable Object alarm's wall clock, with room for
 *  the memory write and the finalize that follow it in the same tick. */
const VERIFY_BUDGET_MS = 9 * 60_000;
/** Below this, a command is not started: it could not finish. */
const MIN_COMMAND_MS = 30_000;
/** The conventional exit code of a command stopped by its time limit. */
const DID_NOT_FINISH = 124;

/** The run's sandbox shell: heartbeat + cancel around a bounded command. */
export interface VerifyShell {
  runFor(command: string, timeoutMs: number): Promise<ShellResult>;
}

export interface SandboxVerifyResult {
  packageScripts: Record<string, string> | null;
  runner: PackageScriptRunner;
  results: InRunVerifyCommandResult[];
}

/** The repo's declared package.json scripts, or null (missing / unreadable / malformed). */
async function readPackageScripts(sandbox: RunSandbox): Promise<Record<string, string> | null> {
  const r = await sandbox.fs({ op: 'read', path: 'package.json' });
  if (!r.ok || typeof r.content !== 'string') return null;
  try {
    const scripts = (JSON.parse(r.content) as { scripts?: unknown }).scripts;
    if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) return null;
    return Object.fromEntries(Object.entries(scripts).filter((e): e is [string, string] => typeof e[1] === 'string'));
  } catch {
    return null;
  }
}

/** The package manager the repo's lockfile names (npm when none does). */
async function detectRunner(sandbox: RunSandbox): Promise<PackageScriptRunner> {
  const atRoot = async (name: string): Promise<boolean> => {
    const listed = await sandbox.fs({ op: 'list', glob: name })
      .catch(reportedFallback(null, { source: 'application/runtime/sandbox/sandboxVerify.ts', operation: 'detectRunner', context: { name } }));
    return (listed?.paths ?? []).includes(name);
  };
  if (await atRoot('pnpm-lock.yaml')) return 'pnpm';
  if (await atRoot('yarn.lock')) return 'yarn';
  return 'npm';
}

/** The sandbox's own command channel — what a caller with no heartbeat-bearing shell
 *  (the run's `sandboxShell`) verifies through. */
function directShell(sandbox: RunSandbox): VerifyShell {
  return { runFor: (command, timeoutMs) => sandbox.run(command, undefined, timeoutMs) };
}

export async function runSandboxVerify(sandbox: RunSandbox, shell: VerifyShell = directShell(sandbox), now: () => number = Date.now): Promise<SandboxVerifyResult> {
  const [packageScripts, runner] = await Promise.all([readPackageScripts(sandbox), detectRunner(sandbox)]);
  const plan = planInRunVerify({ surface: 'sandbox', packageScripts, runner });
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
    results.push({ command, exitCode: typeof r.exitCode === 'number' ? r.exitCode : 1 });
  }
  return { packageScripts, runner, results };
}
