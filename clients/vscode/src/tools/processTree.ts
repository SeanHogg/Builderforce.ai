/**
 * Kill a shell command AND everything it started.
 *
 * A command runs through a shell (`cmd.exe`, `/bin/sh`, or bash), so the pid it hands
 * back is the SHELL's. Killing only that pid — what `exec`'s own `signal` option
 * does — orphans the real work: on Windows `cmd.exe` dies and the `node` / `npm` it
 * started runs on to its 10-minute timeout. So Stop goes through here instead:
 *   - Windows: `taskkill /pid <pid> /T /F`, which walks the tree by parent pid — and
 *     therefore must run BEFORE the shell dies, or its children are already orphaned;
 *   - POSIX: the command was spawned `detached` (its own process group), so the whole
 *     group is signalled with `-pid`; the bare pid is the fallback.
 */

import { execFile, spawn, type ChildProcess, type SpawnOptions } from "child_process";
import { toBashNullDevice } from "@builderforce/agent-tools/node-posix-shell";

/**
 * Start a command so {@link killProcessTree} reaches everything it starts: in its own
 * process group on POSIX; on Windows without `detached`, which would open a console
 * window. Always `spawn` — `exec` / `execFile` do not pass `detached` on, so a command
 * they start shares the editor's group, `kill(-pid)` fails, only the shell dies, and the
 * real process keeps the output pipe open: the run never settles (Linux CI, 2026-10-25).
 * `bash` null ⇒ the platform shell. Output arrives as UTF-8 text, decoded across chunk
 * boundaries. Throws as `spawn` does.
 */
export function spawnCommand(command: string, bash: string | null, options: SpawnOptions): ChildProcess {
  const opts: SpawnOptions = { ...options, windowsHide: true, ...(process.platform === "win32" ? {} : { detached: true }) };
  // Under bash a cmd-style `2>nul` would create an undeletable `nul` file — see toBashNullDevice.
  const child = bash ? spawn(bash, ["-c", toBashNullDevice(command)], opts) : spawn(command, { ...opts, shell: true });
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  return child;
}

/** How long a killed command's pipes may stay open before they are closed from this end. */
const KILL_GRACE_MS = 1_000;

/**
 * Kill a command's tree and make sure its pipes close. A process the kill could not reach
 * — on Windows, a `start /b` grandchild whose shell already exited is out of
 * `taskkill /T`'s walk — would hold them open, and a run waiting on `close` would never
 * settle.
 */
export function stopCommand(child: ChildProcess): void {
  void killProcessTree(child.pid);
  setTimeout(() => {
    child.stdout?.destroy();
    child.stderr?.destroy();
  }, KILL_GRACE_MS).unref?.();
}

/** Kill `pid` and its descendants. Resolves once the kill was issued (never rejects). */
export function killProcessTree(pid: number | undefined): Promise<void> {
  if (!pid) return Promise.resolve();
  if (process.platform === "win32") {
    return new Promise((resolve) => {
      execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => resolve());
    });
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
  return Promise.resolve();
}
