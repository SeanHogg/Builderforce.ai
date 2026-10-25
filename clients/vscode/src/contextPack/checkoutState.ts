/**
 * Git state per top-level checkout for the context pack (PRD 35 E2): branch,
 * ahead/behind and the uncommitted files — clean checkouts included, because "which
 * branch is each repo on" is the question a multi-repo planner asks first.
 *
 * Reads the built-in Git extension through `gitApi.ts` (no process spawn); a host
 * without it falls back to the pending-change set (`gitChanges.ts`), which lists dirty
 * checkouts only.
 */

import * as vscode from "vscode";
import { getGitApi } from "../gitApi";
import { collectRepoChanges, contains, repoName } from "../gitChangeModel";
import { detectPendingChanges } from "../gitChanges";
import { DIRTY_FILES_SHOWN, type ContextPackRepo } from "./renderContextPack";

function workspaceFolders(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
}

/** Every checkout in the workspace, as the pack lists it. [] when git is unavailable. */
export async function readCheckoutState(): Promise<ContextPackRepo[]> {
  const folders = workspaceFolders();
  if (folders.length === 0) return [];
  const api = await getGitApi();
  if (api) {
    return api.repositories
      .filter((repo) => folders.some((f) => contains(repo.rootUri.fsPath, f) || contains(f, repo.rootUri.fsPath)))
      .map((repo) => {
        const changes = collectRepoChanges(repo);
        const head = repo.state.HEAD;
        return {
          repo: repoName(repo.rootUri.fsPath),
          ...(head?.name ? { branch: head.name } : {}),
          ...(head?.ahead ? { ahead: head.ahead } : {}),
          ...(head?.behind ? { behind: head.behind } : {}),
          dirty: changes.slice(0, DIRTY_FILES_SHOWN).map((c) => c.relativePath),
          dirtyTotal: changes.length,
        };
      });
  }
  const set = await detectPendingChanges();
  return set.repos.map((r) => ({
    repo: r.name,
    ...(r.branch ? { branch: r.branch } : {}),
    dirty: r.changes.slice(0, DIRTY_FILES_SHOWN).map((c) => c.relativePath),
    dirtyTotal: r.changes.length,
  }));
}
