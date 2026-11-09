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

import { exec, type ExecOptions } from "child_process";
import type { CheckRecord } from "./types";

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
    exec(command, options, (error, _stdout, _stderr) => {
      if (error && typeof (error as { code?: unknown }).code === "number") {
        resolve({ exitCode: (error as { code: number }).code });
      } else if (error) {
        // Killed / failed to start — non-zero, and never a pass.
        resolve({ exitCode: typeof error.code === "number" ? error.code : 1 });
      } else {
        resolve({ exitCode: 0 });
      }
    });
  });

/** The real process runner: honours the timeout, reports the honest exit code. */
export const execRunner: Runner = (command, options) => execAsync(command, options);
