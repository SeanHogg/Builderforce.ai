/**
 * `@builderforce/agent-tools/node-process` — the ONE way to stop a process TREE, and to run one
 * tool and stop it (`runTree`), for every Node surface (the editor, the on-prem runtime).
 * A SEPARATE subpath for the same reason as `node-path`: it imports `node:child_process`, so the
 * node-builtin-free package root (the Worker imports it) must not reach it.
 *
 * On timeout, abort or overflow the WHOLE tree is killed, not just the direct child: a test runner,
 * a package manager or StrykerJS starts workers of its own, which would otherwise keep running.
 *
 *  - POSIX: the child starts `detached` (its own process group) and the group is signalled (`-pid`),
 *    the bare pid as the fallback.
 *  - Windows: `taskkill /T` (+ `/F` for a hard kill), taskkill resolved from `%SystemRoot%\System32`
 *    — NEVER PATH, so a `taskkill` the workspace put on PATH can never run. With no known system
 *    folder the direct pid is signalled instead.
 *
 * Two shapes, one implementation: {@link killTree} with no `graceMs` is a hard kill now;
 * with `graceMs` it asks first (SIGTERM / `taskkill` without `/F`) and force-kills what is still
 * alive after the grace. {@link killProcessTree} is the graceful form with the runtime's default grace.
 *
 * Failures other than "the process is already gone" are REPORTED through `onError` (default: a
 * process warning), never swallowed.
 */

import { spawn } from "node:child_process";

export const DEFAULT_KILL_GRACE_MS = 3000;
const MAX_KILL_GRACE_MS = 60_000;

export interface KillTreeOptions {
  /** Ask first (SIGTERM / `taskkill` without `/F`) and force-kill after this many ms if still alive. Omitted: hard kill now. */
  graceMs?: number;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** Receives every failure that is not "already gone". Default: `process.emitWarning`. */
  onError?: (error: unknown) => void;
}

/** `taskkill.exe` from the Windows system folder; undefined when the system folder is unknown. */
export function taskkillPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const root = env.SystemRoot ?? env.SYSTEMROOT ?? env.windir;
  return root ? `${root.replace(/[\\/]+$/, "")}\\System32\\taskkill.exe` : undefined;
}

function isGone(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ESRCH" || /ESRCH/.test(String((error as Error | undefined)?.message ?? error));
}

function report(pid: number, error: unknown, onError: KillTreeOptions["onError"]): void {
  if (isGone(error)) return;
  if (onError) onError(error);
  else process.emitWarning(`killTree(${pid}): ${error instanceof Error ? error.message : String(error)}`);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false; // signal 0 throws exactly when the process is not there — that IS the answer
  }
}

function signal(pid: number, sig: NodeJS.Signals, onError: KillTreeOptions["onError"]): boolean {
  try {
    process.kill(pid, sig);
    return true;
  } catch (error) {
    report(pid, error, onError);
    return false;
  }
}

function runTaskkill(pid: number, args: string[], env: NodeJS.ProcessEnv, onError: KillTreeOptions["onError"]): boolean {
  const exe = taskkillPath(env);
  if (!exe) return false;
  try {
    const child = spawn(exe, args, { windowsHide: true, stdio: "ignore", detached: true });
    child?.on("error", (error) => report(pid, error, onError));
    return true;
  } catch (error) {
    report(pid, error, onError);
    return false;
  }
}

function normalizeGraceMs(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(MAX_KILL_GRACE_MS, Math.floor(value))) : DEFAULT_KILL_GRACE_MS;
}

