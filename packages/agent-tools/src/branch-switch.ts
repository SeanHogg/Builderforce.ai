/**
 * Does this shell command SWITCH a checkout's branch?
 *
 * `run_command` refuses a branch switch while the working tree has uncommitted changes
 * (`branch-switch-guard.ts`): git would carry the pending edits onto the other branch, or
 * abort half-way. This is the pure half — which commands are a switch:
 *   - `git checkout <ref>`, `git checkout -b|-B|--orphan <new> [start]`, `git checkout --detach [ref]`;
 *   - `git switch <ref>`, `git switch -c|-C|--create|--force-create|--orphan <new> [start]`, `git switch --detach|-d [ref]`;
 *   - in any segment of a compound command, past `git -C <dir>` / `-c k=v` global options.
 * NOT a switch: `git checkout -- <paths>`, `git checkout <ref> -- <paths>`, `git checkout <ref> <path…>`,
 * `git checkout .`, `git checkout -p`, `git restore …`, and anything that is not git. A bare
 * `git checkout <x>` with no `--` IS read as a switch (it is ambiguous with a path; the refusal
 * names `git restore <path>` for files).
 *
 * Pure: string in, verdict out. Reads commands through THE shared reader (`shell-segments.ts`).
 */

import { commandWords, gitSubcommand, shellTokens, splitShellSegments } from "./shell-segments.js";

/** A branch switch: the ref it moves to (absent for a bare `--detach`), whether it creates that branch, and `git -C`'s directory. */
export interface BranchSwitch {
  target?: string;
  creates: boolean;
  /** The directory the switch runs in, relative to the shell's, when the command names one (`cd X &&`, `git -C Y`, or both: `X/Y`). */
  dir?: string;
}

/** Options that create a branch from their value: `-b new`, `--create=new`. */
const CHECKOUT_CREATE = new Set(["-b", "-B", "--orphan"]);
const SWITCH_CREATE = new Set(["-c", "-C", "--create", "--force-create", "--orphan"]);
/** Options that never switch the branch: an interactive or file-list restore. */
const CHECKOUT_PATH_MODES = new Set(["-p", "--patch"]);

function switchOf(sub: "checkout" | "switch", rest: readonly string[]): Omit<BranchSwitch, "dir"> | undefined {
  const createFlags = sub === "checkout" ? CHECKOUT_CREATE : SWITCH_CREATE;
  let created: string | undefined;
  let creates = false;
  let detach = false;
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const word = rest[i] ?? "";
    if (word === "--") return undefined; // `checkout [<ref>] -- <paths>`: a file restore
    if (sub === "checkout" && (CHECKOUT_PATH_MODES.has(word) || word.startsWith("--pathspec-from-file"))) return undefined;
    const [flag, inline] = word.startsWith("--") && word.includes("=") ? [word.slice(0, word.indexOf("=")), word.slice(word.indexOf("=") + 1)] : [word, undefined];
    if (createFlags.has(flag)) {
      creates = true;
      created = inline ?? rest[i + 1];
      if (inline === undefined) i += 1;
      continue;
    }
    if (word === "--detach" || (sub === "switch" && word === "-d")) {
      detach = true;
      continue;
    }
    if (word === "-") {
      positional.push(word); // the previous branch
      continue;
    }
    if (word.startsWith("-")) continue; // -f, -q, -m, --track, --conflict=…, …
    positional.push(word);
  }
  if (creates) return { ...(created ? { target: created } : {}), creates: true };
  if (detach) return { ...(positional[0] ? { target: positional[0] } : {}), creates: false };
  // `git checkout <ref> <path…>` restores files from <ref>; `git checkout .` restores the tree.
  if (positional.length !== 1 || positional[0] === ".") return undefined;
  return { target: positional[0], creates: false };
}

/** `dir` entered from `base`, as the shell would: an absolute (`/x`, `C:\x`, `~`) path replaces it, a relative one nests under it. */
function enter(base: string | undefined, dir: string): string {
  const clean = dir.replace(/[\\/]+$/, "").replace(/^(\.\/)+/, "") || ".";
  if (!base || /^([\\/~]|[A-Za-z]:)/.test(clean)) return clean;
  return clean === "." ? base : `${base}/${clean}`;
}

function segmentSwitch(words: readonly string[], cdDir: string | undefined): BranchSwitch | undefined {
  const [program, ...args] = words;
  if (program !== "git") return undefined;
  const { sub, rest, dir } = gitSubcommand(args);
  if (sub !== "checkout" && sub !== "switch") return undefined;
  const found = switchOf(sub, rest);
  if (!found) return undefined;
  // `cd X && git -C Y switch …` switches X/Y: the directory the shell would be in.
  const where = dir !== undefined ? enter(cdDir, dir) : cdDir;
  return { ...found, ...(where !== undefined ? { dir: where } : {}) };
}

/**
 * The first branch switch in any segment of `command`; undefined when it switches nothing (or
 * cannot be read). A `cd <dir>` / `pushd <dir>` segment before it carries into `dir`, relative to
 * the shell's directory, so the caller checks the checkout the switch actually affects.
 */
export function detectBranchSwitch(command: string): BranchSwitch | undefined {
  const segments = splitShellSegments(command.trim());
  if (!segments) return undefined;
  let cdDir: string | undefined;
  for (const segment of segments) {
    const words = commandWords(shellTokens(segment));
    if ((words[0] === "cd" || words[0] === "pushd") && words[1] !== undefined && words[1] !== "-") {
      cdDir = enter(cdDir, words[1]);
      continue;
    }
    const found = segmentSwitch(words, cdDir);
    if (found) return found;
  }
  return undefined;
}
