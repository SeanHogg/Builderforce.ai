/**
 * Does this shell command SWITCH a checkout's branch?
 *
 * `run_command` refuses a branch switch while the working tree has uncommitted changes
 * (`branch-switch-guard.ts`): git would carry the pending edits onto the other branch, or
 * abort half-way. This is the pure half — which commands are a switch:
 *   - `git checkout <ref>`, `git checkout -b|-B|--orphan <new> [start]`, `git checkout --detach [ref]`;
 *   - `git switch <ref>`, `git switch -c|-C|--create|--force-create|--orphan <new> [start]`, `git switch --detach|-d [ref]`;
 *   - in any segment of a compound command or subshell, past `git -C <dir>` / `-c k=v` global options,
 *     behind `env` / `command` / `time` / `nohup` / `timeout N`, and inside `sh|bash -c "<script>"`;
 *   - redirects (`2>&1`, `> out.txt`) are not arguments.
 * NOT a switch: `git checkout [<ref>] -- <paths>`, `git checkout <ref> <path…>`, `git checkout .`,
 * `git checkout -p`, `--ours` / `--theirs`, `git restore …`, and anything that is not git. A bare
 * `git checkout <x>` is `ambiguous` — a branch or a path — which the guard settles by asking git
 * whether `<x>` names a commit.
 *
 * A `cd <dir>` / `pushd <dir>` before the switch carries into `dir`, so the caller checks the
 * checkout the switch actually affects. Pure: string in, verdict out. Reads commands through
 * THE shared reader (`shell-segments.ts`).
 */

import { commandWords, gitSubcommand, shellTokens, splitShellSegments } from "./shell-segments.js";

/** A branch switch: the ref it moves to (absent for a bare `--detach`), whether it creates that branch, and where it runs. */
export interface BranchSwitch {
  target?: string;
  creates: boolean;
  /** A bare `git checkout <x>`: `<x>` may be a path (a restore) rather than a branch. */
  ambiguous?: true;
  /** The directory the switch runs in, relative to the shell's, when the command names one (`cd X &&`, `git -C Y`, or both: `X/Y`). */
  dir?: string;
}

/** Options that create a branch from their value: `-b new`, `-bnew`, `--create=new`. */
const CHECKOUT_CREATE = new Set(["-b", "-B", "--orphan"]);
const SWITCH_CREATE = new Set(["-c", "-C", "--create", "--force-create", "--orphan"]);
/** checkout options that only ever restore files. */
const CHECKOUT_PATH_MODES = new Set(["-p", "--patch", "--ours", "--theirs", "-2", "-3"]);
/** A redirect word (`2>&1`, `>out`, `<in`, `&>log`); a bare operator (`>`, `2>>`) also owns the next word. */
const REDIRECT = /^\d*[<>]|^&>/;
const BARE_REDIRECT = /^(\d*(>>?|<)|&>>?)$/;
/** Wrappers that run their arguments as the command. */
const PLAIN_WRAPPERS = new Set(["command", "time", "nohup", "exec"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash"]);
/** A shell's short-option word that includes `-c` (`-c`, `-lc`, `-ec`). */
const SHELL_C_FLAG = /^-[a-zA-Z]*c[a-zA-Z]*$/;
/** Deepest `sh -c` nesting read. */
const MAX_DEPTH = 3;

/** The words without redirects (and a bare redirect's target). */
function withoutRedirects(words: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] ?? "";
    if (BARE_REDIRECT.test(word)) {
      i += 1;
      continue;
    }
    if (!REDIRECT.test(word)) out.push(word);
  }
  return out;
}

/** The value an attached short create flag carries (`-bfeat` → `feat`), when `word` is one. */
function attachedCreate(sub: "checkout" | "switch", word: string): string | undefined {
  const m = (sub === "checkout" ? /^-[bB](.+)$/ : /^-[cC](.+)$/).exec(word);
  return m?.[1];
}

