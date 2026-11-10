/**
 * THE tree hash of the L3 cache key (PRD 41 §B7, B8.3): the content of the files a whole-tree tool reads, computed the
 * SAME way by the run delta (each side) and the background indexer (its folder) — from git, never from the knowledge
 * manifest (which covers only the knowledge root's files, not every file a tool reads in the repository).
 *
 *   hash(scope) = sha256 over the sorted `path \0 blob-id` of every file of git's universe under the scope directories:
 *     tracked and clean  → its index blob id            (`git ls-files -s`)
 *     modified/untracked → the blob id of its content   (`git hash-object --stdin-paths`)
 *     an override        → the blob id of the given text (in process; `null` = the file is absent on this side)
 *
 * Paths are relative to the git ROOT, so a workspace folder that is a sub-folder of the repository hashes its files under
 * the same names the delta does. A blob id is git's own content address, so the same content hashes the same whether it
 * is committed, dirty, or a run's before text. Undefined when git cannot answer (no cache then).
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { whichOnPath } from "./nodeAnalyzerExec";

const TIMEOUT_MS = 60_000;

function git(gitRoot: string, args: readonly string[], input?: string): Promise<string | undefined> {
  return whichOnPath("git").then((exe) => exe ? new Promise<string | undefined>((resolve) => {
    const child = execFile(exe, ["-C", gitRoot, "-c", "core.quotepath=false", ...args],
      { cwd: tmpdir(), encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: TIMEOUT_MS, windowsHide: true },
      (error, stdout) => resolve(error ? undefined : stdout));
    if (input !== undefined) child.stdin?.end(input);
  }) : undefined);
}

/** git's blob id of a text (what `git hash-object` gives the same bytes). */
export function gitBlobId(text: string): string {
  const bytes = Buffer.from(text, "utf8");
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

/** The git root of a folder; undefined outside a repository. */
export async function gitRootOf(folder: string): Promise<string | undefined> {
  return (await git(folder, ["rev-parse", "--show-toplevel"]))?.trim() || undefined;
}

const under = (p: string, scopes: readonly string[]): boolean => scopes.some((s) => s === "." || s === "" || p === s || p.startsWith(`${s}/`));

/**
 * The tree hash of `scopes` (directories relative to the git root; `.` = everything) on the side described by
 * `overrides` (git-root-relative path → that side's text, `null` = absent; the working tree for every other file).
 */
export async function scopeTreeHash(gitRoot: string, scopes: readonly string[], overrides: ReadonlyMap<string, string | null> = new Map()): Promise<string | undefined> {
  const spec = scopes.some((s) => s === "." || s === "") ? [] : ["--", ...scopes];
  const staged = await git(gitRoot, ["ls-files", "-s", "-z", ...spec]);
  const dirty = await git(gitRoot, ["ls-files", "-z", "-m", "--others", "--exclude-standard", ...spec]);
  const deleted = await git(gitRoot, ["ls-files", "-z", "-d", ...spec]);
  if (staged === undefined || dirty === undefined || deleted === undefined) return undefined;
  const blobs = new Map<string, string>();
  for (const row of staged.split("\0").filter(Boolean)) {
    const tab = row.indexOf("\t");
    const [, sha] = row.slice(0, tab).split(" ");
    if (sha) blobs.set(row.slice(tab + 1), sha);
  }
  const gone = new Set(deleted.split("\0").filter(Boolean));
  for (const p of gone) blobs.delete(p);
  const changed = [...new Set(dirty.split("\0").filter((p) => p && !gone.has(p)))].sort();
  if (changed.length > 0) {
    const out = await git(gitRoot, ["hash-object", "--stdin-paths"], `${changed.join("\n")}\n`);
    const ids = out?.split(/\r?\n/).filter(Boolean) ?? [];
    if (ids.length !== changed.length) return undefined; // git could not hash them all: no key, no cache
    changed.forEach((p, i) => blobs.set(p, ids[i]!));
  }
  for (const [p, text] of overrides) {
    if (!under(p, scopes)) continue;
    if (text === null) blobs.delete(p);
    else blobs.set(p, gitBlobId(text));
  }
  const lines = [...blobs].filter(([p]) => under(p, scopes)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([p, id]) => `${p}\0${id}`);
  return createHash("sha256").update(JSON.stringify(scopes)).update("\n").update(lines.join("\n")).digest("hex");
}
