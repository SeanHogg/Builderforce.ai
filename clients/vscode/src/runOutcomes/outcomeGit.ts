/**
 * The git reads of the run-outcomes context on this device (PRD 41 §D1): file history and age for the features frozen at
 * run end, a new commit's files for per-run attribution, and later history with removed lines, blame and both sides' text
 * for the SZZ / revert labellers. Through agent-tools' ONE git runner (argument arrays, never a shell). Every read answers
 * `undefined` (or empty) when git could not answer; none throws. Parsing is pure and exported for tests.
 *
 * COST. Each read is ONE path-limited git process per repository and pass (`git log -p -U0 -- <paths>` for the history,
 * one `git log --diff-filter=A` for every path's age); only a commit that removed lines from the run's paths costs a blame
 * and one `cat-file --batch` per side.
 */

import { runGit } from "@builderforce/agent-tools/node-git-history";
import {
  LOG_RS, LOG_US, parseBlamePorcelain, parseLogPatch, unquoteGitPath, type FileChange, type HistoryCommit, type Timed,
} from "@builderforce/run-delta/predict";
import { repoGit } from "../runDelta/gitSide";

const TIMEOUT_MS = 30_000;

const git = async (root: string, args: string[]): Promise<string | undefined> => (await runGit(root, args, { timeoutMs: TIMEOUT_MS })).stdout;

/** `git diff --numstat` output → path → added/deleted (a binary file's `-` counts as 0; a rename's new path is kept). */
export function parseNumstat(out: string): Map<string, { added: number; deleted: number }> {
  const result = new Map<string, { added: number; deleted: number }>();
  for (const line of out.split("\n")) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line.trim());
    if (!m) continue;
    const name = m[3]!.includes(" => ") ? m[3]!.replace(/\{([^}]*) => ([^}]*)\}/, "$2").replace(/^.* => /, "") : m[3]!;
    result.set(unquoteGitPath(name, false), { added: m[1] === "-" ? 0 : Number(m[1]), deleted: m[2] === "-" ? 0 : Number(m[2]) });
  }
  return result;
}

/** `git log --format=<RS>%H<US>%cI<US>%B` (optionally with `--numstat`) → commits with their message and per-file counts. */
export function parseLog(out: string): Array<{ sha: string; at: string; message: string; files: Map<string, { added: number; deleted: number }> }> {
  return out.split(LOG_RS).filter((chunk) => chunk.trim() !== "").flatMap((chunk) => {
    const [sha, at, rest = ""] = chunk.split(LOG_US);
    if (!sha || !at) return [];
    // `--numstat` lines follow the message; a numstat line never starts a message (it is `n\tn\tpath`).
    const lines = rest.split("\n");
    const firstStat = lines.findIndex((l) => /^(\d+|-)\t(\d+|-)\t/.test(l));
    const message = (firstStat < 0 ? lines : lines.slice(0, firstStat)).join("\n").trim();
    const files = firstStat < 0 ? new Map() : parseNumstat(lines.slice(firstStat).join("\n"));
    return [{ sha: sha.trim(), at: at.trim(), message, files }];
  });
}

/** `git log --diff-filter=A --name-only --format=<RS>%cI` (newest first) → each path's OLDEST add time. */
export function parseBirths(out: string): Map<string, string> {
  const births = new Map<string, string>();
  for (const chunk of out.split(LOG_RS)) {
    const [at, ...names] = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!at) continue;
    for (const name of names) births.set(unquoteGitPath(name, false), at); // later chunks are older: the last one wins
  }
  return births;
}

/** Commits touching `paths` since `since` (ISO) up to HEAD, with their per-path changed lines (churn). */
export async function pathHistory(root: string, paths: readonly string[], since: string): Promise<Array<Timed & { path: string; linesChanged: number }> | undefined> {
  if (paths.length === 0) return [];
  const out = await git(root, ["log", `--since=${since}`, "--numstat", `--format=${LOG_RS}%H${LOG_US}%cI${LOG_US}%B`, "--", ...paths]);
  if (out === undefined) return undefined;
  return parseLog(out).flatMap((c) => [...c.files].map(([path, n]) => ({ path, at: c.at, linesChanged: n.added + n.deleted })));
}

/** When each path was first added (age of the touched code), in ONE git call. Paths git cannot date are left out. */
export async function pathBirths(root: string, paths: readonly string[]): Promise<Array<Timed & { path: string }>> {
  if (paths.length === 0) return [];
  const out = await git(root, ["log", "--diff-filter=A", "--name-only", `--format=${LOG_RS}%cI`, "--", ...paths]);
  const births = out === undefined ? new Map<string, string>() : parseBirths(out);
  const wanted = new Set(paths);
  return [...births].filter(([path]) => wanted.has(path)).map(([path, at]) => ({ path, at }));
}