function switchOf(sub: "checkout" | "switch", rest: readonly string[]): Omit<BranchSwitch, "dir"> | undefined {
  const createFlags = sub === "checkout" ? CHECKOUT_CREATE : SWITCH_CREATE;
  let created: string | undefined;
  let creates = false;
  let detach = false;
  let endsOptions = false;
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const word = rest[i] ?? "";
    if (word === "--") {
      if (i < rest.length - 1) return undefined; // `checkout [<ref>] -- <paths>`: a file restore
      endsOptions = true; // a trailing `--` names no paths: what precedes it is a commit
      break;
    }
    if (sub === "checkout" && (CHECKOUT_PATH_MODES.has(word) || word.startsWith("--pathspec-from-file"))) return undefined;
    const [flag, inline] = word.startsWith("--") && word.includes("=") ? [word.slice(0, word.indexOf("=")), word.slice(word.indexOf("=") + 1)] : [word, undefined];
    if (createFlags.has(flag)) {
      creates = true;
      created = inline ?? rest[i + 1];
      if (inline === undefined) i += 1;
      continue;
    }
    const attached = attachedCreate(sub, word);
    if (attached !== undefined) {
      creates = true;
      created = attached;
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
  const target = positional[0] as string;
  return sub === "checkout" && target !== "-" && !endsOptions ? { target, creates: false, ambiguous: true } : { target, creates: false };
}

/** `dir` entered from `base`, as the shell would: an absolute (`/x`, `C:\x`, `~`) path replaces it, a relative one nests under it. */
function enter(base: string | undefined, dir: string): string {
  const clean = dir.replace(/[\\/]+$/, "").replace(/^(\.\/)+/, "") || ".";
  if (!base || /^([\\/~]|[A-Za-z]:)/.test(clean)) return clean;
  return clean === "." ? base : `${base}/${clean}`;
}

/** Subshells a segment opens (> 0) or closes (< 0): its `(` minus its `)`, quoted text aside. */
function parenBalance(segment: string): number {
  const bare = segment.replace(/"[^"]*"|'[^']*'/g, "");
  return (bare.match(/\(/g)?.length ?? 0) - (bare.match(/\)/g)?.length ?? 0);
}

/** A segment's words with a subshell's `(` / `)` taken off its first and last word. */
function unwrapSubshell(words: readonly string[]): string[] {
  const out = [...words];
  if (out[0]?.startsWith("(")) out[0] = out[0].replace(/^\(+/, "");
  const last = out.length - 1;
  if (last >= 0 && out[last]?.endsWith(")")) out[last] = (out[last] as string).replace(/\)+$/, "");
  return commandWords(out.filter((w) => w !== ""));
}

/** The words after a wrapper (`env A=1 -i`, `command -p`, `timeout -s KILL 30`), or the words themselves. */
function peelWrappers(words: readonly string[]): string[] {
  let out = [...words];
  for (let guard = 0; guard < 8; guard += 1) {
    const [head, ...rest] = out;
    if (head === "env") {
      let i = 0;
      while (i < rest.length && ((rest[i] ?? "").startsWith("-") || /^[A-Za-z_]\w*=/.test(rest[i] ?? ""))) i += rest[i] === "-u" || rest[i] === "-C" ? 2 : 1;
      out = rest.slice(i);
    } else if (head !== undefined && PLAIN_WRAPPERS.has(head)) {
      let i = 0;
      while (i < rest.length && (rest[i] ?? "").startsWith("-")) i += 1;
      out = rest.slice(i);
    } else if (head === "timeout") {
      let i = 0;
      while (i < rest.length && (rest[i] ?? "").startsWith("-")) i += rest[i] === "-s" || rest[i] === "-k" ? 2 : 1;
      out = rest.slice(i + 1); // the duration
    } else {
      return out;
    }
  }
  return out;
}

function segmentSwitch(words: readonly string[], cdDir: string | undefined, depth: number): BranchSwitch | undefined {
  const [program, ...args] = words;
  if (program !== undefined && SHELLS.has(program)) {
    // `-c`, or a cluster carrying it (`-lc`, `-ec`): the script is the next word that is not an option.
    const flag = args.findIndex((a) => SHELL_C_FLAG.test(a));
    const script = flag === -1 ? undefined : args.slice(flag + 1).find((a) => !a.startsWith("-"));
    if (script === undefined || depth >= MAX_DEPTH) return undefined;
    const inner = detectIn(script, depth + 1);
    if (!inner) return undefined;
    const where = inner.dir !== undefined ? enter(cdDir, inner.dir) : cdDir;
    return { ...inner, ...(where !== undefined ? { dir: where } : {}) };
  }
  if (program !== "git") return undefined;
  const { sub, rest, dir } = gitSubcommand(args);
  if (sub !== "checkout" && sub !== "switch") return undefined;
  const found = switchOf(sub, withoutRedirects(rest));
  if (!found) return undefined;
  // `cd X && git -C Y switch …` switches X/Y: the directory the shell would be in.
  const where = dir !== undefined ? enter(cdDir, dir) : cdDir;
  return { ...found, ...(where !== undefined ? { dir: where } : {}) };
}

function detectIn(command: string, depth: number): BranchSwitch | undefined {
  const segments = splitShellSegments(command.trim());
  if (!segments) return undefined;
  let cdDir: string | undefined;
  // A `cd` inside `( … )` ends with the subshell: the directory each open `(` entered from.
  const outer: Array<string | undefined> = [];
  for (const segment of segments) {
    const net = parenBalance(segment);
    for (let k = 0; k < net; k += 1) outer.push(cdDir);
    const words = peelWrappers(unwrapSubshell(commandWords(shellTokens(segment))));
    if ((words[0] === "cd" || words[0] === "pushd") && words[1] !== undefined && words[1] !== "-") {
      cdDir = enter(cdDir, words[1]);
    } else {
      const found = segmentSwitch(words, cdDir, depth);
      if (found) return found;
    }
    for (let k = 0; k < -net && outer.length > 0; k += 1) cdDir = outer.pop();
  }
  return undefined;
}

/** The first branch switch in any segment of `command`; undefined when it switches nothing (or cannot be read). */
export function detectBranchSwitch(command: string): BranchSwitch | undefined {
  return detectIn(command, 0);
}
