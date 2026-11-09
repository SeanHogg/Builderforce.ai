/**
 * Delegation economy — the two rules that stop an owner paying twice for the same work.
 *
 *   1. {@link duplicateOfLiveChild}: while a child is live, the owner may not run a shell
 *      command the child was briefed to run, or has already started. VS Code chat #60338:
 *      the owner spawned a verify child for three commands, ran the SAME three itself in
 *      the background, then blocked in `wait_agents` — ~8 minutes duplicated.
 *   2. {@link trivialDelegationRefusal}: a brief that is only a few shell commands with no
 *      reasoning task is not a delegation — a child costs a model, a prompt and a wait;
 *      the owner runs them itself with `run_command background:true`.
 *
 * ONE rule each, enforced in code at the dispatch seam of every surface that runs live
 * children (the editor wraps its `run_command` and its spawn tools with them), never as
 * prose a model can argue past. Both detectors are CONSERVATIVE: a command is recognised
 * only on a line (or a backticked span) that starts with a known command head, and a
 * brief carrying any reasoning verb is never trivial.
 *
 * Pure (strings and arrays): safe in the Worker, the browser and Node.
 */

/** The shell tool both rules guard. */
export const RUN_COMMAND_TOOL = "run_command";

/** Executables a command line starts with. A line that starts with none is prose. */
const COMMAND_HEADS = new Set([
  "pnpm", "npm", "npx", "yarn", "bun", "bunx", "deno", "node", "tsc", "tsgo", "vitest", "jest", "mocha", "playwright",
  "eslint", "prettier", "biome", "turbo", "nx", "vite", "esbuild", "vsce", "pytest", "python", "python3", "pip", "uv",
  "ruff", "mypy", "cargo", "rustc", "go", "make", "cmake", "git", "dotnet", "mvn", "gradle", "./gradlew", "bash", "sh",
  "pwsh", "powershell", "docker", "kubectl", "wrangler", "terraform",
]);

/** A reasoning task: the brief asks the child to THINK, not only to execute. */
const REASONING_VERBS =
  /\b(?:fix|fixes|fixing|investigat\w*|diagnos\w*|debug\w*|why|implement\w*|refactor\w*|review\w*|analy[sz]\w*|find|trace|design\w*|write|edit|change|update|add|remove|delete|migrat\w*|compare|explain|decide|plan|figure|research|explore|read|search|understand|propose|summari[sz]e|triage|rewrite|port|build\s+(?:a|an|the)\b)/i;

/** A negated verb ("do not fix", "don't edit") is an instruction NOT to reason — drop it before the verb test. */
const NEGATED = /\b(?:do\s+not|don'?t|dont|never|no|without|not)\s+\w+/gi;

/** Words a brief may carry around its commands and still be only those commands. */
const PROSE_ALLOWANCE = 40;

/** Most commands a brief may hold and still be trivial. */
export const TRIVIAL_MAX_COMMANDS = 3;

/**
 * A command as the rules compare it: whitespace collapsed, a leading `cd <dir> &&`, a
 * trailing `2>&1`, a trailing `| tail …` / `| head …` / `| tee …` and a trailing `;` / `&`
 * dropped — the decorations an owner adds around the SAME work.
 */
export function normalizeCommand(command: string): string {
  let c = command.replace(/\s+/g, " ").trim();
  c = c.replace(/^\$\s+/, "");
  for (;;) {
    const next = c
      .replace(/^cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/i, "")
      .replace(/\s*\|\s*(?:tail|head|tee|cat|less|more)\b[^|]*$/i, "")
      .replace(/\s*\d?>&\d\s*$/, "")
      .replace(/\s*[;&]\s*$/, "")
      .trim();
    if (next === c) return c;
    c = next;
  }
}

/** Does this text start with a known command head? */
function startsWithCommand(text: string): boolean {
  const head = text.trim().split(/\s+/, 1)[0] ?? "";
  return COMMAND_HEADS.has(head.toLowerCase());
}

/** A line with list markers, a `$ ` prompt and wrapping backticks peeled off. */
function bareLine(line: string): string {
  return line
    .trim()
    .replace(/^(?:[-*+•]|\d+[.)])\s+/, "")
    .replace(/^\$\s+/, "")
    .replace(/^`([^`]+)`[.,;:]?$/, "$1")
    .trim();
}

/** The commands a brief names, each normalised, in order, without duplicates — and how much of the brief they are. */
function scanBrief(brief: string): { commands: string[]; prose: string } {
  const commands: string[] = [];
  const proseParts: string[] = [];
  const add = (raw: string): void => {
    const c = normalizeCommand(raw);
    if (c && !commands.includes(c)) commands.push(c);
  };
  let fenced = false;
  for (const line of brief.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      const bare = bareLine(line);
      if (bare && !bare.startsWith("#")) add(bare);
      continue;
    }
    const bare = bareLine(line);
    if (bare && startsWithCommand(bare)) {
      add(bare);
      continue;
    }
    // Prose — but a backticked span inside it may still be a command ("run `pnpm test`").
    proseParts.push(
      line.replace(/`([^`]+)`/g, (span, inner: string) => {
        if (!startsWithCommand(inner)) return span;
        add(inner);
        return " ";
      }),
    );
  }
  return { commands, prose: proseParts.join(" ") };
}

/** The shell commands a brief names, normalised ({@link normalizeCommand}). */
export function commandsInBrief(brief: string): string[] {
  return scanBrief(brief).commands;
}

/** One live child, as the duplicate rule reads it. */
export interface LiveChildWork {
  handle: string;
  /** The task the child was briefed with. */
  brief: string;
  /** The `run_command` commands the child has already started (raw; normalised here). */
  started: readonly string[];
}

/** The refusal an owner reads instead of running a command a live child owns. */
export function duplicateCommandRefusal(handle: string): string {
  return `${handle} is already running this — call wait_agents for its result`;
}

/**
 * The refusal for an owner `run_command` whose command a live child was briefed to run,
 * or has already started; null when no live child owns it.
 */
export function duplicateOfLiveChild(command: string, children: readonly LiveChildWork[]): string | null {
  const wanted = normalizeCommand(command);
  if (!wanted) return null;
  for (const child of children) {
    if (child.started.some((c) => normalizeCommand(c) === wanted) || commandsInBrief(child.brief).includes(wanted)) {
      return duplicateCommandRefusal(child.handle);
    }
  }
  return null;
}

/**
 * The refusal for a delegation whose brief is only ≤ {@link TRIVIAL_MAX_COMMANDS} shell
 * commands with no reasoning task; null for a real delegation. Conservative: any reasoning
 * verb (not negated) or more than a few words of prose around the commands makes it real.
 */
export function trivialDelegationRefusal(brief: string): string | null {
  const { commands, prose } = scanBrief(brief);
  if (commands.length === 0 || commands.length > TRIVIAL_MAX_COMMANDS) return null;
  const words = prose.replace(NEGATED, " ").split(/\s+/).filter((w) => /\w/.test(w));
  if (words.length > PROSE_ALLOWANCE || REASONING_VERBS.test(words.join(" "))) return null;
  return `Not delegated: the brief is only ${commands.length} shell command${commands.length === 1 ? "" : "s"} with no reasoning task — run these yourself with run_command background:true: ${commands.map((c) => `\`${c}\``).join(", ")}`;
}
