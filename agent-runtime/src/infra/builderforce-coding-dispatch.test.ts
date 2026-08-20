import { describe, it, expect, vi } from "vitest";
import {
  runCodingDispatch,
  codingBranchSlug,
  diffWorkspace,
  type CodingDispatchDeps,
  type CodingDispatchFs,
  type DispatchDetail,
  type WorkspaceFile,
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

const workspaceDetail = {
  projectId: 34,
  projectName: "Brain App",
  filesPath: "/api/agent-hosts/12/workspace/34/files",
};

/** Every CodingDispatchHttp port, so a test only overrides what it cares about. */
function fakeHttp(over: Partial<CodingDispatchDeps["http"]> = {}): CodingDispatchDeps["http"] {
  return {
    fetchDispatchDetail: vi.fn(async () => detail()),
    openPullRequest: vi.fn(async () => ({ url: "https://github.com/o/r/pull/3", number: 3 })),
    fetchWorkspaceFiles: vi.fn(async () => ({ files: [] as WorkspaceFile[], truncated: false })),
    pushWorkspaceChanges: vi.fn(async () => ({ written: 0, deleted: 0, rejected: [] })),
    reportResult: vi.fn(async () => {}),
    ...over,
  };
}

/** In-memory disk port: the agent's edits are staged into `after`. */
function fakeFs(after: WorkspaceFile[]): CodingDispatchFs & { materialized: WorkspaceFile[] } {
  const materialized: WorkspaceFile[] = [];
  return {
    materialized,
    materialize: vi.fn(async (_dir: string, files: WorkspaceFile[]) => {
      materialized.push(...files);
    }),
    snapshot: vi.fn(async () => after),
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
    http: fakeHttp(),
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
    const d = deps({ http: fakeHttp({ openPullRequest: vi.fn(async () => null) }) });
    await runCodingDispatch(d, "d-1234567890");

    expect(d.git.push).toHaveBeenCalled();
    const reported = (d.http.reportResult as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(reported.status).toBe("completed");
    expect(reported.output).toContain("no PR opened");
  });

  // Reasoning-only is now the LAST resort — no repo AND no workspace — and it
  // must name the reason rather than silently returning prose.
  it("degrades to reasoning-only ONLY when there is no repo and no workspace", async () => {
    const d = deps({
      http: fakeHttp({ fetchDispatchDetail: vi.fn(async () => detail({ repo: null, workspace: null })) }),
    });
    await runCodingDispatch(d, "d-1234567890");

    expect(d.git.clone).not.toHaveBeenCalled();
    const reported = (d.http.reportResult as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(reported.status).toBe("completed");
    expect(reported.output).toContain("edited files");
    expect(reported.output).toContain("No files were written");
    expect(reported.output).toContain("neither a connected git repository nor an IDE workspace");
  });

  it("reports failed when dispatch detail is missing", async () => {
    const d = deps({ http: fakeHttp({ fetchDispatchDetail: vi.fn(async () => null) }) });
    await runCodingDispatch(d, "d-1234567890");
    expect(d.http.reportResult).toHaveBeenCalledWith("d-1234567890", {
      status: "failed",
      error: "Dispatch detail not found",
    });
  });
});

describe("runCodingDispatch — repo-less workspace path", () => {
  it("materialises the IDE workspace, runs the agent, and saves the diff back", async () => {
    const fs = fakeFs([
      { path: "src/App.jsx", content: "export default () => 1;" },
      { path: "src/new.js", content: "export const n = 1;" },
    ]);
    const http = fakeHttp({
      fetchDispatchDetail: vi.fn(async () => detail({ repo: null, workspace: workspaceDetail })),
      fetchWorkspaceFiles: vi.fn(async () => ({
        files: [
          { path: "src/App.jsx", content: "old" },
          { path: "package.json", content: "{}" },
        ],
        truncated: false,
      })),
      pushWorkspaceChanges: vi.fn(async () => ({ written: 2, deleted: 1, rejected: [] })),
    });
    const d = deps({ http, fs });
    await runCodingDispatch(d, "d-1234567890");

    // The tree was written to disk before the agent ran…
    expect(fs.materialized.map((f) => f.path)).toEqual(["src/App.jsx", "package.json"]);
    // …and NO git operation happened: this path has no repo to clone or push to.
    expect(d.git.clone).not.toHaveBeenCalled();
    expect(d.git.push).not.toHaveBeenCalled();
    expect(d.http.openPullRequest).not.toHaveBeenCalled();

    // Only changed/new files are sent back; the untouched file is a delete because
    // the agent removed it from a COMPLETE tree.
    const pushed = (http.pushWorkspaceChanges as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(pushed[0]).toBe("/api/agent-hosts/12/workspace/34/files");
    expect(pushed[1].writes.map((f: WorkspaceFile) => f.path).sort()).toEqual(["src/App.jsx", "src/new.js"]);
    expect(pushed[1].deletes).toEqual(["package.json"]);
    expect(pushed[1].taskId).toBe(7);

    const reported = (http.reportResult as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(reported.status).toBe("completed");
    expect(reported.output).toContain("Saved 2 file(s)");
    expect(reported.output).toContain("Brain App");
  });

  it("reports completed without a save when the agent changed nothing", async () => {
    const files = [{ path: "src/App.jsx", content: "same" }];
    const http = fakeHttp({
      fetchDispatchDetail: vi.fn(async () => detail({ repo: null, workspace: workspaceDetail })),
      fetchWorkspaceFiles: vi.fn(async () => ({ files, truncated: false })),
    });
    const d = deps({ http, fs: fakeFs([...files]) });
    await runCodingDispatch(d, "d-1234567890");

    expect(http.pushWorkspaceChanges).not.toHaveBeenCalled();
    const reported = (http.reportResult as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(reported.status).toBe("completed");
    expect(reported.output).toContain("nothing to save");
  });

  it("fails loudly when the workspace cannot be fetched", async () => {
    const http = fakeHttp({
      fetchDispatchDetail: vi.fn(async () => detail({ repo: null, workspace: workspaceDetail })),
      fetchWorkspaceFiles: vi.fn(async () => null),
    });
    const d = deps({ http, fs: fakeFs([]) });
    await runCodingDispatch(d, "d-1234567890");

    expect(http.reportResult).toHaveBeenCalledWith("d-1234567890", {
      status: "failed",
      error: "workspace fetch failed for project 34",
    });
  });

  it("falls back to reasoning-only when the runtime has no disk port, and says so", async () => {
    const http = fakeHttp({
      fetchDispatchDetail: vi.fn(async () => detail({ repo: null, workspace: workspaceDetail })),
    });
    const d = deps({ http, fs: undefined });
    await runCodingDispatch(d, "d-1234567890");

    const reported = (http.reportResult as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(reported.status).toBe("completed");
    expect(reported.output).toContain("no filesystem port");
  });
});

describe("diffWorkspace", () => {
  it("sends only changed files and never deletes from a truncated tree", () => {
    const before = new Map([
      ["a.txt", "1"],
      ["b.txt", "2"],
    ]);
    const after = [
      { path: "a.txt", content: "1" },      // unchanged → not re-uploaded
      { path: "c.txt", content: "3" },      // new
    ];
    expect(diffWorkspace(before, after, false)).toEqual({
      writes: [{ path: "c.txt", content: "3" }],
      deletes: ["b.txt"],
    });
    // The tree was incomplete, so an absent file is "never materialised", not "deleted".
    expect(diffWorkspace(before, after, true)).toEqual({
      writes: [{ path: "c.txt", content: "3" }],
      deletes: [],
    });
  });
});
