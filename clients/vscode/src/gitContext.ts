/**
 * "Where is the code?" — repository detection for the opened workspace folder.
 *
 * The agent's local tools (`read_file` / `list_files` / `search_code` / `edit_file`)
 * already execute against the workspace root, but nothing ever TOLD the model that a
 * root exists, let alone which repo it is. This module supplies that missing fact so
 * the Brain webview, the native `@builderforce` participant and the agents behind
 * them all resolve "the code" to a concrete checkout instead of asking the user.
 *
 * Detection prefers the BUILT-IN Git extension — reached through the shared
 * {@link gitApi} seam, which also owns the `git` CLI fallback and the repository
 * change subscription this module and {@link gitChanges} both hang off. The dirty
 * FILE COUNT reported here is the same deduped set the Changes view and the chat's
 * pending-changes bar render, so the persona can't tell the model "2 uncommitted
 * files" while the UI shows three.
 *
 * Results ride the shared {@link ttlCache} (project rule: no hand-rolled Map+TTL).
 */

import * as vscode from "vscode";
import { collectRepoChanges, parsePorcelain } from "./gitChangeModel";
import { findRepository, getGitApi, runGit, watchGitRepositories, type GitApiRepository } from "./gitApi";
import type { GitContext } from "./idePersona";
import { ttlCache } from "./ttlCache";

// The SHAPE lives in `idePersona.ts` (host-free, so it can cross the webview
// bridge); this module owns the DETECTION. Re-exported for host-side importers.
export type { GitContext };

/** Git state is cheap to read but not free; a short TTL keeps every turn honest. */
const GIT_TTL = 30_000;
const cache = ttlCache<string, GitContext>(GIT_TTL);

const NOT_A_REPO: GitContext = { isRepo: false };

/**
 * Parse a git remote URL into its host / owner / repo. Handles the three shapes a
 * real checkout produces: `https://host/owner/repo(.git)`, the SCP-ish SSH form
 * `git@host:owner/repo(.git)`, and the explicit `ssh://git@host/owner/repo(.git)`.
 * PURE — the one place remote parsing lives (DRY), and the piece worth unit-testing.
 */
export function parseRemoteUrl(url: string): { owner: string; repo: string; host: string } | null {
  const raw = url.trim();
  if (!raw) return null;

  let host: string;
  let path: string;

  const scp = /^(?:([^@/]+)@)?([^@/:]+):(?!\/)(.+)$/.exec(raw);
  if (scp) {
    // git@github.com:owner/repo.git
    host = scp[2];
    path = scp[3];
  } else {
    // Any URL with a scheme: https://, ssh://, git://, http://
    const m = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/.exec(raw);
    if (!m) return null;
    host = m[1].replace(/:\d+$/, ""); // strip an explicit port
    path = m[2];
  }

  const segments = path
    .replace(/\.git$/i, "")
    .split("/")
    .filter(Boolean);
  if (segments.length < 2) return null;

  const repo = segments[segments.length - 1];
  const owner = segments[segments.length - 2];
  if (!owner || !repo) return null;
  return { owner, repo, host };
}

/** Attach `owner`/`repo` to a context from its remote URL, in one place. */
function withRemote(ctx: GitContext, remoteUrl: string | undefined): GitContext {
  if (!remoteUrl) return ctx;
  const parsed = parseRemoteUrl(remoteUrl);
  return parsed
    ? { ...ctx, remoteUrl, owner: parsed.owner, repo: parsed.repo, host: parsed.host }
    : { ...ctx, remoteUrl };
}

function fromRepository(repo: GitApiRepository): GitContext {
  const state = repo.state;
  const origin = state.remotes.find((r) => r.name === "origin") ?? state.remotes[0];
  return withRemote(
    {
      isRepo: true,
      root: repo.rootUri.fsPath,
      branch: state.HEAD?.name,
      ahead: state.HEAD?.ahead,
      behind: state.HEAD?.behind,
      // DISTINCT files, from the same collector the Changes view renders — a file
      // both staged and re-edited is one pending change, not two.
      dirtyCount: collectRepoChanges(repo).length,
    },
    origin?.fetchUrl ?? origin?.pushUrl,
  );
}

async function fromCli(folder: string): Promise<GitContext> {
  const root = await runGit(folder, "rev-parse --show-toplevel");
  if (!root) return NOT_A_REPO;
  const [branch, remoteUrl, status] = await Promise.all([
    runGit(folder, "rev-parse --abbrev-ref HEAD"),
    runGit(folder, "remote get-url origin"),
    runGit(folder, "status --porcelain=v1 --untracked-files=all"),
  ]);
  return withRemote(
    {
      isRepo: true,
      root,
      // `rev-parse --abbrev-ref HEAD` reports "HEAD" on a detached checkout.
      branch: branch && branch !== "HEAD" ? branch : undefined,
      dirtyCount: status ? parsePorcelain(status, root).length : 0,
    },
    remoteUrl,
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect the git repository for `folder`, preferring the built-in Git extension and
 * falling back to the `git` CLI. TTL-cached per folder; a repository state change
 * (checkout, commit, stage) invalidates the entry early via {@link watchGitContext}.
 */
export async function detectGitContext(folder: string): Promise<GitContext> {
  if (!folder) return NOT_A_REPO;
  const hit = cache.get(folder);
  if (hit) return hit.value;

  const api = await getGitApi();
  const repo = api ? findRepository(api, folder) : undefined;
  const ctx = repo ? fromRepository(repo) : await fromCli(folder);
  cache.set(folder, ctx);
  return ctx;
}

/**
 * The cached context for `folder` without awaiting detection — for the SYNCHRONOUS
 * editor-context snapshot. A miss kicks off a background detection (which populates
 * the cache and, through {@link watchGitContext} subscribers, re-pushes context) and
 * returns undefined for this tick rather than blocking the editor read.
 */
export function peekGitContext(folder: string | undefined): GitContext | undefined {
  if (!folder) return undefined;
  const hit = cache.get(folder);
  if (hit) return hit.value;
  void detectGitContext(folder).then((ctx) => {
    // Only wake listeners when there is something worth saying.
    if (ctx.isRepo) emitChange();
  });
  return undefined;
}

/** Drop cached detection (all folders) so the next read re-detects. */
export function invalidateGitContext(): void {
  cache.invalidate();
}

const changeEmitter = new vscode.EventEmitter<void>();
function emitChange(): void {
  changeEmitter.fire();
}

/**
 * Fire `onChange` whenever the repository state could have changed — a branch
 * checkout, a commit, a stage, or a repo being opened/closed — after invalidating
 * the cache so the next read is fresh. Also fires once detection first resolves.
 * Returns a disposable tearing down every subscription.
 */
export function watchGitContext(onChange: () => void): vscode.Disposable {
  const subs: vscode.Disposable[] = [
    changeEmitter.event(onChange),
    watchGitRepositories(() => {
      invalidateGitContext();
      emitChange();
    }),
  ];
  return new vscode.Disposable(() => {
    for (const s of subs) s.dispose();
  });
}