/** A commit's files with their added lines and the commit time (attribution), or undefined. */
export async function commitFiles(root: string, sha: string): Promise<{ at: string; files: Map<string, { added: number; deleted: number }> } | undefined> {
  const out = await git(root, ["show", "--numstat", "-M", `--format=${LOG_RS}%H${LOG_US}%cI${LOG_US}`, sha]);
  const [commit] = out === undefined ? [] : parseLog(out);
  return commit ? { at: commit.at, files: commit.files } : undefined;
}

/** Commits reachable from HEAD, newest first, from `fromSha` (exclusive) or at most `max`. */
export async function newCommits(root: string, fromSha: string | undefined, max: number): Promise<string[]> {
  const out = await git(root, ["rev-list", `--max-count=${max}`, fromSha ? `${fromSha}..HEAD` : "HEAD"]);
  return out?.split("\n").map((l) => l.trim()).filter(Boolean) ?? [];
}

const decode = (bytes: Uint8Array | null | undefined): string | undefined => (bytes ? new TextDecoder("utf-8").decode(bytes) : undefined);

/**
 * What a capped read can claim it covered: just before the EARLIEST commit it did not process. `git log` order is not
 * strictly by date (side branches interleave, clocks skew), so the last processed commit's time could lie after an older
 * unprocessed one. Never before `since`. Pure.
 */
export function coveredBefore(unprocessed: ReadonlyArray<{ at: string }>, since: string): string {
  const earliest = Math.min(...unprocessed.map((c) => Date.parse(c.at)).filter(Number.isFinite));
  if (!Number.isFinite(earliest)) return since;
  return new Date(Math.max(Date.parse(since), earliest - 1)).toISOString();
}

/** At most this many blames per pass; past it the history is returned INCOMPLETE (`complete: false`). */
export const MAX_BLAMES_PER_PASS = 200;

/** The labellers' history, and whether it covers the whole range (a blame cap reached ⇒ not). */
export interface LaterHistory {
  history: HistoryCommit[];
  complete: boolean;
  /**
   * The history is complete up to this time (ISO): `until` when complete, else 1 ms before the earliest commit the blame
   * cap left unprocessed ({@link coveredBefore}). A run whose window ends by then is fully labelled from it.
   */
  coveredUntil: string;
}

/**
 * The repository's history in `[since, until]` that the labellers read, oldest first: ONE `git log -p -U0 -- <paths>` for
 * every commit — side-branch commits included (a fix made on a branch and merged is a fix; `--first-parent` would hide
 * it) — and its removed lines; plain `git log -p` prints no diff for a merge, and the `%P`-derived `merge` flag keeps a
 * merge from ever being a fix. Only a commit that removed lines from `paths` costs the parent's blame of each such path
 * and both sides' text in one `cat-file --batch` per side, at most `maxBlames` blames per pass. `paths` are the pending
 * runs' attributed paths — no other path can blame to a run.
 */
export async function laterHistory(
  root: string, since: string, until: string, paths: ReadonlySet<string>, maxBlames = MAX_BLAMES_PER_PASS,
): Promise<LaterHistory | undefined> {
  if (paths.size === 0) return { history: [], complete: true, coveredUntil: until };
  const out = await git(root, [
    "log", "-p", "-U0", "--no-color", "--no-ext-diff", "-M", `--since=${since}`, `--until=${until}`,
    `--format=${LOG_RS}%H${LOG_US}%cI${LOG_US}%P${LOG_US}%B${LOG_RS}`, "HEAD", "--", ...paths,
  ]);
  if (out === undefined) return undefined;
  const blobs = repoGit(root);
  const history: HistoryCommit[] = [];
  let blames = 0;
  const commits = parseLogPatch(out).reverse();
  for (const [index, c] of commits.entries()) {
    const touched = [...c.removed].filter(([path, lines]) => paths.has(path) && lines.length > 0);
    const changes: FileChange[] = [];
    if (touched.length > 0 && !c.merge) {
      if (blames + touched.length > maxBlames) return { history, complete: false, coveredUntil: coveredBefore(commits.slice(index), since) };
      blames += touched.length;
      const names = touched.map(([path]) => path);
      const [parents, children] = await Promise.all([blobs.blobs(`${c.sha}^`, names), blobs.blobs(c.sha, names)]);
      for (const [path, removedLines] of touched) {
        const blame = await git(root, ["blame", "--porcelain", `${c.sha}^`, "--", path]);
        const parentText = decode(parents?.get(path));
        const childText = decode(children?.get(path));
        changes.push({
          path, removedLines, blame: blame === undefined ? new Map() : parseBlamePorcelain(blame, path),
          ...(parentText !== undefined ? { parentText } : {}), ...(childText !== undefined ? { childText } : {}),
        });
      }
    }
    history.push({ sha: c.sha, at: c.at, message: c.message, ...(c.merge ? { merge: true } : {}), changes });
  }
  return { history, complete: true, coveredUntil: until };
}
