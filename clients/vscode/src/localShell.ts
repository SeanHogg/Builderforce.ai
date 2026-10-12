/**
 * The editor's ONE local shell runner — what `run_command` and the `git_*` tools run
 * through (via `localCapabilities.ts`) and what the workspace's `.builderforce/hooks.json`
 * commands run through (via `hooks/runHooks.ts`). One runner, so a hook command and an
 * agent's command behave identically: the same POSIX-script routing on Windows, the same
 * timeout and output bound, the same result shape.
 */

import * as path from "path";
import { exec, execFile } from "child_process";
import { promisify } from "util";
import type { ShellResult } from "@builderforce/agent-tools";
import { needsPosixShell, findBash, posixShellOption, cmdCannotRun } from "./posixShell";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

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

export interface LocalShellOptions {
  /** Wall-clock bound for this command; defaults to {@link RUN_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Extra environment for this command, layered over the editor's own. */
  env?: Record<string, string>;
}

export interface LocalShell {
  run(command: string, options?: LocalShellOptions): Promise<ShellResult>;
}

/** A shell rooted at `root` (every command's working directory). */
export function createLocalShell(root: string): LocalShell {
  const cwd = path.resolve(root);

  /** Execute once, in a named interpreter. `bash` null ⇒ the platform default shell. */
  async function execOnce(command: string, bash: string | null, options: LocalShellOptions): Promise<ShellResult> {
    const timeout = options.timeoutMs ?? RUN_TIMEOUT_MS;
    const common = {
      cwd,
      timeout,
      maxBuffer: RUN_MAX_BUFFER,
      windowsHide: true,
      ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
    };
    try {
      // A POSIX script goes to bash EXPLICITLY (`bash -c <script>`), not through the
      // platform shell with an override: the one thing that must not vary between
      // machines is which interpreter parses `set -e`. A one-liner keeps the default.
      const { stdout, stderr } = bash
        ? await execFileAsync(bash, ["-c", command], common)
        : await execAsync(command, common);
      const out = [stdout, stderr].filter((s) => s && s.trim()).join("\n").trim();
      return { ok: true, exitCode: 0, stdout: clamp(out || "(no output)", RUN_MAX_OUTPUT) };
    } catch (e) {
      const err = e as { code?: number | string; killed?: boolean; signal?: string; stdout?: string; stderr?: string; message?: string };
      const out = [err.stdout, err.stderr].filter((s) => s && String(s).trim()).join("\n").trim();
      if (err.killed || err.signal === "SIGTERM") {
        return { ok: false, error: `timed out after ${timeout / 1000}s`, stdout: clamp(out, RUN_MAX_OUTPUT) };
      }
      const code = typeof err.code === "number" ? err.code : 1;
      return { ok: false, exitCode: code, stdout: clamp(out || err.message || "(no output)", RUN_MAX_OUTPUT) };
    }
  }

  return {
    async run(command: string, options: LocalShellOptions = {}): Promise<ShellResult> {
      // A POSIX script with no POSIX shell to run it must say so. Letting it through
      // hands the script to `cmd.exe`, which parses `set -e` as its own builtin and
      // fails with "Environment variable -e not defined" — a message that names
      // neither the cause nor anything the agent could do about it.
      if (needsPosixShell(command) && !findBash()) {
        return {
          ok: false,
          error:
            "this command needs a POSIX shell (it uses set -e / $(…) / [ … ], or a unix utility such as head/grep/sed that cmd.exe does not have) "
            + "and no POSIX shell was found on this Windows machine. "
            + "Install Git for Windows (which ships bash), or re-run the work as plain single-line commands instead.",
        };
      }
      const bash = posixShellOption(command).shell ?? null;
      const first = await execOnce(command, bash, options);
      if (first.ok || bash) return first;
      // cmd.exe could not even ATTEMPT the command — an unlisted unix utility, a
      // single-quoted argument, a `$VAR`. `needsPosixShell` is a whitelist and will
      // always be incomplete, so the failure that reaches the agent must not be
      // `'head' is not recognized as an internal or external command`: retry once in
      // bash, which is what the command was written for. A genuine non-zero exit from
      // a program that DID run (a failing build) does not match, so nothing that
      // legitimately failed is run twice.
      const retryBash = findBash();
      if (!retryBash || !cmdCannotRun(first.stdout ?? "")) return first;
      return execOnce(command, retryBash, options);
    },
  };
}
