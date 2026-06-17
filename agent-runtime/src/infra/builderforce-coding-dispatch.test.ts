import { describe, it, expect, vi } from "vitest";
import {
  runCodingDispatch,
  codingBranchSlug,
  type CodingDispatchDeps,
  type DispatchDetail,
} from "./builderforce-coding-dispatch.js";

const repoDetail = {
  repoId: "r1",
  provider: "github",
  owner: "o",
  repo: "r",
  defaultBranch: "main",
  gitProxyPath: "/api/agent-hosts/12/git-proxy/r1",
};

function detail(over: Partial<DispatchDetail> = {}): DispatchDetail {
  return {
    dispatchId: "d-1234567890",
    role: "implementer",
    input: "Add a hello function",
    model: null,
    taskId: 7,
    repo: repoDetail,
    ...over,
  };
}

function fakeGit() {
  return {
    hasClone: vi.fn(async () => false),
    isDirty: vi.fn(async () => false),
    clone: vi.fn(async () => {}),
    syncToLatest: vi.fn(async () => {}),
    checkoutNewBranch: vi.fn(async () => {}),
    checkoutOrCreateBranch: vi.fn(async () => {}),
    commitAll: vi.fn(async () => ({ changed: true })),
    push: vi.fn(async () => {}),
  };
}

function deps(over: Partial<CodingDispatchDeps> = {}): CodingDispatchDeps {
  return {
    http: {
      fetchDispatchDetail: vi.fn(async () => detail()),
      openPullRequest: vi.fn(async () => ({ url: "https://github.com/o/r/pull/3", number: 3 })),
      reportResult: vi.fn(async () => {}),
    },
    git: fakeGit(),
    agent: { run: vi.fn(async () => ({ ok: true, summary: "edited files" })) },
    baseUrl: "https://api.builderforce.ai",
    workspaceDir: "/work",
    joinPath: (...p: string[]) => p.join("/"),
    ...over,
  };
}

describe("codingBranchSlug", () => {
  it("produces a branch-safe slug", () => {
    expect(codingBranchSlug("Add a Hello Function!")).toBe("add-a-hello-function");
    expect(codingBranchSlug("")).toBe("task");
  });
});

describe("runCodingDispatch", () => {
  it("clones, runs the agent, pushes, opens a PR and reports completed", async () => {
    const d = deps();
    await runCodingDispatch(d, "d-1234567890");

    expect(d.git.clone).toHaveBeenCalledWith(
      "https://api.builderforce.ai/api/agent-hosts/12/git-proxy/r1",
      "/work/dispatch-d-1234567890",
      "main",
    );
    expect(d.git.checkoutNewBranch).toHaveBeenCalled();
    expect(d.agent.run).toHaveBeenCalled();
    expect(d.git.push).toHaveBeenCalled();
    expect(d.http.openPullRequest).toHaveBeenCalled();
    expect(d.http.reportResult).toHaveBeenCalledWith(
      "d-1234567890",
      expect.objectContaining({ status: "completed" }),
    );
    const reported = (d.http.reportResult as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(reported.output).toContain("PR #3");
  });

  it("reports completed without pushing when the agent makes no changes", async () => {
    const git = { ...fakeGit(), commitAll: vi.fn(async () => ({ changed: false })) };
    const d = deps({ git });
    await runCodingDispatch(d, "d-1234567890");

    expect(git.push).not.toHaveBeenCalled();
    expect(d.http.openPullRequest).not.toHaveBeenCalled();
    expect(d.http.reportResult).toHaveBeenCalledWith(
      "d-1234567890",
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("reports failed when the agent run fails (no push)", async () => {
    const git = fakeGit();
    const d = deps({ git, agent: { run: vi.fn(async () => ({ ok: false, summary: "boom" })) } });
    await runCodingDispatch(d, "d-1234567890");

    expect(git.commitAll).not.toHaveBeenCalled();
    expect(git.push).not.toHaveBeenCalled();
    expect(d.http.reportResult).toHaveBeenCalledWith("d-1234567890", {
      status: "failed",
      error: "boom",
    });
  });

  it("still reports completed when PR opening is unsupported (branch pushed)", async () => {
    const d = deps({
      http: {
        fetchDispatchDetail: vi.fn(async () => detail()),
        openPullRequest: vi.fn(async () => null),
        reportResult: vi.fn(async () => {}),
      },
    });
    await runCodingDispatch(d, "d-1234567890");

    expect(d.git.push).toHaveBeenCalled();
    const reported = (d.http.reportResult as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(reported.status).toBe("completed");
    expect(reported.output).toContain("no PR opened");
  });

  it("runs reasoning-only and reports when no repo is bound", async () => {
    const d = deps({
      http: {
        fetchDispatchDetail: vi.fn(async () => detail({ repo: null })),
        openPullRequest: vi.fn(async () => null),
        reportResult: vi.fn(async () => {}),
      },
    });
    await runCodingDispatch(d, "d-1234567890");

    expect(d.git.clone).not.toHaveBeenCalled();
    expect(d.http.reportResult).toHaveBeenCalledWith(
      "d-1234567890",
      expect.objectContaining({ status: "completed", output: "edited files" }),
    );
  });

  it("reports failed when dispatch detail is missing", async () => {
    const d = deps({
      http: {
        fetchDispatchDetail: vi.fn(async () => null),
        openPullRequest: vi.fn(async () => null),
        reportResult: vi.fn(async () => {}),
      },
    });
    await runCodingDispatch(d, "d-1234567890");
    expect(d.http.reportResult).toHaveBeenCalledWith("d-1234567890", {
      status: "failed",
      error: "Dispatch detail not found",
    });
  });
});
