import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Run POSIX shell scripts on Windows.
 *
 * `child_process.exec` uses the platform default shell, which on Windows is
 * `cmd.exe`. Several of the shared git tools are not single commands but small sh
 * scripts — `git_sync_latest` opens with `set -e` and resolves the base branch
 * through `$(git remote show origin | sed …)`, and `git_undo` / `git_redo` guard a
 * dirty tree with `[ -z "$(git status --porcelain)" ] || { … }`. Handed to `cmd.exe`,
 * the very first line is parsed as its `set` builtin and the tool fails with
 * `Environment variable -e not defined`, which is what a real run reported. All three
 * tools were therefore dead on Windows, and the message named nothing a reader could
 * act on.
 *
 * Those scripts are POSIX by construction and shared byte-for-byte with the cloud
 * Container (which runs a real sh), so the fix belongs at the point of execution, not
 * in the command text: detect a script that needs sh and run it under `bash`. Any
 * machine with git on Windows has one — Git for Windows ships it beside `git.exe` —
 * so this is found via git's own install rather than by hoping it is on `PATH`.
 *
 * Ordinary one-liners are untouched and keep running in the platform default shell,
 * so nothing that worked before changes.
 */

/**
 * Constructs that only a POSIX shell understands. Deliberately narrow: each is a
 * shell CONTROL form, not something that merely looks unixy, so a plain command with
 * a forward-slash path is never misrouted.
 */
const POSIX_ONLY = [
  /(^|\n)\s*set\s+-[a-z]/,      // `set -e`
  /\$\((?!\()/,                  // command substitution `$(…)`
  /(^|\s)\[\s/,                  // the `[ … ]` test builtin
  /\|\|\s*\{/,                   // `… || { …; }` grouping
  /(^|\n)\s*export\s+\w+=/,      // `export VAR=…`
];

/** Does this command require a POSIX shell to run correctly? */
export function needsPosixShell(command: string): boolean {
  return POSIX_ONLY.some((re) => re.test(command));
}

/** Cached bash lookup — resolving it walks the filesystem, and the shell capability
 *  is called once per tool step. `undefined` = not looked up yet, `null` = absent. */
let cachedBash: string | null | undefined;

/**
 * Locate a POSIX shell. Prefers Git for Windows' own bash (guaranteed present
 * wherever the git tools can work at all), then the WSL/MSYS conventional paths.
 * Returns null when none exists, so the caller degrades rather than throwing.
 */
export function findBash(
  env: NodeJS.ProcessEnv = process.env,
  // Injectable so the ABSENT branch — the one that produces the user-facing error —
  // is testable on a machine that happens to have bash installed.
  exists: (p: string) => boolean = (p) => { try { return fs.existsSync(p); } catch { return false; } },
): string | null {
  if (cachedBash !== undefined) return cachedBash;
  cachedBash = bashCandidates(env).find(exists) ?? null;
  return cachedBash;
}

/** Where a POSIX shell lives, most-specific first. Pure, so the order is testable. */
export function bashCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const candidates: string[] = [];
  // Git for Windows: `…\Git\cmd\git.exe` → `…\Git\bin\bash.exe`. Joined with
  // `path.win32` rather than `path.join`: these are Windows paths whatever the host
  // is, and the platform-sensitive join emits `/` separators when this runs — as the
  // tests do — on Linux.
  for (const key of ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"]) {
    const base = env[key];
    if (base) candidates.push(path.win32.join(base, "Git", "bin", "bash.exe"), path.win32.join(base, "Programs", "Git", "bin", "bash.exe"));
  }
  candidates.push("C:\\Program Files\\Git\\bin\\bash.exe", "/bin/bash", "/usr/bin/bash");
  return candidates;
}

/** Test seam: forget the cached lookup. */
export function resetBashCache(): void {
  cachedBash = undefined;
}

/**
 * The `shell` option to spread into an `exec` call for this command — a bash path
 * when the command needs POSIX and one was found, otherwise nothing at all (the
 * platform default shell, exactly as before).
 *
 * On a non-Windows host the default shell is already `/bin/sh`, so this is a no-op
 * there and the probe never runs.
 */
export function posixShellOption(command: string): { shell?: string } {
  if (process.platform !== "win32" || !needsPosixShell(command)) return {};
  const bash = findBash();
  return bash ? { shell: bash } : {};
}
