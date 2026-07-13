import { describe, it, expect, vi } from "vitest";
import { createGitRepoSync, type RepoSyncGitOps } from "./repo-sync.js";

function fakeGitOps(over: Partial<RepoSyncGitOps> = {}): RepoSyncGitOps {
  return {
    hasClone: vi.fn(async () => false),
    isDirty: vi.fn(async () => false),
    clone: vi.fn(async () => {}),
    syncToLatest: vi.fn(async () => {}),
    checkoutNewBranch: vi.fn(async () => {}),
    checkoutOrCreateBranch: vi.fn(async () => {}),
    ...over,
  };
}

const repo = { cloneUrl: "https://proxy/repo", defaultBranch: "main" };

describe("createGitRepoSync", () => {
  it("clones a missing workspace and cuts a fresh branch (new-branch mode)", async () => {
    const git = fakeGitOps();
    const res = await createGitRepoSync(git).prepare({
      dir: "/w/dispatch-1",
      repo,
      workBranch: "agent/feature",
      mode: "new-branch",
    });
    expect(git.clone).toHaveBeenCalledWith("https://proxy/repo", "/w/dispatch-1", "main");
    expect(git.checkoutNewBranch).toHaveBeenCalledWith("/w/dispatch-1", "agent/feature");
    expect(git.syncToLatest).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true, refreshed: true });
  });

  it("refreshes a clean reused workspace to latest, then checks out the ticket branch", async () => {
    const git = fakeGitOps({
      hasClone: vi.fn(async () => true),
      isDirty: vi.fn(async () => false),
    });
    const res = await createGitRepoSync(git).prepare({
      dir: "/w/task-7",
      repo,
      workBranch: "builderforce/task-7",
      mode: "ticket-branch",
    });
    expect(git.clone).not.toHaveBeenCalled();
    expect(git.syncToLatest).toHaveBeenCalledWith("/w/task-7", "main");
    expect(git.checkoutOrCreateBranch).toHaveBeenCalledWith("/w/task-7", "builderforce/task-7");
    expect(res).toEqual({ ok: true, refreshed: true });
  });

  it("preserves uncommitted WIP on a dirty reused workspace (no refresh)", async () => {
    const git = fakeGitOps({ hasClone: vi.fn(async () => true), isDirty: vi.fn(async () => true) });
    const res = await createGitRepoSync(git).prepare({
      dir: "/w/task-7",
      repo,
      workBranch: "builderforce/task-7",
      mode: "ticket-branch",
    });
    expect(git.syncToLatest).not.toHaveBeenCalled();
    expect(git.checkoutOrCreateBranch).toHaveBeenCalledWith("/w/task-7", "builderforce/task-7");
    expect(res).toEqual({ ok: true, refreshed: false, preservedLocalChanges: true });
  });

  it("never throws — reports a terminal error result instead", async () => {
    const git = fakeGitOps({
      hasClone: vi.fn(async () => false),
      clone: vi.fn(async () => {
        throw new Error("network down");
      }),
    });
    const res = await createGitRepoSync(git).prepare({
      dir: "/w/dispatch-1",
      repo,
      workBranch: "agent/feature",
      mode: "new-branch",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("network down");
  });
});
