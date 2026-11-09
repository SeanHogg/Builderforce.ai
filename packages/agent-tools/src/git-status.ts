/**
 * `git_status`, answered in ONE call — the command text and the parse behind it (split out
 * of `git-tools.ts`, which holds the tool definitions and the shared runner).
 *
 * Observed (chat #60338): to answer "is my change committed / pushed, and by whom?" a model
 * made seven calls — `git_diff` twice (one a 20 KB full diff), `git_status` twice and
 * `git log origin/main..HEAD` three times — because `git_status` returned only raw text and
 * nothing about the commits behind a file. So one call now carries:
 *
 *   - branch, upstream, ahead/behind (the `## …` header of `git status --short --branch`);
 *   - staged / unstaged / untracked / conflicted entries, parsed;
 *   - with `paths`: the last commit touching each path (sha, subject, author, date) and
 *     whether that commit is already on the upstream (`git merge-base --is-ancestor`).
 *
 * Without `paths` the command is byte-for-byte the old `git status --short --branch`, so the
 * Container mirror, the cmd.exe routing and the ship verification that parses this header are
 * all unchanged. With `paths` it is ONE shell invocation: the status plus one `git log` and
 * one `merge-base` per path, separated by marker lines this module parses back.
 */

import { commitPathCandidates, shellQuote } from "./git-repo-scope.js";

/** The no-paths status command — unchanged, shared with the Container image's execTool. */
export const GIT_STATUS_COMMAND = "git status --short --branch";

/** Most paths one `git_status` call resolves commits for (each costs two git commands). */
export const GIT_STATUS_MAX_PATHS = 20;
/** Most entries per list in the structured report; `output` still carries the raw text. */
const MAX_ENTRIES = 200;

const PATH_MARK = "@@bf-path";
const PUSHED_MARK = "@@bf-pushed";
/** sha first, then a SPACE (so the script can cut it with `${L%% *}`), then US-separated fields. */
const LOG_FORMAT = "%H %an%x1f%ae%x1f%aI%x1f%s";
const US = "\x1f";

/** One changed path in the working tree or index. `from` is a rename/copy's source. */
export interface GitStatusEntry {
  path: string;
  /** The porcelain status letter: M, A, D, R, C, T. */
  status: string;
  from?: string;
}

/** The last commit that touched a path the caller asked about. */
export interface GitPathCommit {
  path: string;
  /** null when the path has no commit (new, untracked, or not in this repository). */
  lastCommit: { sha: string; subject: string; author: string; email: string; date: string } | null;
  /** That commit is on the upstream (pushed). null when there is no upstream or no commit. */
  onUpstream: boolean | null;
}

export interface GitStatusReport {
  /** null when HEAD is detached. */
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  /** The upstream branch was deleted on the remote (`[gone]`). */
  upstreamGone?: true;
  detached?: true;
  /** No commit exists yet on the branch. */
  noCommits?: true;
  staged: GitStatusEntry[];
  unstaged: GitStatusEntry[];
  untracked: string[];
  conflicted: string[];
  /** Nothing staged, unstaged, untracked or conflicted (within `paths`, when given). */
  clean: boolean;
  /** Set when a list was cut at {@link MAX_ENTRIES}; the raw `output` has everything. */
  truncated?: true;
  paths?: GitPathCommit[];
}

/** The caller's paths, trimmed, deduped and capped. */
export function statusPaths(paths: readonly unknown[] | undefined): string[] {
  const clean = (paths ?? []).filter((p): p is string => typeof p === "string").map((p) => p.trim()).filter(Boolean);
  return [...new Set(clean)].slice(0, GIT_STATUS_MAX_PATHS);
}

/**
 * The status command. No paths ⇒ exactly {@link GIT_STATUS_COMMAND}. With paths ⇒ one POSIX
 * script (routed to bash on Windows by its `[ … ]` tests): status limited to those paths, then
 * per path a marker, its last commit, and whether that commit is on `@{u}`. Each path is tried
 * as given, then re-expressed inside `repo` (see `commitPathCandidates`) — file tools speak in
 * workspace-root paths, git in repo-relative ones.
 */
export function buildStatusCommand(paths?: readonly string[], repo?: string): string {
  const wanted = statusPaths(paths);
  if (wanted.length === 0) return GIT_STATUS_COMMAND;
  const candidatesOf = (p: string): string[] => commitPathCandidates(p, repo);
  const spec = [...new Set(wanted.flatMap(candidatesOf))].map(shellQuote).join(" ");
  const log = (p: string): string => `"$(git --no-pager log -1 --format='${LOG_FORMAT}' -- ${shellQuote(p)} 2>/dev/null)"`;
  const lines = [`${GIT_STATUS_COMMAND} -- ${spec} || exit $?`];
  wanted.forEach((p, i) => {
    const [first, ...rest] = candidatesOf(p);
    lines.push(`echo "${PATH_MARK} ${i}"`);
    lines.push(`L=${log(first ?? p)}`);
    for (const c of rest) lines.push(`[ -n "$L" ] || L=${log(c)}`);
    lines.push(
      `[ -z "$L" ] || { printf '%s\\n' "$L"; git merge-base --is-ancestor "\${L%% *}" '@{u}' 2>/dev/null && echo "${PUSHED_MARK} yes" || echo "${PUSHED_MARK} no"; }`,
    );
  });
  return lines.join("\n");
}

