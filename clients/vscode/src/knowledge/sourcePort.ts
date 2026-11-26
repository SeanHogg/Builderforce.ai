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
import { runGit } from "@builderforce/agent-tools/node-git-history";
import { isMissingPath } from "../composerCommands/writeContainment";
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

/**
 * A commit sha the host will hand to git: 7-40 hex digits and nothing else. Anything git would also accept as a revision
 * (`HEAD~1`, `main`, `a..b`, `@{u}`) is refused, and so is anything starting with `-` — a value like `--output=x` must never
 * reach git's argument list as an option.
 */
export const COMMIT_SHA = /^[0-9a-f]{7,40}$/i;

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
 * Null when any of that refuses, git fails (not a repository, unknown commit, no such file at that commit), or the blob is too big.
 */
export async function readSourceAt(root: KnowledgeRoot, rel: unknown, rev: unknown, startLine: unknown, endLine: unknown): Promise<KnowledgeSourceText | null> {
  if (typeof rev !== "string" || !COMMIT_SHA.test(rev)) return null;
  if (typeof rel !== "string" || !isSafeRelative(rel)) return null;
  const spec = `${rev}:./${rel.replace(/\\/g, "/").replace(/^(\.\/)+/, "")}`;
  const size = await runGit(root.rootPath, ["cat-file", "-s", spec], { timeoutMs: GIT_AT_TIMEOUT_MS });
  const bytes = size.stdout === undefined ? Number.NaN : Number(size.stdout.trim());
  if (!Number.isInteger(bytes) || bytes > MAX_SOURCE_FILE_BYTES) return null;
  const blob = await runGit(root.rootPath, ["cat-file", "blob", spec], { timeoutMs: GIT_AT_TIMEOUT_MS });
  if (blob.stdout === undefined) return null;
  return sliceLines(blob.stdout, clampLines(startLine, endLine));
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
