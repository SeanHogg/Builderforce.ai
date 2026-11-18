/**
 * THE shell-command reader the guards share: split a command into its top-level segments,
 * tokenise a segment, drop the construct words before its program, and find a `git`
 * invocation's subcommand past its global options.
 *
 * Moved here from `@builderforce/run-guards` `readOnlyShell.ts` (which still uses it) because
 * run-guards depends on THIS package — the branch-switch detector (`branch-switch.ts`) lives
 * here, next to `run_command`, and must read commands exactly the way the read-only
 * classifier does. Pure: string in, strings out.
 */

/** Shell keywords that open, continue or close a construct and run nothing themselves. */
const CONSTRUCT_WORDS = new Set(["then", "else", "fi", "do", "done", "esac", "{", "}", "(", ")"]);

/** Split into top-level segments on `&&`, `||`, `;`, `|` and newlines, respecting quotes. `null` when unbalanced. */
export function splitShellSegments(command: string): string[] | null {
  const out: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let depth = 0; // inside $( … )
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "$" && command[i + 1] === "(") {
      depth += 1;
      current += "$(";
      i += 1;
      continue;
    }
    if (ch === ")" && depth > 0) {
      depth -= 1;
      current += ch;
      continue;
    }
    // `2>&1`, `>&2`, `<&0` and `&>file` are REDIRECTS, not job separators — the `&` belongs
    // to the redirect.
    if (ch === "&" && (command[i - 1] === ">" || command[i - 1] === "<" || command[i + 1] === ">")) {
      current += ch;
      continue;
    }
    if (depth === 0 && (ch === ";" || ch === "\n" || ch === "|" || ch === "&")) {
      // `&&` / `||` are one separator; a lone `&` backgrounds a job (still one segment end).
      if ((ch === "&" || ch === "|") && command[i + 1] === ch) i += 1;
      if (current.trim()) out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (quote || depth !== 0) return null; // unbalanced — do not guess
  if (current.trim()) out.push(current.trim());
  return out;
}

/** Whitespace tokens with quotes stripped. */
export function shellTokens(segment: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m = re.exec(segment);
  while (m) {
    out.push(m[1] ?? m[2] ?? m[3] ?? "");
    m = re.exec(segment);
  }
  return out;
}

/** A segment's words from its program on: leading construct words (`do`, `then`, `if`, `!`) and assignments (`n=$(…)`) dropped. */
export function commandWords(words: readonly string[]): string[] {
  let i = 0;
  while (i < words.length) {
    const first = words[i] ?? "";
    const leads = CONSTRUCT_WORDS.has(first) || /^[A-Za-z_]\w*=/.test(first) || first === "if" || first === "while" || first === "until" || first === "!";
    if (!leads) break;
    i += 1;
  }
  return words.slice(i);
}

/** git's global options that take their value as the NEXT word (`--git-dir=/x` is one word and needs no entry). */
const GIT_VALUED_GLOBALS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env"]);

/** A `git` invocation's arguments split at its subcommand: global options (`-C <dir>`, `-c k=v`, `--git-dir <x>`, `--no-pager`, …) skipped, `-C`'s directory kept. */
export function gitSubcommand(args: readonly string[]): { sub?: string; rest: string[]; dir?: string } {
  let i = 0;
  let dir: string | undefined;
  while (i < args.length && (args[i] ?? "").startsWith("-")) {
    if (args[i] === "-C") dir = args[i + 1];
    i += GIT_VALUED_GLOBALS.has(args[i] ?? "") ? 2 : 1;
  }
  return { ...(args[i] !== undefined ? { sub: args[i] } : {}), rest: args.slice(i + 1), ...(dir !== undefined ? { dir } : {}) };
}
