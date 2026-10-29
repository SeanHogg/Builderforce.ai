/**
 * The editor's ONE local shell runner — what `run_command` and the `git_*` tools run
 * through (via `localCapabilities.ts`) and what the workspace's `.builderforce/hooks.json`
 * commands run through (via `hooks/runHooks.ts`). One runner, so a hook command and an
 * agent's command behave identically: the same POSIX-script routing on Windows, the same
 * timeout and output bound, the same result shape.
 */

import * as path from "path";
import type { ChildProcess } from "child_process";
import type { ShellJobStart, ShellJobStatus, ShellResult } from "@builderforce/agent-tools";
import { posixRoute, runRouted } from "@builderforce/agent-tools/node-posix-shell";
import { resolveShellCwd } from "@builderforce/agent-tools/node-path";
import { spawnCommand, stopCommand } from "./processTree";
import { killJob, pollJob, startJob, type JobOwner } from "./localShellJobs";

// Bound a command's wall-clock + the output handed back to the model. Matches the cloud
// Container's COMMAND_TIMEOUT_MS (api/container/server.mjs) — a build/type-check/test
// step may legitimately take minutes (e.g. `tsc --noEmit` or `npm test` on a large
// monorepo), and the old 120s ceiling was killing those runs mid-compile well before
// they could finish.
export const RUN_TIMEOUT_MS = 10 * 60 * 1000;
const RUN_MAX_BUFFER = 4 * 1024 * 1024;
const RUN_MAX_OUTPUT = 60_000;