/** Undo git's C-style quoting of a path with special characters (`"a b\303\251"`). */
export function unquoteGitPath(s: string): string {
  if (s.length < 2 || !s.startsWith('"') || !s.endsWith('"')) return s;
  const body = s.slice(1, -1);
  const enc = new TextEncoder();
  const bytes: number[] = [];
  const simple: Record<string, string> = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", a: "\x07", b: "\b", f: "\f", v: "\v" };
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i]!;
    if (c !== "\\" || i === body.length - 1) {
      bytes.push(...enc.encode(c));
      continue;
    }
    const next = body[i + 1]!;
    const octal = /^[0-7]{3}/.exec(body.slice(i + 1));
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      i += 3;
    } else {
      bytes.push(...enc.encode(simple[next] ?? next));
      i += 1;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

type Header = Pick<GitStatusReport, "branch" | "upstream" | "ahead" | "behind" | "upstreamGone" | "detached" | "noCommits">;

/** Parse the `## …` branch header of `git status --short --branch`. */
function parseHeader(line: string | undefined): Header {
  const header: Header = { branch: null, upstream: null, ahead: 0, behind: 0 };
  if (!line) return header;
  const text = line.replace(/^##\s*/, "");
  const initial = /^(?:No commits yet on|Initial commit on) (.+)$/.exec(text);
  if (initial) return { ...header, branch: initial[1]!.trim(), noCommits: true };
  if (/^HEAD \(no branch\)/.test(text)) return { ...header, detached: true };
  const [names = "", bracket = ""] = text.split(/ \[(.*)\]$/);
  const dots = names.indexOf("...");
  header.branch = (dots === -1 ? names : names.slice(0, dots)).trim() || null;
  if (dots !== -1) header.upstream = names.slice(dots + 3).trim() || null;
  header.ahead = Number(/ahead (\d+)/.exec(bracket)?.[1] ?? 0);
  header.behind = Number(/behind (\d+)/.exec(bracket)?.[1] ?? 0);
  if (/\bgone\b/.test(bracket)) header.upstreamGone = true;
  return header;
}

const CONFLICT = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

/** Parse the entry lines (`XY path`, `XY from -> to`, `?? path`) into the four lists. */
function parseEntries(lines: readonly string[]): Pick<GitStatusReport, "staged" | "unstaged" | "untracked" | "conflicted"> {
  const out = { staged: [] as GitStatusEntry[], unstaged: [] as GitStatusEntry[], untracked: [] as string[], conflicted: [] as string[] };
  for (const line of lines) {
    if (line.length < 4 || line.startsWith("##")) continue;
    const xy = line.slice(0, 2);
    const rest = line.slice(3);
    if (xy === "!!") continue;
    if (xy === "??") {
      out.untracked.push(unquoteGitPath(rest));
      continue;
    }
    const arrow = rest.indexOf(" -> ");
    const path = unquoteGitPath(arrow === -1 ? rest : rest.slice(arrow + 4));
    const from = arrow === -1 ? undefined : unquoteGitPath(rest.slice(0, arrow));
    if (CONFLICT.has(xy)) {
      out.conflicted.push(path);
      continue;
    }
    const [x, y] = [xy[0]!, xy[1]!];
    if (x !== " ") out.staged.push({ path, status: x, ...(from && (x === "R" || x === "C") ? { from } : {}) });
    if (y !== " ") out.unstaged.push({ path, status: y });
  }
  return out;
}

/** The per-path sections the script emits after the status text. */
function parsePathSections(sections: readonly string[][], paths: readonly string[], upstreamUsable: boolean): GitPathCommit[] {
  return paths.map((path, i) => {
    const lines = sections[i] ?? [];
    const logLine = lines.find((l) => l.includes(US));
    if (!logLine) return { path, lastCommit: null, onUpstream: null };
    const space = logLine.indexOf(" ");
    const [author = "", email = "", date = "", ...subject] = logLine.slice(space + 1).split(US);
    const pushed = lines.find((l) => l.startsWith(PUSHED_MARK));
    return {
      path,
      lastCommit: { sha: logLine.slice(0, space), subject: subject.join(US), author, email, date },
      onUpstream: upstreamUsable && pushed ? pushed.endsWith(" yes") : null,
    };
  });
}

/**
 * Split the command's stdout into the raw status text (the tool's `output`, unchanged in
 * form so the ship verification still reads its header) and the structured report.
 */
export function parseGitStatusOutput(stdout: string, paths?: readonly string[]): { output: string; report: GitStatusReport } {
  const lines = stdout.replace(/\r\n/g, "\n").split("\n");
  const firstMark = lines.findIndex((l) => l.startsWith(PATH_MARK));
  const statusLines = firstMark === -1 ? lines : lines.slice(0, firstMark);
  const sections: string[][] = [];
  if (firstMark !== -1) {
    for (const line of lines.slice(firstMark)) {
      const mark = new RegExp(`^${PATH_MARK} (\\d+)$`).exec(line);
      if (mark) sections[Number(mark[1])] = [];
      else sections[sections.length - 1]?.push(line);
    }
  }
  const header = parseHeader(statusLines.find((l) => l.startsWith("##")));
  const entries = parseEntries(statusLines);
  const truncated = Object.values(entries).some((list) => list.length > MAX_ENTRIES);
  const report: GitStatusReport = {
    ...header,
    staged: entries.staged.slice(0, MAX_ENTRIES),
    unstaged: entries.unstaged.slice(0, MAX_ENTRIES),
    untracked: entries.untracked.slice(0, MAX_ENTRIES),
    conflicted: entries.conflicted.slice(0, MAX_ENTRIES),
    clean: Object.values(entries).every((list) => list.length === 0),
    ...(truncated ? { truncated: true as const } : {}),
  };
  const wanted = statusPaths(paths);
  if (wanted.length > 0) report.paths = parsePathSections(sections, wanted, !!header.upstream && !header.upstreamGone);
  return { output: statusLines.join("\n").trim(), report };
}
