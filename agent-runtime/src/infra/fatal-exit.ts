/**
 * The ONE terminal-crash path: print it, file it, exit.
 *
 * Three entry points installed the same `uncaughtException` handler verbatim
 * (`cli/run-main.ts`, `index.ts`, `macos/relay.ts`) and the unhandled-rejection
 * handler open-coded `console.error` + `process.exit(1)` at three more branches.
 * Six copies of "the process is going down because of this error" is six places
 * that have to be edited to make a crash reportable, which is exactly why none of
 * them were.
 *
 * The remote report is opt-in and best-effort (see `platform-error-reporter.ts`):
 * with reporting off this costs one boolean read before the exit that would have
 * happened anyway.
 */
import process from "node:process";

import { logDebug } from "../logger.js";
import { formatUncaughtError } from "./errors.js";
import { isPlatformErrorReportingEnabled, sendRuntimeErrorReport } from "./platform-error-reporter.js";

/** Longest a crash may wait for its report before the process goes down regardless. */
const REPORT_DEADLINE_MS = 5_000;

export interface FatalExitOptions {
  /** The seam that died, e.g. `uncaughtException` or `unhandledRejection:fatal`. */
  operation: string;
  /** Console prefix, kept per-call so existing crash output is unchanged. */
  label: string;
  /** Workspace whose Builderforce link addresses the report. */
  workspaceDir?: string | undefined;
  exitCode?: number;
}

/**
 * Print a terminal error, file it when the operator opted in, then exit.
 *
 * Awaits the report under a hard deadline: a crash report that hangs must not turn
 * a fast crash into a wedged process.
 */
export async function reportAndExit(error: unknown, options: FatalExitOptions): Promise<never> {
  console.error(options.label, formatUncaughtError(error));

  if (isPlatformErrorReportingEnabled()) {
    await Promise.race([
      sendRuntimeErrorReport(error, {
        operation: options.operation,
        level: "fatal",
        workspaceDir: options.workspaceDir ?? process.cwd(),
      }),
      new Promise<void>((resolve) => setTimeout(resolve, REPORT_DEADLINE_MS).unref?.()),
    ]).catch((reportingError) => {
      // Terminal: routing this back through the reporter would recurse into the
      // handler that is already running. The file log is the last stop.
      logDebug(`[fatal-exit] crash report failed: ${String(reportingError)}`);
    });
  }

  process.exit(options.exitCode ?? 1);
  // `process.exit` does not return; this satisfies the `never` contract.
  throw error;
}

/**
 * Install the process-wide `uncaughtException` handler. Call once per entry point.
 *
 * @param workspaceDir The workspace whose Builderforce link addresses reports.
 */
export function installUncaughtExceptionHandler(workspaceDir?: string): void {
  process.on("uncaughtException", (error) => {
    void reportAndExit(error, {
      operation: "uncaughtException",
      label: "[builderforce] Uncaught exception:",
      workspaceDir,
    });
  });
}
