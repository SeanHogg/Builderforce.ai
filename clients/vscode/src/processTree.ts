/**
 * Kill a shell command AND everything it started.
 *
 * `exec` runs a command through a shell (`cmd.exe`, `/bin/sh`, or bash), so the pid it
 * hands back is the SHELL's. Killing only that pid — what `exec`'s own `signal` option
 * does — orphans the real work: on Windows `cmd.exe` dies and the `node` / `npm` it
 * started runs on to its 10-minute timeout. So Stop goes through here instead:
 *   - Windows: `taskkill /pid <pid> /T /F`, which walks the tree by parent pid — and
 *     therefore must run BEFORE the shell dies, or its children are already orphaned;
 *   - POSIX: the command was spawned `detached` (its own process group), so the whole
 *     group is signalled with `-pid`; the bare pid is the fallback.
 */

import { execFile } from "child_process";

/** Spread into `exec` / `spawn` options: its own process group on POSIX (so the group
 *  can be killed); nothing on Windows, where `detached` would open a console window. */
export function processGroupOption(): { detached?: boolean } {
  return process.platform === "win32" ? {} : { detached: true };
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
