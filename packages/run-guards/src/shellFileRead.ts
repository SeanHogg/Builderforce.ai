/**
 * A shell command that PRINTS one workspace file, read as the `read_file` it stands for.
 *
 * Measured on the 2026-10-25 run (PRD 35 E1): the model fell back to `sed -n` through
 * `run_command` to see lines read coverage claimed it had, and coverage never tracked
 * those prints — so the same window could be read twice, once each way, with no guard
 * noticing. A print of one file is a read of that file. Recognised, strictly:
 *
 *   cat F · head F · head -n N F · head -N F · tail -n +K F · tail -n N F
 *   sed -n 'A,Bp' F · sed -n 'Ap' F — each optionally after one `cd DIR &&`.
 *
 * Anything else — a pipe, a second file, a glob, a variable, an absolute or `..` path —
 * is not a file read, and stays what it was. Pure: string in, read out.
 */

/** What a recognised command printed: lines `from`… of `path`. */
export interface ShellFileRead {
  /** Workspace-relative path (the `cd` folded in), `/`-separated. */
  path: string;
  /** 1-based first line printed. Undefined for a plain `tail -n N`, whose start depends on the file's length. */
  from?: number;
  /** Lines asked for; undefined = through EOF. */
  count?: number;
}

/** Characters that make a command more than one plain program on one file. */
const SHELL_META = /[|;&<>`$*?(){}\[\]\\\n\r!~]/;

function words(text: string): string[] | null {
  const unquoted = text.replace(/"[^"]*"|'[^']*'/g, "");
  if (SHELL_META.test(unquoted) || /["']/.test(unquoted)) return null;
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  return out;
}

/** A relative path inside the workspace, normalized; null for anything that could leave it. */
function workspacePath(raw: string): string | null {
  const p = raw.trim().split("\\").join("/");
  if (!p || p.startsWith("/") || p.startsWith("-") || p.includes(":")) return null;
  const parts = p.split("/").filter((s) => s !== "" && s !== ".");
  if (parts.length === 0 || parts.some((s) => s === "..")) return null;
  return parts.join("/");
}

const positiveInt = (s: string | undefined): number | undefined =>
  s !== undefined && /^\d+$/.test(s) && Number(s) > 0 ? Number(s) : undefined;

/** The program part (after any `cd`): which lines of which file it prints. */
function printedLines(argv: string[]): Omit<ShellFileRead, "path"> & { file: string } | null {
  const [program, ...args] = argv;
  if (program === "cat" && args.length === 1) return { file: args[0]!, from: 1 };
  if (program === "head" || program === "tail") {
    let n: string | undefined;
    let file: string | undefined;
    if (args.length === 1) [file] = args;
    else if (args.length === 2 && /^-\d+$/.test(args[0]!)) [n, file] = [args[0]!.slice(1), args[1]];
    else if (args.length === 2 && /^-n\+?\d+$/.test(args[0]!)) [n, file] = [args[0]!.slice(2), args[1]];
    else if (args.length === 2 && /^--lines=\+?\d+$/.test(args[0]!)) [n, file] = [args[0]!.slice(8), args[1]];
    else if (args.length === 3 && args[0] === "-n") [n, file] = [args[1], args[2]];
    else return null;
    if (!file) return null;
    if (n === undefined) n = "10";
    if (program === "head") {
      const count = positiveInt(n);
      return count ? { file, from: 1, count } : null;
    }
    // `tail -n +K` prints from line K to EOF; `tail -n N` prints the last N.
    if (n.startsWith("+")) {
      const from = positiveInt(n.slice(1));
      return from ? { file, from } : null;
    }
    const count = positiveInt(n);
    return count ? { file, count } : null;
  }
  if (program === "sed" && args.length === 3 && args[0] === "-n") {
    const m = /^(\d+)(?:,(\d+))?\s*p$/.exec(args[1]!.trim());
    const from = positiveInt(m?.[1]);
    const to = m && m[2] !== undefined ? positiveInt(m[2]) : from;
    if (!from || !to || to < from) return null;
    return { file: args[2]!, from, count: to - from + 1 };
  }
  return null;
}

/** The one file `command` prints and which lines, or null when it is not such a command. */
export function parseShellFileRead(command: string): ShellFileRead | null {
  let rest = command.trim();
  let dir = "";
  const cd = /^cd\s+("[^"]+"|'[^']+'|[^\s;&|<>`$"']+)\s*&&\s*/.exec(rest);
  if (cd) {
    const folder = workspacePath(cd[1]!.replace(/^["']|["']$/g, ""));
    if (!folder) return null;
    dir = folder;
    rest = rest.slice(cd[0].length);
  }
  const argv = words(rest);
  if (!argv || argv.length === 0) return null;
  const printed = printedLines(argv);
  if (!printed) return null;
  const file = workspacePath(printed.file);
  if (!file) return null;
  const { file: _file, ...lines } = printed;
  return { path: dir ? `${dir}/${file}` : file, ...lines };
}

/** The `read_file` arguments and result a file print stands for. */
export interface ShellReadAsFileRead {
  args: Record<string, unknown>;
  result: Record<string, unknown>;
}

/**
 * The `read_file` a successful print of one file stands for, built from what it printed
 * — so read coverage records exactly the lines the model saw. Null when the command is
 * not a file print, printed nothing, or its window cannot be placed (a `tail -n N` that
 * filled all N lines starts at a line nobody knows).
 */
export function shellReadAsFileRead(command: string, stdout: string): ShellReadAsFileRead | null {
  const read = parseShellFileRead(command);
  if (!read) return null;
  const body = stdout.replace(/\r?\n$/, "");
  if (!body) return null;
  const printed = body.split("\n").length;
  const whole = (from: number): ShellReadAsFileRead["result"] =>
    ({ ok: true, path: read.path, content: body, offset: from, totalLines: from + printed - 1, truncated: false });
  if (read.from === undefined) {
    // `tail -n N`: fewer than N lines printed means the whole file was.
    return read.count !== undefined && printed < read.count ? { args: { path: read.path }, result: whole(1) } : null;
  }
  if (read.count === undefined) {
    return { args: read.from > 1 ? { path: read.path, offset: read.from } : { path: read.path }, result: whole(read.from) };
  }
  if (printed > read.count) return null;
  const args = { path: read.path, offset: read.from, limit: read.count };
  // Fewer lines than asked for: the print ran into EOF.
  if (printed < read.count) return { args, result: whole(read.from) };
  return { args, result: { ok: true, path: read.path, content: body, offset: read.from, truncated: true } };
}
