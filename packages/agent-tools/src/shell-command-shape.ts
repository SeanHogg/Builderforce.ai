/**
 * How a `run_command` command is shaped before it runs, and how its result is read after.
 *
 * Pure (no `node:*`): the Worker imports the package root, and these rules are shared by
 * every surface that runs `run_command` (`shell-tools.ts`) and by the node shells
 * (`node-posix-shell.ts` re-exports {@link withPipefail}).
 *
 *   - {@link withPipefail}: a model's `pnpm install 2>&1 | tail -20` that FAILED reported
 *     exit 0, because a pipeline's status is its last stage's. Under `pipefail` it is the
 *     failing stage's.
 *   - {@link stripTrailingTrim}: a trailing `| tail -N` / `| head -N` only throws output away
 *     (the shell's output budget already bounds it) — and it hid the failure above. It is
 *     dropped, and the result shows the head AND the tail of the real output instead.
 *   - {@link searchNoMatch}: `grep` exiting 1 with no output found nothing; that is an
 *     answer, not a failed step.
 */

import type { ShellResult } from "./capabilities.js";

/** A command with its quoted strings blanked, so an `&&` or `|` inside text is not read as shell syntax. */
export function withoutQuoted(command: string): string {
  return command.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
}

/** True when the (quote-blanked) command chains commands (`&&`, `||`, `;`, a newline). */
function isChained(bare: string): boolean {
  return /&&|\|\||;|\n/.test(bare);
}

/** The stages of a pipeline (single `|`), each trimmed — of the quote-blanked text. */
function stages(bare: string): string[] {
  return bare.split(/(?<!\|)\|(?!\|)/).map((s) => s.trim());
}

/** A stage's command word, past `VAR=x` prefixes and a path (`/usr/bin/grep` → `grep`). */
function verbOf(stage: string): string {
  const word = /^[\w./-]+/.exec(stage.replace(/^(?:\w+=\S*\s+)+/, ""))?.[0] ?? "";
  return word.slice(word.lastIndexOf("/") + 1).toLowerCase().replace(/\.exe$/, "");
}

/** A stage that stops reading early, so `pipefail` would turn its producer's SIGPIPE into a failure. */
function closesEarly(stage: string): boolean {
  const verb = verbOf(stage);
  if (verb === "head") return true;
  return ["grep", "egrep", "fgrep", "rg"].includes(verb) && /\s-(?:\w*q|m\s*\d|-quiet|-max-count)/.test(stage);
}

/**
 * `command` run so a failing pipeline stage fails the pipeline. `bash` is the POSIX interpreter
 * the host routes it to, `null` = the platform shell (cmd.exe on Windows — left alone; `/bin/sh`
 * elsewhere, where `pipefail` is set only if that sh has it). Untouched: a command with no pipe,
 * a script that sets its own options (`set -e` scripts the git tools build depend on a
 * substitution's pipeline NOT failing), and a pipeline with a stage that closes early (`| head`,
 * `grep -q`), whose producer would die of SIGPIPE. `platform` is the host's `process.platform`,
 * passed in by the node shell that runs the command — this module never reads `process`.
 */
export function withPipefail(command: string, bash: string | null, platform: string): string {
  const bare = withoutQuoted(command);
  const parts = stages(bare);
  if (parts.length < 2) return command;
  if (/(^|\n)\s*set\s+[-+]/.test(bare)) return command;
  if (parts.slice(1).some(closesEarly)) return command;
  if (bash) return `set -o pipefail\n${command}`;
  if (platform === "win32") return command;
  // A POSIX sh without the option (old dash) would EXIT on a bad `set`: probe in a subshell first.
  return `(set -o pipefail) 2>/dev/null && set -o pipefail\n${command}`;
}

/** What {@link stripTrailingTrim} removed. */
export interface OutputTrim {
  kind: "head" | "tail";
  lines: number;
}

const TRAILING_TRIM = /\s*(?:2>&1\s*)?\|\s*(head|tail)\s+(?:-n\s*|--lines[=\s]\s*|-)(\d+)\s*$/;

/**
 * Drop a trailing `| tail -N` / `| head -N` (with or without `2>&1`, `-n N`, `--lines=N`).
 * Everything before it is kept — a `grep … | sort` that does real work still runs. A command
 * whose trim is inside quotes (`bash -c "x | tail -5"`), after `||`, or that is ONLY the trim is unchanged.
 */
export function stripTrailingTrim(command: string): { command: string; trim?: OutputTrim } {
  const m = TRAILING_TRIM.exec(command);
  // Still there once quoted text is blanked ⇒ the trim is real syntax, not the end of a string.
  if (!m || !TRAILING_TRIM.test(withoutQuoted(command))) return { command };
  const kept = command.slice(0, m.index).trimEnd();
  if (!kept || /\|\s*$/.test(kept)) return { command };
  return { command: kept, trim: { kind: m[1] as OutputTrim["kind"], lines: Number(m[2]) } };
}

/** Lines kept from each end of a trimmed command's output (at least what the trim asked for). */
const TRIM_WINDOW_LINES = 40;

/**
 * A stripped command's output as its first and last lines — the head says what started (and,
 * as in `ERR_PNPM_NO_PKG_MANIFEST`, often what failed), the tail says how it ended.
 */
export function shapeTrimmed(text: string, trim: OutputTrim, outputId?: string): string {
  const lines = text.split("\n");
  const head = Math.max(TRIM_WINDOW_LINES, trim.kind === "head" ? trim.lines : 0);
  const tail = Math.max(TRIM_WINDOW_LINES, trim.kind === "tail" ? trim.lines : 0);
  if (lines.length <= head + tail) return text;
  const omitted = lines.length - head - tail;
  const more = outputId ? `; output_filter { "outputId": "${outputId}" } reads them` : "";
  return [...lines.slice(0, head), `…(${omitted} lines omitted${more})…`, ...lines.slice(lines.length - tail)].join("\n");
}

const SEARCH_VERBS = new Set(["grep", "egrep", "fgrep", "rg", "findstr", "ag", "ack"]);

/** A single pipeline whose last stage is a text search (`grep`, `rg`, `findstr`, `git grep`, `Select-String`). */
export function isSearchCommand(command: string): boolean {
  const bare = withoutQuoted(command);
  if (isChained(bare)) return false;
  const last = stages(bare).pop() ?? "";
  const verb = verbOf(last);
  if (SEARCH_VERBS.has(verb)) return true;
  if (verb === "git") return /^\S+\s+(?:-\S+\s+)*grep\b/.test(last.replace(/^(?:\w+=\S*\s+)+/, ""));
  return verb === "select-string" || verb === "sls";
}

const NO_OUTPUT = /^\s*(\(no output\))?\s*$/;

/**
 * A search that found nothing — exit 1 and no output — as the answer it is: `ok: true`,
 * `matches: 0`. Any other result (output on exit 1 is an error message; exit 2 is a bad
 * pattern) is returned unchanged.
 */
export function searchNoMatch<R extends ShellResult>(command: string, result: R): R {
  if (result.ok || result.exitCode !== 1 || result.aborted || result.error) return result;
  if (!NO_OUTPUT.test(result.stdout ?? "") || !isSearchCommand(command)) return result;
  const { exitCode: _exit, ...rest } = result;
  return { ...rest, ok: true, matches: 0, stdout: "(no matches — the search exited 1 with no output)" } as R;
}