/** Kills `pid` and every process it started (hard now, or graceful with `graceMs`). Never throws. */
export function killTree(pid: number, opts: KillTreeOptions = {}): void {
  if (!Number.isFinite(pid) || pid <= 0) return;
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const { onError } = opts;
  const graceMs = opts.graceMs === undefined ? undefined : normalizeGraceMs(opts.graceMs);

  if (platform === "win32") {
    if (graceMs === undefined) {
      if (!runTaskkill(pid, ["/T", "/F", "/PID", String(pid)], env, onError)) signal(pid, "SIGKILL", onError);
      return;
    }
    if (!runTaskkill(pid, ["/T", "/PID", String(pid)], env, onError)) signal(pid, "SIGTERM", onError);
    // Force-kill only if the pid still exists, so a graceful exit is never followed by an unconditional /F.
    setTimeout(() => {
      if (!isAlive(pid)) return;
      if (!runTaskkill(pid, ["/F", "/T", "/PID", String(pid)], env, onError)) signal(pid, "SIGKILL", onError);
    }, graceMs).unref();
    return;
  }

  if (graceMs === undefined) {
    // The child's process group (it was started detached), the bare pid as the fallback.
    if (!signal(-pid, "SIGKILL", onError)) signal(pid, "SIGKILL", onError);
    return;
  }
  if (!signal(-pid, "SIGTERM", onError) && !signal(pid, "SIGTERM", onError)) return; // already gone
  setTimeout(() => {
    if (isAlive(-pid) && signal(-pid, "SIGKILL", onError)) return;
    if (isAlive(pid)) signal(pid, "SIGKILL", onError);
  }, graceMs).unref(); // never holds the event loop open
}

/** The graceful form: SIGTERM / `taskkill`, then a force-kill after `graceMs` (default {@link DEFAULT_KILL_GRACE_MS}). */
export function killProcessTree(pid: number, opts?: { graceMs?: number }): void {
  killTree(pid, { graceMs: opts?.graceMs ?? DEFAULT_KILL_GRACE_MS });
}

export interface TreeRunOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxBuffer: number;
  signal?: AbortSignal;
  windowsVerbatimArguments?: boolean;
}

export interface TreeRunResult {
  /** False: the program could not be launched (ENOENT, EACCES, EINVAL). */
  started: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  overflow?: boolean;
}

const NOT_STARTED = new Set(["ENOENT", "EACCES", "EINVAL"]);

/** Runs `file args…` (argv only, no shell, bounded output) and collects its output; on timeout, abort or overflow kills its whole tree. Never rejects. */
export function runTree(file: string, args: readonly string[], opts: TreeRunOptions): Promise<TreeRunResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(file, [...args], {
        cwd: opts.cwd, env: opts.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
        ...(opts.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
      });
    } catch {
      // A throwing spawn IS "not started": the result says so, and the caller reports it.
      resolve({ started: false, exitCode: null, stdout: "", stderr: "" });
      return;
    }
    let stdout = "", stderr = "", size = 0, timedOut = false, overflow = false, done = false;
    const kill = (): void => { if (child.pid !== undefined) killTree(child.pid); };
    const timer = setTimeout(() => { timedOut = true; kill(); }, Math.max(1, opts.timeoutMs));
    const onAbort = (): void => { timedOut = true; kill(); };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const finish = (result: TreeRunResult): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const take = (into: "out" | "err") => (chunk: string): void => {
      size += chunk.length;
      if (size > opts.maxBuffer) { if (!overflow) { overflow = true; kill(); } return; }
      if (into === "out") stdout += chunk; else stderr += chunk;
    };
    child.stdout?.setEncoding("utf8").on("data", take("out"));
    child.stderr?.setEncoding("utf8").on("data", take("err"));
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (NOT_STARTED.has(String(error.code))) finish({ started: false, exitCode: null, stdout: "", stderr: "" });
      else { kill(); finish({ started: true, exitCode: null, stdout, stderr, ...(timedOut ? { timedOut } : {}), ...(overflow ? { overflow } : {}) }); }
    });
    child.on("close", (code) => {
      finish({
        started: true, exitCode: timedOut || overflow ? null : code, stdout, stderr,
        ...(timedOut && !overflow ? { timedOut } : {}), ...(overflow ? { overflow } : {}),
      });
    });
    if (opts.signal?.aborted) onAbort();
  });
}
