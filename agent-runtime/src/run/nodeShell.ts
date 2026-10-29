/**
 * `buildNodeShell` — the on-prem host's `ShellCapability`: a real shell on this machine,
 * in the run's working tree (`run_command`'s backing).
 *
 * One reason to change: HOW a foreground command runs here. WHERE it runs (`cwd`, the
 * run's default checkout) is the shared `run_command` tool's job, which scopes the
 * command line itself; WHETHER it may run (governance gates) is the agent's policy.
 *
 * Stop reaches the process: aborting `opts.signal` kills the command's whole tree
 * (`killProcessTree`, the same kill the native exec tool uses) and the result comes back
 * `{ ok: false, aborted: true }`. A command that outlives the foreground ceiling is killed
 * and reported as not finished — never as a pass.
 */

import { spawn } from "node:child_process";
import type { ShellCapability, ShellResult, ShellRunOptions } from "@builderforce/agent-tools";
import { getShellConfig, killProcessTree } from "../agents/shell-utils.js";

/** The foreground ceiling: a command that needs longer belongs in a background job. */
export const SHELL_FOREGROUND_TIMEOUT_MS = 10 * 60 * 1000;
/** The most output kept per command; earlier output is dropped and the result says so. */
export const SHELL_OUTPUT_CAP_CHARS = 200_000;

export interface NodeShellOptions {
  /** Absolute working directory every command starts in. */
  cwd: string;
  /** The run's default checkout (`ShellCapability.defaultRepo`), when the root holds several. */
  defaultRepo?: string;
  /** Test seam: the foreground ceiling. */
  timeoutMs?: number;
}

/** The ceiling as the model reads it: whole minutes, or seconds for a short test ceiling. */
function ceilingLabel(ms: number): string {
  return ms >= 60_000 ? `${Math.round(ms / 60_000)} minutes` : `${Math.max(1, Math.round(ms / 1000))} seconds`;
}

/**
 * The program and argv that run `command` in this platform's shell. On Windows the shell is
 * PowerShell, which would otherwise be handed the command through argv quoting (nested
 * quotes arrive mangled) and would report exit code 1 for ANY failed native program; so the
 * script goes in as `-EncodedCommand` (no quoting at all) and ends by exiting with the last
 * native program's own code.
 */
export function shellInvocation(command: string): { shell: string; args: string[] } {
  const { shell, args } = getShellConfig();
  if (process.platform !== "win32") return { shell, args: [...args, command] };
  const script = `${command}
if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }`;
  return { shell, args: [...args.slice(0, -1), "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")] };
}

/** Run one command to completion (or abort, or the ceiling). Never throws. */
function runForeground(command: string, options: NodeShellOptions, runOpts?: ShellRunOptions): Promise<ShellResult> {
  const signal = runOpts?.signal;
  const ceiling = options.timeoutMs ?? SHELL_FOREGROUND_TIMEOUT_MS;
  if (signal?.aborted) return Promise.resolve({ ok: false, aborted: true, error: "aborted before it started" });

  return new Promise<ShellResult>((resolve) => {
    const { shell, args } = shellInvocation(command);
    const child = spawn(shell, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      // A process group on POSIX, so the kill reaches the command's children too.
      detached: process.platform !== "win32",
    });

    let output = "";
    let dropped = false;
    let settled = false;
    const onData = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      if (output.length > SHELL_OUTPUT_CAP_CHARS) {
        output = output.slice(output.length - SHELL_OUTPUT_CAP_CHARS);
        dropped = true;
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    const finish = (result: ShellResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      const stdout = dropped ? `[earlier output dropped]\n${output}` : output;
      resolve({ ...result, stdout });
    };
    const kill = (): void => {
      if (child.pid !== undefined) killProcessTree(child.pid);
    };
    const onAbort = (): void => {
      kill();
      finish({ ok: false, aborted: true, error: "the command was stopped" });
    };
    const timer = setTimeout(() => {
      kill();
      finish({ ok: false, error: `the command did not finish within ${ceilingLabel(ceiling)} and was killed` });
    }, ceiling);

    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (err) => finish({ ok: false, error: err.message }));
    child.on("close", (code) => finish({ ok: code === 0, ...(code !== null ? { exitCode: code } : {}) }));
  });
}

/** The on-prem shell: foreground commands in `options.cwd`, killed with the run's Stop. */
export function buildNodeShell(options: NodeShellOptions): ShellCapability {
  return {
    ...(options.defaultRepo ? { defaultRepo: options.defaultRepo } : {}),
    run: (command, runOpts) => runForeground(command, options, runOpts),
  };
}
