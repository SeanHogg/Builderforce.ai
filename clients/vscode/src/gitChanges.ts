/**
 * "What has the agent changed that I haven't reviewed?" — the cached read port over
 * the uncommitted working set of every repository in the open workspace.
 *
 * The editor's local tools (`write_file` / `edit_file` / `delete_file` / `run_command`)
 * write straight into the workspace, so a Brain turn can leave real, unreviewed edits
 * on disk while the conversation only SAYS it changed something. Nothing in the
 * BuilderForce surfaces read that fact: the chat, the ticket rail and the sidebar all
 * showed a finished turn with no hint that code was now pending review.
 *
 * This module is the one source of that answer. It reads the built-in Git extension
 * when available (no process spawn, and it raises `state.onDidChange` on every stage /
 * commit / edit, so the cache invalidates instead of polling) and falls back to
 * `git status --porcelain` otherwise. Everything above it — the Changes view, the
 * chat's pending-changes bar, the persona's dirty-file count — reads THIS, so a count
 * shown in one place cannot contradict a list shown in another.
 *
 * The mapping itself is host-free and unit-tested in {@link gitChangeModel}; this
 * file is only the caching, the watching and the two ways of asking git.
 */

import * as vscode from "vscode";
import {
  collectRepoChanges,
  contains,
  EMPTY_CHANGE_SET,
  normalizePath,
  parsePorcelain,
  repoName,
  toChangeSet,
  type PendingChangeRepo,
  type PendingChangeSet,
} from "./gitChangeModel";
import { getGitApi, runGit, runGitRaw, watchGitRepositories, type GitApiRepository } from "./gitApi";
import { boundDiff, pendingDiffCommands } from "./pendingDiffModel";
import { ttlCache } from "./ttlCache";

export type {
  PendingChange,
  PendingChangeRepo,
  PendingChangeSet,
  PendingChangeStatus,
} from "./gitChangeModel";
export { EMPTY_CHANGE_SET } from "./gitChangeModel";

/** Long, because {@link watchPendingChanges} invalidates the instant git moves. */
const CHANGES_TTL = 15_000;
const CACHE_KEY = "workspace";
const cache = ttlCache<string, PendingChangeSet>(CHANGES_TTL);
/** The working tree's unified diff, invalidated with {@link cache} — same events. */
const diffCache = ttlCache<string, string>(CHANGES_TTL);
/** Bumped on every invalidation: a diff computed across one is not cached, so a slow
 *  read that started before an agent write cannot pin the pre-write rows for a TTL. */
let diffGeneration = 0;
/** The read in flight, shared by every ask that arrives while it runs. */
let diffInFlight: { generation: number; promise: Promise<string> } | undefined;

const changeEmitter = new vscode.EventEmitter<void>();

/** The workspace folders to look for repositories under. */
function workspaceFolders(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
}

/** Read every repository in the workspace through the Git extension. */
function fromExtension(repos: GitApiRepository[], folders: string[]): PendingChangeRepo[] {
  return (
    repos
      // Only repositories the workspace actually contains (or that contain a workspace
      // folder) — a repo opened for an unrelated folder is not this workspace's work.
      .filter((repo) =>
        folders.some(
          (folder) => contains(repo.rootUri.fsPath, folder) || contains(folder, repo.rootUri.fsPath),
        ),
      )
      .map((repo) => ({
        root: repo.rootUri.fsPath,
        name: repoName(repo.rootUri.fsPath),
        branch: repo.state.HEAD?.name,
        changes: collectRepoChanges(repo),
      }))
  );
}

/** Read one workspace folder's repository through the `git` CLI. */
async function fromCli(folder: string): Promise<PendingChangeRepo | undefined> {
  const root = await runGit(folder, "rev-parse --show-toplevel");
  if (!root) return undefined;
  const [status, branch] = await Promise.all([
    runGit(folder, "status --porcelain=v1 --untracked-files=all"),
    runGit(folder, "rev-parse --abbrev-ref HEAD"),
  ]);
  return {
    root,
    name: repoName(root),
    branch: branch && branch !== "HEAD" ? branch : undefined,
    changes: status ? parsePorcelain(status, root) : [],
  };
}

/**
 * The workspace's uncommitted work, cached. Prefers the Git extension; falls back to
 * one `git status` per workspace folder (deduped by resolved repository root).
 */
