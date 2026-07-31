/**
 * "Where is the code?" — repository detection for the opened workspace folder.
 *
 * The agent's local tools (`read_file` / `list_files` / `search_code` / `edit_file`)
 * already execute against the workspace root, but nothing ever TOLD the model that a
 * root exists, let alone which repo it is. This module supplies that missing fact so
 * the Brain webview, the native `@builderforce` participant and the agents behind
 * them all resolve "the code" to a concrete checkout instead of asking the user.
 *
 * Detection prefers the BUILT-IN Git extension (`vscode.git`) — it is already active
 * in any VS Code with a repo open, it hands over branch / remote / ahead-behind /
 * dirty state with no process spawn, and it fires `state.onDidChange` on checkout so
 * we can invalidate instead of polling. When that extension is unavailable (a
 * stripped host, `git.enabled: false`) we fall back to plain `git` invocations.
 *
 * Results ride the shared {@link ttlCache} (project rule: no hand-rolled Map+TTL).
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import type { GitContext } from "./idePersona";
import { ttlCache } from "./ttlCache";

const execFileAsync = promisify(exec);

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

// ---------------------------------------------------------------------------
// Built-in Git extension (preferred path)
// ---------------------------------------------------------------------------

/**
 * The slice of the `vscode.git` extension API we actually use. Typed locally rather
 * than depending on the (unpublished) `git.d.ts` so the extension keeps compiling
 * when the Git extension is absent.
 */
interface GitApiRepositoryState {
  HEAD?: { name?: string; ahead?: number; behind?: number };
  remotes: { name: string; fetchUrl?: string; pushUrl?: string }[];
  workingTreeChanges: unknown[];
  indexChanges: unknown[];
  onDidChange: vscode.Event<void>;
}
interface GitApiRepository {
  rootUri: vscode.Uri;
  state: GitApiRepositoryState;
}
interface GitApi {
  repositories: GitApiRepository[];
  onDidOpenRepository: vscode.Event<GitApiRepository>;
  onDidCloseRepository: vscode.Event<GitApiRepository>;
}
interface GitExtension {
  getAPI(version: 1): GitApi;
}

/** The activated Git API, or undefined when the extension isn't present/enabled. */
async function getGitApi(): Promise<GitApi | undefined> {
  try {
    const ext = vscode.extensions.getExtension<GitExtension>("vscode.git");
    if (!ext) return undefined;
    const exports = ext.isActive ? ext.exports : await ext.activate();
    return exports?.getAPI(1);
  } catch {
    return undefined;
  }
}

/** Normalize for path containment comparison (Windows casing + separators). */
function normalize(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** True when `folder` is at or beneath `repoRoot`. */
function contains(repoRoot: string, folder: string): boolean {
  const a = normalize(repoRoot);
  const b = normalize(folder);
  return b === a || b.startsWith(`${a}/`);
}

/** The innermost repository containing `folder` (nested repos: deepest root wins). */
function findRepository(api: GitApi, folder: string): GitApiRepository | undefined {
  return api.repositories
    .filter((r) => contains(r.rootUri.fsPath, folder))
    .sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length)[0];
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
      dirtyCount: state.workingTreeChanges.length + state.indexChanges.length,
    },
    origin?.fetchUrl ?? origin?.pushUrl,
  );
}

// ---------------------------------------------------------------------------
// `git` CLI fallback
// ---------------------------------------------------------------------------

/** Run a git command in `cwd`; undefined when git is missing or the command fails. */
async function git(cwd: string, args: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(`git ${args}`, { cwd, timeout: 5_000, windowsHide: true });
    const out = stdout.trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

async function fromCli(folder: string): Promise<GitContext> {
  const root = await git(folder, "rev-parse --show-toplevel");
  if (!root) return NOT_A_REPO;
  const [branch, remoteUrl, status] = await Promise.all([
    git(folder, "rev-parse --abbrev-ref HEAD"),
    git(folder, "remote get-url origin"),
    git(folder, "status --porcelain"),
  ]);
  return withRemote(
    {
      isRepo: true,
      root,
      // `rev-parse --abbrev-ref HEAD` reports "HEAD" on a detached checkout.
      branch: branch && branch !== "HEAD" ? branch : undefined,
      dirtyCount: status ? status.split("\n").filter((l) => l.trim()).length : 0,
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
  const subs: vscode.Disposable[] = [changeEmitter.event(onChange)];
  let disposed = false;

  void getGitApi().then((api) => {
    if (!api || disposed) return;
    const bump = () => {
      invalidateGitContext();
      emitChange();
    };
    const watchRepo = (repo: GitApiRepository) => {
      subs.push(repo.state.onDidChange(bump));
    };
    for (const repo of api.repositories) watchRepo(repo);
    subs.push(
      api.onDidOpenRepository((repo) => {
        watchRepo(repo);
        bump();
      }),
      api.onDidCloseRepository(bump),
    );
  });

  return new vscode.Disposable(() => {
    disposed = true;
    for (const s of subs) s.dispose();
  });
}
