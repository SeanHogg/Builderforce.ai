/**
 * Does this shell command CHANGE the workspace? The counterpart to `readOnlyShell.ts`, and deliberately its opposite in
 * bias: that classifier must never call a writer read-only (a stale cached read), so anything unrecognised "may write".
 * This one decides whether a PLANNING turn's `run_command` is a code change that the coder should make instead
 * (`@builderforce/agent-run` `policy/model/reask.ts`, VS Code chat #275), and a false positive there re-asks a planner
 * for running `pnpm build` or `gh pr view`. So it flags only KNOWN writers, segment by segment:
 *
 *  - a `>` / `>>` redirect into a file;
 *  - a file writer: `rm`, `mv`, `cp`, `tee`, `touch`, `ln`, `truncate`, the PowerShell writers;
 *  - an in-place editor: `sed -i`, `perl -i`;
 *  - a git command that moves the tree or history: `commit`, `checkout`, `reset`, `push`, `stash`, `rebase`, `merge`,
 *    `apply`, …;
 *  - an inline script (`node -e`, `python -c`) whose body calls a file-writing API;
 *  - a regenerating flag: `--update`, `--fix`, `--write`, and `-u` on a check runner (a snapshot update).
 *
 * Check runners, guard / ratchet scripts without those flags, builds and installs are not code changes. Every segment
 * is judged (`pnpm test && git commit -am x` writes), and `$( … )` bodies too.
 */

import { commandWords, gitSubcommand, shellTokens, splitShellSegments } from "@builderforce/agent-tools";
import { runsCheck, shellCommandOf } from "./checkCommand.js";
import { substitutions, writesViaRedirect } from "./readOnlyShell.js";

/** Programs that write or remove files by definition. */
const FILE_WRITERS = new Set([
  "rm", "rmdir", "mv", "cp", "tee", "touch", "ln", "truncate", "unlink", "install", "patch",
  // cmd.exe
  "del", "erase", "move", "copy", "ren", "rename", "rd",
  // PowerShell
  "remove-item", "move-item", "copy-item", "new-item", "set-content", "add-content", "out-file", "rename-item", "clear-content",
]);

/** git subcommands that change the working tree, the index's commits, or the history. */
const GIT_WRITERS = new Set([
  "commit", "checkout", "switch", "reset", "restore", "push", "pull", "rebase", "merge", "apply", "am", "cherry-pick",
  "revert", "clean", "rm", "mv", "stash",
]);

/** Inline-script runners and the flag that takes the script. */
const INLINE_FLAGS: Readonly<Record<string, readonly string[]>> = {
  node: ["-e", "--eval", "-p", "--print"],
  python: ["-c"],
  python3: ["-c"],
  py: ["-c"],
};

/** File-writing APIs an inline script calls. */
const WRITE_API = /\b(?:writeFile(?:Sync)?|appendFile(?:Sync)?|rmSync|rmdirSync|unlink(?:Sync)?|rename(?:Sync)?|mkdirSync|copyFile(?:Sync)?|cpSync|createWriteStream|truncate(?:Sync)?|write_text|write_bytes|os\.remove|os\.unlink|os\.rename|shutil\.\w+)\b|\bopen\([^)]*,\s*['"][wax]\+?b?['"]/;

/** Flags that regenerate files: a ratchet `--update`, `eslint --fix`, `prettier --write`. */
const REGENERATING = /^--(?:update|fix|write|updateSnapshot|update-snapshots?)(?:=.*)?$/;

function gitWrites(args: string[]): boolean {
  const { sub, rest } = gitSubcommand(args);
  if (!sub || !GIT_WRITERS.has(sub)) return false;
  // `git stash list|show` only reads.
  return !(sub === "stash" && ["list", "show"].includes(rest.find((a) => !a.startsWith("-")) ?? ""));
}

function segmentWrites(segment: string, depth: number): boolean {
  if (depth > 4) return false;
  if (substitutions(segment).some((body) => commandWrites(body, depth + 1))) return true;
  const flat = segment.replace(/\$\((?:[^()]|\([^()]*\))*\)/g, "X");
  if (writesViaRedirect(flat)) return true;
  const [rawProgram, ...args] = commandWords(shellTokens(flat));
  if (rawProgram === undefined) return false;
  const program = (rawProgram.split(/[\\/]/).pop() ?? rawProgram).toLowerCase().replace(/\.exe$/, "");
  if (FILE_WRITERS.has(program)) return true;
  if (program === "git") return gitWrites(args);
  if (program === "sed" && args.some((a) => a.startsWith("-i") || a.startsWith("--in-place"))) return true;
  if (program === "perl" && args.some((a) => /^-[a-z]*i/.test(a))) return true;
  if (args.some((a) => REGENERATING.test(a))) return true;
  if (args.includes("-u") && runsCheck(flat)) return true;
  const inline = INLINE_FLAGS[program];
  if (inline && args.some((a) => inline.includes(a)) && WRITE_API.test(flat)) return true;
  return false;
}

function commandWrites(command: string, depth: number): boolean {
  const segments = splitShellSegments(command);
  // Unbalanced quoting cannot be read segment by segment: judge the whole text once.
  if (!segments) return segmentWrites(command, depth);
  return segments.some((s) => segmentWrites(s, depth));
}

/** Whether any segment of `command` is a known writer. */
export function isMutatingShellCommand(command: string): boolean {
  const trimmed = command.trim();
  return trimmed !== "" && commandWrites(trimmed, 0);
}

/**
 * A `run_command` that CHANGES the workspace ({@link isMutatingShellCommand}). The model policy counts it as a code
 * change: a planning turn that reaches for one is re-asked of the coder (VS Code chat #275).
 */
export function isMutatingShellCall(tool: string, args: unknown): boolean {
  return tool === "run_command" && isMutatingShellCommand(shellCommandOf(args));
}
