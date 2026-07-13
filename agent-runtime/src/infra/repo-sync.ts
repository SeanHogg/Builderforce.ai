/**
 * Modular repo preparation ("is this the latest code from the repo?") for the
 * coding execution paths.
 *
 * This used to be hard-coded inline in two places — the swimlane dispatch loop
 * (runCodingDispatch) and the V2 ticket workspace (ensureTaskWorkspace) — each
 * open-coding its own clone + checkout. That coupled "get latest code" to the
 * execution loop and duplicated the logic. It now lives behind a single
 * `RepoSyncStrategy` port that both paths depend on, so the policy (shallow vs.
 * full, refresh-on-reuse, WIP safety, branch mode) is decided in one place and
 * can be swapped per agent/skill.
 *
 * The default strategy is pure over an injected {@link RepoSyncGitOps}, so it is
 * unit-testable without a real git, and the concrete git CLI adapter lives with
 * the other coding-dispatch adapters (makeCodingGit).
 */

export interface RepoSyncRepo {
  /** Absolute clone URL (host git-proxy). */
  cloneUrl: string;
  /** Upstream default branch to pull latest from; null falls back to remote HEAD. */
  defaultBranch: string | null;
}

export type RepoSyncMode =
  /** Fresh per-dispatch dir: clone latest, then cut a NEW working branch. */
  | "new-branch"
  /** Shared per-ticket dir reused across runs: idempotent branch, WIP-preserving refresh. */
  | "ticket-branch";

export interface RepoSyncRequest {
  /** Working directory the agent will run in. */
  dir: string;
  repo: RepoSyncRepo;
  /** Branch the agent should be on when it starts editing. */
  workBranch: string;
  mode: RepoSyncMode;
}

export interface RepoSyncResult {
  ok: boolean;
  /** True when this call brought the working copy to the latest remote state. */
  refreshed: boolean;
  /** True when a refresh was deliberately skipped to preserve uncommitted work. */
  preservedLocalChanges?: boolean;
  error?: string;
}

/**
 * The git primitives the default strategy needs. Implemented by makeCodingGit so
 * the same authenticated git CLI adapter backs both the sync and commit/push.
 */
export interface RepoSyncGitOps {
  /** True when `dir` already contains a git work tree. */
  hasClone(dir: string): Promise<boolean>;
  /** True when `dir` has uncommitted changes (tracked or untracked). */
  isDirty(dir: string): Promise<boolean>;
  /** Clone `cloneUrl` into `dir` at `branch` (latest tip). */
  clone(cloneUrl: string, dir: string, branch: string | null): Promise<void>;
  /** Fetch + hard-reset `dir` to the latest remote `branch` (destroys local state). */
  syncToLatest(dir: string, branch: string | null): Promise<void>;
  /** Create and switch to a fresh branch in `dir`. */
  checkoutNewBranch(dir: string, branch: string): Promise<void>;
  /** Switch to `branch`, creating it if it does not exist (idempotent). */
  checkoutOrCreateBranch(dir: string, branch: string): Promise<void>;
}

export interface RepoSyncStrategy {
  /** Ensure `dir` holds the right code on the right branch before the agent runs. */
  prepare(req: RepoSyncRequest): Promise<RepoSyncResult>;
}

/**
 * Default git-backed strategy.
 *
 * - Missing clone → clone latest.
 * - Reused clone → refresh to the latest default branch, but ONLY when the work
 *   tree is clean. Ticket workspaces accumulate uncommitted WIP across runs;
 *   hard-resetting there would destroy a prior agent's changes, so we preserve
 *   them and skip the refresh instead.
 * - Branch: `new-branch` cuts a fresh feature branch; `ticket-branch` reuses the
 *   ticket's branch idempotently.
 *
 * Never throws — every failure is reported as `{ ok: false, error }` so the
 * caller's execution loop can report a terminal result instead of crashing.
 */
export function createGitRepoSync(git: RepoSyncGitOps): RepoSyncStrategy {
  return {
    async prepare(req: RepoSyncRequest): Promise<RepoSyncResult> {
      try {
        let refreshed = false;
        let preservedLocalChanges = false;

        if (!(await git.hasClone(req.dir))) {
          await git.clone(req.repo.cloneUrl, req.dir, req.repo.defaultBranch);
          refreshed = true;
        } else if (await git.isDirty(req.dir)) {
          preservedLocalChanges = true;
        } else {
          await git.syncToLatest(req.dir, req.repo.defaultBranch);
          refreshed = true;
        }

        if (req.mode === "new-branch") {
          await git.checkoutNewBranch(req.dir, req.workBranch);
        } else {
          await git.checkoutOrCreateBranch(req.dir, req.workBranch);
        }

        return {
          ok: true,
          refreshed,
          ...(preservedLocalChanges ? { preservedLocalChanges } : {}),
        };
      } catch (err) {
        return {
          ok: false,
          refreshed: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
