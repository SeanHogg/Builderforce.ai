/**
 * How a `run_command` command is shaped before it runs, and how its result is read after.
 *
 * Pure (no `node:*`): the Worker imports the package root, and these rules are shared by
 * every surface that runs `run_command` (`shell-tools.ts`) and by the node shells
 * (`node-posix-shell.ts` re-exports {@link withPipefail}).
 *
 *   - {@link withPipefail}: a model's `pnpm install 2>&1 | tail -20` that FAILED reported
 *     exit 0, because a pipeline's status is its last stage's. Under `pipefail` it is the
 *     failing stage's. The command itself is never rewritten: a `| head -N` is a real limit
 *     (`git log | head -20`, `yes | head`) and a `| tail -N` reads the end of output the shell
 *     would otherwise clamp, so both run as the model wrote them.
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
 * substitution's pipeline NOT failing), a pipeline with a stage that closes early (`| head`,
 * `grep -q`), whose producer would die of SIGPIPE, and a pipeline with a search BEFORE its last
 * stage (`grep -rn foo src | wc -l`): a search that matched nothing exits 1, and under pipefail
 * that "0" would read as a failed step that {@link searchNoMatch} cannot rescue (it only reads a
 * search in last place). `platform` is the host's `process.platform`, passed in by the node
 * shell that runs the command — this module never reads `process`.
 */
export function withPipefail(command: string, bash: string | null, platform: string): string {
  const bare = withoutQuoted(command);
  const parts = stages(bare);
  if (parts.length < 2) return command;
  if (/(^|\n)\s*set\s+[-+]/.test(bare)) return command;
  if (parts.slice(1).some(closesEarly)) return command;
  if (searchesMidPipeline(bare)) return command;
  if (bash) return `set -o pipefail\n${command}`;
  if (platform === "win32") return command;
  // A POSIX sh without the option (old dash) would EXIT on a bad `set`: probe in a subshell first.
  return `(set -o pipefail) 2>/dev/null && set -o pipefail\n${command}`;
}

const SEARCH_VERBS = new Set(["grep", "egrep", "fgrep", "rg", "findstr", "ag", "ack"]);

/** A pipeline stage that is a text search (`grep`, `rg`, `findstr`, `git grep`, `Select-String`). */
function isSearchStage(stage: string): boolean {
  const verb = verbOf(stage);
  if (SEARCH_VERBS.has(verb)) return true;
  if (verb === "git") return /^\S+\s+(?:-\S+\s+)*grep\b/.test(stage.replace(/^(?:\w+=\S*\s+)+/, ""));
  return verb === "select-string" || verb === "sls";
}

/** True when any pipeline of the (quote-blanked) command has a search before its last stage. */
function searchesMidPipeline(bare: string): boolean {
  return bare.split(/&&|\|\||;|\n/).some((pipeline) => stages(pipeline).slice(0, -1).some(isSearchStage));
}

/** A single pipeline whose last stage is a text search (`grep`, `rg`, `findstr`, `git grep`, `Select-String`). */
export function isSearchCommand(command: string): boolean {
  const bare = withoutQuoted(command);
  if (isChained(bare)) return false;
  return isSearchStage(stages(bare).pop() ?? "");
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
