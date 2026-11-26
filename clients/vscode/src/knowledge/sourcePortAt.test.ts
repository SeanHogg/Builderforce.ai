import { beforeEach, describe, expect, it, vi } from "vitest";

const git = vi.hoisted(() => ({
  calls: [] as { cwd: string; args: string[] }[],
  answer: (_args: string[]): { stdout?: string; failure?: string } => ({ failure: "error" }),
}));

vi.mock("vscode", () => ({ Uri: { file: (fsPath: string) => ({ fsPath }) }, workspace: { fs: {} }, window: {}, Range: class {} }));
vi.mock("@builderforce/agent-tools/node-git-history", () => ({
  runGit: async (cwd: string, args: string[]) => { git.calls.push({ cwd, args }); return git.answer(args); },
}));

import { slash, type KnowledgeRoot } from "./knowledgeRoots";
import { COMMIT_SHA, MAX_SOURCE_FILE_BYTES, readSourceAt } from "./sourcePort";

const root: KnowledgeRoot = { rootId: "r", title: "root", rootPath: slash("/repo/root"), folderPath: slash("/repo/root"), rel: "" };
const SHA = "abc1234def";

/** git answers `cat-file -s` with `size` and `cat-file blob` with `blob`. */
const repoHas = (blob: string, size = Buffer.byteLength(blob)): void => {
  git.answer = (args) => (args[1] === "-s" ? { stdout: `${size}\n` } : { stdout: blob });
};

beforeEach(() => {
  git.calls = [];
  git.answer = () => ({ failure: "error" });
});

describe("sourcePort.readSourceAt", () => {
  it("accepts only a 7-40 hex sha", () => {
    for (const ok of ["abc1234", "ABC1234", "a".repeat(40)]) expect(COMMIT_SHA.test(ok)).toBe(true);
    for (const bad of ["abc123", "a".repeat(41), "HEAD", "main", "HEAD~1", "abc1234..def5678", "--output=x", "-abc1234", "abc1234\n", "abc1234 ", "abc123g"]) {
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

  it("answers null when git fails (unknown commit, file absent then, not a repository)", async () => {
    expect(await readSourceAt(root, "a.ts", SHA, 1, 1)).toBeNull();
  });
});
