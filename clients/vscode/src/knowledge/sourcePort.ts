/**
 * The code band's two host ports (PRD 43 B1a rule 9): `readSource` (some lines of one file of a root) and
 * `openSource` ("Open at line" in the editor). Every argument arrives from the webview, so it is untrusted:
 *
 *   - the root is one an open workspace folder holds (the caller resolves it with `rootById`, which throws otherwise);
 *   - the path is root-relative with no way out (`isSafeRelative`), and its REAL path (links followed) sits inside the
 *     root's real path — a link inside the root that points outside is refused;
 *   - a file over {@link MAX_SOURCE_FILE_BYTES} is not read;
 *   - the lines are clamped to 1-based, at most {@link MAX_SOURCE_LINES} of them.
 *
 * A refused or missing file answers null; any other failure (permissions, I/O) propagates to the caller's error reply.
 */

import { realpath, stat } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { runGit, type GitRun } from "@builderforce/agent-tools/node-git-history";
import { reportExtensionError } from "../diagnostics/errorReporter";
import { isMissingPath } from "../composerCommands/writeContainment";
import { COMMIT_SHA } from "./commitSha";
import { MAX_SOURCE_LINES, type KnowledgeSourceText } from "./knowledgeProtocol";
import { inside, slash, type KnowledgeRoot } from "./knowledgeRoots";
import { isSafeRelative } from "./safePath";

/** A larger source file is not read for the code band. */
export const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024;

/** The lines asked for, made safe: integers from 1, at most {@link MAX_SOURCE_LINES} of them; `truncated` when the cap cut the range. */
export function clampLines(startLine: unknown, endLine: unknown): { startLine: number; endLine: number; truncated: boolean } {
  const start = Number.isFinite(startLine) ? Math.max(1, Math.floor(startLine as number)) : 1;
  const asked = Number.isFinite(endLine) ? Math.max(start, Math.floor(endLine as number)) : start;
  const end = Math.min(asked, start + MAX_SOURCE_LINES - 1);
  return { startLine: start, endLine: end, truncated: end < asked };
}

/** The real path of `rel` under `root` when it is a safe name that resolves inside the root's real path; null when refused or missing. */
export async function resolveInsideRoot(root: KnowledgeRoot, rel: unknown): Promise<string | null> {
  if (typeof rel !== "string" || !isSafeRelative(rel)) return null;
  try {
    const realRoot = slash(await realpath(root.rootPath));
    const realFile = await realpath(path.resolve(root.rootPath, rel));
    return inside(slash(realFile), realRoot) && slash(realFile) !== realRoot ? realFile : null;
  } catch (error) {
    if (isMissingPath(error)) return null;
    throw error;
  }
}

/** Lines `startLine..endLine` of `rel` in `root`; null when the path is refused, missing, not a file or too large. */
export async function readSource(root: KnowledgeRoot, rel: unknown, startLine: unknown, endLine: unknown): Promise<KnowledgeSourceText | null> {
  const file = await resolveInsideRoot(root, rel);
  if (!file) return null;
  const info = await stat(file);
  if (!info.isFile() || info.size > MAX_SOURCE_FILE_BYTES) return null;
  const range = clampLines(startLine, endLine);
  const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(file)));
  return sliceLines(text, range);
}

/** The clamped `range` of `text`'s lines as the view's `SourceText` — one slicer for the working copy and for a commit's blob. */
function sliceLines(text: string, range: { startLine: number; endLine: number; truncated: boolean }): KnowledgeSourceText {
  return { startLine: range.startLine, lines: text.split(/\r?\n/).slice(range.startLine - 1, range.endLine), truncated: range.truncated };
}

/** Room for git to answer `cat-file` for one blob; a hung or huge repository does not hold the view's call. */
const GIT_AT_TIMEOUT_MS = 10_000;

