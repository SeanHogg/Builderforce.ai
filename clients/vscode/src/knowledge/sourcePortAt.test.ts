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

import { slash, type KnowledgeRoot } from "./knowledgeRoots";
import { COMMIT_SHA } from "./commitSha";
import { MAX_SOURCE_FILE_BYTES, readSourceAt } from "./sourcePort";

const root: KnowledgeRoot = { rootId: "r", title: "root", rootPath: slash("/repo/root"), folderPath: slash("/repo/root"), rel: "" };
const SHA = "abc1234def";

/** git answers `cat-file -s` with `size` and `cat-file blob` with `blob`. */
const repoHas = (blob: string, size = Buffer.byteLength(blob)): void => {
  git.answer = (args) => (args[1] === "-s" ? { stdout: `${size}\n` } : { stdout: blob });
};

beforeEach(() => {
  git.calls = [];
  reported.mockClear();
  git.answer = () => ({ failure: "error" });
});

describe("sourcePort.readSourceAt", () => {
  // The SAME table as the API's `commitSha.test.ts` (COMMIT_SHA_PATTERN): the two packages state one shape, 7-64 hex (SHA-256 repos).
  it("accepts only a 7-64 hex sha (parity table with the API's COMMIT_SHA_PATTERN)", () => {
    for (const ok of ["abc1234", "ABC1234", "a".repeat(40), "a".repeat(64)]) expect(COMMIT_SHA.test(ok)).toBe(true);
    for (const bad of ["", "abc123", "a".repeat(65), "HEAD", "main", "HEAD~1", "abc1234..def5678", "--output=x", "-abc1234", "abc1234\n", "abc1234 ", "abc123g"]) {
      expect(COMMIT_SHA.test(bad)).toBe(false);
    }
  });

  it("reads the asked lines at the commit, with argv as an array rooted at the root and `./` addressing", async () => {
    repoHas("l1\nl2\nl3\nl4");
    expect(await readSourceAt(root, "src/a.ts", SHA, 2, 3)).toEqual({ startLine: 2, lines: ["l2", "l3"], truncated: false });
    expect(git.calls).toEqual([
      { cwd: root.rootPath, args: ["cat-file", "-s", `${SHA}:./src/a.ts`] },
      { cwd: root.rootPath, args: ["cat-file", "blob", `${SHA}:./src/a.ts`] },
    ]);
  });

  it("never reaches git with a bad rev", async () => {
    repoHas("x");
    for (const rev of ["--output=x", "HEAD", "HEAD~1", "main", "", 42, undefined, "abc123"]) {
      expect(await readSourceAt(root, "a.ts", rev, 1, 1)).toBeNull();
    }
    expect(git.calls).toHaveLength(0);
  });

  it("reuses readSource's path check: no `..`, absolute path, NUL or non-string reaches git", async () => {
    repoHas("x");
    for (const rel of ["../x.ts", "src/../../x.ts", "/etc/passwd", "C:\\x.ts", "a.ts\0", 42, ""]) {
      expect(await readSourceAt(root, rel, SHA, 1, 1)).toBeNull();
    }
    expect(git.calls).toHaveLength(0);
  });

  it("does not read a blob over the size cap", async () => {
    repoHas("x", MAX_SOURCE_FILE_BYTES + 1);
    expect(await readSourceAt(root, "big.ts", SHA, 1, 1)).toBeNull();
    expect(git.calls.map((c) => c.args[1])).toEqual(["-s"]);
  });

  it("answers null only when the path is absent at a commit that exists", async () => {
    git.answer = (args) => (args[1] === "-e" ? { stdout: "" } : { failure: "error", stderr: `fatal: Not a valid object name ${SHA}:./a.ts` });
    expect(await readSourceAt(root, "a.ts", SHA, 1, 1)).toBeNull();
    git.answer = (args) => (args[1] === "-e" ? { stdout: "" } : { failure: "error", stderr: `fatal: path 'a.ts' does not exist in '${SHA}'` });
    expect(await readSourceAt(root, "a.ts", SHA, 1, 1)).toBeNull();
    expect(reported).not.toHaveBeenCalled();
  });

  it("throws and reports every other failure: unknown commit, not a repository, timeout, buffer, git missing", async () => {
    const failures: { failure: "error" | "timeout" | "buffer"; stderr?: string }[] = [
      { failure: "error", stderr: `fatal: Not a valid object name ${SHA}:./a.ts` }, // commit unknown: the -e check fails below
      { failure: "error", stderr: "fatal: not a git repository (or any of the parent directories): .git" },
      { failure: "timeout" },
      { failure: "buffer" },
      { failure: "error" }, // git missing: no stderr
    ];
    for (const f of failures) {
      git.answer = () => f;
      await expect(readSourceAt(root, "a.ts", SHA, 1, 1)).rejects.toThrow(/git could not read a\.ts/);
    }
    expect(reported).toHaveBeenCalledTimes(failures.length);
  });

  it("throws when the blob read fails after its size was read", async () => {
    git.answer = (args) => (args[1] === "-s" ? { stdout: "3\n" } : { failure: "error", stderr: "fatal: bad object" });
    await expect(readSourceAt(root, "a.ts", SHA, 1, 1)).rejects.toThrow(/bad object/);
  });
});
