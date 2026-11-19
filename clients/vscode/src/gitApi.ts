/**
 * Access to VS Code's built-in Git extension (`vscode.git`) — the ONE place this
 * extension talks to it.
 *
 * Two features need the same handle for different reasons: {@link gitContext}
 * answers "which repository is the code in?" (branch / remote / ahead-behind) and
 * {@link gitChanges} answers "what is uncommitted right now?". Both used to imply
 * their own copy of the API typings, activation dance and repository lookup; this
 * module owns all three so they cannot drift on which repository a workspace folder
 * resolves to, or on when a repository state change should invalidate a cache.
 *
 * Path comparison and the change-set mapping live in {@link gitChangeModel}, which
 * imports no editor API; this module is only the plumbing that reaches git.
 *
 * The API surface is typed LOCALLY (a narrow slice of `git.d.ts`, which the Git
 * extension does not publish) so the extension keeps compiling — and keeps working
 * through its CLI fallbacks — on a host where Git is absent or disabled.
 */

import * as vscode from "vscode";
import { contains } from "./gitChangeModel";

/** One changed resource as the Git extension reports it. */
export interface GitApiChange {
  uri: vscode.Uri;
  originalUri: vscode.Uri;
  renameUri?: vscode.Uri;
  status: number;
}

export interface GitApiRepositoryState {
  HEAD?: { name?: string; commit?: string; ahead?: number; behind?: number };
  remotes: { name: string; fetchUrl?: string; pushUrl?: string }[];
  workingTreeChanges: GitApiChange[];
  indexChanges: GitApiChange[];
  mergeChanges?: GitApiChange[];
  /** Present only when `git.untrackedChanges` is set to `separate`. */
  untrackedChanges?: GitApiChange[];
  onDidChange: vscode.Event<void>;
}

export interface GitApiRepository {
  rootUri: vscode.Uri;
  state: GitApiRepositoryState;
}

export interface GitApi {
  repositories: GitApiRepository[];
  onDidOpenRepository: vscode.Event<GitApiRepository>;
  onDidCloseRepository: vscode.Event<GitApiRepository>;
}

interface GitExtension {
  getAPI(version: 1): GitApi;
}

/** The activated Git API, or undefined when the extension isn't present/enabled. */
export async function getGitApi(): Promise<GitApi | undefined> {
  try {
    const ext = vscode.extensions.getExtension<GitExtension>("vscode.git");
    if (!ext) return undefined;
    const exports = ext.isActive ? ext.exports : await ext.activate();
    return exports?.getAPI(1);
  } catch {
    return undefined;
  }
}

/** The innermost repository containing `folder` (nested repos: deepest root wins). */
export function findRepository(api: GitApi, folder: string): GitApiRepository | undefined {
  return api.repositories
    .filter((r) => contains(r.rootUri.fsPath, folder))
    .sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length)[0];
}

/**
 * Fire `onChange` whenever ANY open repository's state could have changed — a
 * commit, a stage, a checkout, a file edited on disk — or a repository is opened or
 * closed. The single subscription both the repo-identity cache and the pending-change
 * cache hang off, so neither polls and both invalidate at the same instant.
 *
 * Returns a disposable tearing down every subscription (including ones added later
 * by `onDidOpenRepository`).
 */
export function watchGitRepositories(onChange: () => void): vscode.Disposable {
  const subs: vscode.Disposable[] = [];
  let disposed = false;

  void getGitApi().then((api) => {
    if (!api || disposed) return;
    const watchRepo = (repo: GitApiRepository) => {
      subs.push(repo.state.onDidChange(() => onChange()));
    };
    for (const repo of api.repositories) watchRepo(repo);
    subs.push(
      api.onDidOpenRepository((repo) => {
        watchRepo(repo);
        onChange();
      }),
      api.onDidCloseRepository(() => onChange()),
    );
  });

  return new vscode.Disposable(() => {
    disposed = true;
    for (const s of subs) s.dispose();
  });
}

// ---------------------------------------------------------------------------
// `git` CLI fallback
// ---------------------------------------------------------------------------

// The runner lives in `gitCli.ts` (no `vscode` import, so the publish gate and its tests can load it); re-exported here
// so every existing importer keeps its one entry point.
export { runGit, runGitRaw } from "./gitCli";
