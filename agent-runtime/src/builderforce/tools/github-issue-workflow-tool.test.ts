import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runExec = vi.fn();
vi.mock("../../process/exec.js", () => ({ runExec }));

const executeWorkflow = vi.fn();
const createWorkflow = vi.fn();
vi.mock("../orchestrator.js", () => ({
  globalOrchestrator: { createWorkflow, executeWorkflow },
  createFeatureWorkflow: vi.fn(() => []),
  createBugFixWorkflow: vi.fn(() => []),
}));

const { runGithubIssueWorkflow } = await import("./github-issue-workflow-tool.js");

const ROOT = "/repos/acme";

/** Route git calls by subcommand; `status` returns the given porcelain output. */
function stubGit(porcelainSequence: string[]) {
  let statusCall = 0;
  runExec.mockImplementation(async (_cmd: string, args: string[]) => {
    if (args.includes("status")) {
      const out = porcelainSequence[Math.min(statusCall, porcelainSequence.length - 1)];
      statusCall += 1;
      return { stdout: out, stderr: "" };
    }
    return { stdout: "", stderr: "" };
  });
}

function gitSubcommands(): string[][] {
  return runExec.mock.calls.map((call) => (call[1] as string[]).filter((a) => a !== "-C" && a !== ROOT));
}

function details(result: { details?: unknown }): Record<string, unknown> {
  return result.details as Record<string, unknown>;
}

describe("runGithubIssueWorkflow — checkout safety", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/pulls")) {
          return { ok: true, json: async () => ({ html_url: "https://github.com/acme/app/pull/7" }) };
        }
        if (String(url).includes("/issues/")) {
          return {
            ok: true,
            json: async () => ({
              number: 42,
              title: "Fix login",
              body: "Broken",
              html_url: "https://github.com/acme/app/issues/42",
              labels: [{ name: "bug" }],
              state: "open",
            }),
          };
        }
        return { ok: true, json: async () => ({ default_branch: "main" }) };
      }),
    );
    const workflow = { id: "wf-1", status: "completed" };
    createWorkflow.mockReturnValue(workflow);
    executeWorkflow.mockResolvedValue(new Map([["t1", "done"]]));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    runExec.mockReset();
    createWorkflow.mockReset();
    executeWorkflow.mockReset();
  });

  it("regression: dirty checkout is never switched or swept into the issue commit", async () => {
    stubGit([" M src/a.ts\n?? notes.txt\nM  src/b.ts\n M src/c.ts\n"]);

    const result = await runGithubIssueWorkflow({}, { issue: "acme/app#42", projectRoot: ROOT });

    const calls = gitSubcommands();
    expect(calls.some((c) => c.includes("checkout"))).toBe(false);
    expect(calls.some((c) => c.includes("add"))).toBe(false);
    expect(calls.some((c) => c.includes("commit"))).toBe(false);
    expect(calls.some((c) => c.includes("push"))).toBe(false);
    expect(createWorkflow).not.toHaveBeenCalled();
    expect(executeWorkflow).not.toHaveBeenCalled();

    const error = String(details(result).error);
    expect(error).toContain("4 uncommitted changes");
    expect(error).toContain("src/a.ts, notes.txt, src/b.ts");
    expect(error).toContain("and 1 more");
    expect(error).toContain("will not switch branches");
    expect(error).toContain("git worktree add ../acme-agentNode-issue-42-fix-login-wt -b agentNode/issue-42-fix-login");
  });

  it("clean checkout: branches, runs the workflow, commits and pushes", async () => {
    // First status = pre-branch dirty check (clean); second = commitAll (agent edits present).
    stubGit(["", " M src/login.ts\n"]);

    const result = await runGithubIssueWorkflow({}, { issue: "acme/app#42", projectRoot: ROOT });

    const calls = gitSubcommands();
    const checkoutIdx = calls.findIndex((c) => c[0] === "checkout");
    expect(calls[checkoutIdx]).toEqual(["checkout", "-b", "agentNode/issue-42-fix-login"]);
    expect(calls[0]).toEqual(["status", "--porcelain"]);
    expect(checkoutIdx).toBeGreaterThan(0);
    expect(executeWorkflow).toHaveBeenCalledOnce();
    expect(calls.some((c) => c[0] === "commit")).toBe(true);
    expect(calls.some((c) => c.includes("push"))).toBe(true);
    expect(details(result).error).toBeUndefined();
    expect(details(result).branch).toBe("agentNode/issue-42-fix-login");
  });
});