/**
 * Lines `startLine..endLine` of `rel` as it was at commit `rev` (PRD 43 C8), read from the root's repository.
 *
 *   - `rev` must match {@link COMMIT_SHA} (option injection, ref expressions);
 *   - `rel` passes the SAME lexical check as `readSource` (`isSafeRelative`: no `..`, no absolute path, no NUL). Its real-path
 *     check is not repeated: the file may no longer exist in the working tree, and git reads the object database, which no
 *     working-tree link can redirect (a tree path never traverses a symlink);
 *   - `rel` is addressed as `rev:./path`: the `./` makes git resolve it against the root (git's cwd), not the repository
 *     top, so a root that is a subfolder of the repository cannot be escaped upward;
 *   - the blob's size is asked first (`cat-file -s`) and a blob over {@link MAX_SOURCE_FILE_BYTES} is never read; `cat-file blob`
 *     (not `show`) refuses a tree or a commit named by the path, and runs no textconv filter or external program;
 *   - argv is an array (no shell), so no value is ever parsed as shell text.
 *
 * Null when a check above refuses, the blob is too big, or the path does not exist at that commit (the commit itself exists).
 * Every other git failure (timeout, output too large, git missing, not a repository, unknown commit) is reported through
 * `reportExtensionError` and thrown, so the view never mistakes "could not read" for "the file was absent then".
 */
export async function readSourceAt(root: KnowledgeRoot, rel: unknown, rev: unknown, startLine: unknown, endLine: unknown): Promise<KnowledgeSourceText | null> {
  if (typeof rev !== "string" || !COMMIT_SHA.test(rev)) return null;
  if (typeof rel !== "string" || !isSafeRelative(rel)) return null;
  const spec = `${rev}:./${rel.replace(/\\/g, "/").replace(/^(\.\/)+/, "")}`;
  const size = await runGit(root.rootPath, ["cat-file", "-s", spec], { timeoutMs: GIT_AT_TIMEOUT_MS });
  if (size.stdout === undefined) {
    if (await pathAbsentAt(root, rev, size)) return null;
    throw await gitFailure(rev, rel, size);
  }
  const bytes = Number(size.stdout.trim());
  if (!Number.isInteger(bytes)) throw await gitFailure(rev, rel, { ...size, stderr: `unreadable size: ${size.stdout.trim().slice(0, 40)}` });
  if (bytes > MAX_SOURCE_FILE_BYTES) return null;
  const blob = await runGit(root.rootPath, ["cat-file", "blob", spec], { timeoutMs: GIT_AT_TIMEOUT_MS });
  if (blob.stdout === undefined) throw await gitFailure(rev, rel, blob);
  return sliceLines(blob.stdout, clampLines(startLine, endLine));
}

/**
 * git's "no such path" answers (`cat-file -s <rev>:./<path>` exits 128 with `fatal: Not a valid object name <spec>`, and
 * `rev-parse`/`show` word it `fatal: path '<p>' does not exist in '<rev>'` or `exists on disk, but not in '<rev>'`). The
 * "Not a valid object name" wording is shared with an unknown commit, so it only means "path absent" once the commit is
 * confirmed to exist.
 */
const PATH_ABSENT = /does not exist in|exists on disk, but not in|Not a valid object name/i;

/** True only when git failed with a "no such path" message AND `rev` is a commit this repository has. */
async function pathAbsentAt(root: KnowledgeRoot, rev: string, run: GitRun): Promise<boolean> {
  if (run.failure !== "error" || !PATH_ABSENT.test(run.stderr ?? "")) return false;
  const commit = await runGit(root.rootPath, ["cat-file", "-e", `${rev}^{commit}`], { timeoutMs: GIT_AT_TIMEOUT_MS });
  return commit.stdout !== undefined;
}

/** A git failure that is not "the file was absent": reported to the extension's error sink, and returned for the caller to throw. */
async function gitFailure(rev: string, rel: string, run: GitRun): Promise<Error> {
  const why = run.failure === "timeout" ? "timed out" : run.failure === "buffer" ? "output too large" : (run.stderr ?? "").trim().split(/\r?\n/)[0] || "git failed";
  const error = new Error(`git could not read ${rel} at ${rev.slice(0, 12)}: ${why}`);
  await reportExtensionError(error, { operation: "knowledge.readSourceAt", context: { rev: rev.slice(0, 12), failure: run.failure ?? "error" } });
  return error;
}

/** Opens `rel` in the editor with lines `startLine..endLine` selected (a preview tab). Null either way: a refused path opens nothing. */
export async function openSource(root: KnowledgeRoot, rel: unknown, startLine: unknown, endLine?: unknown): Promise<null> {
  const file = await resolveInsideRoot(root, rel);
  if (!file) return null;
  const range = clampLines(startLine, endLine ?? startLine);
  await vscode.window.showTextDocument(vscode.Uri.file(file), {
    selection: new vscode.Range(range.startLine - 1, 0, range.endLine - 1, 0),
    preview: true,
  });
  return null;
}
