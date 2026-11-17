/**
 * What a shell command RUNS — its executable, not words anywhere in it. `ls tests/`,
 * `grep -r foo tests/` and `git commit -m "fix tests"` all mention a test, and none of them
 * is a check; a run that passed one of them has verified nothing.
 *
 * The executable is the first token of the first segment that is not a `cd` (segments split
 * on `&&`, `||`, `;`), past `KEY=value` / `env` prefixes and a package-manager wrapper
 * (`pnpm`/`npm`/`npx`/`yarn`/`bun`/`bunx`, optionally `exec`/`run`/`dlx`/`x`, with
 * `--filter X` / `-C X` / `--dir X` / `--prefix X` / other flags skipped). Pure.
 */

const WRAPPERS = new Set(["pnpm", "npm", "npx", "yarn", "bun", "bunx"]);
const WRAPPER_VERBS = new Set(["exec", "run", "dlx", "x", "run-script"]);
/** Wrapper flags that take a value. */
const VALUE_FLAGS = new Set(["--filter", "-F", "-C", "--dir", "--prefix", "-w", "--workspace", "--cwd"]);
/** Executables that ARE a check runner. */
const RUNNERS = new Set(["tsc", "tsgo", "vitest", "jest", "pytest", "mocha", "eslint", "biome", "ruff", "mypy", "playwright"]);
/** Script names (after a wrapper) that run a check: `test`, `lint`, `typecheck`, `check`, and their `name:variant` forms. */
const CHECK_SCRIPT = /^(test|tests|lint|typecheck|type-check|check)(:[\w.-]+)?$/i;
/** Runners whose check is a subcommand. */
const SUBCOMMAND_RUNNERS: Readonly<Record<string, ReadonlySet<string>>> = { cargo: new Set(["test", "check", "clippy"]), go: new Set(["test", "vet"]) };
/** git subcommands that only record or report the work — never a change to the files the work is about. */
const VCS_BOOKKEEPING = new Set(["add", "commit", "status", "diff", "log", "push", "show", "fetch"]);

/** The shell command a call carries (`command`, or `cmd`), or "". */
export function shellCommandOf(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as { command?: unknown; cmd?: unknown };
  return typeof a.command === "string" ? a.command : typeof a.cmd === "string" ? a.cmd : "";
}

function tokensOf(segment: string): string[] {
  return segment.trim().split(/\s+/).filter(Boolean).map((t) => t.replace(/^["']|["']$/g, ""));
}

/** The tokens of what the command runs, from its executable on (wrapper and prefixes dropped, the script name kept). */
export function executableTokensOf(command: string): string[] {
  const segments = command.split(/&&|\|\||;/).map(tokensOf).filter((t) => t.length > 0 && t[0] !== "cd" && t[0] !== "pushd");
  let t = segments[0] ?? [];
  let i = 0;
  while (i < t.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t[i]!) || t[i] === "env")) i += 1;
  t = t.slice(i);
  if (t.length > 0 && WRAPPERS.has(t[0]!)) {
    let j = 1;
    for (;;) {
      const tok = t[j];
      if (tok === undefined) break;
      if (VALUE_FLAGS.has(tok)) j += 2;
      else if (tok.startsWith("-")) j += 1;
      else if (WRAPPER_VERBS.has(tok)) j += 1;
      else break;
    }
    t = t.slice(j);
  }
  return t.map((tok, k) => (k === 0 ? tok.split(/[\\/]/).pop() ?? tok : tok));
}

/** Whether a shell command's EXECUTABLE is a check runner (a test, lint or type-check). */
export function runsCheck(command: string): boolean {
  const [exe, sub] = executableTokensOf(command);
  if (!exe) return false;
  if (RUNNERS.has(exe) || CHECK_SCRIPT.test(exe)) return true;
  const subs = SUBCOMMAND_RUNNERS[exe];
  return !!subs && !!sub && subs.has(sub);
}

/** Whether a shell command only records or reports VCS state (`git add/commit/status/diff/log/push/…`). */
export function isVcsBookkeeping(command: string): boolean {
  const [exe, sub] = executableTokensOf(command);
  return exe === "git" && !!sub && VCS_BOOKKEEPING.has(sub);
}
