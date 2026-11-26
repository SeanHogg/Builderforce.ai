import { beforeEach, describe, expect, it, vi } from "vitest";

const git = vi.hoisted(() => ({
  calls: [] as { cwd: string; args: string[] }[],
  answer: (_args: string[]): { stdout?: string; stderr?: string; failure?: string } => ({ failure: "error" }),
}));
const reported = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../diagnostics/errorReporter", () => ({ reportExtensionError: reported }));
vi.mock("vscode", () => ({ Uri: { file: (fsPath: string) => ({ fsPath }) }, workspace: { fs: {} }, window: {}, Range: class {} }));
vi.mock("@builderforce/agent-tools/node-git-history", () => ({
  runGit: async (cwd: string, args: string[]) => { git.calls.push({ cwd, args }); return git.answer(args); },
}));

import { readReviewCommit, type KnowledgeFiles } from "@builderforce/agent-tools/knowledge";
import { recordReviewCommit, reviewCommitOf } from "./reviewCommit";

const ROOT = "/repo/root";
const A = "a".repeat(40);
const B = "b".repeat(40);

/** git answers `status` with `status` and `rev-parse` with `head()`. */
const repo = (status: string, head: () => string): void => {
  git.answer = (args) => (args[0] === "status" ? { stdout: status } : { stdout: `${head()}\n` });
};

function memoryFiles(): KnowledgeFiles {
  const store = new Map<string, string>();
  return { read: async (n) => store.get(n), write: async (n, t) => { store.set(n, t); }, remove: async (n) => { store.delete(n); } };
}

beforeEach(() => {
  git.calls = [];
  reported.mockClear();
  git.answer = () => ({ failure: "error" });
});

describe("reviewCommitOf (the commit a completed review ran at)", () => {
  it("answers the lower-cased HEAD of a CLEAN tree, asking git with argv arrays rooted at the root", async () => {
    repo("", () => "ABCDEF1234".repeat(4));
    expect(await reviewCommitOf(ROOT)).toBe("abcdef1234".repeat(4));
    expect(git.calls).toEqual([
      { cwd: ROOT, args: ["status", "--porcelain", "--", ".", ":(exclude).builderforce"] },
      { cwd: ROOT, args: ["rev-parse", "--verify", "HEAD"] },
    ]);
    expect(reported).not.toHaveBeenCalled();
  });

  it("answers undefined for a DIRTY tree (modified, staged or untracked) — HEAD is not what was reviewed — without asking for HEAD", async () => {
    for (const status of [" M src/a.ts\n", "A  src/new.ts\n", "?? scratch.txt\n"]) {
      git.calls = [];
      repo(status, () => A);
      expect(await reviewCommitOf(ROOT)).toBeUndefined();
      expect(git.calls.map((c) => c.args[0])).toEqual(["status"]);
    }
    expect(reported).not.toHaveBeenCalled();
  });

  it("answers undefined, silently, for the expected replies: not a repository, a repository with no commit", async () => {
    git.answer = () => ({ failure: "error", stderr: "fatal: not a git repository (or any of the parent directories): .git" });
    expect(await reviewCommitOf(ROOT)).toBeUndefined();
    git.answer = (args) => (args[0] === "status" ? { stdout: "" } : { failure: "error", stderr: "fatal: Needed a single revision" });
    expect(await reviewCommitOf(ROOT)).toBeUndefined();
    expect(reported).not.toHaveBeenCalled();
  });

  it("REPORTS an unexpected git failure (timeout, output too large, git missing) and answers undefined", async () => {
    for (const run of [{ failure: "timeout" }, { failure: "buffer" }, { failure: "error", stderr: "spawn git ENOENT" }]) {
      reported.mockClear();
      git.answer = () => run;
      expect(await reviewCommitOf(ROOT)).toBeUndefined();
      expect(reported).toHaveBeenCalledTimes(1);
      expect(reported).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ operation: "knowledge.reviewCommit" }));
    }
  });

  it("never answers anything that is not a plain sha", async () => {
    for (const head of ["HEAD", "--output=x", "abc123", "not a sha"]) {
      repo("", () => head);
      expect(await reviewCommitOf(ROOT)).toBeUndefined();
    }
  });
});

describe("recordReviewCommit", () => {
  it("keeps the commit of the review: HEAD moving afterwards does not change what is read for the pack", async () => {
    const files = memoryFiles();
    let head = A;
    repo("", () => head);
    await recordReviewCommit(files, ROOT, "ws:a");
    head = B; // a commit lands between the review and the send
    expect(await readReviewCommit(files, "ws:a")).toBe(A);
    expect(git.calls.filter((c) => c.args[0] === "rev-parse")).toHaveLength(1); // reading asked git nothing
  });

  it("a review over a dirty tree records nothing, replacing the earlier review's commit with unknown", async () => {
    const files = memoryFiles();
    repo("", () => A);
    await recordReviewCommit(files, ROOT, "ws:a");
    expect(await readReviewCommit(files, "ws:a")).toBe(A);
    repo(" M src/a.ts\n", () => B);
    await recordReviewCommit(files, ROOT, "ws:a");
    expect(await readReviewCommit(files, "ws:a")).toBeUndefined();
  });

  it("a folder that is not a git repository records nothing (the commit is absent, never invented)", async () => {
    const files = memoryFiles();
    git.answer = () => ({ failure: "error", stderr: "fatal: not a git repository" });
    await recordReviewCommit(files, ROOT, "ws:a");
    expect(await readReviewCommit(files, "ws:a")).toBeUndefined();
  });

  it("reports a failed write instead of throwing into the review", async () => {
    const files: KnowledgeFiles = { read: async () => undefined, write: async () => { throw new Error("disk full"); }, remove: async () => { throw new Error("disk full"); } };
    repo("", () => A);
    await expect(recordReviewCommit(files, ROOT, "ws:a")).resolves.toBeUndefined();
    expect(reported).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ operation: "knowledge.recordReviewCommit" }));
  });
});
