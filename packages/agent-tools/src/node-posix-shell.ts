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
const POSIX_ONLY_CONTROL = [
  /(^|\n)\s*set\s+-[a-z]/,      // `set -e`
  /(^|\s)\[\s/,                  // the `[ … ]` test builtin
  /\|\|\s*\{/,                   // `… || { …; }` grouping
  /(^|\n)\s*export\s+\w+=/,      // `export VAR=…`
];
/** `$(…)` command substitution - POSIX, but Windows PowerShell's `$(…)` subexpression reads it too. */
const COMMAND_SUBSTITUTION = /\$\((?!\()/;
const POSIX_ONLY = [...POSIX_ONLY_CONTROL, COMMAND_SUBSTITUTION];

/**
 * Coreutils that DO NOT EXIST as `cmd.exe` commands, so invoking one there fails with
 * `'head' is not recognized as an internal or external command` — a real reported
 * failure from `git log --oneline | head -5`.
 *
 * The control-form list above catches scripts the git tools BUILD; this catches the
 * one-liners a model WRITES, which are ordinary unix pipelines with no `set -e` or
 * `$(…)` anywhere in them. Both routes end at the same bash.
 *
 * Deliberately excludes every name cmd.exe also has — `sort`, `find`, `more`, `mkdir`,
 * `echo`, `type`, `del` — even where the flags differ: routing those would change the
 * behaviour of commands that work today, and the {@link cmdCannotRun} retry below
 * covers them if they ever do fail.
 */
const POSIX_UTILITIES: ReadonlySet<string> = new Set([
  "head", "tail", "grep", "egrep", "fgrep", "sed", "awk", "gawk", "wc", "cut", "tr",
  "uniq", "xargs", "basename", "dirname", "cat", "ls", "rm", "cp", "mv", "touch",
  "which", "pwd", "chmod", "ln", "du", "df", "tee", "sleep", "test", "seq", "diff",
]);

/** Split a command into its pipeline/chain segments — the positions a COMMAND WORD can
 *  start at (`|`, `||`, `&&`, `;`, and newlines), each trimmed of leading parentheses. Quotes are not
 *  parsed: a separator inside a string can only ever cause an extra (harmless) bash route, never a miss.
 *  The ONE segmenter: {@link commandWords} and the PowerShell flag check both read it. */
function segments(command: string): string[] {
  return command.split(/\|\||&&|[|;\n]/).map((seg) => seg.trim().replace(/^\(+\s*/, ""));
}

function commandWords(command: string): string[] {
  return segments(command)
    // Skip `VAR=value cmd` prefixes and redirections to reach the real verb.
    .map((seg) => seg.replace(/^(?:\w+=\S*\s+)+/, ""))
    .map((seg) => (/^[\w./-]+/.exec(seg)?.[0] ?? ""))
    // A path-qualified invocation (`./scripts/x.sh`, `node_modules/.bin/tsc`) is not a
    // bare utility name — take the basename so `/usr/bin/head` still matches.
    .map((word) => word.slice(word.lastIndexOf("/") + 1))
    .filter(Boolean);
}

/**
 * Utilities Windows PowerShell already has under the same name (aliases), so on a machine whose
 * default shell IS PowerShell a plain `ls src` / `cat f` / `rm f` runs there and is no reason to demand
 * bash. NOT `diff`: that is `Compare-Object`, which compares ARGUMENT STRINGS - it runs, and answers wrong.
 */
const POWERSHELL_ALIASED: ReadonlySet<string> = new Set(["cat", "ls", "rm", "cp", "mv", "pwd", "sleep", "tee"]);

/**
 * Verbs whose PowerShell meaning is NOT the unix one once a unix flag is handed to them: the aliases above,
 * plus `find` (Windows' find.exe: a text filter), `curl` / `wget` (aliases of Invoke-WebRequest), `kill`
 * (Stop-Process) and `echo` (Write-Output). Plain, flagless use of the aliased ones still runs.
 */
const POWERSHELL_FLAG_SENSITIVE: ReadonlySet<string> = new Set([...POWERSHELL_ALIASED, "find", "curl", "wget", "kill", "echo"]);

/**
 * A flag-sensitive verb handed a unix `-flag` (`rm -rf`, `ls -la`, `cat -n`, `mv -f`, `curl -s`): the alias
 * binds the flag to a Cmdlet parameter by prefix, or not at all, so the command fails or does something
 * else. A token is a PowerShell PARAMETER only if it is a capitalised word (`-Force`, `-Recurse`, `-Path`):
 * every other `-token` is a unix flag - `-R`, `-A`, `-Rf`, `-KILL`, `-9`, `-L`, `--long` - however it is
 * cased, because a one- or two-letter capital is a unix flag (`ls -R`, `rm -Rf`), not a parameter name. No
 * exceptions for the unix forms on purpose - `cp -r` happens to bind to -Recurse, but a list of forms that
 * bind goes stale.
 */
const POWERSHELL_PARAMETER = /^-[A-Z][a-z]{2,}[A-Za-z]*$/;
const isUnixFlag = (token: string | undefined): boolean => !!token && token.length > 1 && token.startsWith("-") && !POWERSHELL_PARAMETER.test(token);

/** Verbs whose flags may come AFTER their operands (`find . -name x`, `curl url -o f`, `wget -O f url`). */
const FLAGS_ANYWHERE: ReadonlySet<string> = new Set(["find", "curl", "wget"]);

function aliasedWithUnixFlag(bare: string): boolean {
  return segments(bare).some((segment) => {
    const [verb, ...args] = segment.split(/\s+/);
    if (!verb || !POWERSHELL_FLAG_SENSITIVE.has(verb)) return false;
    return FLAGS_ANYWHERE.has(verb) ? args.some(isUnixFlag) : isUnixFlag(args[0]);
  });
}

/** Shell syntax PowerShell 5.1 does not read at all: POSIX redirects and null device, backtick substitution, `<` input, `VAR=x cmd` prefixes. */
const POWERSHELL_UNSUPPORTED = [
  /\/dev\/null/,                                  // 2>/dev/null, >/dev/null
  /`[^`\n]+`/,                                   // `cmd` command substitution (a backtick is PowerShell's ESCAPE)
  /(^|\s)<\s*\S/,                                 // input redirection
  /(^|[|;&\n]\s*)[A-Za-z_]\w*=\S*\s+\S/,         // VAR=value cmd
];

/** A command with its quoted strings blanked, so an `&&` inside text is not read as a chain. */
function withoutQuoted(command: string): string {
  return command.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
}

/**
 * Does this command require bash on a machine whose default shell is Windows PowerShell 5.1?
 * `needsPosixShell` is built for cmd.exe and would refuse `ls`/`cat`/`rm`, which PowerShell aliases;
 * what PowerShell genuinely cannot run is the `&&` / `||` chain (no such operators in 5.1), the POSIX
 * control forms, and the unix utilities it has no alias for.
 */
function needsBashForPowerShell(command: string): boolean {
  const bare = withoutQuoted(command);
  if (/&&|\|\|/.test(bare)) return true;
  if (POSIX_ONLY_CONTROL.some((re) => re.test(bare))) return true;
  if (POWERSHELL_UNSUPPORTED.some((re) => re.test(bare))) return true;
  if (aliasedWithUnixFlag(bare)) return true;
  return commandWords(bare).some((w) => POSIX_UTILITIES.has(w) && !POWERSHELL_ALIASED.has(w));
}

/**
 * Does this command require a POSIX shell to run correctly? `shell` is the machine's default
 * interpreter: cmd.exe (the default) or Windows PowerShell.
 */
export function needsPosixShell(command: string, shell: "cmd" | "powershell" = "cmd"): boolean {
  if (shell === "powershell") return needsBashForPowerShell(command);
  if (POSIX_ONLY.some((re) => re.test(command))) return true;
  return commandWords(command).some((w) => POSIX_UTILITIES.has(w));
}

/**
 * `cmd.exe`'s own way of saying "I cannot run this" — the signatures that mean the
 * command was never attempted, as opposed to a real non-zero exit from a program that
 * DID run (a failing test suite, a type error). Only the former is worth re-running
 * under bash; re-running the latter would double every failing build.
 *
 * This is the backstop behind {@link needsPosixShell}: that predicate is a whitelist and
 * will always be incomplete (an unlisted utility, a single-quoted argument, a `$VAR`),
 * so the shell capability retries once under bash when cmd.exe reports one of these.
 */
const CMD_CANNOT_RUN = [
  /is not recognized as an internal or external command/i,
  /is not recognized as the name of a cmdlet/i,
  /The syntax of the command is incorrect/i,
  /was unexpected at this time/i,
  // cmd.exe reading `set -e` as its own builtin. Narrowed to a flag-shaped name: a program that DID
  // run and printed "Environment variable FOO not defined" is a real failure, not a reason to rerun.
  /Environment variable -\w+ not defined/i,
];

export function cmdCannotRun(output: string): boolean {
  return !!output && CMD_CANNOT_RUN.some((re) => re.test(output));
}

/**
 * `cmd.exe`'s null device is `nul`; bash's is `/dev/null`. A model writing Windows-style
 * commands reaches for `2>nul` / `>NUL`, and when that command lands in bash — routed by
 * {@link needsPosixShell} or by the {@link cmdCannotRun} retry — bash creates a real FILE
 * named `nul` in the working directory. Windows treats that name as a reserved device, so
 * Explorer and `git clean` cannot delete it and it sits untracked in `git status`
 * (`packages/brain-ui/nul`, holding the stderr of a `findstr … 2>nul`).
 *
 * Rewrite only a redirection TARGET of exactly `nul` (any case), including cmd's `<nul`
 * input idiom: `foo.nul`, `nullable`, `> nul.txt` and a quoted `"…>nul"` (a nested
 * `cmd //c "dir >nul"`, where nul IS the device) are untouched.
 */
const CMD_NULL_REDIRECT = /(\d?>>?|&>>?|<)\s*nul(?![\w.\/\\:"'-])/gi;

export function toBashNullDevice(command: string): string {
  return command.replace(CMD_NULL_REDIRECT, "$1/dev/null");
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
 * What this machine can actually do with a POSIX script — the fact that decides
 * whether `git_sync_latest` / `git_undo` / `git_redo` work here at all.
 *
 * It exists because the failure it describes was, for a while, undiagnosable from the
 * outside. A run reported the raw `cmd.exe` message `Environment variable -e not
 * defined` on a build whose version was AHEAD of the one this guard shipped in, and
 * nothing available to the reporter could separate the two candidate causes: an
 * extension host older than its reported version, or a live hole in the detection. A
 * guard whose presence cannot be observed is indistinguishable from a guard that is
 * not working, so this reports itself and {@link posixShellReport} puts it in the
 * connection diagnostics.
 */
export interface PosixShellStatus {
  platform: NodeJS.Platform;
  /** False off Windows: the default shell is already POSIX, so nothing is routed. */
  routingRequired: boolean;
  /** The shell POSIX scripts are routed to, or null when none was found. */
  shellPath: string | null;
  /** Every path probed, in order — so a machine with bash SOMEWHERE ELSE is visible. */
  candidates: string[];
}

export function posixShellStatus(env: NodeJS.ProcessEnv = process.env): PosixShellStatus {
  const routingRequired = process.platform === "win32";
  return {
    platform: process.platform,
    routingRequired,
    shellPath: routingRequired ? findBash(env) : null,
    candidates: routingRequired ? bashCandidates(env) : [],
  };
}

/**
 * The connection-diagnostics lines for POSIX-script support. Off Windows this is one
 * line saying nothing needs routing; on Windows it names the shell that will run
 * `set -e` scripts, or states plainly that none was found and what that costs.
 */
export function posixShellReport(env: NodeJS.ProcessEnv = process.env): string {
  const status = posixShellStatus(env);
  if (!status.routingRequired) {
    return `POSIX scripts: not routed (${status.platform} default shell is already POSIX).`;
  }
  if (status.shellPath) {
    return `POSIX scripts: routed to ${status.shellPath} — git_sync_latest / git_undo / git_redo will run correctly here.`;
  }
  return [
    "POSIX scripts: NO POSIX SHELL FOUND — git_sync_latest / git_undo / git_redo cannot run on this machine.",
    "  Install Git for Windows (it ships bash). Probed, in order:",
    ...status.candidates.map((c) => `    ${c}`),
  ].join("\n");
}

/** The refusal when a POSIX script has no POSIX shell to run it. */
export const NO_POSIX_SHELL =
  "this command needs a POSIX shell (it uses set -e / $(…) / [ … ], or a unix utility such as head/grep/sed that cmd.exe does not have) "
  + "and no POSIX shell was found on this Windows machine. "
  + "Install Git for Windows (which ships bash), or re-run the work as plain single-line commands instead.";

/** The refusal when a command needs bash and the machine's default shell is Windows PowerShell with no bash to hand it to. */
export const NO_BASH_FOR_POWERSHELL =
  "this command needs a POSIX shell (it chains with && / ||, redirects to /dev/null, uses backticks, < or VAR=value prefixes, passes unix flags to ls/rm/cat/cp/mv, "
  + "or uses a unix utility such as head/grep/sed/diff) and no POSIX shell was found on this Windows machine - the shell here is Windows PowerShell 5.1, which has none of that. "
  + "Either install Git for Windows (which ships bash), or retry it as separate PowerShell commands joined with ';' using the native equivalents: "
  + "Remove-Item -Recurse -Force, Get-ChildItem -Force, Get-Content, Select-String, Select-Object -First N, Copy-Item -Recurse, Move-Item, Test-Path, Compare-Object.";

/**
 * The interpreter a host runs a command in when nothing says otherwise. Windows only:
 *  - `"platform"` — the machine's default shell (cmd.exe), moving a command to bash only when it
 *    needs POSIX. The editor's shell.
 *  - `"bash"` — bash whenever one exists (the default shell is used only when there is none). The
 *    on-prem host's shell: a model writes `a && b` and `$VAR` as it does for the Bash tool, and
 *    Windows PowerShell 5.1 parses neither.
 * The HOST chooses; the routing rule below is the same for both.
 */
export type DefaultInterpreter = "platform" | "bash";

export interface RouteOptions {
  defaultInterpreter?: DefaultInterpreter;
}

/**
 * Which interpreter runs `command`: bash (`{ bash }`), the platform default (`{ bash: null }`), or a
 * refusal naming the cause. A POSIX script with no POSIX shell must say so: letting it through hands
 * it to cmd.exe, which parses `set -e` as its own builtin and fails with "Environment variable -e
 * not defined" — a message that names neither the cause nor anything the agent could do about it.
 *
 * A STRICT NO-OP off Windows: the default shell there is already POSIX, and refusing a `grep` because
 * `/bin/bash` is absent (Alpine, NixOS) would break hosts that work today.
 */
export function posixRoute(command: string, options: RouteOptions = {}): { bash: string | null } | { error: string } {
  if (process.platform !== "win32") return { bash: null };
  const bash = findBash();
  if (options.defaultInterpreter === "bash" && bash) return { bash };
  // With no bash, a "bash"-default host is on PowerShell: judge the command by what PowerShell cannot run.
  const powershell = options.defaultInterpreter === "bash";
  if (!needsPosixShell(command, powershell ? "powershell" : "cmd")) return { bash: null };
  return bash ? { bash } : { error: powershell ? NO_BASH_FOR_POWERSHELL : NO_POSIX_SHELL };
}

/**
 * Run `command` through THE interpreter-routing rule every node shell shares: the route above,
 * then — when the default shell could not even ATTEMPT it (an unlisted unix utility, a
 * single-quoted argument, a `$VAR`; `needsPosixShell` is a whitelist and always incomplete) —
 * ONE retry under bash, which is what the command was written for. A genuine non-zero exit from
 * a program that DID run does not match {@link cmdCannotRun}, so nothing that legitimately failed
 * is run twice, and a stopped command is never started again under another interpreter.
 * `exec` runs the command in the interpreter it is given (`null` = the platform default).
 */
export async function runRouted<R extends { ok: boolean; stdout?: string; aborted?: boolean }>(
  command: string,
  exec: (bash: string | null) => Promise<R>,
  signal?: AbortSignal,
  options: RouteOptions = {},
): Promise<R | { ok: false; error: string }> {
  // Off Windows there is nothing to route and — above all — nothing to RE-RUN: a retry repeats the
  // command's side effects, so it exists only for the one case it is a fix (cmd.exe could not parse it).
  if (process.platform !== "win32") return exec(null);
  const route = posixRoute(command, options);
  if ("error" in route) return { ok: false, error: route.error };
  const first = await exec(route.bash);
  if (first.ok || route.bash || first.aborted) return first;
  const retryBash = findBash();
  if (!retryBash || !cmdCannotRun(first.stdout ?? "") || signal?.aborted) return first;
  return exec(retryBash);
}