function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…(${text.length - max} more chars truncated)`;
}

interface Exited { stdout: string; stderr: string; code: number | null; signal: NodeJS.Signals | null; error?: Error }

/**
 * Wait for `child` to exit. Never rejects. A stream past {@link RUN_MAX_BUFFER} calls
 * `onOverflow` once and keeps no more: an unbounded producer (`yes`, `tail -f`, a
 * watcher run in the foreground) is stopped there, not left to the 10-minute bound.
 */
function collect(child: ChildProcess, onOverflow: () => void): Promise<Exited> {
  return new Promise((resolve) => {
    const out = { stdout: "", stderr: "" };
    let overflowed = false;
    for (const key of ["stdout", "stderr"] as const) {
      child[key]?.on("data", (chunk: string) => {
        if (out[key].length < RUN_MAX_BUFFER) out[key] += chunk;
        else if (!overflowed) {
          overflowed = true;
          onOverflow();
        }
      });
    }
    let error: Error | undefined;
    child.on("error", (e) => {
      error = e;
      // A child that never started emits no `close`.
      if (child.pid === undefined) resolve({ ...out, code: null, signal: null, error: e });
    });
    child.on("close", (code, signal) => resolve({ ...out, code, signal, ...(error ? { error } : {}) }));
  });
}

export interface LocalShellOptions {
  /**
   * The directory this command runs in: a workspace-relative path (already validated by the
   * tool: no `..`, not absolute). The command is spawned WITH that working directory — it is
   * never prefixed with a `cd`, which `cmd.exe` and Windows PowerShell 5.1 do not share a
   * grammar for. Omitted ⇒ the shell's root.
   */
  cwd?: string;
  /** Wall-clock bound for this command; defaults to {@link RUN_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Extra environment for this command, layered over the editor's own. */
  env?: Record<string, string>;
  /**
   * Stop. Aborting kills the command's whole process tree (see `processTree.ts`) and
   * the result is `{ ok: false, aborted: true }`; the cmd→bash retry never runs after it.
   */
  signal?: AbortSignal;
}

export interface LocalShell {
  run(command: string, options?: LocalShellOptions): Promise<ShellResult>;
  /** Start a background job (`run_command` background / yieldMs) owned by this shell's run;
   *  it dies when that run settles, and with `signal` when one is given. */
  start(command: string, options?: LocalShellOptions): Promise<ShellJobStart>;
  /** Aborting `signal` ends the WAIT (the status so far); the job runs on. */
  poll(id: string, opts?: { waitMs?: number; signal?: AbortSignal }): Promise<ShellJobStatus>;
  kill(id: string): Promise<ShellJobStatus>;
}

const aborted = (out: string): ShellResult => ({
  ok: false,
  aborted: true,
  error: "stopped — the command and everything it started were killed",
  ...(out ? { stdout: clamp(out, RUN_MAX_OUTPUT) } : {}),
});

/** A shell rooted at `root` (every command's working directory). `jobOwner` is the run
 *  its background jobs belong to (see `localShellJobs.ts`). */
export function createLocalShell(root: string, opts: { jobOwner?: JobOwner } = {}): LocalShell {
  const cwd = path.resolve(root);
  const owner = opts.jobOwner;

  /** Execute once, in a named interpreter. `bash` null ⇒ the platform default shell. */
  async function execOnce(command: string, bash: string | null, options: LocalShellOptions, dir: string): Promise<ShellResult> {
    const timeout = options.timeoutMs ?? RUN_TIMEOUT_MS;
    const signal = options.signal;
    if (signal?.aborted) return aborted("");
    // A POSIX script goes to bash EXPLICITLY (`bash -c <script>`), not through the
    // platform shell with an override: the one thing that must not vary between
    // machines is which interpreter parses `set -e`. A one-liner keeps the default.
    // `spawnCommand` puts it in its own process group, so Stop can kill the group.
    let child: ChildProcess;
    try {
      child = spawnCommand(command, bash, { cwd: dir, ...(options.env ? { env: { ...process.env, ...options.env } } : {}) });
    } catch (e) {
      return { ok: false, exitCode: 1, stdout: e instanceof Error ? e.message : String(e) };
    }
    let overflowed = false;
    const exited = collect(child, () => {
      overflowed = true;
      stopCommand(child);
    });
    // Stop kills the TREE, never just the shell: that orphans the real process — on
    // Windows before `taskkill /T` can walk to it (see `processTree.ts`).
    const onAbort = (): void => stopCommand(child);
    // The wall-clock bound kills the TREE too, for the same reason.
    let timedOut = false;
    const onTimeout = setTimeout(() => {
      timedOut = true;
      stopCommand(child);
    }, timeout);
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const r = await exited;
      const out = [r.stdout, r.stderr].filter((s) => s.trim()).join("\n").trim();
      if (signal?.aborted) return aborted(out);
      if (overflowed) {
        return { ok: false, error: `stopped — it printed more than ${RUN_MAX_BUFFER / (1024 * 1024)}MB of output`, stdout: clamp(out, RUN_MAX_OUTPUT) };
      }
      if (r.code === 0 && !r.error) return { ok: true, exitCode: 0, stdout: clamp(out || "(no output)", RUN_MAX_OUTPUT) };
      if (timedOut || r.signal === "SIGTERM") {
        return { ok: false, error: `timed out after ${timeout / 1000}s`, stdout: clamp(out, RUN_MAX_OUTPUT) };
      }
      return { ok: false, exitCode: r.code ?? 1, stdout: clamp(out || r.error?.message || "(no output)", RUN_MAX_OUTPUT) };
    } finally {
      clearTimeout(onTimeout);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  return {
    async run(command: string, options: LocalShellOptions = {}): Promise<ShellResult> {
      const where = resolveShellCwd(cwd, options.cwd);
      if (!where.ok) return { ok: false, error: where.error };
      // Which interpreter, and the one cmd→bash retry, are THE shared routing rule.
      return runRouted(command, (bash) => execOnce(command, bash, options, where.dir), options.signal);
    },
    async start(command: string, options: LocalShellOptions = {}): Promise<ShellJobStart> {
      const route = posixRoute(command);
      if ("error" in route) return { ok: false, error: route.error };
      const where = resolveShellCwd(cwd, options.cwd);
      if (!where.ok) return { ok: false, error: where.error };
      return startJob(command, {
        cwd: where.dir,
        bash: route.bash,
        maxOutput: RUN_MAX_OUTPUT,
        ...(owner !== undefined ? { owner } : {}),
        ...(options.env ? { env: options.env } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    },
    poll: (id, poll) => pollJob(id, poll?.waitMs ?? 0, { owner, ...(poll?.signal ? { signal: poll.signal } : {}) }),
    kill: (id) => killJob(id, owner),
  };
}
