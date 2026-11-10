/**
 * The process runner the verifier's shell port uses — the SAME primitive the host
 * uses for `run_command`. It returns the REAL process exit code (never one parsed
 * out of the model's own output) and applies the check's wall-clock budget: a
 * command that cannot finish is killed and reported exit 124 (`DID_NOT_FINISH`),
 * which the evidence ledger records "unavailable", never "pass" (OD-3).
 *
 * Windows: a package-manager command must be launched through its `.cmd` shim
 * (`pnpm.cmd`, `npm.cmd`) — a bare `spawn("pnpm")` without a shell cannot start a
 * batch file on win32. `windowsCommand` in `typecheck.ts` rewrites the command;
 * here the runner also honours `windowsVerbatimArguments` and `shell: false` so the
 * shim is exec'd exactly as written.
 */

import { exec, execFile, type ExecOptions } from "child_process";

export interface Runner {
  (command: string, options: ExecOptions): Promise<{ exitCode?: number }>;
}

export interface ExecResult {
  exitCode?: number;
}

/** The conventional exit code of a command stopped by its time limit. */
export const DID_NOT_FINISH = 124;

const execAsync = (command: string, options: ExecOptions): Promise<ExecResult> =>
  new Promise((resolve) => {
    exec(command, { windowsHide: true, ...options }, (error, _stdout, _stderr) => {
      if (!error) {
        resolve({ exitCode: 0 });
      } else if ((error as { killed?: boolean }).killed && options.timeout) {
        // Stopped by its time limit: the check could not finish — "unavailable", never a fail or a pass.
        resolve({ exitCode: DID_NOT_FINISH });
      } else if (typeof (error as { code?: unknown }).code === "number") {
        resolve({ exitCode: (error as { code: number }).code });
      } else {
        // Killed / failed to start — non-zero, and never a pass.
        resolve({ exitCode: 1 });
      }
    });
  });

/** The real process runner: honours the timeout, reports the honest exit code. */
export const execRunner: Runner = (command, options) => execAsync(command, options);

/** git's own budget per plumbing query. */
const GIT_TIMEOUT_MS = 30_000;

/**
 * The host's git for the GitPort: `execFile` (no shell, no quoting surface — `git.exe` is a
 * real executable on Windows, not a `.cmd` shim), stdout plus the real exit code.
 */
export const gitRunner = (args: readonly string[], opts: { cwd: string }): Promise<{ stdout: string; exitCode: number }> =>
  new Promise((resolve) => {
    execFile("git", ["--no-optional-locks", ...args], { cwd: opts.cwd, windowsHide: true, timeout: GIT_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
      const code = (error as { code?: unknown } | null)?.code;
      resolve({ stdout: String(stdout ?? ""), exitCode: !error ? 0 : typeof code === "number" ? code : 1 });
    });
  });
