/**
 * THE editor's way to stop a process TREE (and the run delta's way to start one tool and stop it): `killTree` for every
 * caller that owns a child (the knowledge shell `knowledgeShell.ts`, the verify runner `verify/execRunner.ts`), and
 * `runTree` for the run delta's tools (`nodeAnalyzerExec`: argv only, no shell, bounded output, a timeout and an abort
 * signal). On timeout, abort or overflow the WHOLE PROCESS TREE is killed, not just the direct child: a test runner, a
 * package manager or StrykerJS starts workers of its own, which would otherwise keep running (and writing).
 *
 *  - POSIX: the child starts `detached` (its own process group), and the group is killed: `process.kill(-pid, 'SIGKILL')`.
 *  - Windows: `taskkill /T /F /PID <pid>`, taskkill resolved from `%SystemRoot%\System32` (never PATH — a `taskkill` the
 *    workspace put on PATH must never run).
 *
 * Callers hold `child.pid`, which is undefined when the spawn failed: they return early instead of calling `killTree`.
 */

import { spawn } from "node:child_process";

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

/** `taskkill.exe` from the Windows system folder; undefined when the system folder is unknown. */
export function taskkillPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const root = env.SystemRoot ?? env.SYSTEMROOT ?? env.windir;
  return root ? `${root.replace(/[\\/]+$/, "")}\\System32\\taskkill.exe` : undefined;
}

/** Kills `pid` and every process it started. Never throws. */
export function killTree(pid: number, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): void {
  if (platform === "win32") {
    const taskkill = taskkillPath(env);
    if (taskkill) {
      try {
        spawn(taskkill, ["/T", "/F", "/PID", String(pid)], { windowsHide: true, stdio: "ignore" }).on("error", () => undefined);
        return;
      } catch { /* fall through to the direct child */ }
    }
    try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
    return;
  }
  try {
    process.kill(-pid, "SIGKILL"); // the child's process group (it was started detached)
  } catch {
    try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
  }
}

const NOT_STARTED = new Set(["ENOENT", "EACCES", "EINVAL"]);

/** Runs `file args…` and collects its output; on timeout, abort or overflow kills its whole tree. Never rejects. */
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
