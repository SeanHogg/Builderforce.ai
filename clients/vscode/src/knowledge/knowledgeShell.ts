/**
 * Runs a shell command for the knowledge fix flow (knip's codemod, a project's check script) and
 * keeps the host safe while it does:
 *
 *   - the whole PROCESS TREE dies on timeout or abort (`taskkill /T /F` on Windows, the process
 *     group elsewhere), so a script's grandchildren never outlive the check;
 *   - only the LAST 64 KB of output is kept, ANSI stripped, and what is reported back is capped
 *     at 2 KB;
 *   - `BUILDERFORCE_*` variables are not passed to the child;
 *   - a command that ran and failed (`kind: "exit"`) is told apart from one that could not run.
 */

import { spawn } from "node:child_process";
import { fixText } from "./knowledgeFixText";

export const OUTPUT_TAIL = 64 * 1024;
export const DETAIL_CAP = 2 * 1024;

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;

/** Output without terminal colour and cursor codes. Pure. */
export const stripAnsi = (text: string): string => text.replace(ANSI, "");

/** The environment a child gets: ours, minus every `BUILDERFORCE_*` variable. Pure. */
export function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !k.toUpperCase().startsWith("BUILDERFORCE_")));
}

/** The last `cap` characters of `text + chunk`. Pure. */
export const tailOf = (text: string, chunk: string, cap = OUTPUT_TAIL): string => (text.length + chunk.length <= cap ? text + chunk : (text + chunk).slice(-cap));

export type ShellFailureKind = "exit" | "launch" | "timeout" | "aborted";

/** A command that did not succeed, and why. `output` is the cleaned tail, at most {@link DETAIL_CAP}. */
export class ShellFailure extends Error {
  constructor(readonly kind: ShellFailureKind, message: string, readonly output = "", readonly code: number | null = null) {
    super(message);
    this.name = "ShellFailure";
  }
}

export interface ShellOptions {
  timeoutMs?: number;
  /** Names the tool in error messages (default knip). */
  label?: string;
  /** Did the command do what was asked? Default: knip ran (exit 0, or exit 1 with a report). */
  ok?(code: number | null, stdout: string, stderr: string): boolean;
  /** Kills the process tree when it aborts. */
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 10 * 60_000;

/** Kills `pid` and everything it started. */
export function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => undefined);
    return;
  }
  try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } }
}

const clean = (text: string): string => stripAnsi(text).trim().slice(-DETAIL_CAP);

/** Runs `command` through the shell; rejects with a {@link ShellFailure} unless `ok` (default: knip ran). */
export function runShell(command: string, cwd: string, opts: ShellOptions & { ok(code: number | null, stdout: string, stderr: string): boolean }): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const label = opts.label ?? "knip";
  return new Promise<void>((resolve, reject) => {
    if (opts.signal?.aborted) { reject(new ShellFailure("aborted", fixText.cancelled(label))); return; }
    const windows = process.platform === "win32";
    const child = spawn(command, { cwd, shell: true, windowsHide: true, detached: !windows, stdio: ["ignore", "pipe", "pipe"], env: childEnv(process.env) });
    let stdout = "";
    let stderr = "";
    let end: ShellFailure | undefined;
    child.stdout.on("data", (c: Buffer) => { stdout = tailOf(stdout, c.toString("utf8")); });
    child.stderr.on("data", (c: Buffer) => { stderr = tailOf(stderr, c.toString("utf8")); });
    const stop = (failure: ShellFailure): void => { end ??= failure; killTree(child.pid); };
    const timer = setTimeout(() => stop(new ShellFailure("timeout", fixText.timedOut(label, Math.round(timeoutMs / 1000)))), timeoutMs);
    const onAbort = (): void => stop(new ShellFailure("aborted", fixText.cancelled(label)));
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const done = (): void => { clearTimeout(timer); opts.signal?.removeEventListener("abort", onAbort); };
    child.on("error", (error) => { done(); reject(new ShellFailure("launch", fixText.couldNotRun(label, error.message))); });
    child.on("close", (code) => {
      done();
      if (end) { reject(new ShellFailure(end.kind, end.message, clean(`${stdout}\n${stderr}`), code)); return; }
      if (opts.ok(code, stdout, stderr)) { resolve(); return; }
      reject(new ShellFailure("exit", fixText.failedExit(label, String(code)), clean(stderr || stdout), code));
    });
  });
}