export async function detectPendingChanges(): Promise<PendingChangeSet> {
  const hit = cache.get(CACHE_KEY);
  if (hit) return hit.value;

  const folders = workspaceFolders();
  let set = EMPTY_CHANGE_SET;
  if (folders.length) {
    const api = await getGitApi();
    if (api) {
      set = toChangeSet(fromExtension(api.repositories, folders));
    } else {
      const byRoot = new Map<string, PendingChangeRepo>();
      for (const folder of folders) {
        const repo = await fromCli(folder);
        if (repo) byRoot.set(normalizePath(repo.root), repo);
      }
      set = toChangeSet([...byRoot.values()]);
    }
  }
  cache.set(CACHE_KEY, set);
  return set;
}

/**
 * The uncommitted work as unified diff text — what the Visualization panel's change
 * tree renders as before/after rows (`parseUnifiedDiff`). Every repository's diff
 * against HEAD, concatenated (paths stay repo-relative, the shape the change graph
 * keys on); which commands depend on whether the repository has a HEAD
 * (`pendingDiffCommands`), and the result is bounded by file (`boundDiff`). Untracked
 * files have no diff and are drawn from the change list. Cached and invalidated
 * exactly like {@link detectPendingChanges}; concurrent asks share one read.
 */
export function detectPendingDiff(): Promise<string> {
  const hit = diffCache.get(CACHE_KEY);
  if (hit) return Promise.resolve(hit.value);
  if (diffInFlight?.generation === diffGeneration) return diffInFlight.promise;
  const generation = diffGeneration;
  const promise = readPendingDiff()
    .then((diff) => {
      if (generation === diffGeneration) diffCache.set(CACHE_KEY, diff);
      return diff;
    })
    .finally(() => {
      if (diffInFlight?.promise === promise) diffInFlight = undefined;
    });
  diffInFlight = { generation, promise };
  return promise;
}

/** Room for a large staged change before the per-file bound drops it; git output past
 *  this fails the read, which would otherwise blank every row. */
const DIFF_READ_LIMITS = { timeoutMs: 15_000, maxBuffer: 64 * 1024 * 1024 };

async function readPendingDiff(): Promise<string> {
  const set = await detectPendingChanges();
  const parts: string[] = [];
  for (const repo of set.repos) {
    if (repo.changes.length === 0) continue;
    const hasHead = (await runGit(repo.root, "rev-parse --verify -q HEAD")) !== undefined;
    for (const command of pendingDiffCommands(hasHead)) {
      const text = await runGitRaw(repo.root, command, DIFF_READ_LIMITS);
      if (text) parts.push(text.endsWith("\n") ? text : `${text}\n`);
    }
  }
  return boundDiff(parts.join(""));
}

/** Drop the cached set so the next read re-detects. */
function invalidatePendingChanges(): void {
  cache.invalidate();
  diffCache.invalidate();
  diffGeneration += 1;
}

/**
 * Drop the cache AND wake every subscriber — the signal to fire the moment something
 * outside git's own notifications changed the working tree. The agent's local tools
 * write through `node:fs`, not the text-document API, so a `write_file` / `edit_file` /
 * `delete_file` / `run_command` turn is exactly such a moment: without this the chat
 * would keep claiming "nothing pending" until the next TTL expiry.
 */
export function refreshPendingChanges(): void {
  invalidatePendingChanges();
  changeEmitter.fire();
}

/**
 * The upstream subscriptions that drive {@link changeEmitter}, held ONCE however many
 * surfaces are watching. Every open chat panel plus the Changes view would otherwise
 * each attach its own repository listener and re-invalidate the same cache on the same
 * git event. Ref-counted so they are also torn down when the last watcher goes.
 */
let sources: vscode.Disposable[] | undefined;
let watcherCount = 0;

function openSources(): void {
  if (sources) return;
  sources = [
    watchGitRepositories(refreshPendingChanges),
    // The CLI fallback has no state events of its own; a save is the cheapest
    // reliable editor-side signal. Agent writes bypass it entirely and are covered by
    // {@link refreshPendingChanges}, fired by the host after every mutating tool.
    vscode.workspace.onDidSaveTextDocument(() => refreshPendingChanges()),
  ];
}

function closeSources(): void {
  for (const s of sources ?? []) s.dispose();
  sources = undefined;
}

/**
 * Fire `onChange` whenever the uncommitted set could have changed — an edit, a stage,
 * a commit, a checkout, a repository opening or closing — after invalidating the
 * cache so the next read is fresh.
 */
export function watchPendingChanges(onChange: () => void): vscode.Disposable {
  openSources();
  watcherCount += 1;
  const sub = changeEmitter.event(onChange);
  let disposed = false;
  return new vscode.Disposable(() => {
    if (disposed) return;
    disposed = true;
    sub.dispose();
    watcherCount -= 1;
    if (watcherCount === 0) closeSources();
  });
}
